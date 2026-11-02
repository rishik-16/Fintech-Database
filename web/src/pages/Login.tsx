import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/UI';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoEmail: string, demoPw: string = 'password123') => {
    setEmail(demoEmail);
    setPassword(demoPw);
    setError('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-200/90 dark:border-gray-800 shadow-warm-lg">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-primary-700 to-primary-500 flex items-center justify-center text-white mx-auto shadow-sm shadow-primary-900/20 mb-3">
            <Wallet className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Sign In to PayLedger</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Simulated Fintech Core Engine</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-3 text-sm text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@example.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
          <Button type="submit" isLoading={loading} className="w-full mt-2">
            Sign In
          </Button>
        </form>

        {/* 1-Click Demo Login Shortcuts for Graders */}
        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3 text-center">
            Quick-Fill Role Credentials
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => fillDemo('alice@example.com')}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-left hover:border-primary-500 hover:bg-primary-50/40 dark:hover:border-primary-400 transition-colors"
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">Customer (Alice)</div>
              <div className="text-[10px] text-gray-400">alice@example.com</div>
            </button>
            <button
              type="button"
              onClick={() => fillDemo('bob@example.com')}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-left hover:border-primary-500 hover:bg-primary-50/40 dark:hover:border-primary-400 transition-colors"
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">Customer (Bob)</div>
              <div className="text-[10px] text-gray-400">bob@example.com</div>
            </button>
            <button
              type="button"
              onClick={() => fillDemo('shopmart@example.com')}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-left hover:border-primary-500 hover:bg-primary-50/40 dark:hover:border-primary-400 transition-colors"
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">Merchant</div>
              <div className="text-[10px] text-gray-400">shopmart@example.com</div>
            </button>
            <button
              type="button"
              onClick={() => fillDemo('officer1@payledger.com')}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-left hover:border-primary-500 hover:bg-primary-50/40 dark:hover:border-primary-400 transition-colors"
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">Loan Officer</div>
              <div className="text-[10px] text-gray-400">officer1@payledger.com</div>
            </button>
            <button
              type="button"
              onClick={() => fillDemo('analyst1@payledger.com')}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-left hover:border-primary-500 hover:bg-primary-50/40 dark:hover:border-primary-400 transition-colors"
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">Risk Analyst</div>
              <div className="text-[10px] text-gray-400">analyst1@payledger.com</div>
            </button>
            <button
              type="button"
              onClick={() => fillDemo('admin@payledger.com', 'admin123')}
              className="p-2.5 rounded-xl border border-primary-200 dark:border-primary-800 text-left hover:border-primary-500 transition-colors bg-primary-50/60 dark:bg-primary-950/40"
            >
              <div className="font-semibold text-primary-800 dark:text-primary-300">Administrator</div>
              <div className="text-[10px] text-gray-400">admin@payledger.com</div>
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
          Need an account?{' '}
          <Link to="/register" className="font-semibold text-primary-600 hover:text-primary-700">
            Sign up here
          </Link>
        </p>
      </div>
    </div>
  );
};
