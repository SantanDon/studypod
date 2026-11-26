import {
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { AuthContext, AuthContextType } from "./AuthContextInstance";
import { LocalUser, LocalSession } from "@/services/localStorageService";
import { localStorageService } from "@/services/localStorageService";
import { useEncryptionStore } from "@/stores/encryptionStore";
import { safeGetItem, safeParseJSON } from "@/lib/utils/contextUtils";
import { ApiService } from "@/services/apiService";
import { clearPersonalProviderConnection } from "@/lib/ai/personalProviderContext";


interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const authUserIdRef = useRef<string | null>(null);

  const authRevision = useRef(0);

  const updateAuthState = useCallback(
    (newUser: LocalUser | null, newSession: LocalSession | null) => {
      if (authUserIdRef.current && authUserIdRef.current !== (newUser?.id ?? null)) clearPersonalProviderConnection();
      authUserIdRef.current = newUser?.id ?? null;
      setUser(newUser);
      setSession(newSession);
      setError((prev) => (newUser && prev ? null : prev));
    },
    [],
  );

  const clearAuthState = useCallback(() => {
    clearPersonalProviderConnection();
    authUserIdRef.current = null;
    console.log("AuthContext: Clearing auth state");
    setUser(null);
    setSession(null);
    setError(null);
  }, []);

  const signIn = async (credentials: Record<string, unknown>) => {
    console.log("AuthContext: Starting sign in process...");
    setError(null);
    try {
      const data = await ApiService.signin(credentials);
      
      if (data.mfaRequired) {
        setMfaRequired(true);
        setMfaToken(data.mfaToken);
        return false;
      }

      signInWithCloud(data.user);
      return true;
    } catch (err) {
      console.error("AuthContext: Sign in error:", err);
      setError(err instanceof Error ? err.message : "Sign in error");
      throw err;
    }
  };

  const signInWithCloud = (userData: { id: string; email?: string; displayName?: string; account_type?: string; createdAt: string }) => {
    authRevision.current++;
    const { setUnlockedOnly } = useEncryptionStore.getState();
    
    try {
      const mappedUser: LocalUser = {
        id: userData.id,
        email: userData.email || `${userData.displayName}@agent.local`,
        displayName: userData.displayName,
        account_type: userData.account_type,
        created_at: userData.createdAt
      };

      // In cookie mode, we don't store tokens in LocalSession
      const mappedSession: LocalSession = {
        access_token: "SESSION_MANAGED_BY_COOKIE",
        refresh_token: "SESSION_MANAGED_BY_COOKIE",
        expires_at: Date.now() + 3600000, // Placeholder
        user: mappedUser
      };

      localStorageService.clearLegacyIdentity();
      setUnlockedOnly(userData.id);
      updateAuthState(mappedUser, mappedSession);
      setMfaRequired(false);
      setMfaToken(null);

    } catch (err) {
      console.error("AuthContext: Cloud sign in mapping error:", err);
      setError("Cloud sign in failed");
    }
  };

  const verifyMfa = async (code: string) => {
    if (!mfaToken) {
      setError("MFA session expired. Please sign in again.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await ApiService.mfaVerify(mfaToken, code);
      signInWithCloud(data.user);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "MFA verification failed";
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const signOut = useCallback(async () => {
    authRevision.current++;
    localStorageService.clearLegacyIdentity();
    clearAuthState();
    setMfaRequired(false);
    setMfaToken(null);
    await ApiService.signout().catch(() => {
      setError("This browser could not confirm sign out. Check your connection and try again.");
    });
  }, [clearAuthState]);

  useEffect(() => {
    let mounted = true;
    const revision = authRevision.current;

    const initializeAuth = async () => {
      try {
        console.log("AuthContext: Initializing auth...");

        // In cookie mode, we verify by calling /api/user/profile
        // This is safer than trusting localStorage
        try {
          const profileData = await ApiService.getUser("COOKIE_SESSION", { checkingInitialSession: true });
          if (!mounted || revision !== authRevision.current) return;
          if (profileData.user) {
            localStorageService.clearLegacyIdentity();
            
            const mappedUser: LocalUser = {
              id: profileData.user.id,
              email: profileData.user.email,
              displayName: profileData.user.displayName,
              account_type: profileData.user.account_type || 'cloud',
              created_at: profileData.user.createdAt
            };

            const mappedSession: LocalSession = {
              access_token: "SESSION_MANAGED_BY_COOKIE",
              refresh_token: "SESSION_MANAGED_BY_COOKIE",
              expires_at: Date.now() + 3600000,
              user: mappedUser
            };

            updateAuthState(mappedUser, mappedSession);
            setLoading(false);
            return;
          }
        } catch {
          if (!mounted || revision !== authRevision.current) return;
        }

        const guest = localStorageService.getLegacyGuestUser();
        const stored = safeParseJSON<LocalSession>(safeGetItem("currentSession"));
        if (guest && stored?.user?.id === guest.id && stored.expires_at > Date.now()
          && typeof stored.access_token === "string" && /^guest_[A-Za-z0-9_-]{12,128}$/.test(stored.access_token)) {
          updateAuthState(guest, { user: guest, expires_at: stored.expires_at, access_token: stored.access_token });
        } else {
          localStorageService.clearLegacyIdentity();
        }
      } catch (err) {
        console.error("AuthContext: Auth initialization error:", err);
        if (mounted) {
          setError(err instanceof Error ? err.message : "Authentication error");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Initialize auth state synchronously
    initializeAuth();

    return () => {
      mounted = false;
    };
  }, [updateAuthState]); // updateAuthState is stable via useCallback

  // Listen for global unauthorized API responses to force signout
  useEffect(() => {
    const handleUnauthorized = () => {
      console.log("AuthContext: Received auth:unauthorized event, forcing signout...");
      signOut();
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [signOut]);

  const value: AuthContextType = {
    user,
    session,
    loading,
    error,
    isAuthenticated: !!user && !!session,
    mfaRequired,
    mfaToken,
    signOut,
    signIn,
    signInWithCloud,
    verifyMfa,
    recoverAccount: async (displayName: string, recoveryKey: string) => {
      setError(null);
      try {
        return await ApiService.recover(displayName, recoveryKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Recovery failed";
        setError(msg);
        throw new Error(msg);
      }
    },
    resetPassphrase: async (resetToken: string, newPassphrase: string) => {
      setError(null);
      try {
        const data = await ApiService.resetPassphrase(resetToken, newPassphrase);
        if (data.user) {
          // Auto-login after reset
          signInWithCloud(data.user);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Reset failed";
        setError(msg);
        throw new Error(msg);
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
