import { query } from './database.js';

type SqlInputs = Record<string, unknown>;

function isMissingTable(err: unknown): boolean {
  return /Invalid object name/i.test(err instanceof Error ? err.message : String(err));
}

/** Query that returns [] when a booking table is not installed yet. */
export async function querySoft<T>(text: string, inputs?: SqlInputs): Promise<T[]> {
  try {
    return await query<T>(text, inputs);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function queryOneSoft<T>(text: string, inputs?: SqlInputs): Promise<T | null> {
  const rows = await querySoft<T>(text, inputs);
  return rows[0] ?? null;
}
