// The only API the overlay page gets: report the octo's box, move the window, drop it.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octoBridge', {
  setRect: rect => ipcRenderer.send('octo:rect', rect),
  moveTo: (x, y) => ipcRenderer.send('octo:move', x, y),
  drop: () => ipcRenderer.send('octo:drop'),
});
