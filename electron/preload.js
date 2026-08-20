const { contextBridge, ipcRenderer, webUtils } = require('electron');
const aiModels = Object.freeze({
  list: () => ipcRenderer.invoke('ai-model-list'),
  status: id => ipcRenderer.invoke('ai-model-status', id),
  download: id => ipcRenderer.invoke('ai-model-download', id),
  cancel: id => ipcRenderer.invoke('ai-model-cancel', id),
  get: id => ipcRenderer.invoke('ai-model-get', id),
  remove: id => ipcRenderer.invoke('ai-model-remove', id),
  onProgress: callback => {
    if (typeof callback !== 'function') throw new TypeError('Progress callback must be a function');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ai-model-progress', listener);
    return () => ipcRenderer.removeListener('ai-model-progress', listener);
  }
});
const customPresets = Object.freeze({
  exportFile: payload => ipcRenderer.invoke('custom-presets-export', payload),
  importFile: () => ipcRenderer.invoke('custom-presets-import')
});
contextBridge.exposeInMainWorld('desktop', {
  pickImages: () => ipcRenderer.invoke('pick-images'),
  exportImage: payload => ipcRenderer.invoke('export-image', payload),
  revealFile: filePath => ipcRenderer.invoke('reveal-file', filePath),
  pathForFile: file => webUtils.getPathForFile(file),
  saveCatalog: text => ipcRenderer.invoke('save-catalog', text),
  openCatalog: () => ipcRenderer.invoke('open-catalog'),
  copyOriginal: payload => ipcRenderer.invoke('copy-original', payload),
  openHelpGuide: () => ipcRenderer.invoke('open-help-guide'),
  customPresets,
  aiModels
});
