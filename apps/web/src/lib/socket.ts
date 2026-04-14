import { io } from 'socket.io-client';
import { useAuthStore } from '@web/stores/authStore';

const socket = io(window.location.origin, {
  autoConnect: false,
  withCredentials: true,
  // Inject the current JWT so the server's socket auth middleware accepts the connection.
  // The token is re-read on every connect/reconnect attempt.
  auth: (cb) => {
    const token = useAuthStore.getState().accessToken;
    cb({ token: token ?? '' });
  },
});

export default socket;
