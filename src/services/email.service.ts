import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { getMailConfig, mailIsConfigured } from './settings.service.js';

export type InviteGuest = { email: string; name?: string | null };

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

export type InviteSendResult = {
  configured: boolean;
  sent: number;
  failed: number;
  error?: string;
};

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

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

function greeting(card: InvitationCard): string {
  const name = card.toName?.trim();
  if (name) return `Hi ${escapeHtml(name)},`;
  return 'Hello,';
}

export function buildInvitationHtml(card: InvitationCard, cancelled = false): string {
  const when = `${formatWhen(card.startAt)} – ${formatWhen(card.endAt)}`;
  const location = card.hallLocation ? `<p style="margin:4px 0;color:#4a6354">${escapeHtml(card.hallLocation)}</p>` : '';
  const purpose = card.purpose
    ? `<p style="margin:16px 0 0;color:#1a3322"><strong>Agenda:</strong> ${escapeHtml(card.purpose)}</p>`
    : '';
  const title = cancelled ? 'This meeting has been cancelled' : 'You are invited to a meeting';
  const header = cancelled ? '#7f1d1d' : '#122315';
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#e8f0eb;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d3ded7;border-radius:12px">
    <tr>
      <td style="padding:20px 24px;background:${header};color:#fff;border-radius:12px 12px 0 0">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.75">evolv · Conference halls</div>
        <h1 style="margin:8px 0 0;font-size:22px">${escapeHtml(card.eventName)}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:24px">
        <p style="margin:0 0 12px;color:#122315;font-size:15px">${greeting(card)} ${title}.</p>
        <table width="100%" style="border-collapse:collapse;font-size:14px;color:#122315">
          <tr><td style="padding:8px 0;width:120px;color:#64786d">When</td><td><strong>${escapeHtml(when)}</strong></td></tr>
          <tr><td style="padding:8px 0;color:#64786d">Hall</td><td>${escapeHtml(card.hallName)}${location}</td></tr>
          <tr><td style="padding:8px 0;color:#64786d">Type</td><td>${escapeHtml(card.eventType)}</td></tr>
          <tr><td style="padding:8px 0;color:#64786d">Booking</td><td>${escapeHtml(card.bookingNumber)}</td></tr>
          ${
            card.organizerEmail
              ? `<tr><td style="padding:8px 0;color:#64786d">Organizer</td><td>${escapeHtml(
                  card.organizerName ? `${card.organizerName} · ${card.organizerEmail}` : card.organizerEmail,
                )}</td></tr>`
              : ''
          }
        </table>
        ${purpose}
        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">${
          cancelled
            ? 'This calendar event has been cancelled.'
            : 'Open the attached calendar invite to add this meeting to your calendar.'
        }</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

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

async function archiveInvitation(to: string, html: string): Promise<void> {
  const dir = path.resolve(env.UPLOAD_DIR, 'invitations');
  await fs.mkdir(dir, { recursive: true });
  const safe = to.replace(/[^a-z0-9._@-]/gi, '_');
  const file = path.join(dir, `${Date.now()}-${safe}.html`);
  await fs.writeFile(file, html, 'utf8');
}

function fromHeader(cfg: { user: string; from: string }, card: InvitationCard): string {
  const name = (card.organizerName || '').replace(/"/g, '').trim();
  const address = (card.organizerEmail || '').trim().toLowerCase();
  if (name && address) return `"${name}" <${address}>`;
  if (address) return address;
  return cfg.from || cfg.user;
}

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

export async function sendInvitationCard(card: InvitationCard): Promise<boolean> {
  try {
    return await deliver(card, 'REQUEST');
  } catch (err) {
    logger.error({ err, to: card.to }, 'Failed to send meeting invitation');
    return false;
  }
}

export async function sendCancellationCard(card: InvitationCard): Promise<boolean> {
  try {
    return await deliver(card, 'CANCEL');
  } catch (err) {
    logger.error({ err, to: card.to }, 'Failed to send cancellation email');
    return false;
  }
}

export async function sendMeetingInvites(cards: InvitationCard[]): Promise<InviteSendResult> {
  const cfg = await getMailConfig();
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

export async function sendTestMail(to: string): Promise<void> {
  await sendEmail(
    to,
    'evolv hall booking — test mail',
    'If you can read this, invitation emails from Save & send invites will reach the inbox.',
  );
}
