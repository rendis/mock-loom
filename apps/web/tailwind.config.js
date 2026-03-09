/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        'surface-base': 'rgb(var(--surface-base) / <alpha-value>)',
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        'surface-soft': 'rgb(var(--surface-soft) / <alpha-value>)',
        'surface-inset': 'rgb(var(--surface-inset) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-dark': 'rgb(var(--primary-dark) / <alpha-value>)',
        focus: 'rgb(var(--focus) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        'success-dark': 'rgb(var(--success-dark) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        'warning-dark': 'rgb(var(--warning-dark) / <alpha-value>)',
        error: 'rgb(var(--error) / <alpha-value>)',
        'error-dark': 'rgb(var(--error-dark) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        'info-dark': 'rgb(var(--info-dark) / <alpha-value>)',
      },
      boxShadow: {
        card: '0 10px 24px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.06)',
        inset: 'inset 0 2px 4px rgba(15, 23, 42, 0.08)',
        tactile: '0 1px 2px rgba(15, 23, 42, 0.08), 0 4px 10px rgba(15, 23, 42, 0.08)',
        'neo-soft': '1px 1px 3px rgba(15, 23, 42, 0.12), -1px -1px 3px rgba(255, 255, 255, 0.92)',
        'neo-press': 'inset 1px 1px 3px rgba(15, 23, 42, 0.15), inset -1px -1px 3px rgba(255, 255, 255, 0.7)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
