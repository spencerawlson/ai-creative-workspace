import type { Config } from "tailwindcss";

/** Studio design tokens. One dark theme: neutral "ink" greys tuned so
 * the 3D canvas reads true, and one warm accent (a tungsten amber)
 * reserved for selection, focus and the primary action. */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#09090c",
          900: "#0e0e12",
          850: "#131318",
          800: "#18181f",
          750: "#1e1e26",
          700: "#272731",
          600: "#363642",
          500: "#5a5a68",
          400: "#8a8a99",
          300: "#b0b0bc",
          200: "#d2d2da",
          100: "#ededf2",
        },
        accent: {
          DEFAULT: "#f2b35a",
          strong: "#ffc677",
          soft: "rgb(242 179 90 / 0.14)",
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
