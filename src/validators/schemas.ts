import { z } from 'zod';
import { EVENT_TYPES, HALL_TYPES, HALL_STATUSES } from '../config/constants.js';

/** Intranet hosts such as user@client-api.local must be accepted. */
const mailId = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), 'Enter a valid mail ID');

const optionalMail = z.preprocess(
  (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
  mailId.optional(),
);

function directoryIds(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [];
  return [
    ...new Set(
      list
        .map((value) => String(value ?? '').trim())
        .filter((id) => id && id.length <= 64 && id !== 'undefined' && id !== 'null' && !id.startsWith('guest:')),
    ),
  ].slice(0, 50);
}

function onlyMailIds(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter((value) => /^[^\s@]+@[^\s@]+$/.test(value)))];
}

/** Table primary/foreign keys are BIGINT AUTO_INCREMENT (sent as digit strings). */
export const dbId = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform((v) => String(v));

export const loginSchema = {
  body: z
    .object({
      email: z.string().optional(),
      username: z.string().optional(),
      password: z.string().min(1),
    })
    .superRefine((value, ctx) => {
      if (!(value.email || value.username || '').trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Email or username is required', path: ['email'] });
      }
    })
    .transform((value) => ({
      email: (value.email || value.username || '').trim(),
      password: value.password,
    })),
};

export const refreshSchema = {
  body: z.object({ refreshToken: z.string().min(10) }),
};

export const portalSsoSchema = {
  body: z.object({ sso: z.string().min(20) }),
};

export const idParam = {
  params: z.object({ id: dbId }),
};

export const hallCodeParam = {
  params: z.object({ hallCode: z.string().min(1).max(30) }),
};

const directoryUserId = z.string().min(1).max(64);
const directoryRoleId = z.enum(['ADMINISTRATOR', 'EMPLOYEE']);
const directoryDepartment = z.string().max(80);

export const createUserSchema = {
  body: z.object({
    employeeId: z.string().min(2).max(40).trim(),
    firstName: z.string().max(80).optional().default(''),
    lastName: z.string().max(80).optional().default(''),
    email: z.string().email(),
    phone: z.string().max(30).optional(),
    department: directoryDepartment.optional(),
    departmentId: directoryDepartment.optional(),
    designation: z.string().max(120).optional(),
    roleId: directoryRoleId,
    password: z.string().min(8).max(80),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  }),
};

export const updateUserSchema = {
  params: z.object({ id: directoryUserId }),
  body: z.object({
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().max(80).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(30).optional(),
    department: directoryDepartment.nullable().optional(),
    departmentId: directoryDepartment.nullable().optional(),
    designation: z.string().max(120).optional(),
    employeeId: z.string().min(2).max(40).trim().optional(),
    roleId: directoryRoleId.optional(),
    status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).optional(),
    password: z.string().min(8).max(80).optional(),
  }),
};

export const resetPasswordSchema = {
  params: z.object({ id: directoryUserId }),
  body: z.object({ password: z.string().min(8).max(80) }),
};

export const createHallSchema = {
  body: z.object({
    name: z.string().min(2).max(160),
    code: z.string().min(2).max(30),
    description: z.string().max(1000).optional(),
    location: z.string().max(200).optional(),
    building: z.string().max(80).optional(),
    floor: z.string().max(20).optional(),
    capacity: z.number().int().positive(),
    hallType: z.enum(HALL_TYPES),
    status: z.enum(HALL_STATUSES).optional(),
    imageUrl: z.string().max(400).optional(),
    openingTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    closingTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    contactPersonId: dbId.optional(),
    isActive: z.boolean().optional(),
    facilityIds: z.array(dbId).optional(),
    layouts: z
      .array(z.object({ name: z.string(), capacity: z.number().int().positive(), isDefault: z.boolean().optional() }))
      .optional(),
  }),
};

export const createBookingSchema = {
  body: z.object({
    eventName: z.string().min(2).max(200),
    eventType: z.enum(EVENT_TYPES),
    departmentId: z.union([z.string().trim().min(1).max(120), z.number().int().positive()]).transform((v) => String(v)),
    organizerId: dbId.optional(),
    contactNumber: z.string().max(30).optional(),
    mailId: optionalMail,
    invitationEmails: z.array(z.string()).max(50).optional().transform(onlyMailIds),
    hallId: dbId,
    startAt: z.string().datetime({ offset: true }).or(z.string().min(10)),
    endAt: z.string().min(10),
    attendeeCount: z.coerce.number().int().positive(),
    seatingLayoutId: dbId.optional(),
    purpose: z.string().max(1000).optional(),
    cateringRequired: z.boolean().optional(),
    specialRequirements: z.string().max(1000).optional(),
    inviteNote: z.string().max(500).optional(),
    facilityIds: z.array(dbId).optional(),
    attendees: z
      .array(
        z.object({
          name: z.string(),
          employeeId: z.string().optional(),
          department: z.string().optional(),
          email: optionalMail,
          phone: z.string().optional(),
        }),
      )
      .optional(),
    draft: z.boolean().optional(),
  }),
};

export const availabilityCheckSchema = {
  body: z.object({
    hallId: z.preprocess(
      (value) => (value == null || value === '' ? undefined : String(value).trim()),
      z.string().min(1).max(64).optional(),
    ),
    userIds: z.preprocess(directoryIds, z.array(z.string()).max(50)).optional(),
    startAt: z.string().min(10),
    endAt: z.string().min(10),
    attendeeCount: z.coerce.number().int().positive().optional(),
    excludeBookingId: dbId.optional(),
  }),
};

export const rejectSchema = {
  params: z.object({ id: dbId }),
  body: z.object({ reason: z.string().min(3).max(500) }),
};

export const cancelSchema = {
  params: z.object({ id: dbId }),
  body: z.object({ reason: z.string().trim().min(3, 'Please enter a reason.').max(500) }),
};

export const maintenanceSchema = {
  body: z.object({
    hallId: dbId,
    title: z.string().min(2).max(160),
    description: z.string().max(1000).optional(),
    startAt: z.string().min(10),
    endAt: z.string().min(10),
  }),
};

export const departmentSchema = {
  body: z.object({
    code: z.string().min(2).max(30),
    name: z.string().min(2).max(120),
    description: z.string().max(400).optional(),
  }),
};

export const settingsSchema = {
  body: z.object({
    entries: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
};

export const testMailSchema = {
  body: z.object({
    to: z.string().email(),
  }),
};

export const contactSchema = {
  body: z.object({
    name: z.string().max(160).optional(),
    email: z.string().email(),
    phone: z.string().max(30).optional(),
  }),
};

export const contactImportSchema = {
  body: z.object({
    contacts: z.array(
      z.object({
        name: z.string().max(160).optional(),
        email: z.string().email(),
        phone: z.string().max(30).optional(),
      }),
    ).min(1).max(500),
  }),
};

export const eventUpdateSchema = {
  params: z.object({ id: dbId }),
  body: z.object({
    description: z.string().max(2000).optional(),
    expectedAttendees: z.number().int().positive().optional(),
    actualAttendees: z.number().int().nonnegative().optional(),
    requirements: z.string().max(1000).optional(),
  }),
};
