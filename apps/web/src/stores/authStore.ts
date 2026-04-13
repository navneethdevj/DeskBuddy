import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { UserDTO } from '@shared/types';

interface AuthState {
  accessToken: string | null;
  user: UserDTO | null;
  isLoading: boolean;

  setAccessToken: (token: string) => void;
  setUser: (user: UserDTO) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isLoading: false,

      setAccessToken: (token) => set({ accessToken: token }),

      setUser: (user) => set({ user }),

      clearAuth: () => set({ accessToken: null, user: null }),
    }),
    {
      name: 'deskbuddy-auth',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist token + user; never persist transient isLoading flag.
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
    },
  ),
);
