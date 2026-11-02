/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Warm Cream & Espresso Neutral Scale (replaces generic cold gray)
        gray: {
          50: '#FBF9F5',  // Warm cream linen / canvas
          100: '#F4EFE6', // Soft oat / secondary surface
          200: '#E8E0D5', // Refined warm sand border
          300: '#D8CEBF', // Muted sand
          400: '#A8988B', // Soft taupe
          500: '#7E6C60', // Warm cocoa secondary text
          600: '#635348', // Roasted walnut
          700: '#4A3C33', // Deep coffee
          800: '#332720', // Dark roast espresso
          900: '#221813', // Deepest espresso primary text
          950: '#160F0B', // Dark espresso night
        },
        // Warm Saddle Brown / Cognac / Caramel Brand Scale
        primary: {
          50: '#FAF5EE',
          100: '#F3E8DC',
          200: '#E6D2BF',
          300: '#D5B79C',
          400: '#BF9672',
          500: '#A47447', // Warm caramel
          600: '#87532B', // Rich saddle cognac
          700: '#6D3E1B', // Deep chestnut
          800: '#532E14', // Roast coffee
          900: '#3D200E', // Dark espresso bean
          950: '#261206',
        },
        // Alias indigo to primary to seamlessly elevate existing indigo UI accents
        indigo: {
          50: '#FAF5EE',
          100: '#F3E8DC',
          200: '#E6D2BF',
          300: '#D5B79C',
          400: '#BF9672',
          500: '#A47447',
          600: '#87532B',
          700: '#6D3E1B',
          800: '#532E14',
          900: '#3D200E',
          950: '#261206',
        },
        // Dedicated luxury cream and espresso scales
        cream: {
          50: '#FDFCFB',
          100: '#FBF9F5',
          200: '#F5EFE6',
          300: '#ECE2D4',
          400: '#DECFC0',
          500: '#CBB7A2',
        },
        espresso: {
          50: '#F7F5F4',
          100: '#EAE5E2',
          500: '#7E6C60',
          700: '#4A3C33',
          800: '#332720',
          900: '#221813',
          950: '#160F0B',
        },
        // Warm status tones
        success: {
          50: '#F0F7F2',
          100: '#DCEEE1',
          200: '#BEDEC6',
          300: '#95C7A1',
          400: '#64AA74',
          500: '#3B8B4E',
          600: '#2B6E3D',
          700: '#235832',
          800: '#1F472B',
          900: '#1B3B24',
        },
        warning: {
          50: '#FDF9F0',
          100: '#FBF0DB',
          200: '#F6DEB4',
          300: '#EFC586',
          400: '#E6A556',
          500: '#D3832B',
          600: '#B8651E',
          700: '#944B1B',
          800: '#793C1C',
          900: '#65331B',
        },
        error: {
          50: '#FDF4F4',
          100: '#FAE5E5',
          200: '#F6CECE',
          300: '#EEABAB',
          400: '#E27B7B',
          500: '#CF4F4F',
          600: '#B53838',
          700: '#952B2B',
          800: '#7D2727',
          900: '#692525',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'warm-sm': '0 1px 3px rgba(34, 24, 19, 0.04), 0 1px 2px rgba(34, 24, 19, 0.02)',
        warm: '0 4px 16px -2px rgba(34, 24, 19, 0.05), 0 2px 6px -1px rgba(34, 24, 19, 0.03)',
        'warm-lg': '0 10px 25px -3px rgba(34, 24, 19, 0.07), 0 4px 10px -2px rgba(34, 24, 19, 0.03)',
        'warm-xl': '0 20px 35px -5px rgba(34, 24, 19, 0.09), 0 10px 15px -5px rgba(34, 24, 19, 0.03)',
      },
    },
  },
  plugins: [],
};
