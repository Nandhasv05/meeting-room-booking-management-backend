import type { BookingStatus, EventType } from '../config/constants.js';

/** User row */
export type UserRow = {
  Id: string;
  EmployeeId: string;
  FirstName: string;
  LastName: string;
  Email: string;
  Phone: string | null;
  DepartmentId: string | null;
  DepartmentName: string | null;
  Designation: string | null;
  RoleId: string;
  RoleCode: string;
  RoleName: string;
  Status: string;
  LastLoginAt: Date | null;
  CreatedAt: Date;
};

/** Hall row */
export type HallRow = {
  Id: string;
  Name: string;
  Code: string;
  Description: string | null;
  Location: string | null;
  Building: string | null;
  Floor: string | null;
  Capacity: number;
  HallType: string;
  Status: string;
  ImageUrl: string | null;
  OpeningTime: Date | string;
  ClosingTime: Date | string;
  ContactPersonId: string | null;
  ContactName: string | null;
  IsActive: boolean;
  CreatedAt: Date;
};

/** Booking row */
export type BookingRow = {
  Id: string;
  BookingNumber: string;
  EventName: string;
  EventType: EventType;
  DepartmentId: string;
  DepartmentName: string;
  OrganizerId: string;
  OrganizerName: string;
  ContactNumber: string | null;
  ContactEmail: string | null;
  HallId: string;
  HallName: string;
  HallCode: string;
  HallCapacity: number;
  BookingDate: Date;
  StartAt: Date;
  EndAt: Date;
  AttendeeCount: number;
  SeatingLayoutId: string | null;
  SeatingLayoutName: string | null;
  Purpose: string | null;
  CateringRequired: boolean;
  SpecialRequirements: string | null;
  InviteNote: string | null;
  Status: BookingStatus;
  RequiresApproval: boolean;
  ApprovedBy: string | null;
  ApprovedByName: string | null;
  ApprovedAt: Date | null;
  RejectedBy: string | null;
  RejectedByName: string | null;
  RejectedAt: Date | null;
  RejectionReason: string | null;
  CancelledBy: string | null;
  CancelledAt: Date | null;
  CancellationReason: string | null;
  CheckInAt: Date | null;
  CheckOutAt: Date | null;
  CreatedAt: Date;
  EventId: string | null;
  QrToken?: string;
};

/** Booking select */
export const BOOKING_SELECT = `
  SELECT b.Id, b.BookingNumber, b.EventName, b.EventType, b.DepartmentId, d.Name AS DepartmentName,
         b.OrganizerId, o.UserName AS OrganizerName, b.ContactNumber, b.ContactEmail,
         b.HallId, h.Name AS HallName, h.Code AS HallCode, h.Capacity AS HallCapacity,
         b.BookingDate, b.StartAt, b.EndAt, b.AttendeeCount, b.SeatingLayoutId,
         sl.Name AS SeatingLayoutName, b.Purpose, b.CateringRequired, b.SpecialRequirements,
         b.InviteNote, b.Status, b.RequiresApproval, b.ApprovedBy,
         ap.UserName AS ApprovedByName, b.ApprovedAt,
         b.RejectedBy, rj.UserName AS RejectedByName, b.RejectedAt,
         b.RejectionReason, b.CancelledBy, b.CancelledAt, b.CancellationReason,
         b.CheckInAt, b.CheckOutAt, b.CreatedAt, e.Id AS EventId, b.QrToken
  FROM dbo.bookings b
  JOIN dbo.departments d ON d.Id = b.DepartmentId
  JOIN dbo.users o ON CAST(o.Id AS nvarchar(64)) = CAST(b.OrganizerId AS nvarchar(64))
  JOIN dbo.conference_halls h ON h.Id = b.HallId
  LEFT JOIN dbo.hall_seating_layouts sl ON sl.Id = b.SeatingLayoutId
  LEFT JOIN dbo.users ap ON CAST(ap.Id AS nvarchar(64)) = CAST(b.ApprovedBy AS nvarchar(64))
  LEFT JOIN dbo.users rj ON CAST(rj.Id AS nvarchar(64)) = CAST(b.RejectedBy AS nvarchar(64))
  LEFT JOIN dbo.events e ON e.BookingId = b.Id
`;

/** Omit QR token */
export function omitQr<T extends { QrToken?: string }>(row: T): Omit<T, 'QrToken'> {
  const { QrToken: _token, ...rest } = row;
  return rest;
}
