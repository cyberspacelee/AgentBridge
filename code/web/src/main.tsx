import { initializeDesktop } from "./lib/desktop"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { Button } from "@/components/ui/button"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

let startupError: Error | undefined
try {
  await initializeDesktop()
} catch (error) {
  startupError = error as Error
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      {startupError ? (
        <main className="mx-auto max-w-xl p-8" role="alert">
          <h1>无法恢复桌面偏好</h1>
          <p>{startupError.message}</p>
          <Button className="mt-4" onClick={() => location.reload()}>
            重新加载
          </Button>
        </main>
      ) : (
        <App />
      )}
    </ThemeProvider>
  </StrictMode>
)
