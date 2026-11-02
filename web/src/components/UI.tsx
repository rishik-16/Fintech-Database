import React from 'react';
import { Loader2 } from 'lucide-react';

/* ─── Card ─── */
export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}> = ({ children, className = '', title, subtitle, action }) => (
  <div className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/90 dark:border-gray-700/80 shadow-warm p-6 transition-all ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-100 dark:border-gray-700">
        <div>
          {title && <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">{title}</h3>}
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    )}
    {children}
  </div>
);

/* ─── Button ─── */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center font-semibold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-primary-600 hover:bg-primary-700 text-white focus:ring-primary-500/25 shadow-sm shadow-primary-900/10 hover:shadow-warm',
    secondary: 'bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 focus:ring-gray-400 shadow-warm-sm',
    danger: 'bg-error-600 hover:bg-error-700 text-white focus:ring-error-500/25 shadow-sm',
    outline: 'border border-gray-200 dark:border-gray-600 hover:bg-gray-100/70 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 focus:ring-primary-500/20',
    ghost: 'hover:bg-gray-100/70 dark:hover:bg-gray-700/60 text-gray-600 dark:text-gray-300',
  };

  const sizes = {
    sm: 'px-3.5 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2.5 text-base',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </button>
  );
};

/* ─── Badge ─── */
export const Badge: React.FC<{
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  className?: string;
}> = ({ children, variant = 'neutral', className = '' }) => {
  const styles = {
    success: 'bg-success-50 text-success-700 border-success-200 dark:bg-success-900/30 dark:text-success-400 dark:border-success-800/60',
    warning: 'bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-900/30 dark:text-warning-400 dark:border-warning-800/60',
    error: 'bg-error-50 text-error-700 border-error-200 dark:bg-error-900/30 dark:text-error-400 dark:border-error-800/60',
    info: 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800/60',
    neutral: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[variant]} ${className}`}>
      {children}
    </span>
  );
};

/* ─── Input ─── */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, helper, className = '', id, ...props }) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`w-full rounded-xl border bg-gray-50/40 dark:bg-gray-900 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:bg-white dark:focus:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-600 transition-all ${
          error ? 'border-error-500 focus:ring-error-500/20' : 'border-gray-200 dark:border-gray-700'
        } ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-error-600 font-medium">{error}</p>}
      {helper && !error && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{helper}</p>}
    </div>
  );
};

/* ─── Modal ─── */
export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ isOpen, onClose, title, children, footer }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-3xl max-w-lg w-full p-6 shadow-warm-xl border border-gray-200 dark:border-gray-700 relative">
        <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-700 mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl font-bold p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            ×
          </button>
        </div>
        <div className="text-gray-700 dark:text-gray-300">{children}</div>
        {footer && <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
};

/* ─── LoadingSpinner ─── */
export const Spinner: React.FC<{ size?: string }> = ({ size = 'w-8 h-8' }) => (
  <div className="flex items-center justify-center p-8">
    <Loader2 className={`${size} animate-spin text-primary-600`} />
  </div>
);

/* ─── EmptyState ─── */
export const EmptyState: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, description, action, icon }) => (
  <div className="text-center py-12 px-4">
    {icon && <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700/60 text-gray-400 dark:text-gray-400 mb-4">{icon}</div>}
    <h4 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h4>
    {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);
