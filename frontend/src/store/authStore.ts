import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthWorkshop {
  id: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  workshop: AuthWorkshop | null;
  permissions: string[];
  setAuth: (token: string, user: AuthUser, workshop: AuthWorkshop, permissions?: string[]) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      workshop: null,
      permissions: [],
      setAuth: (token, user, workshop, permissions = []) =>
        set({ token, user, workshop, permissions }),
      logout: () => set({ token: null, user: null, workshop: null, permissions: [] }),
    }),
    { name: 'garage-auth' },
  ),
);
