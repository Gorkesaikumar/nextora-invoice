const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  request: (spec) => ipcRenderer.invoke('api:request', spec),
  openDocument: (options) => ipcRenderer.invoke('doc:open', options),
  backupDatabase: (options) => ipcRenderer.invoke('db:backup', options),
  restoreDatabase: (options) => ipcRenderer.invoke('db:restore', options),
  setUnsavedChanges: (dirty) => ipcRenderer.invoke('app:setUnsavedChanges', Boolean(dirty)),
  print: () => ipcRenderer.invoke('app:print'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, hash) => callback(hash);
    ipcRenderer.on('app:navigate', listener);
    return () => ipcRenderer.removeListener('app:navigate', listener);
  },
});
