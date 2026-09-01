import { query } from '../config/database.js';
import { queryOneSoft, querySoft } from '../config/sqlSoft.js';
import { isDirectoryAdmin } from '../config/directoryAccess.js';
import { logger } from '../config/logger.js';
import { todayInAppTz } from '../utils/clock.js';
import { countDirectoryUsers } from './clientApiUsers.js';

type Stats = {
  TotalHalls: number;
  AvailableHalls: number;
  OccupiedHalls: number;
  MaintenanceHalls: number;
  TodayBookings: number;
  UpcomingEvents: number;
  PendingApprovals: number;
  AttendeesToday: number;
  TotalUsers: number;
  ActiveUsers: number;
  CancelledLast30: number;
  Departments: number;
};

const EMPTY_STATS: Stats = {
  TotalHalls: 0,
  AvailableHalls: 0,
  OccupiedHalls: 0,
  MaintenanceHalls: 0,
  TodayBookings: 0,
  UpcomingEvents: 0,
  PendingApprovals: 0,
  AttendeesToday: 0,
  TotalUsers: 0,
  ActiveUsers: 0,
  CancelledLast30: 0,
  Departments: 0,
};

async function section<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn(
      { label, err: err instanceof Error ? err.message : String(err) },
      'Dashboard section failed',
    );
    return fallback;
  }
}

function groupDirectoryRoles(
  rows: Array<{ Role?: unknown; Department?: unknown; IsAdmin?: unknown }>,
) {
  let admin = 0;
  let employee = 0;
  for (const row of rows) {
    if (isDirectoryAdmin({ role: row.Role, department: row.Department, isAdmin: row.IsAdmin })) {
      admin += 1;
    } else {
      employee += 1;
    }
  }
  return [
    { RoleName: 'Administrator', RoleCode: 'ADMINISTRATOR', Count: admin },
    { RoleName: 'Employee', RoleCode: 'EMPLOYEE', Count: employee },
  ].filter((row) => row.Count > 0);
}

async function loadUsersByRole() {
  try {
    return groupDirectoryRoles(
      await query<{ Role: unknown; Department: unknown; IsAdmin: unknown }>(
        `SELECT Role, Department, IsAdmin FROM dbo.users`,
      ),
    );
  } catch {
    return groupDirectoryRoles(
      await query<{ Role: unknown; Department: unknown }>(`SELECT Role, Department FROM dbo.users`),
    );
  }
}

export async function getDashboard() {
  const today = todayInAppTz();

  const stats = await section('stats', { ...EMPTY_STATS }, async () => {
    const row = await queryOneSoft<Stats>(
      `
      SELECT
        (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND IsActive = 1) AS TotalHalls,
        (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND IsActive = 1 AND Status = N'AVAILABLE') AS AvailableHalls,
        (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND Status IN (N'OCCUPIED', N'BOOKED')) AS OccupiedHalls,
        (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND Status = N'MAINTENANCE') AS MaintenanceHalls,
        (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND CAST(DATEADD(MINUTE, 330, StartAt) AS DATE) = @Today
           AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')) AS TodayBookings,
        (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND Status IN (N'CONFIRMED', N'APPROVED') AND StartAt > SYSUTCDATETIME()) AS UpcomingEvents,
        (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND Status = N'PENDING') AS PendingApprovals,
        (SELECT COALESCE(SUM(AttendeeCount), 0) FROM dbo.bookings WHERE DeletedAt IS NULL
           AND CAST(DATEADD(MINUTE, 330, StartAt) AS DATE) = @Today
           AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')) AS AttendeesToday,
        0 AS TotalUsers,
        0 AS ActiveUsers,
        (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND Status = N'CANCELLED'
           AND CreatedAt >= DATEADD(DAY, -30, SYSUTCDATETIME())) AS CancelledLast30,
        (SELECT COUNT(*) FROM dbo.departments WHERE IsActive = 1) AS Departments
    `,
      { Today: today },
    );
    return row ?? { ...EMPTY_STATS };
  });

  const utilization = await section('utilization', [], () =>
    querySoft<{ HallName: string; HoursBooked: number }>(`
      SELECT h.Name AS HallName,
             CAST(ROUND(COALESCE(SUM(DATEDIFF(MINUTE, b.StartAt, b.EndAt)), 0) / 60.0, 2) AS float) AS HoursBooked
      FROM dbo.conference_halls h
      LEFT JOIN dbo.bookings b ON b.HallId = h.Id AND b.DeletedAt IS NULL
        AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
        AND b.StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
      WHERE h.DeletedAt IS NULL AND h.IsActive = 1
      GROUP BY h.Id, h.Name
      ORDER BY HoursBooked DESC
    `),
  );

  const byDepartment = await section('byDepartment', [], () =>
    querySoft<{ Department: string; Count: number }>(`
      SELECT d.Name AS Department, COUNT(*) AS Count
      FROM dbo.bookings b
      JOIN dbo.departments d ON d.Id = b.DepartmentId
      WHERE b.DeletedAt IS NULL AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
        AND b.StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
      GROUP BY d.Id, d.Name
      ORDER BY Count DESC
    `),
  );

  const byEventType = await section('byEventType', [], () =>
    querySoft<{ EventType: string; Count: number }>(`
      SELECT EventType, COUNT(*) AS Count
      FROM dbo.bookings
      WHERE DeletedAt IS NULL AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
        AND StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
      GROUP BY EventType
      ORDER BY Count DESC
    `),
  );

  const trend = await section('trend', [], () =>
    querySoft<{ Period: string; Count: number }>(`
      SELECT CONVERT(varchar(10), StartAt, 23) AS Period, COUNT(*) AS Count
      FROM dbo.bookings
      WHERE DeletedAt IS NULL AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
        AND StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
      GROUP BY CONVERT(varchar(10), StartAt, 23)
      ORDER BY Period
    `),
  );

  const peakHours = await section('peakHours', [], () =>
    querySoft<{ Hour: number; Count: number }>(`
      SELECT DATEPART(HOUR, StartAt) AS Hour, COUNT(*) AS Count
      FROM dbo.bookings
      WHERE DeletedAt IS NULL AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
        AND StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
      GROUP BY DATEPART(HOUR, StartAt)
      ORDER BY Hour
    `),
  );

  const todaySchedule = await section('todaySchedule', [], () =>
    querySoft(
      `
      SELECT CAST(b.Id AS nvarchar(32)) AS Id, b.EventName, b.StartAt, b.EndAt, b.Status,
             h.Name AS HallName, h.Code AS HallCode,
             o.UserName AS OrganizerName, b.AttendeeCount
      FROM dbo.bookings b
      JOIN dbo.conference_halls h ON h.Id = b.HallId
      LEFT JOIN dbo.users o ON CAST(o.Id AS nvarchar(64)) = CAST(b.OrganizerId AS nvarchar(64))
      WHERE b.DeletedAt IS NULL AND CAST(DATEADD(MINUTE, 330, b.StartAt) AS DATE) = @Today
        AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
      ORDER BY b.StartAt
      OFFSET 0 ROWS FETCH NEXT 12 ROWS ONLY
    `,
      { Today: today },
    ),
  );

  const upcoming = await section('upcoming', [], () =>
    querySoft(`
      SELECT CAST(b.Id AS nvarchar(32)) AS Id, b.EventName, b.StartAt, b.EndAt, b.Status,
             h.Name AS HallName, o.UserName AS OrganizerName
      FROM dbo.bookings b
      JOIN dbo.conference_halls h ON h.Id = b.HallId
      LEFT JOIN dbo.users o ON CAST(o.Id AS nvarchar(64)) = CAST(b.OrganizerId AS nvarchar(64))
      WHERE b.DeletedAt IS NULL AND b.StartAt > SYSUTCDATETIME()
        AND b.Status IN (N'CONFIRMED', N'APPROVED', N'PENDING')
      ORDER BY b.StartAt
      OFFSET 0 ROWS FETCH NEXT 8 ROWS ONLY
    `),
  );

  const recent = await section('recent', [], () =>
    querySoft(`
      SELECT CAST(b.Id AS nvarchar(32)) AS Id, b.EventName, b.CreatedAt, b.Status,
             h.Name AS HallName, b.BookingNumber
      FROM dbo.bookings b
      JOIN dbo.conference_halls h ON h.Id = b.HallId
      WHERE b.DeletedAt IS NULL
      ORDER BY b.CreatedAt DESC
      OFFSET 0 ROWS FETCH NEXT 8 ROWS ONLY
    `),
  );

  const usersByRole = await section('usersByRole', [], loadUsersByRole);

  const hallBoard = await section('hallBoard', [], () =>
    querySoft<{
      Id: string;
      Name: string;
      Code: string;
      Status: string;
      Capacity: number;
      CurrentEvent: string | null;
    }>(`
      SELECT CAST(h.Id AS nvarchar(32)) AS Id, h.Name, h.Code, h.Status, h.Capacity,
             cur.EventName AS CurrentEvent
      FROM dbo.conference_halls h
      OUTER APPLY (
        SELECT TOP (1) b.EventName
        FROM dbo.bookings b
        WHERE b.HallId = h.Id AND b.DeletedAt IS NULL
          AND b.Status IN (N'ONGOING', N'CONFIRMED', N'APPROVED')
          AND b.StartAt <= SYSUTCDATETIME() AND b.EndAt > SYSUTCDATETIME()
        ORDER BY b.StartAt
      ) cur
      WHERE h.DeletedAt IS NULL AND h.IsActive = 1
      ORDER BY h.Name
    `),
  );

  try {
    const directoryCount = await countDirectoryUsers();
    stats.TotalUsers = directoryCount;
    stats.ActiveUsers = directoryCount;
  } catch {
    try {
      const row = await queryOneSoft<{ C: number }>(`SELECT COUNT(*) AS C FROM dbo.users`);
      const count = Number(row?.C ?? 0);
      stats.TotalUsers = count;
      stats.ActiveUsers = count;
    } catch {
      /* keep zeros */
    }
  }

  return {
    stats,
    utilization,
    byDepartment,
    byEventType,
    trend,
    peakHours,
    todaySchedule,
    upcoming,
    recent,
    usersByRole,
    hallBoard,
  };
}
