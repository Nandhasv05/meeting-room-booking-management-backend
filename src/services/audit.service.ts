// AUTHOR : NANDHAKUMAR S V
// DATE : 28/08/2026
// DESCRIPTION : Audit log service
import { query, queryOne } from '../config/database.js';
import type { Paged } from '../types/index.js';


/** List audit logs */
export async function listAuditLogs(filters: {
  q?: string;
  module?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}): Promise<Paged<Record<string, unknown>>> {
  const where = ['1 = 1'];
  const inputs: Record<string, unknown> = {
    Offset: (filters.page - 1) * filters.pageSize,
    PageSize: filters.pageSize,
  };
  if (filters.module) {
    where.push('a.Module = @Module');
    inputs.Module = filters.module;
  }
  if (filters.q) {
    where.push(`(a.Action LIKE @Q OR u.Email LIKE @Q OR a.RecordId LIKE @Q)`);
    inputs.Q = `%${filters.q}%`;
  }
  if (filters.from) {
    where.push('a.CreatedAt >= @From');
    inputs.From = new Date(filters.from);
  }
  if (filters.to) {
    where.push('a.CreatedAt <= @To');
    inputs.To = new Date(filters.to);
  }
  const clause = where.join(' AND ');
  const total = await queryOne<{ Cnt: number }>(
    `SELECT COUNT(*) AS Cnt FROM dbo.audit_logs a LEFT JOIN dbo.users u ON CAST(u.Id AS nvarchar(64)) = CAST(a.UserId AS nvarchar(64)) WHERE ${clause}`,
    inputs,
  );
  const items = await query<Record<string, unknown>>(
    `SELECT a.Id, a.UserId, u.UserName AS UserName, u.Email, a.Action, a.Module,
            a.RecordId, a.OldValue, a.NewValue, a.IpAddress, a.CreatedAt
     FROM dbo.audit_logs a
     LEFT JOIN dbo.users u ON CAST(u.Id AS nvarchar(64)) = CAST(a.UserId AS nvarchar(64))
     WHERE ${clause}
     ORDER BY a.CreatedAt DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY`,
    inputs,
  );
  return { items, page: filters.page, pageSize: filters.pageSize, total: total?.Cnt ?? 0 };
}
