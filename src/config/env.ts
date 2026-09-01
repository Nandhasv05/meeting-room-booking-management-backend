// AUTHOR : NANDHAKUMAR S V
//VERSION : 1.0.0
//DESCRIPTION : Environment configuration for the booking system
// DATE : 2026-08-26
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Here */
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });
dotenv.config({ path: path.resolve(here, '../../.env') });

/** Schema */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  DB_SERVER: z.string().min(1),
  DB_PORT: z.coerce.number().default(1433),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_ENCRYPT: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  DB_TRUST_SERVER_CERTIFICATE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),
  FRONTEND_URL: z.string().default('http://10.103.10.32'),
  API_URL: z.string().default('http://10.103.10.33/api'),
  API_CRYPTO_KEY: z.string().min(8).default('MeetingHallApiKey'),
  PORTAL_SSO_SECRET: z.string().optional().default(''),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('noreply@corp.local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
});

/** Parsed */
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Invalid environment: ${missing}`);
}

/** Env */
export const env = parsed.data;

/** Is production */
export const isProd = env.NODE_ENV === 'production';

function originOnly(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return String(url || '').replace(/\/$/, '');
  }
}

/** Browser Origin values allowed in production CORS */
export const corsOrigins: string[] | boolean = isProd
  ? Array.from(
      new Set(
        [env.FRONTEND_URL, 'https://apps.evolvclothing.com', 'http://localhost:5173']
          .map(originOnly)
          .filter(Boolean),
      ),
    )
  : true;
