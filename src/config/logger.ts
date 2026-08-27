// AUTHOR : NANDHAKUMAR S V
//VERSION : 1.0.0
//DESCRIPTION : Logger configuration for the booking system
// DATE : 2026-08-26
import pino from 'pino';
import { env, isProd } from './env.js';


export const logger = pino({
  level: isProd ? 'info' : 'debug',
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
  base: { service: 'conference-hall-api', env: env.NODE_ENV },
});
