'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioApp', {
  getInitialState: () => ipcRenderer.invoke('audio:get-initial-state'),
  chooseDirectory: () => ipcRenderer.invoke('audio:choose-directory'),
  rescan: () => ipcRenderer.invoke('audio:rescan'),
  saveConfig: (config) => ipcRenderer.invoke('audio:save-config', config)
});
