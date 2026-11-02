import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import { Sparkles, ShieldCheck, Landmark } from 'lucide-react';

export const Layout: React.FC = () => {
  const { user } = useAuth();
  const initials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'PL';

  return (
    <div className="flex min-h-screen bg-surface-cream dark:bg-stone-950 text-warm-charcoal dark:text-warm-sand transition-colors">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top App Bar - Modern Banking / GPay & PhonePe Style */}
        <header className="h-16 bg-surface/90 dark:bg-stone-900/90 backdrop-blur-md border-b border-warm-sand/40 dark:border-stone-800 px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary-500/10 dark:bg-primary-500/15 border border-primary-500/20 text-primary-800 dark:text-primary-200 text-xs font-semibold">
              <Landmark className="w-3.5 h-3.5 text-primary-600" />
              <span>PayLedger Core Banking</span>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              ACID Verified • 0 Deadlocks
            </span>
          </div>

          <div className="flex items-center gap-4">
            <ThemeToggle />
            <div className="h-6 w-px bg-warm-sand/40 dark:border-stone-700" />
            
            {/* User Profile Pill - PhonePe / GPay Profile Header */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary-700 to-amber-600 text-white font-bold text-xs flex items-center justify-center shadow-sm font-sans tracking-wide">
                {initials}
              </div>
              <div className="text-left hidden sm:block">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-bold text-warm-charcoal dark:text-warm-sand leading-none">
                    {user?.full_name}
                  </p>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-[10px] text-warm-charcoal/50 dark:text-warm-sand/50 font-mono mt-0.5">
                  {user?.role === 'customer' ? `${user?.email?.split('@')[0]}@payledger` : user?.email}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>

        {/* Banking App Footer */}
        <footer className="py-4 px-6 sm:px-8 border-t border-warm-sand/40 dark:border-stone-800 bg-surface/60 dark:bg-stone-900/60 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-warm-charcoal/50 dark:text-warm-sand/50">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-warm-charcoal/70 dark:text-warm-sand/70">PayLedger FinTech Banking</span>
            <span>•</span>
            <span>PostgreSQL 16 Engine</span>
            <span>•</span>
            <span>Double-Entry Core</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-500/20">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Demo / simulated funds
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
};
