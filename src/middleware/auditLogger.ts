import type { Request } from 'express';
import { query } from '../config/database.js';

export async function writeAudit(input: {
  userId?: string | null;
  action: string;
  module: string;
  recordId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  req?: Request;
}): Promise<void> {
  await query(
    `INSERT INTO dbo.audit_logs (UserId, Action, Module, RecordId, OldValue, NewValue, IpAddress, UserAgent)
     VALUES (@UserId, @Action, @Module, @RecordId, @OldValue, @NewValue, @IpAddress, @UserAgent)`,
    {
      UserId: input.userId ?? null,
      Action: input.action,
      Module: input.module,
      RecordId: input.recordId ?? null,
      OldValue: input.oldValue ? JSON.stringify(input.oldValue) : null,
      NewValue: input.newValue ? JSON.stringify(input.newValue) : null,
      IpAddress: input.req?.ip ?? null,
      UserAgent: input.req?.get('user-agent')?.slice(0, 300) ?? null,
    },
  );
}

export function auditLogger(action: string, module: string) {
  return async (req: Request, recordId: string, oldValue?: unknown, newValue?: unknown): Promise<void> => {
    await writeAudit({
      userId: req.user?.id,
      action,
      module,
      recordId,
      oldValue,
      newValue,
      req,
    });
  };
}
