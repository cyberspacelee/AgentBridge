const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  const initial = ipcRenderer.sendSync("desktop:initial");
  if (initial) {
    for (const [key, value] of Object.entries(initial.preferences)) {
      if (typeof value === "string") localStorage.setItem(key, value);
    }
    contextBridge.exposeInMainWorld("agentBridge", {
      version: initial.version,
      selectDirectory: () => ipcRenderer.invoke("desktop:select-directory"),
      getNetworkSettings: () => ipcRenderer.invoke("desktop:network-get"),
      saveNetworkSettings: (input) => ipcRenderer.invoke("desktop:network-save", input),
      testNetworkSettings: (input, url) => ipcRenderer.invoke("desktop:network-test", input, url),
      selectCertificate: () => ipcRenderer.invoke("desktop:select-certificate"),
      restart: () => ipcRenderer.invoke("desktop:restart"),
    });
    // Persist only these non-secret preferences across the gateway's random ports.
    let previous = JSON.stringify(initial.preferences);
    setInterval(() => {
      const preferences = Object.fromEntries(
        ["theme", "agentbridge:sidebar-collapsed"].map((key) => [
          key,
          localStorage.getItem(key),
        ]),
      );
      const next = JSON.stringify(preferences);
      if (next !== previous) {
        previous = next;
        ipcRenderer.send("desktop:preferences", preferences);
      }
    }, 500);
  }
}
