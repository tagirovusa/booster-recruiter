const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("booster", {
  command: (operation, params = {}) =>
    ipcRenderer.invoke("command", operation, params),
  export: (campaignId, format) =>
    ipcRenderer.invoke("export", campaignId, format),
  openProfile: (url) => ipcRenderer.invoke("open-profile", url),
  mcpConfig: () => ipcRenderer.invoke("mcp-config"),
  desktopSettings: (patch) => ipcRenderer.invoke("desktop-settings", patch),
});
