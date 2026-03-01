import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        aqua: {
          DEFAULT: "#008b73",
          50: "#e6f5f3",
          100: "#b3e0d9",
          200: "#80cbbf",
          300: "#4db5a5",
          400: "#00997a",
          500: "#008b73",
          600: "#007a65",
          700: "#006657",
          800: "#005348",
          900: "#003d33",
        },
      },
    },
  },
  plugins: [],
};

export default config;
