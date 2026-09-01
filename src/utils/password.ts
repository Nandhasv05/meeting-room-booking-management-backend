import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

function rounds(): number {
  const value = Number(env.BCRYPT_ROUNDS ?? 10);
  return Number.isFinite(value) && value >= 4 ? value : 10;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(String(plain ?? ''), rounds());
}

export async function hashPasswordAsync(plain: string): Promise<string> {
  return bcrypt.hash(String(plain ?? ''), rounds());
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!plain || !hash) return false;
  return bcrypt.compareSync(String(plain), String(hash));
}

export const hash = hashPassword;
export const compare = verifyPassword;

export async function verifyPasswordAsync(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}
