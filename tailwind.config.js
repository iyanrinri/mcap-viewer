/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#ffffff",
        ink: "#222222",
        body: "#3f3f3f",
        primary: "#ff385c",
        'primary-active': "#e00b41",
        'surface-soft': "#f7f7f7",
        'surface-strong': "#f2f2f2",
        hairline: "#dddddd",
        'hairline-soft': "#ebebeb",
        muted: "#6a6a6a",
      },
      fontFamily: {
        sans: ["'Inter'", "Circular", "-apple-system", "system-ui", "sans-serif"],
      },
      borderRadius: {
        'md': '14px',
        'lg': '20px',
        'xl': '32px',
        'full': '9999px',
      },
      boxShadow: {
        'airbnb': 'rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px, rgba(0,0,0,0.1) 0 4px 8px',
      }
    },
  },
  plugins: [],
}
