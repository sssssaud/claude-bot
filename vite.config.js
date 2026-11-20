import { resolve } from 'node:path';

export default {
  root: 'ui',
  base: './', // relative URLs, so Electron can loadFile() the build
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800, // three.js alone is ~700 kB; fine for a local app
    rolldownOptions: { input: { index: resolve('ui/index.html'), overlay: resolve('ui/overlay.html') } },
  },
};
