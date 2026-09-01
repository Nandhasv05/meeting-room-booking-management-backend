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

const COLUMN_LABELS: Record<string, string> = {
  BookingNumber: 'Booking #',
  EventName: 'Event',
  EventType: 'Type',
  Department: 'Department',
  Hall: 'Hall',
  Organizer: 'Organizer',
  StartAt: 'Start',
  EndAt: 'End',
  AttendeeCount: 'Attendees',
  Status: 'Status',
  CancellationReason: 'Reason',
  HoursBooked: 'Hours booked',
  WindowHours: 'Window hours',
  Code: 'Code',
  Capacity: 'Capacity',
  BookingCount: 'Bookings',
  TotalHours: 'Total hours',
  Hour: 'Hour',
  Count: 'Count',
};

const COLUMN_WEIGHT: Record<string, number> = {
  BookingNumber: 1.35,
  EventName: 1.45,
  EventType: 0.85,
  Department: 1.4,
  Hall: 1,
  Organizer: 1,
  StartAt: 1.25,
  EndAt: 1.25,
  AttendeeCount: 0.7,
  Status: 0.9,
  CancellationReason: 1.3,
  HoursBooked: 1.1,
  WindowHours: 1.1,
  BookingCount: 0.9,
  TotalHours: 1,
  Hour: 0.8,
  Count: 0.8,
};

const INK = '#122315';
const BRAND = '#0f2015';
const MUTED = '#5c6b62';
const LINE = '#d5e0d8';
const MIST = '#eef4f0';
const HEADER_H = 58;
const MARGIN = 28;
const FOOTER_H = 30;

function humanizeKey(key: string) {
  return COLUMN_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function isDateField(key: string, value: unknown) {
  if (value instanceof Date) return true;
  if (!/(At|Date)$/.test(key)) return false;
  const d = new Date(String(value ?? ''));
  return !Number.isNaN(d.getTime());
}

function formatDate(value: Date, withTime = false) {
  return value.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  });
}

function formatCell(key: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (key === 'Hour') return `${String(value).padStart(2, '0')}:00`;
  if (key === 'Status' || key === 'EventType') return String(value).replaceAll('_', ' ');
  if (isDateField(key, value)) return formatDate(new Date(value as string | Date), true);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  const asNumber = Number(value);
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(asNumber) && /Hours|Count|Capacity|Attendee/.test(key)) {
    return Number.isInteger(asNumber) ? String(asNumber) : asNumber.toFixed(2);
  }
  return String(value);
}

function visibleKeys(rows: Record<string, unknown>[]) {
  if (!rows[0]) return [];
  return Object.keys(rows[0]).filter((key) => {
    if (key !== 'CancellationReason') return true;
    return rows.some((row) => String(row[key] ?? '').trim() !== '');
  });
}

function statusColor(status: string) {
  const value = status.toUpperCase();
  if (value === 'COMPLETED' || value === 'APPROVED' || value === 'CONFIRMED') return '#2f7a4e';
  if (value === 'CANCELLED' || value === 'REJECTED' || value === 'NO_SHOW') return '#b42318';
  if (value.includes('PENDING')) return '#b54708';
  return INK;
}

function columnWidths(keys: string[], usable: number) {
  const weights = keys.map((key) => COLUMN_WEIGHT[key] ?? 1);
  const total = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => (w / total) * usable);
}

function writePdf(
  res: Response,
  title: string,
  rows: Record<string, unknown>[],
  filters: ReportFilters,
) {
  const keys = visibleKeys(rows);
  const landscape = keys.length > 5;
  const { from, to } = bounds(filters);
  const period = `${formatDate(from)}  –  ${formatDate(to)}`;
  const generated = formatDate(new Date(), true);
  const meta = `Period  ${period}    ·    ${rows.length} ${rows.length === 1 ? 'record' : 'records'}    ·    Generated  ${generated}`;

  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: title, Author: 'Meeting Hall' },
  });
  doc.pipe(res);

  const usable = () => doc.page.width - MARGIN * 2;
  const widths = columnWidths(keys, usable());
  const pad = 5;
  const fontSize = landscape ? 7.5 : 8.5;

  const paintChrome = (first: boolean) => {
    const width = doc.page.width;
    doc.save();
    doc.rect(0, 0, width, HEADER_H).fill(BRAND);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(first ? 16 : 12)
      .text(title, MARGIN, first ? 14 : 12, { width: usable(), lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor('#c8d5cc')
      .text(first ? 'Meeting Hall' : meta, MARGIN, first ? 36 : 30, { width: usable() / 2, lineBreak: false });
    if (first) {
      doc.text(generated, MARGIN, 36, { width: usable(), align: 'right', lineBreak: false });
    }
    doc.restore();
    return first ? HEADER_H + 18 : HEADER_H + 10;
  };

  const paintTableHeader = (y: number) => {
    const rowH = 22;
    doc.save();
    doc.rect(MARGIN, y, usable(), rowH).fill(BRAND);
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff');
    let x = MARGIN;
    keys.forEach((key, i) => {
      doc.text(humanizeKey(key).toUpperCase(), x + pad, y + 7, {
        width: widths[i] - pad * 2,
        lineBreak: false,
      });
      x += widths[i];
    });
    doc.restore();
    return y + rowH;
  };

  let y = paintChrome(true);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(period, MARGIN, y, { width: usable() / 2, lineBreak: false });
  doc.text(`${rows.length} ${rows.length === 1 ? 'record' : 'records'}`, MARGIN, y, {
    width: usable(),
    align: 'right',
    lineBreak: false,
  });
  y += 16;

  if (!rows.length) {
    doc.font('Helvetica').fontSize(11).fillColor(INK)
      .text('No records in this period.', MARGIN, y + 12);
  } else {
    y = paintTableHeader(y);

    rows.forEach((row, index) => {
      const cells = keys.map((key) => formatCell(key, row[key]));
      doc.font('Helvetica').fontSize(fontSize);
      const contentH = Math.max(
        ...cells.map((text, i) => doc.heightOfString(text, { width: Math.max(widths[i] - pad * 2, 12) })),
        10,
      );
      const rowH = contentH + pad * 2;
      if (y + rowH > doc.page.height - FOOTER_H - 8) {
        doc.addPage();
        y = paintTableHeader(paintChrome(false));
      }

      doc.save();
      doc.rect(MARGIN, y, usable(), rowH).fill(index % 2 === 0 ? '#ffffff' : MIST);
      doc.strokeColor(LINE).lineWidth(0.4)
        .moveTo(MARGIN, y + rowH).lineTo(MARGIN + usable(), y + rowH).stroke();
      doc.restore();

      let x = MARGIN;
      keys.forEach((key, i) => {
        const isStatus = key === 'Status';
        doc.font(isStatus ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(fontSize)
          .fillColor(isStatus ? statusColor(String(row[key] ?? '')) : INK)
          .text(cells[i], x + pad, y + pad, {
            width: widths[i] - pad * 2,
            align: key === 'AttendeeCount' || key === 'Count' || key === 'Capacity' ? 'right' : 'left',
          });
        x += widths[i];
      });
      y += rowH;
    });
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(i);
    const top = doc.page.height - FOOTER_H;
    doc.save();
    doc.rect(0, top, doc.page.width, FOOTER_H).fill(MIST);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Meeting Hall  ·  Booking reports', MARGIN, top + 10, { width: usable() / 2, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, MARGIN, top + 10, {
        width: usable(),
        align: 'right',
        lineBreak: false,
      });
    doc.restore();
  }

  doc.end();
}

async function writeExcel(title: string, rows: Record<string, unknown>[], filters: ReportFilters, res: Response, type: string) {
  const keys = visibleKeys(rows);
  const { from, to } = bounds(filters);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Meeting Hall';
  const sheet = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });

  if (keys.length) {
    sheet.columns = keys.map((key) => ({
      header: humanizeKey(key),
      key,
      width: Math.min(28, Math.max(12, humanizeKey(key).length + 8)),
    }));
    rows.forEach((row) => {
      const mapped: Record<string, unknown> = {};
      keys.forEach((key) => {
        mapped[key] = isDateField(key, row[key]) ? new Date(row[key] as string | Date) : formatCell(key, row[key]);
      });
      sheet.addRow(mapped);
    });
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2015' } };
    sheet.getRow(1).alignment = { vertical: 'middle' };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
    keys.forEach((key, i) => {
      if (!/(At|Date)$/.test(key)) return;
      sheet.getColumn(i + 1).numFmt = 'dd-mmm-yyyy hh:mm';
    });
  } else {
    sheet.addRow(['No records in this period.']);
  }

  sheet.headerFooter.oddHeader = `&LMeeting Hall&C${title}&R${formatDate(from)} – ${formatDate(to)}`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${type}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
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
    writePdf(res, title, rows, filters);
    return;
  }

  await writeExcel(title, rows, filters, res, type);
}
