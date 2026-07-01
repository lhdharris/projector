const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const https = require('https');
const shareServer = require('./share-server');

// ---- native Wayland -----------------------------------------------------
// Run as a native Wayland client when the session is Wayland (no-op on X11 /
// Windows / macOS, which keep X11/native). A frameless window under XWayland
// doesn't hand its title-bar drag (-webkit-app-region: drag) to the compositor
// as an interactive move, so GNOME/KDE never offer edge-tiling; as a native
// Wayland client the move is compositor-managed, restoring drag-to-edge half-
// tiling, drag-to-top maximize, and Super+Left/Right. Must run before app ready.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

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

// ---- update check -------------------------------------------------------
// On launch (and every 24h while running) ask GitHub for the latest published
// release; if it's newer than this build, offer to open the download page. All
// failures are silent so an offline launch never interrupts the user. Clicking
// "Later" remembers the version in config so we don't nag again until there's a
// newer one.
// NOTE: we read the /releases LIST (not /releases/latest) and take the newest
// published, non-draft entry — pre-release or not — because GitHub's
// /releases/latest endpoint silently skips pre-releases, and Projector has shipped
// pre-releases. The list is returned newest-first; isNewerVersion still gates the
// prompt, so an older "newest published" release simply never prompts.
const RELEASES_API = 'https://api.github.com/repos/lhdharris/projector/releases?per_page=10';
const RELEASES_PAGE = 'https://github.com/lhdharris/projector/releases/latest';

function fetchLatestRelease() {
  return new Promise((resolve) => {
    const req = https.get(RELEASES_API, {
      headers: { 'User-Agent': 'Projector', Accept: 'application/vnd.github+json' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const list = JSON.parse(body);
          const rel = Array.isArray(list) ? list.find((r) => r && !r.draft) : null;
          resolve(rel ? { tag: rel.tag_name || '', url: rel.html_url || RELEASES_PAGE } : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Compare dotted numeric versions; any non-digit prefix on the remote tag
// (e.g. a leading "v") is ignored. True only when remote is strictly newer.
function isNewerVersion(remote, local) {
  const nums = (s) => String(s).replace(/^[^0-9]*/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = nums(remote);
  const b = nums(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkForUpdates() {
  const latest = await fetchLatestRelease();
  if (!latest || !latest.tag) return;
  const current = app.getVersion();
  if (!isNewerVersion(latest.tag, current)) return;
  if (readConfig().dismissedUpdateVersion === latest.tag) return; // user said "Later" already
  const win = BrowserWindow.getAllWindows()[0];
  const cleanTag = latest.tag.replace(/^[^0-9]*/, '');
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['Update now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update available',
    message: 'A new version of Projector is available',
    detail: `Projector ${cleanTag} is available — you have ${current}.`,
  });
  if (response === 0) {
    shell.openExternal(latest.url);
  } else {
    const cfg = readConfig();
    cfg.dismissedUpdateVersion = latest.tag;
    writeConfig(cfg);
  }
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
    // Default wide enough that the three Task List columns + sidebar fit
    // without a horizontal scrollbar at the app's 1.2× UI zoom.
    width: 1340,
    height: 860,
    // minWidth must stay below a half-screen tile, or the compositor can't
    // shrink the window into the tile and silently refuses to half-tile it
    // (GNOME/KDE honour a client's minimum size). Half of a 1920px display is
    // 960px, so the old 980 blocked left/right tiling there; 640 tiles on any
    // screen >=1280 wide and the layout just reflows/scrolls when narrower.
    minWidth: 640,
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
  // Drop the reused PDF render window with the main window, so a hidden export
  // window can't keep window-all-closed from firing (which would block quit).
  win.on('closed', closePdfWindow);
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
shareServer.init({ resolveProject, appVersion: app.getVersion(), renderPdf: renderSharePdf });

// payload: { files:[path], title, view, scope } -> { active, primaryUrl, urls, port }
ipcMain.handle('share:start', (e, payload) => shareServer.start(payload || {}));
ipcMain.handle('share:stop', () => shareServer.stop());
ipcMain.handle('share:status', () => shareServer.status());
// Current Wi-Fi network name (or null) so the share UI can name the network
// guests must join.
ipcMain.handle('share:wifi', () => shareServer.wifiSsid());

// ---- export to PDF ------------------------------------------------------

// A safe PDF basename: drop any path parts, strip characters that are illegal in
// filenames, and guarantee a .pdf extension.
function safePdfName(name) {
  let base = path.basename(String(name || '')).replace(/[\\/:*?"<>|]+/g, ' ').trim();
  if (!base) base = 'Projector export';
  if (!/\.pdf$/i.test(base)) base += '.pdf';
  return base;
}

// First non-colliding path in `dir` for `base`: "name.pdf", then "name (2).pdf",
// etc., so a direct write never silently overwrites an existing export.
function uniquePdfPath(dir, base) {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let target = path.join(dir, base);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${stem} (${i})${ext}`);
  return target;
}

// Pick the output folder for "Export to PDF" (in-dialog folder chooser). Returns
// the chosen directory, or { canceled } if the user backs out.
ipcMain.handle('pdf:chooseFolder', async (e, payload) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const current = payload && payload.current;
  let defaultPath = app.getPath('documents');
  try { if (current && fs.statSync(current).isDirectory()) defaultPath = current; } catch { /* fall back to Documents */ }
  const res = await dialog.showOpenDialog(parent, {
    title: 'Choose export folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath,
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true };
  return { dir: res.filePaths[0] };
});

// One hidden, script-disabled window renders every PDF, and we REUSE it across
// exports instead of creating a fresh one each time. Creating a second
// BrowserWindow this way fails to load on some GPU setups (the navigation errors
// with ERR_FAILED and the export then hangs), so "Export to PDF" worked exactly
// once per session and then appeared broken; a warm, reused window also makes
// repeat exports far faster. The window is torn down after a quiet spell and when
// the main window closes (see createWindow / before-quit) so it never lingers as
// a hidden renderer or holds window-all-closed open and blocks quit.
let pdfWin = null;
let pdfIdleTimer = null;
function getPdfWindow() {
  if (pdfIdleTimer) { clearTimeout(pdfIdleTimer); pdfIdleTimer = null; }
  if (pdfWin && !pdfWin.isDestroyed()) return pdfWin;
  pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, contextIsolation: true, nodeIntegration: false },
  });
  pdfWin.on('closed', () => { pdfWin = null; });
  return pdfWin;
}
function closePdfWindow() {
  if (pdfIdleTimer) { clearTimeout(pdfIdleTimer); pdfIdleTimer = null; }
  if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy();
  pdfWin = null;
}

// Render a complete, self-contained HTML document (inline CSS + inline SVG, no
// scripts, no external assets) to a PDF Buffer, loading it from a temp file (more
// robust than a huge data: URL for SVG-heavy documents). preferCSSPageSize lets
// the document's named @page rules drive paper size + per-page orientation, so a
// single PDF mixes portrait (forecast/team) and landscape (global) pages.
async function renderPdfOnce(html) {
  const tmp = path.join(app.getPath('temp'),
    `projector-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    const win = getPdfWindow();
    await win.loadFile(tmp);
    // displayHeaderFooter + a footer template stamps "Page X of Y" in the bottom
    // @page margin of every physical page. This is the only reliable way to number
    // the document: the Team / All-tasks pages flow across an unknown number of
    // pages, so the renderer can't pre-compute a total. An empty header template
    // suppresses Chromium's default date/title header.
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#9aa0a6;text-align:center;'
        + 'font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;'
        + '-webkit-print-color-adjust:exact;print-color-adjust:exact;">'
        + 'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
  } finally {
    fs.rm(tmp, { force: true }, () => {});
    // Release the warm window after a quiet spell so an idle app isn't holding a
    // hidden renderer (and window-all-closed fires normally once exports stop).
    if (pdfIdleTimer) clearTimeout(pdfIdleTimer);
    pdfIdleTimer = setTimeout(closePdfWindow, 30000);
  }
}

// Public entry point, shared by "Export to PDF" and the viewer's "Download PDF".
// Renders are serialized onto the single shared window so two concurrent callers
// (a user export racing a viewer download) take turns instead of clobbering each
// other's navigation.
let pdfQueue = Promise.resolve();
function htmlToPdfBuffer(html) {
  const run = pdfQueue.then(() => renderPdfOnce(html));
  pdfQueue = run.catch(() => {}); // keep the chain alive even if a render fails
  return run;
}

// The renderer hands us a complete, self-contained HTML document. We render it to
// a PDF and save it. When the renderer supplies a chosen folder we write straight
// there (deduping the name); otherwise we fall back to a native Save dialog.
ipcMain.handle('pdf:export', async (e, payload) => {
  const { html, fileName, defaultName, dir } = payload || {};
  if (!html) return { canceled: true };
  const parent = BrowserWindow.fromWebContents(e.sender);
  const name = safePdfName(fileName || defaultName);

  let outPath = null;
  let dirOk = false;
  try { dirOk = !!dir && fs.statSync(dir).isDirectory(); } catch { dirOk = false; }
  if (dirOk) {
    outPath = uniquePdfPath(dir, name);
  } else {
    const res = await dialog.showSaveDialog(parent, {
      title: 'Export to PDF',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    outPath = res.filePath;
  }

  try {
    fs.writeFileSync(outPath, await htmlToPdfBuffer(html));
  } catch (err) {
    return { error: (err && err.message) || String(err) };
  }

  shell.showItemInFolder(outPath);
  return { path: outPath };
});

// ---- shared PDF for the meeting viewer ----------------------------------

// The renderer's view modules (Palette / GanttParse / PdfExport) are plain,
// DOM-free IIFEs that attach to a `window` global. We run them once in a Node vm
// sandbox so the main process can build the very same export document the app's
// renderer builds — no duplicated layout logic. Cached: the modules are pure.
let pdfSandbox = null;
function exportSandbox() {
  if (pdfSandbox) return pdfSandbox;
  const ctx = { window: {} };
  vm.createContext(ctx);
  // Order matters: pdf-export.js reads window.Palette + window.GanttParse when it
  // builds. gantt-parse.js attaches to window.GanttParse only when there's no
  // CommonJS `module` (we provide none), so it lands on window like the others.
  for (const f of ['palette.js', 'gantt-parse.js', 'pdf-export.js']) {
    const src = fs.readFileSync(path.join(__dirname, 'renderer', f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  pdfSandbox = ctx.window;
  return pdfSandbox;
}

// Build the export HTML for a meeting-share /data payload: every page (Forecast
// Timeline + Team, Global timeline) for exactly the shared projects, with sensible
// defaults. Dormant while the share UI is unwired, but kept in sync with the
// renderer's buildDocument opts shape so it still works if sharing is restored.
function renderShareHtml(data) {
  const { Palette, GanttParse, PdfExport } = exportSandbox();
  const projects = (data.projects || []).map((p) => ({
    file: p.id,
    title: p.title,
    color: Palette.colorFor({ color: Palette.readColor(p.rawMd), title: p.title, file: p.id }),
    model: GanttParse.parseGantt(GanttParse.extractMermaidBlock(p.rawMd).code),
  }));
  const scopeKind = data.scope === 'global' ? 'all' : 'project';
  return PdfExport.buildDocument({
    scopeKind,
    scopeTitle: data.title || (scopeKind === 'all' ? 'All projects' : (projects[0] && projects[0].title) || 'Project'),
    scopeProjects: projects,
    windowDays: 7,
    forecast: {
      days: 7,
      timeline: { on: true, milestones: true, milestoneWeeks: null },
      team: { on: true },
    },
    global: {
      projects,
      allTasks: { on: false, includeCompleted: false },
      timeline: { on: true, range: { mode: 'all' } },
    },
    pageSize: 'Letter',
    profileName: '',
    todayISO: GanttParse.todayISO(),
    appVersion: data.version || app.getVersion(),
  });
}

// Injected into share-server (init below): turn a /data payload into a PDF Buffer
// the viewer downloads. Errors propagate so the route can answer 500.
async function renderSharePdf(data) {
  return htmlToPdfBuffer(renderShareHtml(data));
}

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
    // Offer an update if a newer GitHub release exists — now and every 24h.
    checkForUpdates();
    setInterval(checkForUpdates, 24 * 60 * 60 * 1000);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // A share must never outlive the app: drop the server when the app is
  // quitting or all its windows are gone. Tear down the reused PDF window too.
  app.on('before-quit', () => { shareServer.stop(); closePdfWindow(); });

  app.on('window-all-closed', () => {
    shareServer.stop();
    if (process.platform !== 'darwin') app.quit();
  });
}
