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
  };

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

  // ---- live polling -----------------------------------------------------
  async function poll() {
    let data;
    try {
      const res = await fetch('/data', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch {
      showDisconnected();
      return;
    }
    document.body.classList.remove('disconnected');

    // First successful load: open on whatever view the host was using.
    if (!state.viewInit) {
      state.viewInit = true;
      if (['kanban', 'gantt', 'team'].includes(data.view)) state.view = data.view;
    }

    byId('share-title').textContent = data.title || 'Shared';
    document.title = (data.title ? data.title + ' — ' : '') + 'Projector (shared)';

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
