/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['"Outfit"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: '#0e0d0b',
        surface: {
          DEFAULT: '#161512',
          2:       '#1d1b17',
          3:       '#242119',
          hover:   '#2a271f',
        },
        border: {
          DEFAULT: '#2c2924',
          2:       '#3a3730',
          3:       '#4a4740',
        },
        ink: {
          DEFAULT: '#f0ebe0',
          2:       '#a09488',
          3:       '#6a6058',
          4:       '#3e3a34',
        },
        accent: {
          DEFAULT: '#e8963a',
          hover:   '#f0a845',
          dim:     '#2e1e08',
          muted:   '#3d2710',
        },
        ok: {
          DEFAULT: '#4caf7c',
          muted:   '#0d2c1a',
          text:    '#3da060',
        },
        warn: {
          DEFAULT: '#d4842a',
          muted:   '#2a1906',
        },
        err: {
          DEFAULT: '#d65040',
          muted:   '#2c0e08',
        },
        info: {
          DEFAULT: '#5090d8',
          muted:   '#0a1e34',
        },
      },
      animation: {
        'fade-in':        'fade-in 200ms ease-out both',
        'slide-up':       'slide-up 280ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-left':  'slide-in-left 300ms cubic-bezier(0.16,1,0.3,1) both',
        'scale-in':       'scale-in 200ms cubic-bezier(0.16,1,0.3,1) both',
        'toast-in':       'toast-in 300ms cubic-bezier(0.16,1,0.3,1) both',
        'shimmer':        'shimmer 1.6s ease-in-out infinite',
      },
      keyframes: {
        'fade-in':       { '0%': { opacity: '0' },                                           '100%': { opacity: '1' } },
        'slide-up':      { '0%': { opacity: '0', transform: 'translateY(10px)' },            '100%': { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right':{ '0%': { opacity: '0', transform: 'translateX(20px)' },            '100%': { opacity: '1', transform: 'translateX(0)' } },
        'slide-in-left': { '0%': { opacity: '0', transform: 'translateX(-20px)' },           '100%': { opacity: '1', transform: 'translateX(0)' } },
        'scale-in':      { '0%': { opacity: '0', transform: 'scale(0.96)' },                 '100%': { opacity: '1', transform: 'scale(1)' } },
        'toast-in':      { '0%': { opacity: '0', transform: 'translateY(16px) scale(0.94)' },'100%': { opacity: '1', transform: 'translateY(0) scale(1)' } },
        'shimmer':       { '0%': { backgroundPosition: '-200% 0' },                           '100%': { backgroundPosition: '200% 0' } },
      },
      boxShadow: {
        card:     '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)',
        'card-lg':'0 4px 16px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.4)',
        modal:    '0 24px 64px rgba(0,0,0,0.8)',
        drawer:   '-4px 0 40px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
