// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Email service
// DATE : 2026-08-26
import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { getMailConfig, mailIsConfigured } from './settings.service.js';

/** Invite guest */
export type InviteGuest = { email: string; name?: string | null };

/** Invitation card */
export type InvitationCard = {
  uid: string;
  to: string;
  toName?: string | null;
  eventName: string;
  eventType: string;
  hallName: string;
  hallLocation?: string | null;
  startAt: Date;
  endAt: Date;
  purpose?: string | null;
  organizerEmail?: string | null;
  organizerName?: string | null;
  bookingNumber: string;
  guests: InviteGuest[];
};

/** Invite send result */
export type InviteSendResult = {
  configured: boolean;
  sent: number;
  failed: number;
  error?: string;
};

/** Format when */
function formatWhen(d: Date): string {
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Escape HTML */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ICS date */
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** ICS escape */
function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold line */
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return parts.join('\r\n');
}

/** Build ICS */
function buildIcs(card: InvitationCard, method: 'REQUEST' | 'CANCEL', senderMailbox?: string): string {
  const uid = `${card.uid}@evolv-halls`;
  const stamp = icsDate(new Date());
  const start = icsDate(card.startAt);
  const end = icsDate(card.endAt);
  const location = [card.hallName, card.hallLocation].filter(Boolean).join(', ');
  const organizerMail = senderMailbox || card.organizerEmail || env.SMTP_FROM || 'noreply@corp.local';
  const organizerCn = icsEscape(card.organizerName || card.organizerEmail || organizerMail);
  const status = method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
  const summary = icsEscape(card.eventName);
  const description = icsEscape(
    [card.purpose, `Hall: ${card.hallName}`, `Booking ${card.bookingNumber}`].filter(Boolean).join('\n'),
  );

  const attendees = card.guests
    .filter((g) => g.email)
    .map((g) => {
      const cn = icsEscape(g.name?.trim() || g.email);
      const partstat = method === 'CANCEL' ? 'DECLINED' : 'NEEDS-ACTION';
      return foldLine(
        `ATTENDEE;CN=${cn};ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat};RSVP=TRUE:mailto:${g.email}`,
      );
    });

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//evolv//Conference Halls//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${summary}`,
    foldLine(`DESCRIPTION:${description}`),
    location ? foldLine(`LOCATION:${icsEscape(location)}`) : null,
    `ORGANIZER;CN=${organizerCn}:mailto:${organizerMail}`,
    ...attendees,
    `STATUS:${status}`,
    `SEQUENCE:${method === 'CANCEL' ? 1 : 0}`,
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Meeting reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line): line is string => Boolean(line));

  return `${lines.join('\r\n')}\r\n`;
}

/** Greeting */
function greeting(card: InvitationCard): string {
  const name = card.toName?.trim();
  if (name) return `Hi ${escapeHtml(name)},`;
  return 'Hello,';
}

/** Build invitation HTML */
export function buildInvitationHtml(card: InvitationCard, cancelled = false): string {
  const when = `${formatWhen(card.startAt)} – ${formatWhen(card.endAt)}`;
  const locationText = card.hallLocation ? escapeHtml(card.hallLocation) : '';
  const accentColor = cancelled ? '#dc2626' : '#1a56db';
  const accentBg = cancelled ? '#fef2f2' : '#eff6ff';
  const statusLabel = cancelled ? 'CANCELLED' : 'CONFIRMED';
  const statusColor = cancelled ? '#dc2626' : '#16a34a';
  const statusBg = cancelled ? '#fef2f2' : '#f0fdf4';

  const guestListHtml = card.guests.length > 0
    ? `<tr>
        <td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #f3f4f6;vertical-align:top">Guests</td>
        <td style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6">${card.guests.map(g => escapeHtml(g.name?.trim() || g.email)).join(', ')}</td>
      </tr>`
    : '';

  const purposeHtml = card.purpose
    ? `<div style="margin:24px 0 0;padding:16px 20px;background:#f9fafb;border-left:3px solid ${accentColor};border-radius:0 6px 6px 0">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:6px">Agenda</div>
        <div style="font-size:14px;color:#1f2937;line-height:1.6">${escapeHtml(card.purpose)}</div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:32px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:0 auto">

          <!-- Logo / Brand -->
          <tr>
            <td style="padding:0 0 24px;text-align:center">
              <span style="font-size:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#374151">EVOLV</span>
              <span style="font-size:14px;color:#d1d5db;margin:0 8px">|</span>
              <span style="font-size:13px;color:#6b7280;letter-spacing:.04em">Conference Halls</span>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08)">

                <!-- Accent Top Bar -->
                <tr>
                  <td style="height:4px;background:${accentColor};border-radius:8px 8px 0 0;font-size:0;line-height:0">&nbsp;</td>
                </tr>

                <!-- Header -->
                <tr>
                  <td style="padding:28px 32px 0">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td>
                          <div style="display:inline-block;padding:4px 10px;background:${statusBg};border-radius:4px;font-size:11px;font-weight:700;color:${statusColor};letter-spacing:.06em;text-transform:uppercase">${statusLabel}</div>
                          <h1 style="margin:12px 0 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3">${escapeHtml(card.eventName)}</h1>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Greeting -->
                <tr>
                  <td style="padding:20px 32px 0">
                    <p style="margin:0;font-size:15px;color:#374151;line-height:1.6">${greeting(card)} ${cancelled ? 'The following meeting has been <strong>cancelled</strong>.' : 'You have been invited to the following meeting.'}</p>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding:20px 32px 0">
                    <div style="border-top:1px solid #e5e7eb"></div>
                  </td>
                </tr>

                <!-- Details Table -->
                <tr>
                  <td style="padding:16px 32px 0">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse">
                      <tr>
                        <td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #f3f4f6;width:120px;vertical-align:top">Date &amp; Time</td>
                        <td style="padding:12px 16px;color:#111827;font-size:14px;font-weight:600;border-bottom:1px solid #f3f4f6">${escapeHtml(when)}</td>
                      </tr>
                      <tr>
                        <td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #f3f4f6;vertical-align:top">Venue</td>
                        <td style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6">
                          ${escapeHtml(card.hallName)}${locationText ? `<br><span style="color:#6b7280;font-size:13px">${locationText}</span>` : ''}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #f3f4f6;vertical-align:top">Meeting Type</td>
                        <td style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6">${escapeHtml(card.eventType)}</td>
                      </tr>
                      <tr>
                        <td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #f3f4f6;vertical-align:top">Reference</td>
                        <td style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6"><code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:13px;color:#374151">${escapeHtml(card.bookingNumber)}</code></td>
                      </tr>
                      ${card.organizerEmail
      ? `<tr>
                            <td style="padding:12px 16px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #f3f4f6;vertical-align:top">Organizer</td>
                            <td style="padding:12px 16px;color:#111827;font-size:14px;border-bottom:1px solid #f3f4f6">${escapeHtml(card.organizerName || '')}${card.organizerName ? '<br>' : ''}<a href="mailto:${escapeHtml(card.organizerEmail)}" style="color:${accentColor};text-decoration:none;font-size:13px">${escapeHtml(card.organizerEmail)}</a></td>
                          </tr>`
      : ''
    }
                      ${guestListHtml}
                    </table>
                  </td>
                </tr>

                <!-- Agenda -->
                <tr>
                  <td style="padding:0 32px">
                    ${purposeHtml}
                  </td>
                </tr>

                <!-- Calendar CTA -->
                <tr>
                  <td style="padding:24px 32px 0;text-align:center">
                    <div style="padding:14px 20px;background:${accentBg};border-radius:6px">
                      <span style="font-size:13px;color:${accentColor}">${cancelled
      ? '📅 This calendar event has been cancelled. The attached .ics file will remove it from your calendar.'
      : '📎 An .ics calendar invite is attached. Open it to add this meeting to your calendar.'
    }</span>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding:28px 32px">
                    <div style="border-top:1px solid #e5e7eb;padding-top:20px">
                      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;text-align:center">
                        This is an automated notification from the <strong style="color:#6b7280">Evolv Conference Hall Booking System</strong>.<br>
                        Please do not reply directly to this email.
                      </p>
                    </div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Sub-Footer -->
          <tr>
            <td style="padding:20px 0;text-align:center">
              <p style="margin:0;font-size:11px;color:#9ca3af">&copy; ${new Date().getFullYear()} Evolv Clothing Pvt Ltd. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Build invitation text */
function buildInvitationText(card: InvitationCard, cancelled = false): string {
  return [
    cancelled ? `Cancelled: ${card.eventName}` : `Invitation: ${card.eventName}`,
    `When: ${formatWhen(card.startAt)} – ${formatWhen(card.endAt)}`,
    `Hall: ${card.hallName}`,
    card.hallLocation ? `Location: ${card.hallLocation}` : null,
    `Booking: ${card.bookingNumber}`,
    card.organizerEmail ? `Organizer: ${card.organizerName ?? card.organizerEmail}` : null,
    card.purpose ? `Agenda: ${card.purpose}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Get transport */
async function getTransport() {
  const cfg = await getMailConfig();
  return {
    cfg,
    transport: nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      requireTLS: cfg.port === 587,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    }),
  };
}

/** SMTP failure message */
function smtpFailureMessage(cfg: { user: string; host: string }, err: unknown): string {
  const detail = err instanceof Error ? err.message : 'SMTP send failed';
  if (/535|BadCredentials|Username and Password not accepted/i.test(detail)) {
    return (
      `Gmail rejected login for ${cfg.user}. The sending mail ID and the 16-character app password must belong to the same Google account ` +
      `(Google Account → Security → 2-Step Verification → App passwords). Do not use the normal Gmail password. ` +
      `If you just changed the sending mail ID, paste a new app password from that account, save, then test again.`
    );
  }
  return `Mail server rejected the message: ${detail}`;
}

/** Archive invitation */
async function archiveInvitation(to: string, html: string): Promise<void> {
  try {
    const dir = path.resolve(env.UPLOAD_DIR, 'invitations');
    await fs.mkdir(dir, { recursive: true });
    const safe = to.replace(/[^a-z0-9._@-]/gi, '_');
    const file = path.join(dir, `${Date.now()}-${safe}.html`);
    await fs.writeFile(file, html, 'utf8');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), to }, 'Could not archive invitation HTML');
  }
}

/** From header */
function fromHeader(cfg: { user: string; from: string }, card: InvitationCard): string {
  const name = (card.organizerName || '').replace(/"/g, '').trim();
  const address = (card.organizerEmail || '').trim().toLowerCase();
  if (name && address) return `"${name}" <${address}>`;
  if (address) return address;
  return cfg.from || cfg.user;
}

/** Deliver */
async function deliver(card: InvitationCard, method: 'REQUEST' | 'CANCEL'): Promise<boolean> {
  const cancelled = method === 'CANCEL';
  const subject = cancelled
    ? `Cancelled: ${card.eventName} · ${formatWhen(card.startAt)}`
    : `Meeting invitation: ${card.eventName} · ${formatWhen(card.startAt)}`;
  const html = buildInvitationHtml(card, cancelled);
  const text = buildInvitationText(card, cancelled);
  await archiveInvitation(card.to, html);

  const { cfg, transport } = await getTransport();
  if (!mailIsConfigured(cfg)) {
    logger.warn({ to: card.to }, 'Invitation not emailed — sending mailbox password is missing');
    return false;
  }

  const ics = buildIcs(card, method, card.organizerEmail || cfg.user);
  const displayedFrom = fromHeader(cfg, card);
  const mail = {
    from: displayedFrom,
    sender: cfg.user,
    to: card.toName ? `"${card.toName.replace(/"/g, '')}" <${card.to}>` : card.to,
    replyTo: card.organizerEmail || undefined,
    envelope: {
      from: cfg.user,
      to: card.to,
    },
    subject,
    text,
    html,
    icalEvent: {
      filename: 'invite.ics',
      method,
      content: ics,
    },
  };
  try {
    const info = await transport.sendMail(mail);
    logger.info(
      { to: card.to, from: card.organizerEmail, via: cfg.user, messageId: info.messageId, method },
      'Meeting invitation emailed',
    );
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    if (!/5\.7\.(1|60)|not allowed to send|cannot send as|Sender address rejected/i.test(detail)) {
      throw err;
    }
    const fallback = await transport.sendMail({
      ...mail,
      from: `"${(card.organizerName || '').replace(/"/g, '').trim() || cfg.user}" <${cfg.user}>`,
    });
    logger.warn(
      { to: card.to, wantedFrom: card.organizerEmail, usedFrom: cfg.user, messageId: fallback.messageId },
      'SMTP would not send as the logged-in user; delivered via the configured mailbox',
    );
    return true;
  }
}

/** Send invitation card */
export async function sendInvitationCard(card: InvitationCard): Promise<boolean> {
  try {
    return await deliver(card, 'REQUEST');
  } catch (err) {
    logger.error({ err, to: card.to }, 'Failed to send meeting invitation');
    return false;
  }
}

/** Send cancellation card */
export async function sendCancellationCard(card: InvitationCard): Promise<boolean> {
  try {
    return await deliver(card, 'CANCEL');
  } catch (err) {
    logger.error({ err, to: card.to }, 'Failed to send cancellation email');
    return false;
  }
}

/** Send meeting invites */
export async function sendMeetingInvites(cards: InvitationCard[]): Promise<InviteSendResult> {
  let cfg;
  try {
    cfg = await getMailConfig();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Mail config failed');
    return {
      configured: false,
      sent: 0,
      failed: cards.length,
      error: 'Mail settings could not be loaded.',
    };
  }
  const configured = mailIsConfigured(cfg);
  if (!configured) {
    return {
      configured: false,
      sent: 0,
      failed: cards.length,
      error: 'Sending mailbox password is missing. Save the Gmail/Outlook app password in Settings.',
    };
  }
  if (cards.length === 0) return { configured, sent: 0, failed: 0 };
  const results = await Promise.all(
    cards.map(async (card) => {
      try {
        return { ok: await deliver(card, 'REQUEST'), error: undefined as string | undefined };
      } catch (err) {
        logger.error({ err, to: card.to }, 'Failed to send meeting invitation');
        return { ok: false, error: smtpFailureMessage(cfg, err) };
      }
    }),
  );
  const sent = results.filter((r) => r.ok).length;
  const error = results.find((r) => r.error)?.error;
  return { configured, sent, failed: results.length - sent, error };
}

/** Send email */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const { cfg, transport } = await getTransport();
  if (!mailIsConfigured(cfg)) {
    throw new AppError('Mail is not configured. Save the sending mailbox app password in Settings.', 400);
  }
  try {
    await transport.sendMail({
      from: cfg.from || cfg.user,
      to,
      subject,
      text: body,
      html: `<pre style="font-family:Segoe UI,Arial,sans-serif">${escapeHtml(body)}</pre>`,
    });
  } catch (err) {
    throw new AppError(smtpFailureMessage(cfg, err), 502);
  }
}

/** Send test mail */
export async function sendTestMail(to: string): Promise<void> {
  await sendEmail(
    to,
    'evolv hall booking — test mail',
    'If you can read this, invitation emails from Save & send invites will reach the inbox.',
  );
}
