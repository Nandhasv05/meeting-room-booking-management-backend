import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { decryptData, encryptDataV2, isDecryptFailure } from '../utils/crypto.js';
import { fail } from '../utils/apiResponse.js';

const SKIP_REQUEST_DECRYPT = new Set(['/reports/export']);

function shouldSkipRequestDecrypt(req: Request): boolean {
  return SKIP_REQUEST_DECRYPT.has(req.path);
}

function readRequestToken(req: Request): string | undefined {
  const fromBody = req.body && typeof req.body === 'object' ? (req.body as { requestToken?: unknown }).requestToken : undefined;
  const fromQuery = req.query?.requestToken;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody;
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery;
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === 'string' && fromQuery[0].trim()) return fromQuery[0];
  return undefined;
}

function wrapJson(res: Response): void {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return originalJson(body);
    }
    const envelope = body as { success?: boolean; message?: string; data?: unknown; response?: unknown };
    if (typeof envelope.response === 'string') {
      return originalJson(body);
    }
    const packed = encryptDataV2({ data: envelope.data ?? null }, env.API_CRYPTO_KEY);
    return originalJson({
      success: Boolean(envelope.success),
      message: envelope.message ?? '',
      statusCode: res.statusCode,
      response: packed,
    });
  }) as Response['json'];
}

export function cryptoEnvelope(req: Request, res: Response, next: NextFunction): void {
  wrapJson(res);

  if (shouldSkipRequestDecrypt(req)) {
    next();
    return;
  }

  const token = readRequestToken(req);
  if (!token) {
    fail(res, 'Missing encrypted request.', 400);
    return;
  }

  const decoded = decryptData(token, env.API_CRYPTO_KEY);
  if (isDecryptFailure(decoded) || typeof decoded !== 'object' || Array.isArray(decoded)) {
    fail(res, 'Invalid encrypted request.', 400);
    return;
  }

  req.body = decoded as Record<string, unknown>;
  next();
}
