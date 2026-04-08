import type { Server as SocketServer, Socket } from 'socket.io';
import { prisma } from '@api/db/prisma';
import { SOCKET_EVENTS } from '@shared/constants';
import { logger } from '@api/utils/logger';

export const registerSocketHandlers = (io: SocketServer, socket: Socket): void => {
  const userId = socket.data['userId'] as string;

  socket.on(SOCKET_EVENTS.JOIN_WORKSPACE, async (workspaceId: unknown) => {
    if (typeof workspaceId !== 'string') return;
    try {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      });
      if (!member) {
        socket.emit('error', { message: 'Access denied to workspace', code: 'FORBIDDEN' });
        return;
      }
      await socket.join(workspaceId);
      io.to(workspaceId).emit(SOCKET_EVENTS.USER_JOINED, { userId, workspaceId });
      logger.info({ userId, workspaceId }, 'User joined workspace room');
    } catch (err) {
      logger.error({ err, userId, workspaceId }, 'Error handling JOIN_WORKSPACE');
    }
  });

  socket.on(SOCKET_EVENTS.LEAVE_WORKSPACE, async (workspaceId: unknown) => {
    if (typeof workspaceId !== 'string') return;
    try {
      await socket.leave(workspaceId);
      io.to(workspaceId).emit(SOCKET_EVENTS.USER_LEFT, { userId, workspaceId });
      logger.info({ userId, workspaceId }, 'User left workspace room');
    } catch (err) {
      logger.error({ err, userId, workspaceId }, 'Error handling LEAVE_WORKSPACE');
    }
  });

  socket.on('disconnect', () => {
    // Emit USER_LEFT for every workspace room this socket was in
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    for (const workspaceId of rooms) {
      io.to(workspaceId).emit(SOCKET_EVENTS.USER_LEFT, { userId, workspaceId });
    }
  });
};
