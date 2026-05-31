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
