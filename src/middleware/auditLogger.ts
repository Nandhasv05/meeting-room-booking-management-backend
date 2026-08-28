// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Audit logger
// DATE : 2026-08-26
import type { Request } from 'express';
import { query } from '../config/database.js';

/** Write audit */
export async function writeAudit(input: {
  userId?: string | null;
  action: string;
  module: string;
  recordId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  req?: Request;
}): Promise<void> {
  try {
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
  } catch {
    /* dbo.audit_logs may not exist until booking_schema.sql is applied */
  }
}

/** Audit logger */
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
