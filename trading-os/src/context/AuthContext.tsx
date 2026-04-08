"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AuthUser = {
  id?: number | string;
  username?: string;
  email?: string;
  is_admin?: number | boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  initialized: boolean;
  login: (nextToken: string, nextUser?: AuthUser | null) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_STORAGE_KEY = "token";
const LEGACY_TOKEN_STORAGE_KEY = "authToken";
const USER_STORAGE_KEY = "user";

function writeAuthCookie(token: string | null) {
  if (typeof document === "undefined") return;

  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";

  if (token) {
    document.cookie = `token=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Lax${secure}`;
    return;
  }

  document.cookie = `token=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY);
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);

    setToken(storedToken || null);

    let parsedUser: AuthUser | null = null;
    if (storedUser) {
      try {
        parsedUser = JSON.parse(storedUser) as AuthUser;
      } catch {
        parsedUser = null;
      }
    }

    // If stored user is missing is_admin, decode it from the JWT payload directly
    if (storedToken && parsedUser && parsedUser.is_admin == null) {
      try {
        const payload = JSON.parse(atob(storedToken.split(".")[1])) as Record<string, unknown>;
        if (payload.is_admin != null) {
          parsedUser = { ...parsedUser, is_admin: payload.is_admin as number | boolean };
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(parsedUser));
        }
      } catch {
        // ignore decode errors
      }
    }

    setUser(parsedUser);
    writeAuthCookie(storedToken || null);
    setInitialized(true);
  }, []);

  const login = useCallback((nextToken: string, nextUser?: AuthUser | null) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
    localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, nextToken);

    if (nextUser) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    }

    writeAuthCookie(nextToken);
    setToken(nextToken);
    setUser(nextUser || null);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);

    writeAuthCookie(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token),
      isAdmin: Boolean(user?.is_admin === true || user?.is_admin === 1),
      initialized,
      login,
      logout,
    }),
    [initialized, login, logout, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
