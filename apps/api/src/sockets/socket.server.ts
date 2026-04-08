import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '@api/config';
import { logger } from '@api/utils/logger';
import type { AuthPayload } from '@api/middleware/auth';
import { registerSocketHandlers } from './socket.handlers';

let io: SocketServer | null = null;

export const initSocketServer = (httpServer: HttpServer): SocketServer => {
  io = new SocketServer(httpServer, {
    cors: {
      origin: config.CORS_ORIGIN,
      credentials: true,
    },
  });

  // Authenticate every socket connection via Bearer token in handshake.auth
  io.use((socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined;
    if (!token) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    try {
      const payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as AuthPayload;
      socket.data['userId'] = payload.userId;
      socket.data['email'] = payload.email;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  logger.info('Socket.io server initialized');

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, userId: socket.data['userId'] as string }, 'Client connected');
    registerSocketHandlers(io!, socket);

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Client disconnected');
    });
  });

  return io;
};

export const getIO = (): SocketServer => {
  if (!io) {
    throw new Error('Socket.io server not initialized. Call initSocketServer first.');
  }
  return io;
};
