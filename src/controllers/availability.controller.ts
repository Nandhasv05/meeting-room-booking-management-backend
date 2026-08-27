// AUTHOR : NANDHAKUMAR S V
//VERSION : 1.0.0
//DESCRIPTION : Availability endpoints used by the booking form
// DATE : 2026-08-26
import type { Request, Response } from 'express';
import { ok } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as availability from '../services/availability.service.js';

export const check = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await availability.checkAvailability(req.body));
});
