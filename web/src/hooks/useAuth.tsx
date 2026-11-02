import React, { createContext, useContext, useCallback, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/api/client';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  phone?: string;
  status?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  role: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { full_name: string; email: string; phone?: string; password: string; role: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  // Load from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('payledger_token');
    const savedUser = localStorage.getItem('payledger_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('payledger_user');
      }
      authApi.me()
        .then(({ data }) => {
          setUser(data);
          localStorage.setItem('payledger_user', JSON.stringify(data));
        })
        .catch(() => {
          setToken(null);
          setUser(null);
          localStorage.removeItem('payledger_token');
          localStorage.removeItem('payledger_user');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await authApi.login({ email, password });
    const accessToken = data.access_token;
    localStorage.setItem('payledger_token', accessToken);
    setToken(accessToken);

    // Fetch user details
    const meRes = await authApi.me();
    const userData = meRes.data;
    setUser(userData);
    localStorage.setItem('payledger_user', JSON.stringify(userData));

    const roleRoutes: Record<string, string> = {
      customer: '/dashboard',
      merchant: '/merchant/payments',
      loan_officer: '/officer/queue',
      risk_analyst: '/analyst/alerts',
      admin: '/admin/analytics',
    };
    navigate(roleRoutes[userData.role] || '/dashboard');
  }, [navigate]);

  const register = useCallback(async (regData: { full_name: string; email: string; phone?: string; password: string; role: string }) => {
    const { data } = await authApi.register(regData);
    const accessToken = data.access_token;
    localStorage.setItem('payledger_token', accessToken);
    setToken(accessToken);

    const meRes = await authApi.me();
    const userData = meRes.data;
    setUser(userData);
    localStorage.setItem('payledger_user', JSON.stringify(userData));

    const roleRoutes: Record<string, string> = {
      customer: '/dashboard',
      merchant: '/merchant/payments',
      loan_officer: '/officer/queue',
      risk_analyst: '/analyst/alerts',
      admin: '/admin/analytics',
    };
    navigate(roleRoutes[userData.role] || '/dashboard');
  }, [navigate]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('payledger_token');
    localStorage.removeItem('payledger_user');
    navigate('/login');
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: !!token && !!user,
      role: user?.role ?? null,
      isLoading,
      login,
      register,
      logout,
    }),
    [user, token, isLoading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
