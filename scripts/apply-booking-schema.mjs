import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import sql from 'mssql';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(here, '../.env') });

const server = process.env.SCHEMA_DB_SERVER || process.env.DB_SERVER;
const database = process.env.DB_NAME || 'CLIENT_API_LIVE';
const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;

if (!server || !user || !password) {
  console.error('Missing DB_SERVER/DB_USER/DB_PASSWORD');
  process.exit(1);
}

function batches(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/^\s*GO\s*$/gim)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^--.*$/gm, '').trim().length > 0);
}

async function runFile(pool, file) {
  console.log('Running', path.basename(file));
  for (const batch of batches(file)) {
    try {
      await pool.request().query(batch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists|Cannot find the object|Cannot find the user/i.test(message)) {
        console.warn('skip:', message.split('\n')[0]);
        continue;
      }
      throw err;
    }
  }
}

const pool = await sql.connect({
  server,
  port: Number(process.env.DB_PORT || 1433),
  database,
  user,
  password,
  options: { encrypt: true, trustServerCertificate: true },
});

console.log(`Connected ${user}@${server}/${database}`);
await runFile(pool, path.join(root, 'database/sqlserver/booking_schema.sql'));
await runFile(pool, path.join(root, 'database/sqlserver/grant_booking_tables.sql'));

const check = await pool.request().query(`
  SELECT
    OBJECT_ID(N'dbo.mh_contacts', N'U') AS contacts,
    OBJECT_ID(N'dbo.mh_sessions', N'U') AS sessions,
    OBJECT_ID(N'dbo.users', N'U') AS users,
    (SELECT COUNT(*) FROM dbo.users) AS userCount
`);
console.log(check.recordset[0]);
if (!check.recordset[0].contacts) {
  console.error('dbo.mh_contacts is still missing');
  process.exit(1);
}
if (!check.recordset[0].users) {
  console.error('dbo.users is missing — aborting');
  process.exit(1);
}
await pool.close();
