import { getPool, query, queryOne, insert, closePool } from '../config/database.js';
import { hashPassword } from '../utils/password.js';
import { logger } from '../config/logger.js';

const PASSWORD = 'password#1';

const demoUsers = [
  {
    employeeId: 'EMP2001',
    first: 'Admin',
    last: 'User',
    email: 'admin@evoloclothing.com',
    role: 'ADMINISTRATOR',
    dept: 'IT',
    designation: 'Administrator',
  },
  {
    employeeId: 'EMP2002',
    first: 'Hall',
    last: 'Manager',
    email: 'manager@evlovcolthing.com',
    role: 'HALL_MANAGER',
    dept: 'OPS',
    designation: 'Hall Manager',
  },
  {
    employeeId: 'EMP2003',
    first: 'Nandhakumar',
    last: 'DS',
    email: 'nandhakumar@evolvclothing.com',
    role: 'EMPLOYEE',
    dept: 'HR',
    designation: 'Employee',
  },
];

const halls = [
  { name: 'Main Conference Hall', code: 'MCH-01', type: 'CONFERENCE', cap: 180, building: 'Tower A', floor: '2', loc: 'Tower A, Level 2' },
  { name: 'Board Room A', code: 'BR-A', type: 'BOARDROOM', cap: 16, building: 'Tower A', floor: '12', loc: 'Executive floor' },
  { name: 'Board Room B', code: 'BR-B', type: 'BOARDROOM', cap: 12, building: 'Tower A', floor: '12', loc: 'Executive floor' },
  { name: 'Training Studio', code: 'TR-01', type: 'TRAINING', cap: 40, building: 'Tower B', floor: '3', loc: 'Learning centre' },
  { name: 'Innovation Lab', code: 'IL-01', type: 'MULTIPURPOSE', cap: 60, building: 'Tower B', floor: '1', loc: 'Campus west' },
  { name: 'Auditorium', code: 'AUD-01', type: 'AUDITORIUM', cap: 220, building: 'Tower C', floor: 'G', loc: 'Campus east' },
];

async function upsertUser(
  u: (typeof demoUsers)[number],
  hash: string,
): Promise<void> {
  const role = await queryOne<{ Id: string }>(`SELECT Id FROM dbo.roles WHERE Code = @Code`, { Code: u.role });
  const dept = await queryOne<{ Id: string }>(`SELECT Id FROM dbo.departments WHERE Code = @Code`, { Code: u.dept });
  if (!role) throw new Error(`Missing role ${u.role}. Run database/seeds/001_lookups.sql first.`);

  const existing = await queryOne<{ Id: string }>(`SELECT Id FROM dbo.users WHERE Email = @Email`, {
    Email: u.email,
  });

  if (existing) {
    await query(
      `UPDATE dbo.users SET
          PasswordHash = @Hash,
          RoleId = @RoleId,
          Status = N'ACTIVE',
          DeletedAt = NULL,
          FirstName = @FirstName,
          LastName = @LastName,
          DepartmentId = @DepartmentId,
          Designation = @Designation,
          UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @Id`,
      {
        Id: existing.Id,
        Hash: hash,
        RoleId: role.Id,
        FirstName: u.first,
        LastName: u.last,
        DepartmentId: dept?.Id ?? null,
        Designation: u.designation,
      },
    );
    logger.info({ email: u.email, role: u.role }, 'updated user password/role');
    return;
  }

  await insert(
    `INSERT INTO dbo.users (EmployeeId, FirstName, LastName, Email, Phone, DepartmentId, Designation, PasswordHash, RoleId, Status)
     VALUES (@EmployeeId, @FirstName, @LastName, @Email, @Phone, @DepartmentId, @Designation, @Hash, @RoleId, N'ACTIVE')`,
    {
      EmployeeId: u.employeeId,
      FirstName: u.first,
      LastName: u.last,
      Email: u.email,
      Phone: '044-4000-1000',
      DepartmentId: dept?.Id ?? null,
      Designation: u.designation,
      Hash: hash,
      RoleId: role.Id,
    },
  );
  logger.info({ email: u.email, role: u.role }, 'seeded user');
}

async function main() {
  await getPool();
  const hash = await hashPassword(PASSWORD);

  for (const u of demoUsers) {
    await upsertUser(u, hash);
  }

  const admin = await queryOne<{ Id: string }>(
    `SELECT Id FROM dbo.users WHERE Email = N'admin@evoloclothing.com'`,
  );
  const facilities = await query<{ Id: string; Code: string }>(`SELECT Id, Code FROM dbo.facilities`);

  for (const h of halls) {
    const exists = await queryOne(`SELECT Id FROM dbo.conference_halls WHERE Code = @Code`, { Code: h.code });
    if (exists) continue;
    const id = await insert(
      `INSERT INTO dbo.conference_halls
        (Name, Code, Description, Location, Building, Floor, Capacity, HallType, Status, OpeningTime, ClosingTime, ContactPersonId, IsActive, CreatedBy)
       VALUES
        (@Name, @Code, @Desc, @Loc, @Building, @Floor, @Cap, @Type, N'AVAILABLE', '08:00', '20:00', @Contact, 1, @Actor)`,
      {
        Name: h.name,
        Code: h.code,
        Desc: `${h.name} for corporate meetings and events.`,
        Loc: h.loc,
        Building: h.building,
        Floor: h.floor,
        Cap: h.cap,
        Type: h.type,
        Contact: admin?.Id ?? null,
        Actor: admin?.Id ?? null,
      },
    );
    const pick = facilities.filter((f) =>
      ['WIFI', 'AC', 'PROJECTOR', 'VIDEO_CONFERENCING', 'MICROPHONE'].includes(f.Code),
    );
    for (const f of pick) {
      await query(`INSERT INTO dbo.hall_facilities (HallId, FacilityId) VALUES (@HallId, @FacilityId)`, {
        HallId: id,
        FacilityId: f.Id,
      });
    }
    await insert(
      `INSERT INTO dbo.hall_seating_layouts (HallId, Name, Capacity, IsDefault)
       VALUES (@HallId, N'Theatre', @Cap, 1)`,
      { HallId: id, Cap: h.cap },
    );
    logger.info({ code: h.code }, 'seeded hall');
  }

  logger.info('Seed complete. Login password for all test users: password#1');
  await closePool();
}

main().catch((err) => {
  logger.fatal({ err }, 'seed failed');
  process.exit(1);
});
