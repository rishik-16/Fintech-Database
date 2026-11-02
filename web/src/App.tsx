import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';

// Public pages
import { Landing } from '@/pages/Landing';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';

// Customer pages
import { Dashboard } from '@/pages/customer/Dashboard';
import { SendMoney } from '@/pages/customer/SendMoney';
import { PayMerchant } from '@/pages/customer/PayMerchant';
import { Statement } from '@/pages/customer/Statement';
import { Loans } from '@/pages/customer/Loans';
import { LoanApply } from '@/pages/customer/LoanApply';
import { LoanDetail } from '@/pages/customer/LoanDetail';
import { Profile } from '@/pages/customer/Profile';

// Merchant pages
import { MerchantPayments } from '@/pages/merchant/Payments';
import { MerchantSettlements } from '@/pages/merchant/Settlements';

// Loan Officer pages
import { OfficerQueue } from '@/pages/officer/Queue';
import { OfficerPortfolio } from '@/pages/officer/Portfolio';

// Risk Analyst pages
import { RiskAlerts } from '@/pages/analyst/Alerts';
import { RiskRules } from '@/pages/analyst/Rules';
import { Reconciliation } from '@/pages/analyst/Reconciliation';

// Admin pages
import { AdminUsers } from '@/pages/admin/Users';
import { AdminAuditLog } from '@/pages/admin/AuditLog';
import { AdminAnalytics } from '@/pages/admin/Analytics';
import { AdminSystemHealth } from '@/pages/admin/SystemHealth';

// DB Lab page
import { DBLab } from '@/pages/DBLab';

export function App() {
  return (
    <Routes>
      {/* Public Landing & Auth */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Authenticated Application routes wrapped in Layout */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* Core Wallet & Customer */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/send-money" element={<SendMoney />} />
        <Route path="/pay-merchant" element={<PayMerchant />} />
        <Route path="/statement" element={<Statement />} />
        <Route path="/loans" element={<Loans />} />
        <Route path="/loans/apply" element={<LoanApply />} />
        <Route path="/loans/:id" element={<LoanDetail />} />
        <Route path="/profile" element={<Profile />} />

        {/* Merchant */}
        <Route
          path="/merchant/payments"
          element={
            <ProtectedRoute allowedRoles={['merchant']}>
              <MerchantPayments />
            </ProtectedRoute>
          }
        />
        <Route
          path="/merchant/settlements"
          element={
            <ProtectedRoute allowedRoles={['merchant']}>
              <MerchantSettlements />
            </ProtectedRoute>
          }
        />

        {/* Loan Officer */}
        <Route
          path="/officer/queue"
          element={
            <ProtectedRoute allowedRoles={['loan_officer']}>
              <OfficerQueue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/officer/portfolio"
          element={
            <ProtectedRoute allowedRoles={['loan_officer']}>
              <OfficerPortfolio />
            </ProtectedRoute>
          }
        />

        {/* Risk Analyst */}
        <Route
          path="/analyst/alerts"
          element={
            <ProtectedRoute allowedRoles={['risk_analyst']}>
              <RiskAlerts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analyst/rules"
          element={
            <ProtectedRoute allowedRoles={['risk_analyst']}>
              <RiskRules />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analyst/reconciliation"
          element={
            <ProtectedRoute allowedRoles={['risk_analyst']}>
              <Reconciliation />
            </ProtectedRoute>
          }
        />

        {/* Admin */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit-log"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminAuditLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminAnalytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/system"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminSystemHealth />
            </ProtectedRoute>
          }
        />

        {/* DB Lab - Accessible to all authenticated users */}
        <Route path="/db-lab" element={<DBLab />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
