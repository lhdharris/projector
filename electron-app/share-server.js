// "Share meeting" — a tiny read-only HTTP server (main process) that lets people
// on the same Wi-Fi view the chosen project(s) in a browser. It serves a
// stripped-down viewer page plus the SAME renderer view-modules the app uses
// (Kanban/Gantt/Team/GlobalView/Palette/GanttParse), so the browser renders
// identically without duplicating any rendering logic. There are no write
// routes — guests can look but not touch — and only the explicitly-shared files
// and a fixed whitelist of static assets are servable (no path traversal).
//
// Lifecycle is owned by main.js: init() injects the workspace path guard once,
// start()/stop() open/close the server, and it's torn down when the app quits.

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// A memorable default; if it's taken we fall back to an ephemeral port.
const PREFERRED_PORT = 7457;

// The only browser assets the viewer page may load, each mapped to a real file
// under the app dir. Anything not in this table 404s — there is no path-based
// file resolution, so a request like /lib/../main.js can't escape.
const LIB_FILES = {
  'mermaid.min.js': ['renderer', 'vendor', 'mermaid.min.js'],
  'palette.js':     ['renderer', 'palette.js'],
  'gantt-parse.js': ['renderer', 'gantt-parse.js'],
  'kanban.js':      ['renderer', 'kanban.js'],
  'gantt.js':       ['renderer', 'gantt.js'],
  'team.js':        ['renderer', 'team.js'],
  'global.js':      ['renderer', 'global.js'],
  'viewer.js':      ['share', 'viewer.js'],
};

let server = null;                       // http.Server while sharing, else null
let share = null;                        // { files:[abs], title, view, scope } | null
let resolveProjectFn = (f) => f;         // workspace path guard, injected by main.js

// Called once at startup so the server validates every shared path through the
// same sandbox that guards projects:read in main.js.
function init(deps) {
  resolveProjectFn = (deps && deps.resolveProject) || ((f) => f);
}

// First markdown H1, else the fallback — the project's display title (mirrors
// main.js titleFromMarkdown's primary case; only the heading is needed here).
function titleOf(md, fallback) {
  const m = String(md).match(/^\s*#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, parts, type) {
  let data;
  try { data = fs.readFileSync(path.join(__dirname, ...parts)); }
  catch { return send(res, 404, 'text/plain', 'Not found'); }
  send(res, 200, type, data);
}

// Read the shared files FRESH so the viewer is live. `rev` is the newest mtime
// across them — the viewer polls and only re-renders when it changes.
function buildData() {
  const projects = [];
  let rev = 0;
  (share.files || []).forEach((file, idx) => {
    let abs;
    try { abs = resolveProjectFn(file); } catch { return; } // outside sandbox -> skip
    let md, st;
    try { md = fs.readFileSync(abs, 'utf8'); st = fs.statSync(abs); } catch { return; }
    if (st.mtimeMs > rev) rev = st.mtimeMs;
    // id is synthetic — the browser never sees the host's absolute paths.
    projects.push({ id: `p${idx}`, title: titleOf(md, `Project ${idx + 1}`), rawMd: md });
  });
  return {
    scope: share.scope || (projects.length > 1 ? 'global' : 'project'),
    title: share.title || (projects[0] && projects[0].title) || 'Shared',
    view: share.view || 'kanban',
    rev: Math.round(rev),
    projects,
  };
}

function handle(req, res) {
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'Method not allowed');
  if (!share) return send(res, 503, 'text/plain', 'Sharing stopped');
  const url = (req.url || '/').split('?')[0];

  if (url === '/' || url === '/index.html') return sendFile(res, ['share', 'viewer.html'], 'text/html; charset=utf-8');
  if (url === '/app.css') return sendFile(res, ['renderer', 'style.css'], 'text/css; charset=utf-8');
  if (url === '/data') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(buildData()));
  if (url.startsWith('/lib/')) {
    const parts = LIB_FILES[url.slice('/lib/'.length)];
    if (!parts) return send(res, 404, 'text/plain', 'Not found');
    return sendFile(res, parts, 'application/javascript; charset=utf-8');
  }
  return send(res, 404, 'text/plain', 'Not found');
}

// IPv4 LAN addresses, most-likely-reachable first: ordinary private ranges win;
// link-local and CGNAT (100.64.0.0/10, e.g. Tailscale) are dropped so the
// suggested URL is one a phone on the same Wi-Fi can actually open.
function lanAddresses() {
  const rank = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 9;
  };
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^169\.254\./.test(a.address)) continue;                              // link-local
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)) continue; // CGNAT / Tailscale
      out.push(a.address);
    }
  }
  out.sort((x, y) => rank(x) - rank(y));
  return out;
}

function urlsFor(port) {
  const list = lanAddresses().map((ip) => `http://${ip}:${port}`);
  return { primaryUrl: list[0] || `http://localhost:${port}`, urls: list, port };
}

// Other devices on the LAN can't reach the server if the host firewall drops the
// port — the #1 reason a shared link "won't open" on someone else's machine. So
// when sharing starts we best-effort open the port through the OS firewall. Each
// platform raises ONE native prompt (polkit password on Linux, UAC on Windows,
// an admin password on macOS); if the relevant firewall isn't active, the tool is
// missing, or the user cancels, we just log and carry on — the share still works
// for same-host / cooperative networks. The renderer warns the user *before* this
// runs (see the share modal), so the prompt is never a surprise.
const firewallOpenedPorts = new Set();

function openFirewallPort(port) {
  if (firewallOpenedPorts.has(port)) return;
  if (process.platform === 'linux') return openFirewallLinux(port);
  if (process.platform === 'win32') return openFirewallWindows(port);
  if (process.platform === 'darwin') return openFirewallMac();
  // Other platforms: nothing to do; rely on the host network being open.
}

// Linux/firewalld: a RUNTIME rule (no --permanent) — harmless once nothing's
// listening and it clears on reboot/reload, so we never need to (and never do)
// remove it, which also avoids a pkexec prompt at quit time.
function openFirewallLinux(port) {
  // Only prompt if firewalld is actually running (exits 0 when it is).
  execFile('firewall-cmd', ['--state'], (stateErr) => {
    if (stateErr) return;
    firewallOpenedPorts.add(port); // optimistic: don't double-prompt on re-share
    execFile('pkexec', ['firewall-cmd', `--add-port=${port}/tcp`], (err) => {
      if (err) {
        firewallOpenedPorts.delete(port); // let a later share retry
        console.warn(`share: could not open firewall port ${port}:`, err.message);
      }
    });
  });
}

// Windows: add an inbound TCP allow rule via an elevated netsh. `Start-Process
// -Verb RunAs` raises the UAC prompt (consent on admin accounts, a password on
// standard ones). The rule persists; the stable per-port name keeps re-runs
// idempotent enough and the session set stops us re-prompting while sharing.
function openFirewallWindows(port) {
  firewallOpenedPorts.add(port);
  const rule = `Projector Share ${port}`;
  const inner = [
    'advfirewall', 'firewall', 'add', 'rule',
    `name="${rule}"`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${port}`,
  ].map((a) => `'${a}'`).join(',');
  const cmd = `Start-Process netsh -Verb RunAs -WindowStyle Hidden -ArgumentList ${inner}`;
  execFile('powershell', ['-NoProfile', '-Command', cmd], (err) => {
    if (err) {
      firewallOpenedPorts.delete(port);
      console.warn(`share: could not open Windows firewall port ${port}:`, err.message);
    }
  });
}

// macOS: the Application Firewall is app-based and OFF by default. Only if it's
// enabled do we need to allow our own binary through; that needs root, so we ask
// once via osascript (a native admin-password dialog). When the firewall is off
// there's nothing blocking the port, so we stay silent and raise no prompt.
function openFirewallMac() {
  const fw = '/usr/libexec/ApplicationFirewall/socketfilterfw';
  execFile(fw, ['--getglobalstate'], (stateErr, stdout) => {
    if (stateErr) return;                          // firewall tool unavailable
    if (!/enabled/i.test(stdout || '')) return;    // firewall off -> nothing to open
    firewallOpenedPorts.add(0);                    // app-scoped: dedupe on a sentinel
    const exe = process.execPath.replace(/(["\\])/g, '\\$1');
    const script =
      `do shell script "'${fw}' --add '${exe}'; '${fw}' --unblockapp '${exe}'" ` +
      `with administrator privileges`;
    execFile('osascript', ['-e', script], (err) => {
      if (err) {
        firewallOpenedPorts.delete(0);
        console.warn('share: could not allow app through macOS firewall:', err.message);
      }
    });
  });
}

// Best-effort current Wi-Fi network name (SSID), so the share UI can tell the
// host which network guests must join. Resolves to null when it can't be
// determined (e.g. a wired connection or the platform tool isn't present).
function wifiSsid() {
  const run = (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });

  if (process.platform === 'linux') {
    return run('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi']).then((out) => {
      // Rows look like "yes:MyNetwork" / "no:OtherNetwork".
      for (const line of out.split('\n')) {
        const m = line.match(/^yes:(.*)$/);
        if (m && m[1].trim()) return m[1].trim();
      }
      return run('iwgetid', ['-r']).then((s) => s.trim() || null);
    });
  }

  if (process.platform === 'darwin') {
    // Find the Wi-Fi hardware port's device, then read its current network.
    return run('networksetup', ['-listallhardwareports']).then((out) => {
      const m = out.match(/Hardware Port:\s*Wi-?Fi[\s\S]*?Device:\s*(\S+)/i);
      const dev = m ? m[1] : 'en0';
      return run('networksetup', ['-getairportnetwork', dev]).then((line) => {
        const n = line.match(/Current Wi-?Fi Network:\s*(.+)$/im);
        return n && n[1].trim() ? n[1].trim() : null;
      });
    });
  }

  if (process.platform === 'win32') {
    return run('netsh', ['wlan', 'show', 'interfaces']).then((out) => {
      // Match "SSID : Name" but not "BSSID : ..".
      const m = out.match(/^\s*SSID\s*:\s*(.+?)\s*$/im);
      return m && m[1].trim() ? m[1].trim() : null;
    });
  }

  return Promise.resolve(null);
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handle);
    const onErr = (err) => { s.removeListener('error', onErr); reject(err); };
    s.on('error', onErr);
    s.listen(port, '0.0.0.0', () => {
      s.removeListener('error', onErr);
      s.on('error', () => {}); // swallow late socket errors so they never crash the app
      resolve(s);
    });
  });
}

// Begin (or re-target) sharing. Reuses the running server if one is already up,
// so changing the shared selection doesn't bounce the port.
async function start({ files, title, view, scope }) {
  share = { files: files || [], title: title || '', view: view || 'kanban', scope: scope || '' };
  if (!server) {
    try { server = await listen(PREFERRED_PORT); }
    catch (e) {
      if (e && e.code === 'EADDRINUSE') server = await listen(0);
      else throw e;
    }
  }
  // Fire-and-forget so the share dialog/URL shows immediately while the polkit
  // prompt (if any) happens in parallel.
  openFirewallPort(server.address().port);
  return Object.assign({ active: true }, urlsFor(server.address().port));
}

function stop() {
  share = null;
  if (server) { const s = server; server = null; s.close(); }
  return { active: false };
}

function status() {
  if (!server || !share) return { active: false };
  return Object.assign({ active: true, title: share.title }, urlsFor(server.address().port));
}

module.exports = { init, start, stop, status, wifiSsid };
