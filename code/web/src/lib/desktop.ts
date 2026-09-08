export interface NetworkSettings {
  mode: "environment" | "direct" | "manual"
  proxyUrl: string
  proxyUsername: string
  noProxy: string
  useSystemCa: boolean
  caFile: string
}

export interface NetworkView {
  settings: NetworkSettings
  hasPassword: boolean
  restartRequired: boolean
}

export type NetworkInput = NetworkSettings & { proxyPassword?: string }

declare global {
  interface Window {
    agentBridge?: {
      version: string
      selectDirectory: () => Promise<string | null>
      getNetworkSettings: () => Promise<NetworkView>
      saveNetworkSettings: (input: NetworkInput) => Promise<NetworkView>
      testNetworkSettings: (
        input: NetworkInput,
        url: string
      ) => Promise<{ status: number; durationMs: number }>
      selectCertificate: () => Promise<string | null>
      restart: () => Promise<boolean>
    }
  }
}

export const desktop = window.agentBridge
