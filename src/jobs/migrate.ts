import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../config/logger.js';
import { getAdminPool, closePool, getPool } from '../config/database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../');

function splitSql(raw: string): string[] {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
}

async function main() {
  const admin = await getAdminPool();
  const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
  for (const stmt of splitSql(schema)) {
    await admin.query(stmt);
  }
  await admin.end();

  const pool = await getPool();
  const seeds = fs.readFileSync(path.join(root, 'database/seeds/001_lookups.sql'), 'utf8');
  for (const stmt of splitSql(seeds)) {
    if (/^USE\s+/i.test(stmt)) continue;
    await pool.query(stmt);
  }
  logger.info('MySQL migration complete');
  await closePool();
}

main().catch((err) => {
  logger.fatal({ err }, 'migration failed');
  process.exit(1);
});
