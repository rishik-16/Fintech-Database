import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Wallet,
  ArrowRightLeft,
  Store,
  FileText,
  BadgeDollarSign,
  ClipboardList,
  ShieldAlert,
  Sliders,
  Scale,
  Users,
  ScrollText,
  Activity,
  Server,
  FlaskConical,
  LogOut,
  ChevronRight,
  PieChart,
  Landmark,
  ShieldCheck,
  CreditCard,
  Send,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export const Sidebar: React.FC = () => {
  const { user, role, logout } = useAuth();

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
      isActive
        ? 'bg-primary-600 text-white shadow-warm'
        : 'text-warm-charcoal/70 dark:text-warm-sand/70 hover:bg-warm-sand/20 dark:hover:bg-stone-800 hover:text-warm-charcoal dark:hover:text-warm-sand'
    }`;

  return (
    <aside className="w-64 bg-surface dark:bg-stone-900 border-r border-warm-sand/40 dark:border-stone-800 flex flex-col h-screen sticky top-0 z-40">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-warm-sand/30 dark:border-stone-800 gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary-700 to-amber-600 flex items-center justify-center text-white shadow-sm shadow-primary-900/20">
          <Landmark className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-base text-warm-charcoal dark:text-warm-sand leading-tight font-display tracking-tight">
            PayLedger
          </h1>
          <p className="text-[10px] uppercase font-bold tracking-wider text-primary-600 dark:text-primary-400">
            UPI & Core Banking
          </p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* Core Wallet (Customer / Admin) */}
        {(role === 'customer' || role === 'admin') && (
          <div>
            <p className="px-3 text-[10px] font-bold text-warm-charcoal/40 dark:text-warm-sand/40 uppercase tracking-widest mb-2">
              Payments & Transfers
            </p>
            <div className="space-y-1">
              <NavLink to="/dashboard" className={navItemClass}>
                <Wallet className="w-4 h-4" />
                <span>Home / Wallet</span>
              </NavLink>
              <NavLink to="/send-money" className={navItemClass}>
                <Send className="w-4 h-4" />
                <span>Send Money</span>
              </NavLink>
              <NavLink to="/pay-merchant" className={navItemClass}>
                <Store className="w-4 h-4" />
                <span>Pay Merchant</span>
              </NavLink>
              <NavLink to="/statement" className={navItemClass}>
                <FileText className="w-4 h-4" />
                <span>Passbook & History</span>
              </NavLink>
            </div>
          </div>
        )}

        {/* Lending Module (Customer / Admin) */}
        {(role === 'customer' || role === 'admin') && (
          <div>
            <p className="px-3 text-[10px] font-bold text-warm-charcoal/40 dark:text-warm-sand/40 uppercase tracking-widest mb-2">
              Loans & Credit
            </p>
            <div className="space-y-1">
              <NavLink to="/loans" className={navItemClass}>
                <CreditCard className="w-4 h-4" />
                <span>My Loans & EMIs</span>
              </NavLink>
              <NavLink to="/loans/apply" className={navItemClass}>
                <ChevronRight className="w-4 h-4" />
                <span>Apply for Loan</span>
              </NavLink>
            </div>
          </div>
        )}

        {/* Merchant Section */}
        {(role === 'merchant' || role === 'admin') && (
          <div>
            <p className="px-3 text-[10px] font-bold text-warm-charcoal/40 dark:text-warm-sand/40 uppercase tracking-widest mb-2">
              Merchant Business
            </p>
            <div className="space-y-1">
              <NavLink to="/merchant/payments" className={navItemClass}>
                <Store className="w-4 h-4" />
                <span>Payments Received</span>
              </NavLink>
              <NavLink to="/merchant/settlements" className={navItemClass}>
                <FileText className="w-4 h-4" />
                <span>Settlements</span>
              </NavLink>
            </div>
          </div>
        )}

        {/* Loan Officer Portal */}
        {(role === 'loan_officer' || role === 'admin') && (
          <div>
            <p className="px-3 text-[10px] font-bold text-warm-charcoal/40 dark:text-warm-sand/40 uppercase tracking-widest mb-2">
              Credit Underwriting
            </p>
            <div className="space-y-1">
              <NavLink to="/officer/queue" className={navItemClass}>
                <ClipboardList className="w-4 h-4" />
                <span>Approval Queue</span>
              </NavLink>
              <NavLink to="/officer/portfolio" className={navItemClass}>
                <PieChart className="w-4 h-4" />
                <span>Loan Portfolio & Treasury</span>
              </NavLink>
            </div>
          </div>
        )}

        {/* Risk Analyst Portal */}
        {(role === 'risk_analyst' || role === 'admin') && (
          <div>
            <p className="px-3 text-[10px] font-bold text-warm-charcoal/40 dark:text-warm-sand/40 uppercase tracking-widest mb-2">
              Risk & Compliance
            </p>
            <div className="space-y-1">
              <NavLink to="/analyst/alerts" className={navItemClass}>
                <ShieldAlert className="w-4 h-4" />
                <span>Fraud Alerts</span>
              </NavLink>
              <NavLink to="/analyst/rules" className={navItemClass}>
                <Sliders className="w-4 h-4" />
                <span>Fraud Rules Engine</span>
              </NavLink>
              <NavLink to="/analyst/reconciliation" className={navItemClass}>
                <Scale className="w-4 h-4" />
                <span>Bank Reconciliation</span>
              </NavLink>
            </div>
          </div>
        )}

        {/* Admin Portal */}
        {role === 'admin' && (
          <div>
            <p className="px-3 text-[10px] font-bold text-warm-charcoal/40 dark:text-warm-sand/40 uppercase tracking-widest mb-2">
              Core Administration
            </p>
            <div className="space-y-1">
              <NavLink to="/admin/users" className={navItemClass}>
                <Users className="w-4 h-4" />
                <span>Users & Accounts</span>
              </NavLink>
              <NavLink to="/admin/audit" className={navItemClass}>
                <ScrollText className="w-4 h-4" />
                <span>Security Audit Log</span>
              </NavLink>
              <NavLink to="/admin/analytics" className={navItemClass}>
                <Activity className="w-4 h-4" />
                <span>Platform Analytics</span>
              </NavLink>
              <NavLink to="/admin/system" className={navItemClass}>
                <Server className="w-4 h-4" />
                <span>PostgreSQL Engine</span>
              </NavLink>
            </div>
          </div>
        )}

        {/* DBMS Course Live Lab - Accessible to ALL */}
        <div className="pt-2">
          <NavLink
            to="/db-lab"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition-all ${
                isActive
                  ? 'bg-amber-600 text-white border-amber-600 shadow-warm'
                  : 'bg-amber-500/10 text-amber-900 dark:text-amber-200 border-amber-500/20 hover:bg-amber-500/20'
              }`
            }
          >
            <FlaskConical className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>DBMS Live Lab</span>
          </NavLink>
        </div>
      </nav>

      {/* User Footer Profile Card */}
      <div className="p-4 border-t border-warm-sand/30 dark:border-stone-800">
        <div className="flex items-center justify-between p-2 rounded-xl bg-warm-sand/15 dark:bg-stone-800/40">
          <div className="min-w-0 pr-2">
            <p className="text-xs font-bold text-warm-charcoal dark:text-warm-sand truncate">
              {user?.full_name}
            </p>
            <span className="text-[10px] font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wider block">
              {role?.replace('_', ' ')}
            </span>
          </div>
          <button
            onClick={logout}
            title="Sign Out"
            className="p-1.5 rounded-lg text-warm-charcoal/50 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
