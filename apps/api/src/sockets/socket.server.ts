import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import config from '@api/config';
import { logger } from '@api/utils/logger';
import { registerSocketHandlers } from './socket.handlers';

let io: SocketServer | null = null;

export const initSocketServer = (httpServer: HttpServer): SocketServer => {
  io = new SocketServer(httpServer, {
    cors: {
      origin: config.CORS_ORIGIN,
      credentials: true,
    },
  });

  logger.info('Socket.io server initialized');

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');
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
