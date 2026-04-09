import { useEffect, useState } from 'react';
import socket from '@web/lib/socket';
import { SOCKET_EVENTS } from '@shared/constants';
import { useAuthStore } from '@web/stores/authStore';

interface PresenceUser {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

interface UsePresenceReturn {
  onlineUsers: PresenceUser[];
}

export const usePresence = (workspaceId: string | null): UsePresenceReturn => {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!workspaceId || !user) return;

    socket.connect();
    socket.emit(SOCKET_EVENTS.JOIN_WORKSPACE, workspaceId);

    const handleUserPresence = (users: PresenceUser[]): void => {
      setOnlineUsers(users);
    };

    socket.on(SOCKET_EVENTS.USER_PRESENCE, handleUserPresence);

    return (): void => {
      socket.emit(SOCKET_EVENTS.LEAVE_WORKSPACE, workspaceId);
      socket.off(SOCKET_EVENTS.USER_PRESENCE, handleUserPresence);
    };
  }, [workspaceId, user]);

  return { onlineUsers };
};
