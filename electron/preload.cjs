const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  setup: {
    check: () => ipcRenderer.invoke('setup:check'),
    start: () => ipcRenderer.invoke('setup:start'),
    onStatus: (cb) => ipcRenderer.on('setup:status', (_, d) => cb(d)),
    onProgress: (cb) => ipcRenderer.on('setup:progress', (_, d) => cb(d)),
    onGpu: (cb) => ipcRenderer.on('setup:gpu', (_, d) => cb(d)),
    onDone: (cb) => ipcRenderer.on('setup:done', (_, d) => cb(d)),
  },
  dialog: {
    openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  },
  shell: {
    openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  },
  transcribe: {
    start: (files, config) => ipcRenderer.invoke('transcribe:start', { files, config }),
    stop: () => ipcRenderer.invoke('transcribe:stop'),
    onFile: (cb) => ipcRenderer.on('transcribe:file', (_, d) => cb(d)),
    onLine: (cb) => ipcRenderer.on('transcribe:line', (_, d) => cb(d)),
    onProgress: (cb) => ipcRenderer.on('transcribe:progress', (_, d) => cb(d)),
    onHallucination: (cb) => ipcRenderer.on('transcribe:hallucination', (_, d) => cb(d)),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('transcribe:file')
      ipcRenderer.removeAllListeners('transcribe:line')
      ipcRenderer.removeAllListeners('transcribe:progress')
      ipcRenderer.removeAllListeners('transcribe:hallucination')
    },
  },
  catalog: {
    load: () => ipcRenderer.invoke('catalog:load'),
    delete: (id) => ipcRenderer.invoke('catalog:delete', id),
    import: () => ipcRenderer.invoke('catalog:import'),
  },
  file: {
    readSrt: (p) => ipcRenderer.invoke('file:readSrt', p),
    saveSrt: (data) => ipcRenderer.invoke('file:saveSrt', data),
  },
})
