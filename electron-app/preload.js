const { contextBridge, ipcRenderer } = require('electron');

// Window controls.
contextBridge.exposeInMainWorld('wm', {
  platform:       process.platform,
  minimize:       () => ipcRenderer.send('wm-minimize'),
  toggleMaximize: () => ipcRenderer.send('wm-maximize'),
  close:          () => ipcRenderer.send('wm-close'),
});

// App metadata (used by the Settings dialog header).
contextBridge.exposeInMainWorld('appInfo', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
});

// "Share meeting": a read-only LAN web view of the chosen project(s).
contextBridge.exposeInMainWorld('share', {
  start:  (payload) => ipcRenderer.invoke('share:start', payload),
  stop:   () => ipcRenderer.invoke('share:stop'),
  status: () => ipcRenderer.invoke('share:status'),
  wifi:   () => ipcRenderer.invoke('share:wifi'),
});

// "Export to PDF": the renderer builds a self-contained HTML document, the main
// process renders it to a PDF the user saves to disk.
contextBridge.exposeInMainWorld('pdfExport', {
  save:         (payload) => ipcRenderer.invoke('pdf:export', payload),
  chooseFolder: (current) => ipcRenderer.invoke('pdf:chooseFolder', { current }),
});

// Project file storage. Everything lives as .md files in a user-chosen
// folder; the renderer never touches the filesystem directly.
contextBridge.exposeInMainWorld('projects', {
  list:         () => ipcRenderer.invoke('projects:list'),
  read:         (file) => ipcRenderer.invoke('projects:read', file),
  write:        (file, content) => ipcRenderer.invoke('projects:write', file, content),
  create:       (title, dir, profile) => ipcRenderer.invoke('projects:create', title, dir, profile),
  remove:       (file) => ipcRenderer.invoke('projects:delete', file),
  move:         (file, dir) => ipcRenderer.invoke('projects:move', file, dir),
  revealItem:   (file) => ipcRenderer.invoke('projects:revealItem', file),
  // Pick a .md file from anywhere on disk to import; returns { name, content }.
  pickImport:   () => ipcRenderer.invoke('projects:pickImport'),
  // Workspaces: linked folders on disk that hold projects.
  listFolders:    () => ipcRenderer.invoke('workspaces:list'),
  addWorkspace:   () => ipcRenderer.invoke('workspaces:add'),
  removeWorkspace: (dirPath) => ipcRenderer.invoke('workspaces:remove', dirPath),
});
