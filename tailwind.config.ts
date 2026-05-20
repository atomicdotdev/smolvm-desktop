import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#1a1f36",
          sidebar: "#141829",
          card: "#1e2440",
          term: "#0d1117",
        },
        fg: {
          DEFAULT: "#ffffff",
          muted: "#8b92a8",
          term: "#c9d1d9",
        },
        accent: "#4c7bf4",
        running: "#34d399",
        starting: "#fbbf24",
        stopped: "#f87171",
        border: "#2a3050",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
