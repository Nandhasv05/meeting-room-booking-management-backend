// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Hall controller
// DATE : 2026-08-26
import type { Request, Response } from 'express';
import { ok, created } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as halls from '../services/hall.service.js';
import * as maint from '../services/maintenance.service.js';

/** List halls */
export const listHalls = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.listHalls((req.body ?? {}) as Record<string, string>));
});

/** Get hall */
export const getHall = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.getHall(req.params.id as string));
});

/** Create hall */
export const createHall = asyncHandler(async (req: Request, res: Response) => {
  created(res, await halls.createHall(req.user!, req.body, req), 'Hall created.');
});

/** Update hall */
export const updateHall = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.updateHall(req.user!, req.params.id as string, req.body, req), 'Hall updated.');
});

/** Delete hall */
export const deleteHall = asyncHandler(async (req: Request, res: Response) => {
  await halls.deleteHall(req.user!, req.params.id as string, req);
  ok(res, null, 'Hall removed.');
});

/** Availability */
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

/** List facilities */
export const listFacilities = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await halls.listFacilities());
});

/** Create facility */
export const createFacility = asyncHandler(async (req: Request, res: Response) => {
  created(res, await halls.createFacility(req.body), 'Facility created.');
});

/** Update facility */
export const updateFacility = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await halls.updateFacility(req.params.id as string, req.body));
});

/** Delete facility */
export const deleteFacility = asyncHandler(async (req: Request, res: Response) => {
  await halls.deleteFacility(req.params.id as string);
  ok(res, null, 'Facility removed.');
});

/** List maintenance */
export const listMaintenance = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await maint.listMaintenance(req.body?.hallId as string | undefined));
});

/** Create maintenance */
export const createMaintenance = asyncHandler(async (req: Request, res: Response) => {
  created(res, await maint.createMaintenance(req.user!, req.body, req), 'Maintenance scheduled.');
});

/** Update maintenance */
export const updateMaintenance = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await maint.updateMaintenance(req.user!, req.params.id as string, req.body));
});
