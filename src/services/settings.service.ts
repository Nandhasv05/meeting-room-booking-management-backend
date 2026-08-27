import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, insert } from '../config/database.js';
import { env } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILES = [path.resolve(here, '../../../.env'), path.resolve(here, '../../.env')];

/** Shown in Settings when a password is already stored — never send the real secret to the browser. */
export const SMTP_PASSWORD_MASK = '********';

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return String(value);
}

function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const map: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function liveEnvMail(): { host: string; port: string; user: string; password: string; from: string } {
  const file = ENV_FILES.map(parseEnvFile).reduce((acc, cur) => ({ ...acc, ...cur }), {} as Record<string, string>);
  return {
    host: (file.SMTP_HOST || env.SMTP_HOST || '').trim(),
    port: String(file.SMTP_PORT || env.SMTP_PORT || 587).trim(),
    user: (file.SMTP_USER || env.SMTP_USER || '').trim(),
    password: (file.SMTP_PASSWORD || env.SMTP_PASSWORD || '').replace(/\s+/g, ''),
    from: (file.SMTP_FROM || env.SMTP_FROM || '').trim(),
  };
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<Record<string, unknown>>(`SELECT [Value] FROM dbo.system_settings WHERE [Key] = @Key`, {
    Key: key,
  });
  if (!row) return null;
  return asText(row.Value ?? row.value);
}

export async function getSettingBool(key: string, fallback = false): Promise<boolean> {
  const value = await getSetting(key);
  if (value == null) return fallback;
  return value === 'true' || value === '1';
}

const MAIL_DEFAULTS: { key: string; value: string; description: string }[] = [
  { key: 'smtp.host', value: 'smtp.gmail.com', description: 'SMTP server (Gmail: smtp.gmail.com, Outlook: smtp.office365.com)' },
  { key: 'smtp.port', value: '587', description: 'SMTP port (587 for STARTTLS)' },
  { key: 'smtp.user', value: 'nandhakumarsv2002@gmail.com', description: 'Mailbox that delivers invitations' },
  { key: 'smtp.password', value: '', description: 'Gmail app password (not the normal Gmail password)' },
  { key: 'smtp.from', value: 'Nandhakumar <nandhakumarsv2002@gmail.com>', description: 'From name and address' },
];

async function writeSetting(key: string, value: string, actorId?: string): Promise<void> {
  const existing = await queryOne<{ Id: string }>(`SELECT Id FROM dbo.system_settings WHERE [Key] = @Key`, {
    Key: key,
  });
  if (existing) {
    await query(
      `UPDATE dbo.system_settings SET [Value] = @Value, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @Actor WHERE [Key] = @Key`,
      { Value: value, Actor: actorId ?? null, Key: key },
    );
    return;
  }
  await insert(
    `INSERT INTO dbo.system_settings ([Key], [Value], UpdatedBy)
     VALUES (@Key, @Value, @Actor)`,
    { Key: key, Value: value, Actor: actorId ?? null },
  );
}

export async function ensureMailSettings(): Promise<void> {
  for (const row of MAIL_DEFAULTS) {
    const existing = await queryOne<{ Id: string }>(`SELECT Id FROM dbo.system_settings WHERE [Key] = @Key`, {
      Key: row.key,
    });
    if (existing) continue;
    await insert(
      `INSERT INTO dbo.system_settings ([Key], [Value], Description)
       VALUES (@Key, @Value, @Description)`,
      { Key: row.key, Value: row.value, Description: row.description },
    );
  }
  await hydrateMailFromEnv();
}

/** If Settings still has a blank SMTP field, copy it from .env so invites can send. */
export async function hydrateMailFromEnv(): Promise<void> {
  const fromEnv = liveEnvMail();
  const fill: { key: string; value: string }[] = [
    { key: 'smtp.host', value: fromEnv.host },
    { key: 'smtp.port', value: fromEnv.port },
    { key: 'smtp.user', value: fromEnv.user },
    { key: 'smtp.password', value: fromEnv.password },
    { key: 'smtp.from', value: fromEnv.from },
  ];
  for (const row of fill) {
    if (!row.value) continue;
    const current = ((await getSetting(row.key)) || '').trim();
    if (current) continue;
    await writeSetting(row.key, row.value);
  }
}

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

function normalizeFrom(from: string, user: string): string {
  const trimmed = from.trim();
  if (!user) return trimmed;
  if (!trimmed) return user;
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed.replace(/[<>]/g, '')} <${user}>`;
}

export async function getMailConfig(): Promise<MailConfig> {
  await ensureMailSettings();
  const fromEnv = liveEnvMail();
  const host = ((await getSetting('smtp.host')) || fromEnv.host || '').trim();
  const port = Number((await getSetting('smtp.port')) || fromEnv.port || 587);
  const user = ((await getSetting('smtp.user')) || fromEnv.user || '').trim().toLowerCase();
  const password = ((await getSetting('smtp.password')) || fromEnv.password || '').replace(/\s+/g, '');
  const from = normalizeFrom((await getSetting('smtp.from')) || fromEnv.from || user, user);
  return { host, port: Number.isFinite(port) ? port : 587, user, password, from };
}

export function mailIsConfigured(cfg: MailConfig): boolean {
  return Boolean(cfg.host && cfg.user && cfg.password);
}

export async function listSettings() {
  await ensureMailSettings();
  const rows = await query<{ Id: string; Key: string; Value: string; Description: string; UpdatedAt: Date }>(
    `SELECT Id, [Key], [Value], Description, UpdatedAt FROM dbo.system_settings ORDER BY [Key]`,
  );
  const cfg = await getMailConfig();
  return rows.map((row) => {
    const key = String((row as { Key?: string; key?: string }).Key ?? (row as { key?: string }).key ?? '');
    if (key !== 'smtp.password') return row;
    return { ...row, Value: cfg.password ? SMTP_PASSWORD_MASK : '' };
  });
}

export async function updateSettings(actorId: string, entries: { key: string; value: string }[]) {
  await ensureMailSettings();
  for (const entry of entries) {
    let value = entry.value;
    if (entry.key === 'smtp.password') {
      value = value.replace(/\s+/g, '');
      if (!value || value === SMTP_PASSWORD_MASK) continue;
    }
    await writeSetting(entry.key, value, actorId);
  }
  return listSettings();
}
