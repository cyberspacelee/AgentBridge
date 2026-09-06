import { createContext, useContext } from "react"
import type { RuntimeInfo } from "../../../shared/contracts"

export const GatewayContext = createContext<{
  runtime?: RuntimeInfo
  revision: number
}>({ revision: 0 })
export const useGateway = () => useContext(GatewayContext)
