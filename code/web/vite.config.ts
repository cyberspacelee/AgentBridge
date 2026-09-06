import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: Object.fromEntries(
      [
        "/api",
        "/session",
        "/event",
        "/permission",
        "/question",
        "/health",
        "/metrics",
      ].map((prefix) => [prefix, "http://127.0.0.1:3000"])
    ),
  },
})
