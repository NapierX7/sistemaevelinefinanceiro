/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eef2f7',
          200: '#d9e0ea',
          300: '#b8c3d3',
          400: '#8a9ab3',
          500: '#657794',
          600: '#505f79',
          700: '#424f65',
          800: '#394355',
          900: '#343c4b',
          950: '#0B2545',
        },
        brand: {
          50: '#eef5ff',
          100: '#dce9ff',
          200: '#c0d8ff',
          300: '#94bdff',
          400: '#6098ff',
          500: '#3b75f7',
          600: '#2556ec',
          700: '#1f46d8',
          800: '#1f3bb0',
          900: '#0B2545',
          950: '#071831',
        },
        success: '#16a34a',
        danger: '#dc2626',
        warning: '#d97706',
        info: '#2563eb',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        panel: '0 10px 30px -10px rgb(11 37 69 / 0.15)',
      },
      borderRadius: {
        panel: '16px',
        card: '12px',
        pill: '9999px',
      },
    },
  },
  plugins: [],
}
