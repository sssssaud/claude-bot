// The overlay page's API: report its clickable boxes, move/drop the window, open the dock,
// trigger system controls, and receive the state and move commands.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octoBridge', {
  setRegion: region => ipcRenderer.send('octo:region', region),
  moveTo: (x, y) => ipcRenderer.send('octo:move', x, y),
  drop: () => ipcRenderer.send('octo:drop'),
  toggleDock: () => ipcRenderer.send('dock:toggle'),
  setControl: (type, val) => ipcRenderer.send('controls:set', type, val),
  onState: fn => ipcRenderer.on('sim:state', (_e, state) => fn(state)),
  onPlay: fn => ipcRenderer.on('octo:play', (_e, name) => fn(name)),
});
