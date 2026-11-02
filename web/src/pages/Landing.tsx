import React from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet,
  ShieldCheck,
  Scale,
  Database,
  Lock,
  Zap,
  ArrowRight,
  GitBranch,
  Sparkles,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/UI';

export const Landing: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-gray-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-900 dark:text-gray-100">
      {/* Top Navigation */}
      <header className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-700 to-primary-500 flex items-center justify-center text-white shadow-sm shadow-primary-900/20">
            <Wallet className="w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight">PayLedger</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-primary-600 transition-colors">
            Sign In
          </Link>
          <Link to="/register">
            <Button size="sm">Create Account</Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800 mb-6 shadow-warm-sm">
          <Database className="w-3.5 h-3.5 text-primary-600" />
          PostgreSQL 16 High-Integrity Double-Entry Engine
        </div>
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6">
          Fintech Ledger Architecture, <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-700 via-primary-600 to-primary-500 font-serif italic">
            Enforced in Database Core.
          </span>
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed font-sans">
          A full-featured simulated digital wallet, lending, and reconciliation platform where all critical business rules, constraints, isolation levels, and concurrency protections reside directly in SQL.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/login">
            <Button size="lg" className="w-full sm:w-auto flex items-center gap-2">
              Launch Live Application <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link to="/login">
            <Button variant="outline" size="lg" className="w-full sm:w-auto">
              Explore Demo Accounts
            </Button>
          </Link>
        </div>
      </section>

      {/* Three Pillars Module Highlights */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-xs uppercase tracking-wider font-bold text-primary-600 dark:text-primary-400 mb-2">Team Architecture</h2>
          <h3 className="text-3xl font-bold tracking-tight">Three Integrated Fintech Pillars</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Member 1: Wallet & Ledger */}
          <div className="bg-white dark:bg-gray-800/80 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 shadow-warm relative overflow-hidden">
            <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-950 text-primary-700 dark:text-primary-300 flex items-center justify-center mb-6 font-bold">
              <Layers className="w-6 h-6" />
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              Module 1: Wallet & Ledger
            </span>
            <h4 className="text-xl font-bold mt-4 mb-3">Double-Entry Core</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              Immutable append-only ledger entries. Balance is never directly modified; atomic triggers maintain running balances with strict non-negative wallet constraints and deadlock-free transfers.
            </p>
            <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
              <li>• Deferred double-entry invariant trigger</li>
              <li>• Append-only block on UPDATE/DELETE</li>
              <li>• Idempotency key de-duplication</li>
            </ul>
          </div>

          {/* Member 2: Lending */}
          <div className="bg-white dark:bg-gray-800/80 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 shadow-warm relative overflow-hidden">
            <div className="w-12 h-12 rounded-xl bg-success-100 dark:bg-success-950 text-success-700 dark:text-success-400 flex items-center justify-center mb-6 font-bold">
              <Zap className="w-6 h-6" />
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              Module 2: Lending & Credit
            </span>
            <h4 className="text-xl font-bold mt-4 mb-3">Reducing-Balance EMI</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              Stored procedures calculate exact reducing-balance amortisation schedules with exact principal sum matching. Automated nightly batch accrual marks overdue EMIs and assesses penalties.
            </p>
            <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
              <li>• Reducing-balance amortisation formula</li>
              <li>• Full & partial EMI payment / prepayment</li>
              <li>• Idempotent daily penalty accrual batch</li>
            </ul>
          </div>

          {/* Member 3: Risk & Reconciliation */}
          <div className="bg-white dark:bg-gray-800/80 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 shadow-warm relative overflow-hidden">
            <div className="w-12 h-12 rounded-xl bg-error-100 dark:bg-error-950 text-error-700 dark:text-error-400 flex items-center justify-center mb-6 font-bold">
              <Scale className="w-6 h-6" />
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              Module 3: Risk & Audit
            </span>
            <h4 className="text-xl font-bold mt-4 mb-3">Fraud & Reconciliation</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              Real-time post-transfer trigger evaluates five fraud patterns (Velocity, Large Amount, Round-Tripping, Structuring). Automated CSV reconciliation matches bank lines against ledger rows.
            </p>
            <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
              <li>• Real-time fraud detection trigger</li>
              <li>• Bank statement matching procedure</li>
              <li>• Row-Level Security & JSONB audit triggers</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Database Highlights Banner */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="bg-gradient-to-br from-[#2D1E16] via-[#241710] to-[#1A100B] text-white rounded-3xl p-10 shadow-warm-xl border border-[#3D2A1E] flex flex-col lg:flex-row items-center justify-between gap-8">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary-900/80 text-primary-200 border border-primary-800/60 mb-4">
              <Sparkles className="w-3.5 h-3.5 text-primary-300" />
              DBMS 3-Credit Project
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">Live DBMS Evidence in DB Lab</h3>
            <p className="text-primary-100/80 max-w-xl text-sm leading-relaxed">
              Experience the live concurrency test executing 100 parallel transfers, verify the double-entry invariant, inspect monthly range partitions, and compare 5 real EXPLAIN ANALYZE index plans.
            </p>
          </div>
          <Link to="/login">
            <Button variant="secondary" size="lg" className="whitespace-nowrap">
              Test Database Invariants
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 text-center text-xs text-gray-500">
        <p>PayLedger Simulated Fintech Platform • University DBMS Project • No real funds or real banking involved.</p>
      </footer>
    </div>
  );
};
