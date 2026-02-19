import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getToken, setToken, removeToken, getStoredUser, setStoredUser, removeStoredUser } from '../services/api';

interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setUser(null);
        return;
      }
      const data = await api.get('/api/user');
      if (data) {
        setUser(data);
        await setStoredUser(data);
      } else {
        setUser(null);
        await removeToken();
        await removeStoredUser();
      }
    } catch {
      const cached = await getStoredUser();
      if (cached) {
        setUser(cached);
      } else {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await refreshUser();
      setIsLoading(false);
    })();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const { API_BASE_URL } = require('../constants/config');
    const res = await fetch(`${API_BASE_URL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'mobile',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || 'Login failed');
    }

    const data = await res.json();

    if (data.sessionId) {
      await setToken(data.sessionId);
    }

    if (data.user) {
      setUser(data.user);
      await setStoredUser(data.user);
    } else {
      await refreshUser();
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/logout');
    } catch {}
    await removeToken();
    await removeStoredUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
