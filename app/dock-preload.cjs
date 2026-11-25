// The dock page's API: drive the simulator and the octo, receive the shared state.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dockBridge', {
  setPressure: v => ipcRenderer.send('sim:pressure', v),
  toggleMasti: () => ipcRenderer.send('sim:masti'),
  setPersonality: name => ipcRenderer.send('sim:personality', name),
  setDemo: on => ipcRenderer.send('sim:demo', on),
  setTemps: temps => ipcRenderer.send('sim:temps', temps),
  showEmote: name => ipcRenderer.send('sim:emote', name),
  setLook: look => ipcRenderer.send('sim:look', look),
  play: name => ipcRenderer.send('octo:play', name),
  moves: () => ipcRenderer.invoke('dock:moves'),
  onState: fn => ipcRenderer.on('sim:state', (_e, state) => fn(state)),
});
