const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickImages: () => ipcRenderer.invoke('pick-images'),
  exportImage: payload => ipcRenderer.invoke('export-image', payload),
  revealFile: filePath => ipcRenderer.invoke('reveal-file', filePath),
  pathForFile: file => webUtils.getPathForFile(file),
  saveCatalog: text => ipcRenderer.invoke('save-catalog', text),
  openCatalog: () => ipcRenderer.invoke('open-catalog'),
  copyOriginal: payload => ipcRenderer.invoke('copy-original', payload),
  openHelpGuide: () => ipcRenderer.invoke('open-help-guide')
});
