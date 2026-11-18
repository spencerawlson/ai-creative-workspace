import type { Config } from "tailwindcss";

/** Zaka 3D design tokens. One dark theme: graphite "ink" greys
 * (neutral, so the 3D canvas reads true) and one orange accent,
 * reserved for selection, focus, active states and the primary action. */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#161617",
          900: "#1d1d1f",
          850: "#232325",
          800: "#2a2a2c",
          750: "#313134",
          700: "#3b3b3e",
          600: "#4b4b4f",
          500: "#717176",
          400: "#a0a0a5",
          300: "#c0c0c4",
          200: "#dcdcdf",
          100: "#f0f0f2",
        },
        accent: {
          DEFAULT: "#f5821f",
          strong: "#ff9d45",
          soft: "rgb(245 130 31 / 0.16)",
        },
        danger: "#f87171",
        success: "#6ee7a8",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};

export default config;
