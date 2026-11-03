const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStore: () => ipcRenderer.invoke('store:get'),
  setStore: s => ipcRenderer.invoke('store:set', s),
  patchStore: p => ipcRenderer.invoke('store:patch', p),
  onStoreChanged: fn => ipcRenderer.on('store:changed', (_e, s) => fn(s)),

  minimizeToPet: () => ipcRenderer.invoke('win:minimize-to-pet'),
  restoreMain: () => ipcRenderer.invoke('win:restore'),
  openSettings: () => ipcRenderer.invoke('win:open-settings'),

  petMoveTo: (x, y) => ipcRenderer.invoke('pet:move-to', x, y),
  petGetBounds: () => ipcRenderer.invoke('pet:get-bounds'),
  petHover: on => ipcRenderer.invoke('pet:hover', on),
  petHeadY: y => ipcRenderer.invoke('pet:head-y', y),
  petDrag: on => ipcRenderer.invoke('pet:drag', on),
  petDragStart: () => ipcRenderer.invoke('pet:drag-start'),
  petDragEnd: () => ipcRenderer.invoke('pet:drag-end'),
  petMenu: () => ipcRenderer.invoke('pet:context-menu'),
  panelHover: on => ipcRenderer.invoke('panel:hover', on),
  panelHide: () => ipcRenderer.invoke('panel:hide'),
  panelSize: h => ipcRenderer.invoke('panel:size', h),
  showMain: () => ipcRenderer.invoke('win:show-main'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onPanelRefresh: fn => ipcRenderer.on('panel:refresh', () => fn()),
  onPanelSlide: fn => ipcRenderer.on('panel:slide', () => fn()),
  onPetMode: fn => ipcRenderer.on('pet:mode', (_e, m) => fn(m)),

  version: () => ipcRenderer.invoke('app:version'),
  openExternal: url => ipcRenderer.invoke('app:open-external', url),

  checkUpdate: manual => ipcRenderer.invoke('update:check', manual),
  onUpdateProgress: fn => ipcRenderer.on('update:progress', (_e, p) => fn(p)),

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  resetData: () => ipcRenderer.invoke('data:reset'),
});
