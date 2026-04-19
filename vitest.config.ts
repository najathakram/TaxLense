import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { resolve } from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: [],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // DB-backed tests share one Postgres instance — disable file-level parallelism
    // so transaction-count assertions aren't perturbed by concurrent fixture setup.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
})
