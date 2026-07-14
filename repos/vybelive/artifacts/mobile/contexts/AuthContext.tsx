import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { User } from "@workspace/api-client-react";

// Tokens are stored in the OS-backed secure keystore (expo-secure-store) to
// prevent recovery via device backups, rooted-device sandbox reads, or other
// local storage attacks.  Non-sensitive profile data uses AsyncStorage.
const ACCESS_TOKEN_KEY = "vybe_access_token";
const REFRESH_TOKEN_KEY = "vybe_refresh_token";
const USER_KEY = "vybe_user";

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (accessToken: string, refreshToken: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  tryRefreshToken: () => Promise<string | null>;
  /** Returns a fresh access token, proactively refreshing if it expires within 60s. */
  getValidToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  accessToken: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  updateUser: async () => {},
  tryRefreshToken: async () => null,
  getValidToken: async () => null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  // Keep refs in sync so the async token getter always sees the latest values
  // without needing to be recreated on every state change.
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const isRefreshingRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { refreshTokenRef.current = refreshToken; }, [refreshToken]);

  useEffect(() => {
    (async () => {
      try {
        const [storedAccess, storedRefresh, storedUser] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (storedAccess && storedRefresh && storedUser) {
          const parsedUser = JSON.parse(storedUser) as User;
          setAccessToken(storedAccess);
          setRefreshToken(storedRefresh);
          setUser(parsedUser);
        }
      } catch {
        // ignore storage errors
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Perform a raw refresh call (bypasses customFetch to avoid circular auth getter calls)
  const tryRefreshToken = useCallback(async (): Promise<string | null> => {
    const storedRefresh = refreshTokenRef.current;
    if (!storedRefresh) return null;

    // Deduplicate concurrent refresh calls
    if (isRefreshingRef.current && refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    isRefreshingRef.current = true;
    refreshPromiseRef.current = (async () => {
      try {
        const base = process.env["EXPO_PUBLIC_DOMAIN"]
          ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}`
          : "https://getvybe.live";
        const resp = await fetch(`${base}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: storedRefresh }),
        });

        if (!resp.ok) return null;

        const data = (await resp.json()) as {
          accessToken: string;
          refreshToken: string;
          user: User;
        };

        await Promise.all([
          SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken),
          SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken),
          AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user)),
        ]);

        setAccessToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        setUser(data.user);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        isRefreshingRef.current = false;
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }, []);

  // Smart auth token getter: proactively refreshes if the access token
  // expires within 60 seconds, preventing mid-request failures.
  // Exposed as getValidToken() for use in manual fetch() calls (OAuth screens,
  // etc.) that bypass React Query and need a guaranteed-fresh token.
  const getValidToken = useCallback(async (): Promise<string | null> => {
    const token = accessTokenRef.current;
    if (!token) return null;

    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(
          atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
        ) as { exp?: number };
        const nowSec = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp - nowSec < 60) {
          return tryRefreshToken();
        }
      }
    } catch {
      // Malformed token — use as-is and let server reject if invalid
    }

    return token;
  }, [tryRefreshToken]);

  useEffect(() => {
    setAuthTokenGetter(getValidToken);
  }, [getValidToken]);

  const login = useCallback(
    async (newAccessToken: string, newRefreshToken: string, newUser: User) => {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, newAccessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, newRefreshToken),
        AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser)),
      ]);
      setAccessToken(newAccessToken);
      setRefreshToken(newRefreshToken);
      setUser(newUser);
    },
    []
  );

  const logout = useCallback(async () => {
    // Best-effort server-side session revocation: send the refresh token so the
    // server can null refreshTokenHash and bump tokenVersion even when the
    // access token has expired.  Local cleanup always proceeds regardless of
    // network outcome.
    const currentRefresh = refreshTokenRef.current;
    if (currentRefresh) {
      try {
        const base = process.env["EXPO_PUBLIC_DOMAIN"]
          ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}`
          : "https://getvybe.live";
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: currentRefresh }),
        });
      } catch {
        // Network failure — still proceed with local cleanup
      }
    }

    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const updateUser = useCallback(async (updatedUser: User) => {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
    setUser(updatedUser);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        isAuthenticated: !!accessToken && !!user,
        login,
        logout,
        updateUser,
        tryRefreshToken,
        getValidToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
