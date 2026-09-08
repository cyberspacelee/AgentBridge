declare global {
  interface Window {
    agentBridge?: {
      initialize: () => Promise<{
        version: string
        preferences: Record<string, string>
      }>
      savePreferences: (preferences: Record<string, string>) => Promise<void>
      selectDirectory: () => Promise<string | null>
      selectCertificate: () => Promise<string | null>
    }
  }
}
export const desktop = window.agentBridge
export let desktopVersion = ""
export async function initializeDesktop() {
  if (!desktop?.initialize) return
  const initial = await desktop.initialize()
  desktopVersion = initial.version
  for (const key of ["theme", "agentbridge:sidebar-collapsed"]) {
    const value = initial.preferences[key]
    if (typeof value === "string") localStorage.setItem(key, value)
  }
}
export function saveDesktopPreference(key: string, value: string) {
  void desktop?.savePreferences?.({ [key]: value }).catch(() => {
    window.dispatchEvent(new CustomEvent("agentbridge:preference-error"))
  })
}
