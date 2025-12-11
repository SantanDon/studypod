import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { LocalUser, LocalSession } from "@/integrations/supabase/client";
import { localStorageService } from "@/services/localStorageService";

interface AuthContextType {
  user: LocalUser | null;
  session: LocalSession | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
  signIn: (user: LocalUser, session: LocalSession) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const updateAuthState = useCallback(
    (newUser: LocalUser | null, newSession: LocalSession | null) => {
      console.log(
        "AuthContext: Updating auth state:",
        newUser?.email || "No user",
      );
      setUser(newUser);
      setSession(newSession);

      // Clear any previous errors on successful auth in a way that doesn't
      // create a dependency on the `error` variable (so this callback stays stable).
      setError((prev) => (newUser && prev ? null : prev));
    },
    [],
  );

  const clearAuthState = useCallback(() => {
    console.log("AuthContext: Clearing auth state");
    setUser(null);
    setSession(null);
    setError(null);
  }, []);

  const signIn = (user: LocalUser, session: LocalSession) => {
    console.log("AuthContext: Starting sign in process...", user.email);

    try {
      // Store the session and user in localStorage
      localStorage.setItem("currentSession", JSON.stringify(session));
      localStorageService.setCurrentUser(user);

      // Update internal state immediately
      updateAuthState(user, session);

      console.log("AuthContext: Sign in successful for", user.email);
    } catch (err) {
      console.error("AuthContext: Sign in error:", err);
      setError(err instanceof Error ? err.message : "Sign in error");
    }
  };

  const signOut = async () => {
    try {
      console.log("AuthContext: Starting logout process...");

      // Clear local storage
      localStorageService.setCurrentUser(null);
      localStorage.removeItem("currentSession");

      // Clear local state immediately
      clearAuthState();

      console.log("AuthContext: Logout successful");
    } catch (err) {
      console.error("AuthContext: Unexpected logout error:", err);

      // Even if there's an error, try to clear local session
      try {
        localStorageService.setCurrentUser(null);
        localStorage.removeItem("currentSession");
        clearAuthState();
      } catch (localError) {
        console.error(
          "AuthContext: Failed to clear local session:",
          localError,
        );
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    const initializeAuth = () => {
      try {
        console.log("AuthContext: Initializing auth...");

        // Get user from local storage
        const currentUser = localStorageService.getCurrentUser();
        const sessionData = localStorage.getItem("currentSession");

        if (currentUser && sessionData) {
          try {
            const session = JSON.parse(sessionData);
            if (mounted) {
              console.log(
                "AuthContext: Found existing session:",
                currentUser.email,
              );
              updateAuthState(currentUser, session);
            }
          } catch (parseError) {
            console.error("Error parsing session data:", parseError);
            if (mounted) {
              // Clear corrupted session data
              localStorage.removeItem("currentSession");
              updateAuthState(null, null);
            }
          }
        } else if (mounted) {
          console.log("AuthContext: No existing session found");
          updateAuthState(null, null);
        }

        if (mounted) {
          setLoading(false);
        }
      } catch (err) {
        console.error("AuthContext: Auth initialization error:", err);
        if (mounted) {
          setError(err instanceof Error ? err.message : "Authentication error");
          setLoading(false);
        }
      }
    };

    // Initialize auth state synchronously
    initializeAuth();

    return () => {
      mounted = false;
    };
  }, [updateAuthState]); // updateAuthState is stable via useCallback

  const value: AuthContextType = {
    user,
    session,
    loading,
    error,
    isAuthenticated: !!user && !!session,
    signOut,
    signIn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
