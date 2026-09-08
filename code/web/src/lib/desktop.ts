declare global {
  interface Window {
    agentBridge?: {
      version: string
      selectDirectory: () => Promise<string | null>
    }
  }
}

export const desktop = window.agentBridge
