import crypto from 'node:crypto';

/** JWT / token identifiers only — table primary keys are BIGINT AUTO_INCREMENT. */
export function newId(): string {
  return crypto.randomUUID();
}

export function newQrToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function bookingNumber(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const n = crypto.randomInt(1000, 9999);
  return `BK-${y}${m}${d}-${n}`;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
