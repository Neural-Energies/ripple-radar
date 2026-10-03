const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rippleDesktop", {
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  setLaunchAtStartup: (on) => ipcRenderer.invoke("desktop:set-launch-at-startup", Boolean(on)),
  backupData: () => ipcRenderer.invoke("desktop:backup"),
  restoreData: () => ipcRenderer.invoke("desktop:restore"),
  notify: (title, body) => ipcRenderer.invoke("desktop:notify", { title, body }),
  onUpdateStatus: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on("desktop:update-status", listener);
    return () => ipcRenderer.removeListener("desktop:update-status", listener);
  },
});
