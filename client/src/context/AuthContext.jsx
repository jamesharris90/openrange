import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

function decodeToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return {
      id: payload.id,
      username: payload.username || 'User',
      email: payload.email || '',
      isAdmin: !!payload.is_admin,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initialize from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('authToken');
    if (stored) {
      const decoded = decodeToken(stored);
      if (decoded) {
        setUser(decoded);
        setToken(stored);
      } else {
        localStorage.removeItem('authToken');
      }
    }
    setLoading(false);
  }, []);

  // Cross-tab sync
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key !== 'authToken') return;
      if (e.newValue) {
        const decoded = decodeToken(e.newValue);
        if (decoded) {
          setUser(decoded);
          setToken(e.newValue);
        }
      } else {
        setUser(null);
        setToken(null);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const login = useCallback((newToken) => {
    const decoded = decodeToken(newToken);
    if (!decoded) throw new Error('Invalid token');
    localStorage.setItem('authToken', newToken);
    setToken(newToken);
    setUser(decoded);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('authToken');
    setToken(null);
    setUser(null);
  }, []);

  const value = {
    user,
    token,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin || false,
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
