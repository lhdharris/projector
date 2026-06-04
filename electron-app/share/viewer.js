// Read-only viewer for "Share meeting". Fetches /data (the host's chosen
// project or all-projects set), then renders with the SAME modules the app
// uses — Kanban / Gantt / Team / GlobalView / Palette / GanttParse — passing
// no-op handlers so guests can look but never edit. Polls /data so the view
// stays live as the host works; re-renders only when the content actually
// changes (rev = newest file mtime).

(function () {
  'use strict';
  const P = window.GanttParse;
  const byId = (id) => document.getElementById(id);

  const state = {
    view: 'kanban',
    rev: null,        // last-seen content revision (newest mtime)
    data: null,       // last /data payload
    viewInit: false,  // have we applied the host's initial view yet?
    pin: null,        // meeting PIN the guest entered (gates /data)
    wifi: null,       // host Wi-Fi name (or null) for the Invite card's warning
  };

  // Restore a PIN from this tab's session (survives reloads) or a ?pin= link, so
  // a returning guest isn't re-prompted. Only a well-formed 4-digit code counts.
  (function readSavedPin() {
    try {
      const q = new URLSearchParams(location.search).get('pin');
      if (q && /^\d{4}$/.test(q)) { state.pin = q; return; }
      const s = sessionStorage.getItem('sharePin');
      if (s && /^\d{4}$/.test(s)) state.pin = s;
    } catch { /* storage blocked — guest will just type the PIN */ }
  })();

  function pinHeaders() { return state.pin ? { 'X-Share-Pin': state.pin } : {}; }

  // Every interaction is inert in the shared view.
  const NOOP = () => {};
  const handlers = {
    onEditTask: NOOP, onAddTask: NOOP, onMoveTask: NOOP,
    onReassign: NOOP, onSetStatus: NOOP, onAddTaskFor: NOOP, onDeleteMember: NOOP,
  };

  // ---- view toggle + gantt zoom (mirrors the app's wiring) --------------
  document.querySelectorAll('#view-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
  byId('gantt-zoom-in').addEventListener('click', () => window.Gantt.zoomIn());
  byId('gantt-zoom-out').addEventListener('click', () => window.Gantt.zoomOut());
  byId('gantt-zoom-label').addEventListener('click', () => window.Gantt.zoomReset());
  byId('g-zoom-in').addEventListener('click', () => window.Gantt.zoomIn());
  byId('g-zoom-out').addEventListener('click', () => window.Gantt.zoomOut());
  byId('g-zoom-label').addEventListener('click', () => window.Gantt.zoomReset());

  function setView(view) {
    state.view = view;
    updateToggleButtons();
    render();
  }
  function updateToggleButtons() {
    document.querySelectorAll('#view-toggle .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === state.view);
    });
  }

  // Hide the Team tab unless ≥2 people are assigned (matches the app), but keep
  // it while it's the view on screen so a re-render doesn't yank the guest out.
  function updateTeamToggle(tasks) {
    const people = new Set();
    for (const t of tasks) if (t.assignee && t.assignee.trim()) people.add(t.assignee.trim());
    const qualifies = people.size >= 2;
    const inTeam = state.view === 'team';
    const btn = document.querySelector('#view-toggle .seg-btn[data-view="team"]');
    if (btn) btn.hidden = !(qualifies || inTeam);
    if (!qualifies && state.view === 'team' && !inTeam) { state.view = 'kanban'; updateToggleButtons(); }
  }

  // Parse each shared file into a render-ready { file, title, color, model }.
  function projectsFromData(data) {
    return data.projects.map((p) => ({
      file: p.id, // synthetic id; the browser never sees real paths
      title: p.title,
      color: window.Palette.colorFor({ color: window.Palette.readColor(p.rawMd), title: p.title, file: p.id }),
      model: P.parseGantt(P.extractMermaidBlock(p.rawMd).code),
    }));
  }

  function render() {
    const data = state.data;
    if (!data) return;
    byId('view-toggle').hidden = false;
    byId('empty-state').hidden = true;
    updateToggleButtons();

    const projects = projectsFromData(data);
    if (data.scope === 'global') renderGlobal(projects);
    else renderProject(projects[0]);
  }

  function renderProject(proj) {
    byId('global').hidden = true;
    if (!proj) return;
    updateTeamToggle(proj.model.tasks);
    const colorForTask = () => proj.color;
    const kb = byId('kanban'), gt = byId('gantt'), tm = byId('team');
    kb.hidden = gt.hidden = tm.hidden = true;
    if (state.view === 'kanban') {
      kb.hidden = false;
      window.Kanban.render(kb, proj.model, handlers, { colorForTask, readOnlyAdd: true });
    } else if (state.view === 'team') {
      tm.hidden = false;
      window.Team.render(tm, proj.model.tasks, handlers, { colorForTask });
    } else {
      gt.hidden = false;
      window.Gantt.render(byId('gantt-render'), proj.model, handlers, { colorForTask });
    }
  }

  function renderGlobal(projects) {
    byId('kanban').hidden = byId('gantt').hidden = byId('team').hidden = true;
    byId('global').hidden = false;
    const built = window.GlobalView.build(projects);
    updateTeamToggle(built.kanbanModel.tasks);
    const gk = byId('global-kanban'), gg = byId('global-gantt'), gtm = byId('global-team');
    gk.hidden = gg.hidden = gtm.hidden = true;
    if (state.view === 'kanban') {
      gk.hidden = false;
      window.Kanban.render(gk, built.kanbanModel, handlers, {
        colorForTask: built.colorForKanban, projectLabel: built.projectLabel, readOnlyAdd: true,
      });
    } else if (state.view === 'team') {
      gtm.hidden = false;
      window.Team.render(gtm, built.kanbanModel.tasks, handlers, {
        colorForTask: built.colorForKanban, projectLabel: built.projectLabel,
      });
    } else {
      gg.hidden = false;
      window.Gantt.render(byId('global-gantt-render'), built.ganttModel, handlers, { colorForTask: built.colorForGantt });
    }
  }

  // ---- PIN gate ---------------------------------------------------------
  // Shown until /data accepts the guest's PIN; updated in place on a bad code.
  function showGate(msg) {
    const gate = byId('pin-gate');
    const wasHidden = gate.hidden;
    gate.hidden = false;
    const err = byId('pin-error');
    if (msg) { err.textContent = msg; err.hidden = false; }
    else { err.hidden = true; }
    if (wasHidden || msg) {
      const inp = byId('pin-input');
      if (msg) inp.value = '';
      inp.focus();
    }
  }
  function hideGate() { byId('pin-gate').hidden = true; }

  // Map a 401/429 from /data to the gate. A wrong PIN is dropped immediately so
  // the 4s poll loop can't keep re-submitting it and trip the server lockout.
  function handleGate(locked) {
    showInviteBtn(false);   // gated again — nothing valid to share
    if (locked) {
      showGate('Too many attempts. Wait a moment, then try again.');
    } else if (state.pin) {
      state.pin = null;
      try { sessionStorage.removeItem('sharePin'); } catch { /* ignore */ }
      showGate('Incorrect PIN. Try again.');
    } else {
      showGate('');
    }
  }

  byId('pin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = byId('pin-input').value.replace(/\D/g, '').slice(0, 4);
    if (v.length !== 4) { showGate('Enter the 4-digit PIN.'); return; }
    state.pin = v;
    try { sessionStorage.setItem('sharePin', v); } catch { /* ignore */ }
    byId('pin-error').hidden = true;
    poll();
  });

  // ---- invite card ------------------------------------------------------
  // An unobtrusive button (bottom of the screen) opens a card with the join QR,
  // address and PIN, so a guest already in the meeting can show a latecomer how
  // to join from their own phone — no need to interrupt the host. Shown only
  // once past the gate; hidden again if we lose the host or the PIN.
  function showInviteBtn(on) {
    byId('invite-btn').hidden = !on;
    byId('pdf-btn').hidden = !on;   // the PDF download is only valid past the gate
    if (!on) closeInvite();
  }

  // Ask the host to render the shared view (the content it chose to share) to a
  // PDF and download it. The meeting PIN rides the X-Share-Pin header — so a plain
  // <a href> can't carry it — we fetch the bytes, then save them via a temporary
  // object-URL link. The host does the actual rendering (the browser never builds
  // the PDF), so a guest on a phone gets the same document the app exports.
  async function downloadPdf() {
    const btn = byId('pdf-btn');
    if (btn.disabled) return;
    const label = btn.querySelector('.pdf-btn-label');
    const prev = label.textContent;
    btn.disabled = true;
    label.textContent = 'Preparing…';
    let url = null;
    try {
      const res = await fetch('/pdf', { cache: 'no-store', headers: pinHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = ((state.data && state.data.title) || 'Projector') + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      window.alert('Could not download the PDF. The host may have stopped sharing.');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
      label.textContent = prev;
      btn.disabled = false;
    }
  }

  // The address this guest reached us on already works for any device on the
  // same network; the QR embeds the PIN (the viewer honours ?pin=) so a scan
  // joins in one step, while the text address + PIN cover manual entry.
  function openInvite() {
    byId('invite-url').textContent = location.origin;
    byId('invite-pin').textContent = state.pin ? formatPin(state.pin) : '';
    setInviteWifi(state.wifi);
    const join = state.pin ? `${location.origin}/?pin=${state.pin}` : location.origin;
    renderInviteQr(join);
    byId('invite-backdrop').hidden = false;
  }
  function closeInvite() { byId('invite-backdrop').hidden = true; }

  // Fill the invite card's same-Wi-Fi warning, naming the host network when known
  // (mirrors the host app's setShareWifiNote). The latecomer being invited MUST
  // be on this network or the link won't reach the host.
  function setInviteWifi(ssid) {
    const t = byId('invite-wifi').querySelector('.share-wifi-text');
    t.textContent = '';
    if (ssid) {
      t.append('Your guest must be on the same Wi-Fi as the host: ');
      const strong = document.createElement('strong');
      strong.textContent = ssid;
      t.append(strong);
    } else {
      t.append('Your guest must be on the same Wi-Fi network as the host.');
    }
  }

  // Spaced for readability (e.g. "12 34"); the value entered is still "1234".
  function formatPin(pin) {
    const s = String(pin);
    return s.length === 4 ? `${s.slice(0, 2)} ${s.slice(2)}` : s;
  }

  // Paint the join link as an inline-SVG QR (one <path> for all dark modules),
  // matching the host card's renderer. window.QRCode (vendored) builds the matrix.
  function renderInviteQr(url) {
    const box = byId('invite-qr');
    box.innerHTML = '';
    if (!url || !window.QRCode) { box.hidden = true; return; }
    let qr;
    try { qr = window.QRCode.create(url, { errorCorrectionLevel: 'M' }); }
    catch { box.hidden = true; return; }
    box.hidden = false;

    const n = qr.modules.size;
    const quiet = 4;                 // standard QR quiet zone (modules)
    const dim = n + quiet * 2;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
    svg.setAttribute('width', '168');
    svg.setAttribute('height', '168');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', String(dim));
    bg.setAttribute('height', String(dim));
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);

    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#16181d');
    svg.appendChild(path);
    box.appendChild(svg);
  }

  byId('invite-btn').addEventListener('click', openInvite);
  byId('pdf-btn').addEventListener('click', downloadPdf);
  byId('invite-close').addEventListener('click', closeInvite);
  byId('invite-done').addEventListener('click', closeInvite);
  byId('invite-backdrop').addEventListener('mousedown', (e) => {
    if (e.target === byId('invite-backdrop')) closeInvite();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !byId('invite-backdrop').hidden) closeInvite();
  });

  // ---- live polling -----------------------------------------------------
  async function poll() {
    let res;
    try {
      res = await fetch('/data', { cache: 'no-store', headers: pinHeaders() });
    } catch {
      showDisconnected();
      return;
    }
    document.body.classList.remove('disconnected');

    // PIN-gated: no/wrong PIN -> 401, throttled -> 429. Show the gate either way.
    if (res.status === 401) { handleGate(false); return; }
    if (res.status === 429) { handleGate(true); return; }
    if (!res.ok) { showDisconnected(); return; }

    let data;
    try { data = await res.json(); }
    catch { showDisconnected(); return; }
    hideGate();
    showInviteBtn(true);   // past the gate: offer the invite card

    // First successful load: open on whatever view the host was using.
    if (!state.viewInit) {
      state.viewInit = true;
      if (['kanban', 'gantt', 'team'].includes(data.view)) state.view = data.view;
    }

    byId('share-title').textContent = data.title || 'Shared';
    document.title = (data.title ? data.title + ' — ' : '') + 'Projector (shared)';
    state.wifi = data.wifi || null;   // for the Invite card's same-Wi-Fi warning
    byId('footer-version').textContent = data.version ? 'v' + String(data.version).replace(/^v/i, '') : '';

    if (state.rev !== data.rev) {
      state.rev = data.rev;
      state.data = data;
      render();
    }
  }

  // Lost the host (Stop sharing / app quit). Keep the last good view on screen
  // if we have one; otherwise show a plain notice.
  function showDisconnected() {
    document.body.classList.add('disconnected');
    showInviteBtn(false);   // host gone — the address/PIN may no longer work
    if (!state.data) {
      const es = byId('empty-state');
      es.hidden = false;
      es.querySelector('.empty-title').textContent = 'Not connected';
      es.querySelector('.empty-detail').textContent = 'The meeting share may have ended.';
    }
  }

  poll();
  setInterval(poll, 4000);
})();
