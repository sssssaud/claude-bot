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
  onNotice: fn => ipcRenderer.on('octo:notice', (_e, text) => fn(text)),
  onTravel: fn => ipcRenderer.on('octo:travel', (_e, on) => fn(on === true)),
  onDone: fn => ipcRenderer.on('octo:done', (_e, feel) => fn(feel)),
  clicked: () => ipcRenderer.send('octo:clicked'),
});
