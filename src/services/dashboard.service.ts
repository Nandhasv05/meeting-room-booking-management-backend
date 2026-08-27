import { query, queryOne } from '../config/database.js';

export async function getDashboard() {
  const stats = await queryOne<{
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
  }>(`
    SELECT
      (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND IsActive = 1) AS TotalHalls,
      (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND IsActive = 1 AND Status = N'AVAILABLE') AS AvailableHalls,
      (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND Status IN (N'OCCUPIED', N'BOOKED')) AS OccupiedHalls,
      (SELECT COUNT(*) FROM dbo.conference_halls WHERE DeletedAt IS NULL AND Status = N'MAINTENANCE') AS MaintenanceHalls,
      (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND DATE(StartAt) = DATE(SYSUTCDATETIME())
         AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')) AS TodayBookings,
      (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND Status IN (N'CONFIRMED', N'APPROVED') AND StartAt > SYSUTCDATETIME()) AS UpcomingEvents,
      (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND Status = N'PENDING') AS PendingApprovals,
      (SELECT COALESCE(SUM(AttendeeCount), 0) FROM dbo.bookings WHERE DeletedAt IS NULL
         AND DATE(StartAt) = DATE(SYSUTCDATETIME())
         AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')) AS AttendeesToday,
      (SELECT COUNT(*) FROM dbo.users WHERE DeletedAt IS NULL) AS TotalUsers,
      (SELECT COUNT(*) FROM dbo.users WHERE DeletedAt IS NULL AND Status = N'ACTIVE') AS ActiveUsers,
      (SELECT COUNT(*) FROM dbo.bookings WHERE DeletedAt IS NULL AND Status = N'CANCELLED'
         AND CreatedAt >= DATEADD(DAY, -30, SYSUTCDATETIME())) AS CancelledLast30,
      (SELECT COUNT(*) FROM dbo.departments WHERE IsActive = 1) AS Departments
  `);

  const utilization = await query<{ HallName: string; HoursBooked: number }>(`
    SELECT h.Name AS HallName,
           ROUND(COALESCE(SUM(TIMESTAMPDIFF(MINUTE, b.StartAt, b.EndAt)), 0) / 60.0, 2) AS HoursBooked
    FROM dbo.conference_halls h
    LEFT JOIN dbo.bookings b ON b.HallId = h.Id AND b.DeletedAt IS NULL
      AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
      AND b.StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
    WHERE h.DeletedAt IS NULL AND h.IsActive = 1
    GROUP BY h.Id, h.Name
    ORDER BY HoursBooked DESC
  `);

  const byDepartment = await query<{ Department: string; Count: number }>(`
    SELECT d.Name AS Department, COUNT(*) AS Count
    FROM dbo.bookings b
    JOIN dbo.departments d ON d.Id = b.DepartmentId
    WHERE b.DeletedAt IS NULL AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
      AND b.StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
    GROUP BY d.Id, d.Name
    ORDER BY Count DESC
  `);

  const byEventType = await query<{ EventType: string; Count: number }>(`
    SELECT EventType, COUNT(*) AS Count
    FROM dbo.bookings
    WHERE DeletedAt IS NULL AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
      AND StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
    GROUP BY EventType
    ORDER BY Count DESC
  `);

  const trend = await query<{ Period: string; Count: number }>(`
    SELECT DATE_FORMAT(StartAt, '%Y-%m-%d') AS Period, COUNT(*) AS Count
    FROM dbo.bookings
    WHERE DeletedAt IS NULL AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
      AND StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
    GROUP BY DATE_FORMAT(StartAt, '%Y-%m-%d')
    ORDER BY Period
  `);

  const peakHours = await query<{ Hour: number; Count: number }>(`
    SELECT HOUR(StartAt) AS Hour, COUNT(*) AS Count
    FROM dbo.bookings
    WHERE DeletedAt IS NULL AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
      AND StartAt >= DATEADD(DAY, -30, SYSUTCDATETIME())
    GROUP BY HOUR(StartAt)
    ORDER BY Hour
  `);

  const todaySchedule = await query(`
    SELECT b.Id, b.EventName, b.StartAt, b.EndAt, b.Status, h.Name AS HallName, h.Code AS HallCode,
           CONCAT(o.FirstName, ' ', o.LastName) AS OrganizerName, b.AttendeeCount
    FROM dbo.bookings b
    JOIN dbo.conference_halls h ON h.Id = b.HallId
    JOIN dbo.users o ON o.Id = b.OrganizerId
    WHERE b.DeletedAt IS NULL AND DATE(b.StartAt) = DATE(SYSUTCDATETIME())
      AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
    ORDER BY b.StartAt
    LIMIT 12
  `);

  const upcoming = await query(`
    SELECT b.Id, b.EventName, b.StartAt, b.EndAt, b.Status, h.Name AS HallName,
           CONCAT(o.FirstName, ' ', o.LastName) AS OrganizerName
    FROM dbo.bookings b
    JOIN dbo.conference_halls h ON h.Id = b.HallId
    JOIN dbo.users o ON o.Id = b.OrganizerId
    WHERE b.DeletedAt IS NULL AND b.StartAt > SYSUTCDATETIME()
      AND b.Status IN (N'CONFIRMED', N'APPROVED', N'PENDING')
    ORDER BY b.StartAt
    LIMIT 8
  `);

  const recent = await query(`
    SELECT b.Id, b.EventName, b.CreatedAt, b.Status, h.Name AS HallName, b.BookingNumber
    FROM dbo.bookings b
    JOIN dbo.conference_halls h ON h.Id = b.HallId
    WHERE b.DeletedAt IS NULL
    ORDER BY b.CreatedAt DESC
    LIMIT 8
  `);

  const usersByRole = await query<{ RoleName: string; RoleCode: string; Count: number }>(`
    SELECT r.Name AS RoleName, r.Code AS RoleCode, COUNT(*) AS Count
    FROM dbo.users u
    JOIN dbo.roles r ON r.Id = u.RoleId
    WHERE u.DeletedAt IS NULL
    GROUP BY r.Id, r.Name, r.Code
    ORDER BY Count DESC
  `);

  const hallBoard = await query<{
    Id: string;
    Name: string;
    Code: string;
    Status: string;
    Capacity: number;
    CurrentEvent: string | null;
  }>(`
    SELECT h.Id, h.Name, h.Code, h.Status, h.Capacity,
           (SELECT b.EventName FROM dbo.bookings b
            WHERE b.HallId = h.Id AND b.DeletedAt IS NULL
              AND b.Status IN (N'ONGOING', N'CONFIRMED', N'APPROVED')
              AND b.StartAt <= SYSUTCDATETIME() AND b.EndAt > SYSUTCDATETIME()
            ORDER BY b.StartAt
            LIMIT 1) AS CurrentEvent
    FROM dbo.conference_halls h
    WHERE h.DeletedAt IS NULL AND h.IsActive = 1
    ORDER BY h.Name
  `);

  return {
    stats: stats ?? {
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
    },
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
