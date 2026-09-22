const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snapper', {
  getState: () => ipcRenderer.invoke('get-state'),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  art: (id, variantId) => ipcRenderer.invoke('art', id, variantId),
  cardInfo: (id) => ipcRenderer.invoke('card-info', id),
  openSettings: () => ipcRenderer.invoke('settings-open'),
  toggleLock: () => ipcRenderer.invoke('lock'),
  inputLayout: (layout) => ipcRenderer.send('input-layout', layout),
  startDrag: (point) => ipcRenderer.send('drag-start', point),
  moveDrag: (point) => ipcRenderer.send('drag-move', point),
  endDrag: () => ipcRenderer.send('drag-end'),
  resetPosition: () => ipcRenderer.invoke('reset-position'),
  saveSettings: (value) => ipcRenderer.invoke('settings-save', value),
  choosePath: () => ipcRenderer.invoke('choose-path'),
  autoPath: () => ipcRenderer.invoke('auto-path'),
});
