import { insert, query, queryOne } from '../config/database.js';
import { querySoft } from '../config/sqlSoft.js';
import { AppError } from '../utils/AppError.js';
import type { AuthUser } from '../types/index.js';

export type ContactRow = {
  Id: string;
  Name: string;
  Email: string;
  Phone: string | null;
  CreatedAt: Date;
};

function normalizeEmail(value: string) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeName(value: string) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function displayName(name: string | undefined, email: string) {
  const trimmed = String(name ?? '').trim();
  return trimmed || email.split('@')[0] || 'Contact';
}

function mapRow(row: { Id: string | number; Name: string; Email: string; Phone: string | null; CreatedAt: Date }): ContactRow {
  return {
    Id: String(row.Id),
    Name: row.Name,
    Email: row.Email,
    Phone: row.Phone,
    CreatedAt: row.CreatedAt,
  };
}

export async function listContacts(q?: string): Promise<ContactRow[]> {
  const search = String(q ?? '').trim();
  const rows = await querySoft<{ Id: string | number; Name: string; Email: string; Phone: string | null; CreatedAt: Date }>(
    `SELECT Id, Name, Email, Phone, CreatedAt
     FROM dbo.mh_contacts
     WHERE DeletedAt IS NULL
       AND (
         @Q = N''
         OR Name LIKE @Like
         OR Email LIKE @Like
         OR ISNULL(Phone, N'') LIKE @Like
       )
     ORDER BY Name, Email`,
    { Q: search, Like: search ? `%${search}%` : '%' },
  );
  return rows.map(mapRow);
}

export async function upsertContact(
  actor: AuthUser,
  input: { id?: string; name?: string; email: string; phone?: string },
): Promise<ContactRow> {
  const email = normalizeEmail(input.email);
  if (!email) throw new AppError('Enter a valid email.', 400);
  const name = displayName(input.name, email);
  const phone = String(input.phone ?? '').trim() || null;
  const existing = input.id
    ? await queryOne<{ Id: string | number }>(
        `SELECT Id FROM dbo.mh_contacts WHERE Id = @Id AND DeletedAt IS NULL`,
        { Id: input.id },
      )
    : await queryOne<{ Id: string | number }>(
        `SELECT Id FROM dbo.mh_contacts WHERE DeletedAt IS NULL AND LOWER(Email) = @Email`,
        { Email: email },
      );

  if (existing) {
    const taken = await queryOne<{ Id: string | number }>(
      `SELECT Id FROM dbo.mh_contacts
       WHERE DeletedAt IS NULL AND LOWER(Email) = @Email AND Id <> @Id`,
      { Email: email, Id: String(existing.Id) },
    );
    if (taken) throw new AppError('A contact with this email already exists.', 409);
    await query(
      `UPDATE dbo.mh_contacts
       SET Name = @Name, Email = @Email, Phone = @Phone, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @Actor
       WHERE Id = @Id`,
      { Id: String(existing.Id), Name: name, Email: email, Phone: phone, Actor: actor.id },
    );
    const row = await queryOne<{ Id: string | number; Name: string; Email: string; Phone: string | null; CreatedAt: Date }>(
      `SELECT Id, Name, Email, Phone, CreatedAt FROM dbo.mh_contacts WHERE Id = @Id`,
      { Id: String(existing.Id) },
    );
    if (!row) throw new AppError('Contact was updated but could not be loaded.', 500);
    return mapRow(row);
  }

  try {
    const id = await insert(
      `INSERT INTO dbo.mh_contacts (Name, Email, Phone, CreatedBy, UpdatedBy)
       VALUES (@Name, @Email, @Phone, @Actor, @Actor)`,
      { Name: name, Email: email, Phone: phone, Actor: actor.id },
    );
    const row = await queryOne<{ Id: string | number; Name: string; Email: string; Phone: string | null; CreatedAt: Date }>(
      `SELECT Id, Name, Email, Phone, CreatedAt FROM dbo.mh_contacts WHERE Id = @Id`,
      { Id: id },
    );
    if (!row) throw new AppError('Contact was created but could not be loaded.', 500);
    return mapRow(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UQ_mh_contacts_Email|duplicate/i.test(message)) {
      throw new AppError('A contact with this email already exists.', 409);
    }
    throw err;
  }
}

export async function importContacts(
  actor: AuthUser,
  rows: Array<{ name?: string; email: string; phone?: string }>,
) {
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const before = await queryOne<{ Id: string | number }>(
      `SELECT Id FROM dbo.mh_contacts WHERE DeletedAt IS NULL AND LOWER(Email) = @Email`,
      { Email: email },
    );
    await upsertContact(actor, { ...row, email });
    if (before) updated += 1;
    else added += 1;
  }
  return { added, updated, total: added + updated };
}

export async function deleteContact(id: string): Promise<void> {
  const existing = await queryOne<{ Id: string | number }>(
    `SELECT Id FROM dbo.mh_contacts WHERE Id = @Id AND DeletedAt IS NULL`,
    { Id: id },
  );
  if (!existing) throw new AppError('Contact not found.', 404);
  await query(
    `UPDATE dbo.mh_contacts SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id`,
    { Id: id },
  );
}
