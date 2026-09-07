import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

// Proxy and CA variables must exist before the application Node process starts.
const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
