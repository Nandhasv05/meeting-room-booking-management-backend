// AUTHOR : NANDHAKUMAR S V
// DATE : 31/08/2026
// DESCRIPTION : Verify short-lived SSO tickets issued by the EVOL PHP portal
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './AppError.js';


const usedTickets = new Map<string, number>();

function pruneUsedTickets(now = Date.now()) {
  for (const [key, exp] of usedTickets) {
    if (exp <= now) usedTickets.delete(key);
  }
}

function hmacHex(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function signaturesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given.toLowerCase(), 'utf8');
  const b = Buffer.from(expected.toLowerCase(), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function decodePayload(body: string): { u?: unknown; exp?: unknown } {
  const padded = body.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return JSON.parse(Buffer.from(padded + pad, 'base64').toString('utf8')) as { u?: unknown; exp?: unknown };
}

function portalSsoSecret(): string {
  return String(process.env.PORTAL_SSO_SECRET || '').trim();
}

export function isPortalSsoConfigured(): boolean {
  return Boolean(portalSsoSecret());
}

/** Return directory login (UserName or Email) from a portal ticket. */
export function verifyPortalTicket(ticket: string): string {
  const secret = portalSsoSecret();
  if (!secret) {
    throw new AppError('Portal SSO is not configured.', 503);
  }
  const trimmed = String(ticket ?? '').trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot < 1) {
    throw new AppError('Invalid portal ticket.', 401);
  }
  const body = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!signaturesMatch(sig, hmacHex(body, secret))) {
    throw new AppError('Invalid portal ticket.', 401);
  }
  pruneUsedTickets();
  const expMs = usedTickets.get(trimmed);
  if (expMs) {
    throw new AppError('Portal ticket already used.', 401);
  }
  let payload: { u?: unknown; exp?: unknown };
  try {
    payload = decodePayload(body);
  } catch {
    throw new AppError('Invalid portal ticket.', 401);
  }
  const login = String(payload.u ?? '').trim();
  const exp = Number(payload.exp);
  if (!login || !Number.isFinite(exp)) {
    throw new AppError('Invalid portal ticket.', 401);
  }
  if (exp * 1000 < Date.now()) {
    throw new AppError('Portal ticket expired. Open Meeting Hall from the portal again.', 401);
  }
  usedTickets.set(trimmed, exp * 1000);
  return login;
}
