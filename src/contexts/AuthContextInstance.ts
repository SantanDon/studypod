import { createContext } from "react";
import { LocalUser, LocalSession } from "@/services/localStorageService";

export interface AuthContextType {
  user: LocalUser | null;
  session: LocalSession | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
  signIn: (user: LocalUser, session: LocalSession) => void;
  signInWithCloud: (userData: { id: string; email?: string; displayName?: string; account_type?: string; createdAt: string }, sessionData: { accessToken: string; refreshToken: string }) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
