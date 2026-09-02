import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { corsOrigins } from '../config/env.js';
import { logger } from '../config/logger.js';
import { setIo } from './registry.js';
import { verifyAccessToken } from '../utils/jwt.js';

export function attachSockets(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    path: '/socket.io',
  });
  setIo(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next();
      return;
    }
    try {
      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      next();
    } catch {
      next();
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string | undefined;
    if (userId) socket.join(`user:${userId}`);

    socket.on('join', (room: string) => {
      if (typeof room !== 'string') return;
      if (room.startsWith('hall:') || room === 'dashboard' || room === 'calendar' || room.startsWith('user:')) {
        void socket.join(room);
      }
    });

    socket.on('leave', (room: string) => {
      if (typeof room === 'string') void socket.leave(room);
    });

    logger.debug({ id: socket.id }, 'socket connected');
  });

  return io;
}
