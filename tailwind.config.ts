import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cat: {
          sleep: "#94a3b8",
          work: "#2563eb",
          sports: "#16a34a",
          social: "#f59e0b",
          travel: "#0ea5e9",
          misc: "#a78bfa",
          other: "#ef4444",
          eat: "#f97316",
          family: "#ec4899",
          leisure: "#dc2626",
        },
      },
    },
  },
  plugins: [],
};
export default config;
