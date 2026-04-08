import { create } from 'zustand';
import type { UserDTO } from '@shared/types';

interface AuthState {
  accessToken: string | null;
  user: UserDTO | null;
  isLoading: boolean;

  setAccessToken: (token: string) => void;
  setUser: (user: UserDTO) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  isLoading: false,

  setAccessToken: (token) => set({ accessToken: token }),

  setUser: (user) => set({ user }),

  clearAuth: () => set({ accessToken: null, user: null }),
}));
