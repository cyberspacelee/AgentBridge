import path from "node:path";
import { pathToFileURL } from "node:url";
const { createMcpAdapter } = await import(process.env.AGENT_BRIDGE_PI_MCP_MODULE
  ? pathToFileURL(process.env.AGENT_BRIDGE_PI_MCP_MODULE).href
  : "pi-mcp-adapter");

export default createMcpAdapter({
  configPath: path.join(process.env.PI_CODING_AGENT_DIR, "mcp.json"),
});
