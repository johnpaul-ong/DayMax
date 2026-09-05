import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "var(--page)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
          contrast: "var(--accent-contrast)",
        },
        ok: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-soft)" },
      },
      borderRadius: {
        "2xl": "1.1rem",
      },
    },
  },
  plugins: [],
};
export default config;
