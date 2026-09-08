import path from "node:path";
import { createMcpAdapter } from "pi-mcp-adapter";

export default createMcpAdapter({
  configPath: path.join(process.env.PI_CODING_AGENT_DIR, "mcp.json"),
});
