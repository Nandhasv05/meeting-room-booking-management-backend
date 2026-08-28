import type { Request, Response } from 'express';
import { ok, created } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as halls from '../services/hall.service.js';
import * as maint from '../services/maintenance.service.js';

export const listHalls = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.listHalls((req.body ?? {}) as Record<string, string>));
});

export const getHall = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.getHall(req.params.id as string));
});

export const createHall = asyncHandler(async (req: Request, res: Response) => {
  created(res, await halls.createHall(req.user!, req.body, req), 'Hall created.');
});

export const updateHall = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.updateHall(req.user!, req.params.id as string, req.body, req), 'Hall updated.');
});

export const deleteHall = asyncHandler(async (req: Request, res: Response) => {
  await halls.deleteHall(req.user!, req.params.id as string, req);
  ok(res, null, 'Hall removed.');
});

export const availability = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await halls.hallAvailability(
      req.params.id as string,
      String(req.body?.from ?? ''),
      String(req.body?.to ?? ''),
    ),
  );
});

export const listFacilities = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await halls.listFacilities());
});

export const createFacility = asyncHandler(async (req: Request, res: Response) => {
  created(res, await halls.createFacility(req.body), 'Facility created.');
});

export const updateFacility = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.updateFacility(req.params.id as string, req.body));
});

export const deleteFacility = asyncHandler(async (req: Request, res: Response) => {
  await halls.deleteFacility(req.params.id as string);
  ok(res, null, 'Facility removed.');
});

export const listMaintenance = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await maint.listMaintenance(req.body?.hallId as string | undefined));
});

export const createMaintenance = asyncHandler(async (req: Request, res: Response) => {
  created(res, await maint.createMaintenance(req.user!, req.body, req), 'Maintenance scheduled.');
});

export const updateMaintenance = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await maint.updateMaintenance(req.user!, req.params.id as string, req.body));
});
