const { contextBridge, ipcRenderer } = require("electron");

async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    // Electron adds transport details around the service's actionable message.
    // Remove only that known wrapper; preserve ordinary service/error content.
    const original = error?.message || String(error);
    const message = original.replace(
      /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
      "",
    );
    throw new Error(message || original);
  }
}

contextBridge.exposeInMainWorld("booster", {
  command: (operation, params = {}) => invoke("command", operation, params),
  export: (campaignId, format) => invoke("export", campaignId, format),
  openProfile: (url) => invoke("open-profile", url),
  mcpConfig: () => invoke("mcp-config"),
  notificationSettings: (patch) => invoke("notification-settings", patch),
  onAttention: (callback) => {
    const handler = (_event, id) => callback(id);
    ipcRenderer.on("workspace-attention", handler);
    return () => ipcRenderer.removeListener("workspace-attention", handler);
  },
  desktopSettings: (patch) => invoke("desktop-settings", patch),
});
