import type { Server as SocketServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '@shared/constants';
import { logger } from '@api/utils/logger';

export const registerSocketHandlers = (io: SocketServer, socket: Socket): void => {
  socket.on(SOCKET_EVENTS.JOIN_WORKSPACE, async (workspaceId: unknown) => {
    // TODO: implement — verify membership, join room, emit USER_JOINED
    logger.info({ socketId: socket.id, workspaceId }, 'JOIN_WORKSPACE received');
    void io;
  });

  socket.on(SOCKET_EVENTS.LEAVE_WORKSPACE, (workspaceId: unknown) => {
    // TODO: implement — leave room, emit USER_LEFT
    logger.info({ socketId: socket.id, workspaceId }, 'LEAVE_WORKSPACE received');
  });
};
