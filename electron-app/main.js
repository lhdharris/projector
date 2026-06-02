const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const shareServer = require('./share-server');

// ---- dev isolation ------------------------------------------------------
// When running unpackaged (`npm start` / `electron .`) we give the app a
// separate identity from an installed Projector. The installed build keys its
// userData on the package name ("projector-app"); without this, a dev run would
// resolve to the SAME userData dir, so it would (a) fail to get the single-
// instance lock a running Projector already holds — silently focusing that
// window and quitting — and (b) share config.json, clobbering the real
// workspace list. A distinct userData dir gives dev its own config + its own
// instance lock, so it runs side-by-side with the installed app and starts
// with no workspaces linked (real project files stay untouched unless you link
// their folder yourself). Packaged builds (app.isPackaged) are unaffected.
// Must run before requestSingleInstanceLock() and any getPath('userData').
if (!app.isPackaged) {
  app.setName('projector-dev');
  app.setPath('userData', path.join(app.getPath('appData'), 'projector-dev'));
}

// ---- project folder + config -------------------------------------------
// Projects are plain .md files in a folder the user controls. The chosen
// folder is remembered in userData/config.json; first run defaults to
// <Documents>/Projector and creates it.

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Workspaces are the folders on disk the user has linked; ALL projects live in
// one of them (there is no built-in default folder). Stored in config.workspaces
// as absolute paths. First run migrates the legacy config: any old
// externalFolders, plus the old default <Documents>/Projector if it still holds
// .md files, so nothing the user already had disappears.
function workspaces() {
  const cfg = readConfig();
  if (Array.isArray(cfg.workspaces)) return cfg.workspaces;

  const migrated = [];
  const add = (p) => {
    if (p && !migrated.some((q) => path.resolve(q) === path.resolve(p))) migrated.push(path.resolve(p));
  };
  if (Array.isArray(cfg.externalFolders)) cfg.externalFolders.forEach(add);
  const legacyDefault = cfg.projectsDir || path.join(app.getPath('documents'), 'Projector');
  try {
    if (fs.existsSync(legacyDefault) &&
        fs.readdirSync(legacyDefault).some((f) => f.toLowerCase().endsWith('.md'))) {
      add(legacyDefault);
    }
  } catch { /* ignore */ }

  cfg.workspaces = migrated;
  writeConfig(cfg);
  return cfg.workspaces;
}

function setWorkspaces(list) {
  const cfg = readConfig();
  cfg.workspaces = list;
  writeConfig(cfg);
}

// Dev builds run isolated (separate `projector-dev` userData, see top of file) and
// so start with no workspaces — and a previously-linked throwaway folder under
// /tmp can be wiped between runs, leaving a dead reference. When dev has no
// workspace that still exists on disk, seed a persistent demo workspace (under
// userData, so /tmp cleanup can't touch it) and link it, so the dev UI always has
// test content to load. No-op when packaged; left untouched if the user has any
// real workspace linked. dev-seed.js is dev-only and never bundled (not in
// package.json build.files; required lazily behind this guard).
function ensureDevContent() {
  if (app.isPackaged) return;
  const list = workspaces(); // also runs the legacy-config migration
  const anyExists = list.some((p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
  if (anyExists) return;
  const demo = path.join(app.getPath('userData'), 'demo-workspace');
  ensureDir(demo);
  require('./dev-seed')(demo);
  setWorkspaces([demo]);
}

// Turn a project title into a safe .md filename.
function slugify(title) {
  const base = String(title).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
  return base;
}

function uniqueFilePath(dir, slug) {
  let name = `${slug}.md`;
  let i = 2;
  while (fs.existsSync(path.join(dir, name))) {
    name = `${slug}-${i++}.md`;
  }
  return path.join(dir, name);
}

// Every directory the app may read/write: the linked workspaces.
function allowedRoots() {
  return workspaces().map((p) => path.resolve(p));
}

function isWithin(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

// Resolve a project file path and refuse anything outside an allowed root
// (path-traversal / arbitrary-file-access guard).
function resolveProject(file) {
  const full = path.resolve(file);
  if (!allowedRoots().some((r) => isWithin(full, r))) {
    throw new Error('Path outside allowed folders');
  }
  return full;
}

// Resolve a destination workspace directory for create/move. The directory
// must be (within) a linked workspace.
function resolveDir(dir) {
  if (!dir) throw new Error('No workspace specified');
  const full = path.resolve(dir);
  if (!allowedRoots().some((r) => isWithin(full, r))) {
    throw new Error('Directory outside allowed folders');
  }
  return full;
}

// Workspaces shown in the sidebar (each is a linked folder on disk).
function listFolders() {
  const out = [];
  for (const p of workspaces()) {
    const full = path.resolve(p);
    out.push({ name: path.basename(full), path: full, external: true });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// First non-empty markdown heading, else the filename. Used as the display
// title in the project list.
function titleFromMarkdown(md, fallback) {
  const m = md.match(/^\s*#\s+(.+)$/m);
  if (m) return m[1].trim();
  const t = md.match(/^\s*title\s+(.+)$/mi);
  if (t) return t[1].trim();
  return fallback;
}

// Project colour: a Mermaid comment inside the block (%% projector:color
// #rrggbb), falling back to the pre-1.1.x outside-block HTML comment. Mirrors
// Palette.readColor in the renderer; null when the project hasn't picked one.
function colorFromMarkdown(md) {
  const s = String(md);
  const m = s.match(/%%\s*projector:color\s+(#[0-9a-fA-F]{3,8})/i)
    || s.match(/<!--\s*projector:color\s+(#[0-9a-fA-F]{3,8})\s*-->/i);
  return m ? m[1] : null;
}

// Profile tag, stored as a comment inside the mermaid block: %% projector:profile Work
function profileFromMarkdown(md) {
  const m = String(md).match(/%%\s*projector:profile\s+(.+)/i);
  return m ? m[1].trim() : '';
}

// A workspace can hold any .md files; only those carrying a fenced ```mermaid
// block are Projector projects. Mirrors GanttParse.extractMermaidBlock's fence
// detection so the sidebar shows exactly the files the app can open.
function hasMermaidBlock(md) {
  return String(md).split('\n').some((l) => /^```\s*mermaid\s*$/i.test(l.trim()));
}

// A brand-new project is a blank Mermaid gantt block, ready for the user to add
// their first task (no placeholder task to delete first).
function newProjectTemplate(title, profile) {
  const profileLine = profile ? `    %% projector:profile ${profile}\n` : '';
  return `# ${title}

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    title ${title}
${profileLine}\`\`\`
`;
}

// ---- window -------------------------------------------------------------

const APP_ICON = path.join(__dirname, 'assets', 'icon.png');

function createWindow() {
  const win = new BrowserWindow({
    // Wide enough that the three Task List columns + sidebar fit without a
    // horizontal scrollbar at the app's 1.2× UI zoom.
    width: 1340,
    height: 860,
    minWidth: 980,
    minHeight: 520,
    frame: false,
    backgroundColor: '#ffffff',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  installContextMenu(win);
}

// A right-click clipboard menu. Electron ships no default context menu, and the
// frameless window has no menu bar, so without this there's no mouse-driven
// copy/paste anywhere in the UI. We build the menu from the click context:
// cut/paste only over editable fields, copy/select-all wherever there's a
// selection or an editable target. Roles act on the focused web contents, so
// the same handler covers every input, the task editor, and selectable text.
function installContextMenu(win) {
  win.webContents.on('context-menu', (_e, params) => {
    const { isEditable, editFlags } = params;
    const hasSelection = !!(params.selectionText && params.selectionText.trim());
    const template = [];
    if (isEditable) {
      template.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
      );
    }
    if (isEditable || hasSelection) {
      template.push({ role: 'copy', enabled: editFlags.canCopy || hasSelection });
    }
    if (isEditable) {
      template.push({ role: 'paste', enabled: editFlags.canPaste });
    }
    if (isEditable || hasSelection) {
      template.push({ type: 'separator' }, { role: 'selectAll' });
    }
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

// ---- window control IPC -------------------------------------------------

ipcMain.on('wm-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('wm-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('wm-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

// App metadata for the Settings dialog (name + version shown at the top).
ipcMain.handle('app:getVersion', () => app.getVersion());

// ---- projects IPC -------------------------------------------------------

// List every .md project across all linked workspaces (one level, non-recursive).
// Each item carries its workspace path and the metadata the sidebar/global view
// need: title, colour, and profile tag.
ipcMain.handle('projects:list', () => {
  const out = [];
  for (const ws of workspaces()) {
    const full = path.resolve(ws);
    let entries;
    try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() || !e.name.toLowerCase().endsWith('.md')) continue;
      const file = path.join(full, e.name);
      let md = '';
      try { md = fs.readFileSync(file, 'utf8'); } catch { continue; }
      // Only .md files with a Mermaid block are projects; ignore plain notes.
      if (!hasMermaidBlock(md)) continue;
      out.push({
        file,
        folderPath: full,
        external: true,
        loose: false,
        title: titleFromMarkdown(md, path.basename(file).replace(/\.md$/i, '')),
        color: colorFromMarkdown(md),
        profile: profileFromMarkdown(md),
      });
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
});

ipcMain.handle('projects:read', (e, file) => fs.readFileSync(resolveProject(file), 'utf8'));

ipcMain.handle('projects:write', (e, file, content) => {
  fs.writeFileSync(resolveProject(file), content, 'utf8');
  return true;
});

ipcMain.handle('projects:create', (e, title, dir, profile) => {
  const destDir = resolveDir(dir);
  ensureDir(destDir);
  const full = uniqueFilePath(destDir, slugify(title));
  fs.writeFileSync(full, newProjectTemplate(title || 'New Project', profile || ''), 'utf8');
  return path.resolve(full);
});

ipcMain.handle('projects:delete', (e, file) => {
  fs.rmSync(resolveProject(file), { force: true });
  return true;
});

// Move a project into another workspace. Returns the project's new path.
ipcMain.handle('projects:move', (e, file, dir) => {
  const src = resolveProject(file);
  const destDir = resolveDir(dir);
  ensureDir(destDir);
  const dest = uniqueFilePath(destDir, path.basename(src).replace(/\.md$/i, ''));
  fs.renameSync(src, dest);
  return path.resolve(dest);
});

// Pick a markdown file anywhere on disk and return its contents, so it can be
// imported (re-dated, unassigned) as a new project. The file is user-chosen via
// the OS dialog, so reading it here is intentional and outside the workspace
// sandbox that guards projects:read.
ipcMain.handle('projects:pickImport', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Import a project (.md)',
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = path.resolve(res.filePaths[0]);
  try {
    return { name: path.basename(file).replace(/\.(md|markdown)$/i, ''), content: fs.readFileSync(file, 'utf8') };
  } catch {
    return null;
  }
});

// Open the folder that holds a specific project file, with the file selected.
ipcMain.handle('projects:revealItem', (e, file) => {
  shell.showItemInFolder(resolveProject(file));
  return true;
});

// ---- workspaces IPC -----------------------------------------------------

ipcMain.handle('workspaces:list', () => listFolders());

// Link (open) an existing folder on disk as a workspace.
ipcMain.handle('workspaces:add', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Open a workspace folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const chosen = path.resolve(res.filePaths[0]);
  const list = workspaces().slice();
  if (!list.some((p) => path.resolve(p) === chosen)) {
    list.push(chosen);
    setWorkspaces(list);
  }
  return { name: path.basename(chosen), path: chosen, external: true };
});

// Remove a workspace from the sidebar — leaves the files on disk.
ipcMain.handle('workspaces:remove', (e, dirPath) => {
  const target = path.resolve(dirPath);
  setWorkspaces(workspaces().filter((p) => path.resolve(p) !== target));
  return true;
});

// ---- share-meeting IPC --------------------------------------------------

// The read-only LAN viewer server validates every shared path through the same
// workspace sandbox that guards projects:read.
shareServer.init({ resolveProject });

// payload: { files:[path], title, view, scope } -> { active, primaryUrl, urls, port }
ipcMain.handle('share:start', (e, payload) => shareServer.start(payload || {}));
ipcMain.handle('share:stop', () => shareServer.stop());
ipcMain.handle('share:status', () => shareServer.status());
// Current Wi-Fi network name (or null) so the share UI can name the network
// guests must join.
ipcMain.handle('share:wifi', () => shareServer.wifiSsid());

// ---- lifecycle ----------------------------------------------------------

// Only one window ever: a second launch (e.g. clicking the desktop shortcut
// again) must not spawn another instance. The first process keeps the single-
// instance lock; any later process fails to get it and quits immediately,
// after which Electron fires 'second-instance' here so we can surface the
// existing window.
function focusExistingWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);

  app.whenReady().then(() => {
    // Dev builds: make sure there's a workspace with test content to load.
    ensureDevContent();
    // macOS shows the dock icon from the app bundle when packaged; set it
    // explicitly so it's correct when running unpackaged in dev too.
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(APP_ICON); } catch { /* non-fatal */ }
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // A share must never outlive the app: drop the server when the app is
  // quitting or all its windows are gone.
  app.on('before-quit', () => shareServer.stop());

  app.on('window-all-closed', () => {
    shareServer.stop();
    if (process.platform !== 'darwin') app.quit();
  });
}
