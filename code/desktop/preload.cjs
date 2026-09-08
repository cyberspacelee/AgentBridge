const { contextBridge, ipcRenderer } = require("electron");
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("agentBridge", {
    initialize: () => ipcRenderer.invoke("desktop:initial"),
    savePreferences: (preferences) => ipcRenderer.invoke("desktop:preferences", preferences),
    selectDirectory: () => ipcRenderer.invoke("desktop:select-directory"),
    selectCertificate: () => ipcRenderer.invoke("desktop:select-certificate"),
  });
}
