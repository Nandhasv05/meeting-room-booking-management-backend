import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import type { Response } from 'express';

type ReportFilters = {
  from?: string;
  to?: string;
  hallId?: string;
  departmentId?: string;
  organizerId?: string;
  status?: string;
};

function bounds(filters: ReportFilters) {
  const from = filters.from ? new Date(filters.from) : new Date(Date.now() - 30 * 86400000);
  const to = filters.to ? new Date(filters.to) : new Date();
  return { from, to, hallId: filters.hallId ?? null, departmentId: filters.departmentId ?? null, organizerId: filters.organizerId ?? null, status: filters.status ?? null };
}

const BOOKING_WHERE = `
  b.DeletedAt IS NULL
  AND b.StartAt >= @From AND b.StartAt <= @To
  AND (@HallId IS NULL OR b.HallId = @HallId)
  AND (@DepartmentId IS NULL OR b.DepartmentId = @DepartmentId)
  AND (@OrganizerId IS NULL OR b.OrganizerId = @OrganizerId)
  AND (@Status IS NULL OR b.Status = @Status)
`;

export async function bookingReport(filters: ReportFilters) {
  const inputs = bounds(filters);
  return query(
    `SELECT b.BookingNumber, b.EventName, b.EventType, d.Name AS Department, h.Name AS Hall,
            o.UserName AS Organizer, b.StartAt, b.EndAt,
            b.AttendeeCount, b.Status, b.CancellationReason
     FROM dbo.bookings b
     JOIN dbo.departments d ON d.Id = b.DepartmentId
     JOIN dbo.conference_halls h ON h.Id = b.HallId
     JOIN dbo.users o ON CAST(o.Id AS nvarchar(64)) = CAST(b.OrganizerId AS nvarchar(64))
     WHERE ${BOOKING_WHERE}
     ORDER BY b.StartAt DESC`,
    inputs,
  );
}

export async function utilizationReport(filters: ReportFilters) {
  const inputs = bounds(filters);
  return query(
    `SELECT h.Name AS Hall, h.Code, h.Capacity,
            CAST(COALESCE(SUM(DATEDIFF(MINUTE, b.StartAt, b.EndAt)), 0) / 60.0 AS DECIMAL(10,2)) AS HoursBooked,
            CAST(DATEDIFF(HOUR, @From, @To) AS DECIMAL(10,2)) AS WindowHours
     FROM dbo.conference_halls h
     LEFT JOIN dbo.bookings b ON b.HallId = h.Id AND b.DeletedAt IS NULL
       AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT', N'NO_SHOW')
       AND b.StartAt >= @From AND b.StartAt <= @To
       AND (@DepartmentId IS NULL OR b.DepartmentId = @DepartmentId)
     WHERE h.DeletedAt IS NULL AND h.IsActive = 1
       AND (@HallId IS NULL OR h.Id = @HallId)
     GROUP BY h.Name, h.Code, h.Capacity
     ORDER BY HoursBooked DESC`,
    inputs,
  );
}

export async function departmentReport(filters: ReportFilters) {
  const inputs = bounds(filters);
  return query(
    `SELECT d.Name AS Department, COUNT(*) AS BookingCount,
            CAST(COALESCE(SUM(DATEDIFF(MINUTE, b.StartAt, b.EndAt)), 0) / 60.0 AS DECIMAL(10,2)) AS TotalHours,
            COALESCE(SUM(b.AttendeeCount), 0) AS AttendeeCount
     FROM dbo.departments d
     LEFT JOIN dbo.bookings b ON b.DepartmentId = d.Id AND b.DeletedAt IS NULL
       AND b.Status NOT IN (N'DRAFT')
       AND b.StartAt >= @From AND b.StartAt <= @To
       AND (@HallId IS NULL OR b.HallId = @HallId)
     WHERE d.DeletedAt IS NULL
     GROUP BY d.Name
     ORDER BY BookingCount DESC`,
    inputs,
  );
}

export async function cancellationReport(filters: ReportFilters) {
  return bookingReport({ ...filters, status: 'CANCELLED' });
}

export async function peakHoursReport(filters: ReportFilters) {
  const inputs = bounds(filters);
  return query(
    `SELECT DATEPART(HOUR, b.StartAt) AS Hour, COUNT(*) AS Count
     FROM dbo.bookings b
     WHERE ${BOOKING_WHERE} AND b.Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT')
     GROUP BY DATEPART(HOUR, b.StartAt)
     ORDER BY Hour`,
    inputs,
  );
}

export async function exportReport(type: string, format: string, filters: ReportFilters, res: Response) {
  let rows: Record<string, unknown>[] = [];
  let title = 'Report';
  switch (type) {
    case 'bookings':
      rows = (await bookingReport(filters)) as Record<string, unknown>[];
      title = 'Booking Report';
      break;
    case 'utilization':
      rows = (await utilizationReport(filters)) as Record<string, unknown>[];
      title = 'Hall Utilization';
      break;
    case 'departments':
      rows = (await departmentReport(filters)) as Record<string, unknown>[];
      title = 'Department Usage';
      break;
    case 'cancellations':
      rows = (await cancellationReport(filters)) as Record<string, unknown>[];
      title = 'Cancellation Report';
      break;
    case 'peak-hours':
      rows = (await peakHoursReport(filters)) as Record<string, unknown>[];
      title = 'Peak Hours';
      break;
    default:
      throw new AppError('Unknown report type.', 400);
  }

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${type}.pdf"`);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    doc.fontSize(16).text(title);
    doc.moveDown();
    doc.fontSize(9);
    if (rows[0]) {
      const keys = Object.keys(rows[0]);
      rows.forEach((row) => {
        doc.text(keys.map((k) => `${k}: ${String(row[k] ?? '')}`).join('  |  '));
        doc.moveDown(0.3);
      });
    } else {
      doc.text('No rows.');
    }
    doc.end();
    return;
  }

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(title);
  if (rows[0]) {
    const keys = Object.keys(rows[0]);
    sheet.columns = keys.map((k) => ({ header: k, key: k, width: 22 }));
    rows.forEach((row) => sheet.addRow(row));
  }
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${type}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}
