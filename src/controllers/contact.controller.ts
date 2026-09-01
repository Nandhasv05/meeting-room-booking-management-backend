import type { Request, Response } from 'express';
import { ok, created } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as contacts from '../services/contact.service.js';

export const listContacts = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await contacts.listContacts(String(req.body?.q ?? '')));
});

export const createContact = asyncHandler(async (req: Request, res: Response) => {
  created(res, await contacts.upsertContact(req.user!, req.body), 'Contact saved.');
});

export const updateContact = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await contacts.upsertContact(req.user!, { ...req.body, id: req.params.id }), 'Contact updated.');
});

export const deleteContact = asyncHandler(async (req: Request, res: Response) => {
  await contacts.deleteContact(req.params.id as string);
  ok(res, null, 'Contact removed.');
});

export const importContacts = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await contacts.importContacts(req.user!, req.body?.contacts ?? []), 'Contacts imported.');
});
