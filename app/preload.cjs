// The overlay page's API: report its clickable boxes, move/drop the window, open the dock,
// and receive the simulator state and move commands.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octoBridge', {
  setRegion: region => ipcRenderer.send('octo:region', region),
  moveTo: (x, y) => ipcRenderer.send('octo:move', x, y),
  drop: () => ipcRenderer.send('octo:drop'),
  toggleDock: () => ipcRenderer.send('dock:toggle'),
  onState: fn => ipcRenderer.on('sim:state', (_e, state) => fn(state)),
  onPlay: fn => ipcRenderer.on('octo:play', (_e, name) => fn(name)),
});
