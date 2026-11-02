import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export const ThemeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/25 border border-gray-200/60 dark:border-gray-700"
      aria-label="Toggle theme"
      title={isDark ? "Switch to warm cream light mode" : "Switch to dark espresso mode"}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 text-primary-700" />
      )}
    </button>
  );
};
