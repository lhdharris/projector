// App orchestrator: owns state, wires the top bar / sidebar / modal, and
// mediates between the Kanban and Gantt views and the file storage. Each
// project is one .md file; edits mutate an in-memory model and round-trip
// back through GanttParse.writeBackToMarkdown so any prose around the
// ```mermaid block is preserved.

(function () {
  'use strict';
  const P = window.GanttParse;

  const state = {
    folder: '',
    projects: [],
    folders: [],        // folder (sub-directory) names in the sidebar
    currentFile: null,
    rawMd: '',
    model: null,        // { title, dateFormat, tasks: [...] }
    color: null,        // effective colour of the current project
    view: 'kanban',
    mode: 'project',    // 'project' (one project) | 'global' (all projects)
    global: [],         // [{ file, title, color, model }] when in global mode
    built: null,        // GlobalView.build(...) result while in global mode
    team: [],           // app-wide roster of assignee names (all projects)
    editingId: null,    // task id being edited, or null for a new task
    editSourceFile: null, // file the task being edited lives in (move source)
    newStatus: 'todo',  // status for a brand-new task
    editModel: null,    // model that owns the task being edited
    editSave: null,     // async fn persisting that model back to disk
    profiles: [],       // roster of profile names (Work / Household / …)
    activeProfile: '',  // '' = All projects
    teamEditProfile: '',// which profile's roster the Settings panel is editing
    centerGanttNext: false, // one-shot: centre today when the gantt next renders
  };

  // ---- window controls --------------------------------------------------
  byId('minimize').addEventListener('click', () => window.wm.minimize());
  byId('maximize').addEventListener('click', () => window.wm.toggleMaximize());
  byId('close').addEventListener('click', () => window.wm.close());

  // The window can open right under the cursor; suppress :hover (so the close
  // button doesn't flash red) until the mouse actually moves — same trick the
  // tabless-browser chrome uses.
  document.addEventListener('mousemove', () => document.body.classList.remove('no-hover'), { once: true });

  // ---- view toggle ------------------------------------------------------
  document.querySelectorAll('#view-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Gantt zoom controls (project + global gantt share the Gantt module).
  byId('gantt-zoom-in').addEventListener('click', () => window.Gantt.zoomIn());
  byId('gantt-zoom-out').addEventListener('click', () => window.Gantt.zoomOut());
  byId('gantt-zoom-label').addEventListener('click', () => window.Gantt.zoomReset());
  byId('g-zoom-in').addEventListener('click', () => window.Gantt.zoomIn());
  byId('g-zoom-out').addEventListener('click', () => window.Gantt.zoomOut());
  byId('g-zoom-label').addEventListener('click', () => window.Gantt.zoomReset());

  // ---- global view -----------------------------------------------------
  byId('global-view-btn').addEventListener('click', enterGlobal);

  function setView(view) {
    state.view = view;
    localStorage.setItem('lastView', view); // remember the view across launches
    // Opening the Timeline centres the today line; switching away clears the flag.
    state.centerGanttNext = view === 'gantt';
    updateViewToggleButtons();
    renderCurrentView();
  }

  function updateViewToggleButtons() {
    document.querySelectorAll('#view-toggle .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === state.view);
    });
  }

  // ---- new task (toolbar) ----------------------------------------------
  // Opens the task editor from anywhere, with a project picker; the project
  // defaults to whatever's open (blank in Global). Disabled until a project exists.
  byId('new-task-btn').addEventListener('click', () => { if (state.projects.length) openNewModal('todo'); });
  function updateNewTaskBtn() { byId('new-task-btn').disabled = !state.projects.length; }

  // ---- sidebar ----------------------------------------------------------
  byId('new-project').addEventListener('click', (e) => { e.stopPropagation(); onNewProject(); });
  byId('new-folder').addEventListener('click', openWorkspace);
  byId('profile-switcher').addEventListener('click', openProfileMenu);

  // Collapsed-folder state survives reloads.
  const collapsed = new Set(loadCollapsed());
  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem('collapsedFolders') || '[]'); }
    catch { return []; }
  }
  function saveCollapsed() {
    localStorage.setItem('collapsedFolders', JSON.stringify([...collapsed]));
  }

  async function loadProjects(selectFile) {
    const [projects, folders] = await Promise.all([
      window.projects.list(),
      window.projects.listFolders(),
    ]);
    state.projects = projects;
    state.folders = folders;
    renderProjectList();
    updateNewTaskBtn();

    if (selectFile) selectProject(selectFile);
    else if (state.currentFile && !state.projects.find((p) => p.file === state.currentFile)) {
      clearSelection();
    }
  }

  // A project is visible under the active profile if no profile is active
  // ("All projects"), it carries that profile, or it's untagged (untagged
  // projects appear in every profile).
  function inActiveProfile(p) {
    if (!state.activeProfile) return true;
    return !p.profile || p.profile === state.activeProfile;
  }

  // Friendly path for tooltips: collapse the user's home dir to "~".
  function displayPath(abs) {
    return String(abs || '').replace(/^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~');
  }

  // Build the sidebar: one collapsible group per workspace, projects nested
  // underneath, filtered by the active profile.
  function renderProjectList() {
    const list = byId('project-list');
    list.innerHTML = '';

    if (!state.folders.length) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = 'No workspaces open. Use the folder button to open one.';
      list.appendChild(empty);
      return;
    }

    for (const folder of state.folders) {
      const inFolder = state.projects.filter((p) => p.folderPath === folder.path);
      const items = inFolder.filter(inActiveProfile);
      // Under an active profile, hide any workspace with no projects in it —
      // whether it holds projects from other profiles or is empty entirely.
      // Empty workspaces still surface under "All projects", where the user can
      // see every linked folder (including ones they just opened to fill).
      if (state.activeProfile && !items.length) continue;
      list.appendChild(folderGroup(folder, items));
    }
  }

  function projectItem(p) {
    const item = document.createElement('div');
    item.className = 'project-item';
    item.dataset.file = p.file;
    item.draggable = true;
    if (state.mode === 'project' && p.file === state.currentFile) item.classList.add('active');
    item.innerHTML = `<span class="pi-dot"></span><span class="pi-title"></span>`;
    item.querySelector('.pi-dot').style.background = window.Palette.colorFor(p);
    item.querySelector('.pi-title').textContent = p.title;
    // Native tooltip so a title truncated to "…" in the fixed-width sidebar can
    // still be read in full on hover.
    item.title = p.title;
    item.addEventListener('click', () => selectProject(p.file));
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); openProjectMenu(e, p); });
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-projector-file', p.file);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    return item;
  }

  function folderGroup(folder, items) {
    const wrap = document.createElement('div');
    wrap.className = 'folder-group';
    const isCollapsed = collapsed.has(folder.path);

    const head = document.createElement('div');
    head.className = 'folder-head' + (isCollapsed ? ' collapsed' : '');
    // Native tooltip (appears after a hover beat) shows where the workspace lives.
    head.title = displayPath(folder.path);
    head.innerHTML =
      `<span class="folder-caret">▾</span>` +
      `<span class="folder-name"></span>` +
      `<span class="count">${items.length}</span>` +
      `<button class="folder-add" title="New project in workspace">+</button>`;
    head.querySelector('.folder-name').textContent = folder.name;

    head.addEventListener('click', (e) => {
      if (e.target.closest('.folder-add')) return;
      if (collapsed.has(folder.path)) collapsed.delete(folder.path); else collapsed.add(folder.path);
      saveCollapsed();
      renderProjectList();
    });
    head.querySelector('.folder-add').addEventListener('click', (e) => {
      e.stopPropagation();
      onNewProject(folder);
    });
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); openFolderMenu(e, folder); });

    // Drop a project onto the header to move it into this folder.
    head.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-projector-file')) return;
      e.preventDefault();
      head.classList.add('drop-target');
    });
    head.addEventListener('dragleave', () => head.classList.remove('drop-target'));
    head.addEventListener('drop', (e) => {
      e.preventDefault();
      head.classList.remove('drop-target');
      const file = e.dataTransfer.getData('application/x-projector-file');
      const p = state.projects.find((x) => x.file === file);
      if (p && p.folderPath !== folder.path) moveProject(p, folder);
    });

    wrap.appendChild(head);

    if (!isCollapsed) {
      const body = document.createElement('div');
      body.className = 'folder-body';
      if (!items.length) {
        const e = document.createElement('div');
        e.className = 'list-empty';
        e.textContent = 'Empty';
        body.appendChild(e);
      }
      for (const p of items) body.appendChild(projectItem(p));
      wrap.appendChild(body);
    }
    return wrap;
  }

  async function selectProject(file) {
    state.mode = 'project';
    state.currentFile = file;
    state.rawMd = await window.projects.read(file);
    const block = P.extractMermaidBlock(state.rawMd);
    state.model = P.parseGantt(block.code);
    const meta = state.projects.find((p) => p.file === file) || { title: state.model.title, file };
    state.color = window.Palette.colorFor({ color: window.Palette.readColor(state.rawMd), title: meta.title, file });

    document.querySelectorAll('.project-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.file === file);
    });
    byId('global-view-btn').classList.remove('active');

    byId('view-toggle').hidden = false;
    byId('empty-state').hidden = true;
    byId('global').hidden = true;
    localStorage.setItem('lastMode', 'project'); // restored on next launch
    localStorage.setItem('lastFile', file);
    // Opening a project straight into the Timeline centres on today too.
    if (state.view === 'gantt') state.centerGanttNext = true;
    renderCurrentView();
  }

  function clearSelection() {
    state.currentFile = null;
    state.model = null;
    byId('view-toggle').hidden = true;
    byId('kanban').hidden = true;
    byId('team').hidden = true;
    byId('gantt').hidden = true;
    byId('global').hidden = true;
    byId('empty-state').hidden = false;
  }

  // ---- rendering --------------------------------------------------------

  // The Team view only earns its place once work is split across ≥2 people;
  // with one (or no) assignee there's nothing to triage by person, so hide the
  // Team toggle and fall back to the Task List.
  //
  // But once you're *in* Team view, stay there: shuffling jobs around often
  // leaves a member momentarily empty (dropping below 2 assignees), and that
  // must not yank you back to the Task List mid-move. So only fall back when
  // Team isn't the view already on screen — i.e. on load / opening a project
  // where it can't be shown — never on a re-render triggered by an edit. The
  // toggle likewise stays visible while Team is the active view.
  function updateTeamToggle(tasks) {
    const people = new Set();
    for (const t of tasks) if (t.assignee && t.assignee.trim()) people.add(t.assignee.trim());
    const qualifies = people.size >= 2;
    const teamEl = byId(state.mode === 'global' ? 'global-team' : 'team');
    const inTeamView = state.view === 'team' && teamEl && !teamEl.hidden;
    const btn = document.querySelector('#view-toggle .seg-btn[data-view="team"]');
    if (btn) btn.hidden = !(qualifies || inTeamView);
    if (!qualifies && state.view === 'team' && !inTeamView) {
      state.view = 'kanban';
      document.querySelectorAll('#view-toggle .seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === 'kanban');
      });
    }
  }

  // ---- Team view: grace period when a member runs out of tasks ----------
  // In the single-project Team view a person only has a column because they
  // hold a task there, so reassigning/removing their last one would normally
  // make the column vanish instantly. Instead we keep it for 5s, greyed, as
  // feedback that they're about to drop off — assigning a task back inside that
  // window cancels it. Explicit "Delete team member" stays immediate (it adds
  // the name to teamExplicitRemove so the grace below is skipped for it).
  let teamLinger = new Map();        // name -> setTimeout id (members in their grace)
  let teamShownPrev = new Set();     // names that had >=1 task at the last team render
  let teamScopeKey = null;           // 'global' or currentFile — reset grace on scope change
  let teamExplicitRemove = new Set();// names just deleted via the menu (skip grace once)
  const TEAM_LINGER_MS = 5000;

  function teamRender(container, tasks, handlers, opts) {
    opts = opts || {};
    const scopeKey = state.mode === 'global' ? 'global' : (state.currentFile || '');
    if (scopeKey !== teamScopeKey) {            // switched view: drop stale graces
      for (const id of teamLinger.values()) clearTimeout(id);
      teamLinger.clear();
      teamShownPrev = new Set();
      teamScopeKey = scopeKey;
    }
    const withTasks = new Set();
    for (const t of tasks) if (t.assignee) withTasks.add(t.assignee);
    const roster = new Set(opts.roster || []);
    // Rescued: regained a task (or is a permanent roster member) -> cancel grace.
    for (const name of [...teamLinger.keys()]) {
      if (withTasks.has(name) || roster.has(name)) {
        clearTimeout(teamLinger.get(name));
        teamLinger.delete(name);
      }
    }
    // Just lost their last task -> start the grace timer (unless roster-seeded,
    // already lingering, or explicitly deleted).
    for (const name of teamShownPrev) {
      if (withTasks.has(name) || roster.has(name) || teamLinger.has(name) || teamExplicitRemove.has(name)) continue;
      teamLinger.set(name, setTimeout(() => { teamLinger.delete(name); renderCurrentView(); }, TEAM_LINGER_MS));
    }
    teamExplicitRemove.clear();
    const linger = new Set([...teamLinger.keys()].filter((n) => !withTasks.has(n) && !roster.has(n)));
    window.Team.render(container, tasks, handlers, Object.assign({}, opts, { linger }));
    teamShownPrev = withTasks;
  }

  function renderCurrentView() {
    if (state.mode === 'global') return renderGlobalView();
    if (!state.model) return;
    updateViewToggleButtons();
    updateTeamToggle(state.model.tasks);
    const kb = byId('kanban');
    const gt = byId('gantt');
    const tm = byId('team');
    const colorForTask = () => state.color; // one colour for the whole project
    kb.hidden = gt.hidden = tm.hidden = true;
    if (state.view === 'kanban') {
      kb.hidden = false;
      window.Kanban.render(kb, state.model, {
        onEditTask: openEditModal,
        onAddTask: openNewModal,
        onMoveTask: moveTask,
      }, { colorForTask });
    } else if (state.view === 'team') {
      tm.hidden = false;
      // No roster passed: a single project shows only people who actually have
      // a task in it, not the whole team. (Global view below passes the full
      // roster so everyone appears.)
      teamRender(tm, state.model.tasks, {
        onEditTask: openEditModal,
        onReassign: reassignTask,
        onSetStatus: moveTask,
        onAddTaskFor: (assignee) => openNewModal('todo', assignee),
        onDeleteMember: deleteMemberFromView,
      }, { colorForTask });
    } else {
      gt.hidden = false;
      window.Gantt.render(byId('gantt-render'), state.model, { onEditTask: openEditModal },
        { colorForTask, centerOnToday: state.centerGanttNext });
      state.centerGanttNext = false;
    }
  }

  // ---- global view ------------------------------------------------------
  async function enterGlobal() {
    state.mode = 'global';
    // Load + parse the projects in the active profile fresh ("All projects"
    // keeps everything, since inActiveProfile is then true for all). Folders are
    // refreshed too so closing a workspace from global view drops it from the
    // sidebar.
    const [list, folders] = await Promise.all([
      window.projects.list(),
      window.projects.listFolders(),
    ]);
    state.projects = list;
    state.folders = folders;
    updateNewTaskBtn();
    state.global = [];
    for (const p of list.filter(inActiveProfile)) {
      const md = await window.projects.read(p.file);
      const model = P.parseGantt(P.extractMermaidBlock(md).code);
      state.global.push({
        file: p.file,
        title: p.title,
        color: window.Palette.colorFor({ color: window.Palette.readColor(md), title: p.title, file: p.file }),
        model,
      });
    }

    // Rebuild the sidebar from the freshly loaded set so deleting a project or
    // closing a workspace while in global view updates it too. In global mode
    // renderProjectList marks no project active, so this also clears any prior
    // project-mode selection highlight.
    renderProjectList();
    byId('global-view-btn').classList.add('active');
    byId('view-toggle').hidden = false;
    byId('empty-state').hidden = true;
    byId('kanban').hidden = true;
    byId('team').hidden = true;
    byId('gantt').hidden = true;
    byId('global').hidden = false;
    localStorage.setItem('lastMode', 'global'); // restored on next launch
    if (state.view === 'gantt') state.centerGanttNext = true;
    renderGlobalView();
  }

  function renderGlobalView() {
    updateViewToggleButtons();
    state.built = window.GlobalView.build(state.global);
    updateTeamToggle(state.built.kanbanModel.tasks);
    const gk = byId('global-kanban');
    const gg = byId('global-gantt');
    const gtm = byId('global-team');
    gk.hidden = gg.hidden = gtm.hidden = true;
    if (state.view === 'kanban') {
      gk.hidden = false;
      window.Kanban.render(gk, state.built.kanbanModel, {
        onEditTask: openGlobalKanbanTask,
        onMoveTask: globalMoveTask,
        onAddTask: () => {},
      }, {
        colorForTask: state.built.colorForKanban,
        projectLabel: state.built.projectLabel,
        readOnlyAdd: true,
      });
    } else if (state.view === 'team') {
      gtm.hidden = false;
      teamRender(gtm, state.built.kanbanModel.tasks, {
        onEditTask: openGlobalKanbanTask,
        onReassign: globalReassign,
        onSetStatus: globalMoveTask,
        onAddTaskFor: addTaskGlobalForAssignee,
        onDeleteMember: deleteMemberFromView,
      }, {
        colorForTask: state.built.colorForKanban,
        projectLabel: state.built.projectLabel,
        roster: state.team,
      });
    } else {
      gg.hidden = false;
      window.Gantt.render(byId('global-gantt-render'), state.built.ganttModel, {
        onEditTask: openGlobalGanttTask,
      }, { colorForTask: state.built.colorForGantt, centerOnToday: state.centerGanttNext });
      state.centerGanttNext = false;
    }
  }

  // Edit a global card/bar in place: open the task editor against its source
  // project's model and write back to that project's own file, without leaving
  // the global view.
  function openGlobalKanbanTask(gid) {
    openGlobalTaskEditor(state.built.kInfo.get(gid));
  }
  function openGlobalGanttTask(nsid) {
    openGlobalTaskEditor(state.built.gInfo.get(nsid));
  }
  function openGlobalTaskEditor(info) {
    if (!info) return;
    const proj = state.global.find((p) => p.file === info.file);
    if (!proj) return;
    openEditModal(info.origId, proj.model, async () => {
      const md = await window.projects.read(info.file);
      await window.projects.write(info.file, P.writeBackToMarkdown(md, proj.model));
    }, info.file);
  }

  // Drag a card across status columns in the global Kanban: write back to the
  // task's own project file, then refresh just that project's model.
  async function globalMoveTask(gid, status) {
    const info = state.built.kInfo.get(gid);
    if (!info) return;
    const proj = state.global.find((p) => p.file === info.file);
    const t = proj && proj.model.tasks.find((x) => x.id === info.origId);
    if (!t || t.status === status) return;
    t.status = status;
    const md = await window.projects.read(info.file);
    const newMd = P.writeBackToMarkdown(md, proj.model);
    await window.projects.write(info.file, newMd);
    renderGlobalView();
  }

  async function saveModel() {
    state.rawMd = P.writeBackToMarkdown(state.rawMd, state.model);
    await window.projects.write(state.currentFile, state.rawMd);
  }

  async function moveTask(id, status) {
    const t = state.model.tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    t.status = status;
    await saveModel();
    renderCurrentView();
  }

  // Reassign a task (Team view drag-and-drop) within the current project.
  async function reassignTask(id, assignee) {
    const t = state.model.tasks.find((x) => x.id === id);
    if (!t || (t.assignee || '') === assignee) return;
    t.assignee = assignee;
    rememberAssignee(assignee);
    await saveModel();
    renderCurrentView();
  }

  // Reassign a task in the global Team view: write back to its own file.
  async function globalReassign(gid, assignee) {
    const info = state.built.kInfo.get(gid);
    if (!info) return;
    const proj = state.global.find((p) => p.file === info.file);
    const t = proj && proj.model.tasks.find((x) => x.id === info.origId);
    if (!t || (t.assignee || '') === assignee) return;
    t.assignee = assignee;
    rememberAssignee(assignee);
    const md = await window.projects.read(info.file);
    await window.projects.write(info.file, P.writeBackToMarkdown(md, proj.model));
    renderGlobalView();
  }

  // ---- team-view column actions (the "⋮" menu) -------------------------
  // Add a task to a person in the global Team view. The task editor's own
  // Project dropdown chooses the destination project (defaulting to the only one
  // when there's a single project), so no separate pre-pick menu is needed.
  function addTaskGlobalForAssignee(assignee) {
    if (!state.global.length) return;
    openNewModal('todo', assignee, state.global.length === 1 ? state.global[0].file : '');
  }

  // Delete a team member from the Team view: unassign their tasks within the
  // current scope (the active profile, or every project in the global view) and
  // drop them from that scope's roster.
  async function deleteMemberFromView(name) {
    const scope = state.mode === 'global' ? '' : state.activeProfile;
    const counts = await countByAssignee(scope);
    const count = counts.get(name) || 0;
    const where = scope ? ` ${scope}` : '';
    const msg = count
      ? `Delete “${name}” from the${where} team? Their ${count} task${count === 1 ? '' : 's'} will become unassigned.`
      : `Delete “${name}” from the${where} team?`;
    if (!window.confirm(msg)) return;
    if (count) {
      await applyAcrossProjects((t) => {
        if (t.assignee === name) { t.assignee = ''; return true; }
        return false;
      }, scope);
    }
    setSavedRosterFor(scope, savedRosterFor(scope).filter((n) => n !== name));
    // Intentional delete is immediate: skip the run-out-of-tasks grace period
    // and cancel any grace already running for this name.
    teamExplicitRemove.add(name);
    if (teamLinger.has(name)) { clearTimeout(teamLinger.get(name)); teamLinger.delete(name); }
    await refreshAfterTeamChange();
  }

  // ---- task editor modal ------------------------------------------------
  const modal = byId('modal-backdrop');
  byId('f-cancel').addEventListener('click', closeModal);
  byId('f-delete').addEventListener('click', onDeleteTask);
  byId('task-form').addEventListener('submit', onSaveTask);
  window.DatePicker.attach(byId('f-start')); // app-themed calendar popup
  window.DatePicker.attach(byId('f-beforedate')); // "Before a date" deadline field
  byId('f-start-mode').addEventListener('change', syncStartMode);
  // New task: re-point the editor at the chosen project. Editing: the dropdown is
  // just a move destination, read at save time — don't repoint off the source.
  byId('f-project').addEventListener('change', (e) => {
    if (!state.editingId) applyTaskTarget(e.target.value);
  });
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  // The editor's Assignee dropdown is fed by the app-wide team roster
  // (everyone assigned in any project), plus any name on the model being
  // edited that isn't in the roster yet.
  function populateAssigneeList() {
    const dl = byId('assignee-list');
    dl.innerHTML = '';
    const seen = new Set();
    const add = (name) => {
      const a = (name || '').trim();
      if (!a || seen.has(a)) return;
      seen.add(a);
      const opt = document.createElement('option');
      opt.value = a;
      dl.appendChild(opt);
    };
    state.team.forEach(add);
    if (state.editModel) state.editModel.tasks.forEach((t) => add(t.assignee));
  }

  // Show the date picker or the "starts after another task" typeahead depending
  // on the scheduling mode chosen in the editor's "Starts" dropdown.
  function syncStartMode() {
    const mode = byId('f-start-mode').value;
    byId('f-start-date-row').hidden = mode !== 'date';
    byId('f-start-after-row').hidden = mode !== 'after';
    byId('f-start-before-row').hidden = mode !== 'before';
    byId('f-start-beforedate-row').hidden = mode !== 'before-date';
  }

  // Fill the "Starts after" typeahead with the other tasks in the model being
  // edited (a task can't depend on itself) and build a name->id lookup so the
  // typed name can be turned back into an "after <id>" dependency on save.
  function populateAfterList() {
    const dl = byId('after-list');
    const dlBefore = byId('before-list');
    dl.innerHTML = '';
    dlBefore.innerHTML = '';
    state.afterNameToId = new Map();
    const tasks = state.editModel ? state.editModel.tasks : [];
    for (const t of tasks) {
      if (t.id === state.editingId) continue;
      const name = (t.name || '').trim();
      if (!name || state.afterNameToId.has(name)) continue;
      state.afterNameToId.set(name, t.id);
      // The "before" typeahead offers the same predecessor candidates and reuses
      // the same name->id lookup (afterNameToId) when resolving on save.
      for (const list of [dl, dlBefore]) {
        const opt = document.createElement('option');
        opt.value = name;
        list.appendChild(opt);
      }
    }
  }

  // Display name of the first task an "after <ids>" start refers to, used to
  // prefill the typeahead when editing a dependency.
  function afterDisplayName(start, model) {
    const m = /^after\s+(.+)$/i.exec(String(start || '').trim());
    if (!m || !model) return '';
    const firstId = m[1].split(/\s+/).filter(Boolean)[0];
    const ref = model.tasks.find((t) => t.id === firstId);
    return ref ? (ref.name || '') : '';
  }

  // Resolve the editor's scheduling fields into a Mermaid start token: an ISO
  // date, or "after <id>" when the user picked a predecessor task.
  function readStartValue() {
    if (byId('f-start-mode').value === 'after') {
      const typed = byId('f-after').value.trim();
      const orig = byId('f-after').dataset.orig || '';
      const origName = byId('f-after').dataset.origName || '';
      // Untouched field keeps the exact original, preserving a multi-task
      // "after a b" that the single-select typeahead can't represent.
      if (typed && typed === origName && orig) return orig;
      const id = state.afterNameToId && state.afterNameToId.get(typed);
      if (id) return `after ${id}`;
      // No matching task chosen — fall back to a concrete date rather than write
      // a dangling dependency.
      return P.todayISO();
    }
    return byId('f-start').value.trim() || P.todayISO();
  }

  // "Before another task": place the new task so it finishes exactly when the
  // chosen target starts (start = target.start − duration). Mermaid gantt has no
  // native "before", so we resolve the target's start with the shared scheduler
  // and store a concrete ISO date. Falls back to today when no/unknown target is
  // chosen (mirrors the "after" guard) so we never write a dangling reference.
  function readBeforeStart(durDays) {
    const typed = byId('f-before').value.trim();
    const id = state.afterNameToId && state.afterNameToId.get(typed);
    if (!id) return P.todayISO();
    const { startMs } = P.resolveSchedule(state.editModel);
    const tgt = startMs.get(id);
    if (tgt == null) return P.todayISO();
    return P.addDays(P.toISO(new Date(tgt)), -Math.max(0, durDays));
  }

  // "Before a date": the task finishes on the chosen date and starts its duration
  // earlier (start = date − duration), so it reads as a deadline. Stored as a
  // concrete ISO date; falls back to today when no valid date is entered.
  function readBeforeDateStart(durDays) {
    const d = byId('f-beforedate').value.trim();
    if (!P.DATE_RE.test(d)) return P.todayISO();
    return P.addDays(d, -Math.max(0, durDays));
  }

  // Rosters are scoped to a profile so the user can keep a separate "Household"
  // team and "Work" team. Persisted as { profileName: [names] } under
  // 'teamRosters'; the '' bucket is the shared / All-projects roster. The saved
  // roster holds manually-added members (who may have zero tasks); it's merged
  // with whoever is actually assigned in the relevant projects to form a view.
  function rosterStore() {
    try {
      const v = JSON.parse(localStorage.getItem('teamRosters') || '{}');
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch { return {}; }
  }
  function savedRosterFor(profile) {
    const arr = rosterStore()[profile || ''];
    return Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];
  }
  function setSavedRosterFor(profile, names) {
    const store = rosterStore();
    store[profile || ''] = [...new Set(names.map((s) => String(s).trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    localStorage.setItem('teamRosters', JSON.stringify(store));
  }
  // Move a profile's saved roster to its new name when the profile is renamed.
  function renameRosterBucket(oldName, newName) {
    const store = rosterStore();
    if (store[oldName] === undefined) return;
    const merged = [...new Set([...(store[newName] || []), ...store[oldName]])];
    store[newName] = merged;
    delete store[oldName];
    localStorage.setItem('teamRosters', JSON.stringify(store));
  }
  // Forget a profile's saved roster when the profile is deleted.
  function dropRosterBucket(name) {
    const store = rosterStore();
    if (store[name] === undefined) return;
    delete store[name];
    localStorage.setItem('teamRosters', JSON.stringify(store));
  }

  // One-time migration of the old flat 'teamRoster' into the shared bucket so
  // existing members aren't lost when rosters became per-profile.
  function migrateRoster() {
    if (localStorage.getItem('teamRosters')) return;
    let old = [];
    try { old = JSON.parse(localStorage.getItem('teamRoster') || '[]'); } catch { /* ignore */ }
    const store = {};
    if (Array.isArray(old) && old.length) store[''] = old.map((s) => String(s).trim()).filter(Boolean);
    localStorage.setItem('teamRosters', JSON.stringify(store));
  }

  // Does project p belong to `profile`? (Untagged projects appear in every
  // profile, mirroring inActiveProfile.) profile '' = every project.
  function inProfile(p, profile) {
    if (!profile) return true;
    return !p.profile || p.profile === profile;
  }

  // Merge a profile's saved roster with everyone assigned in the projects that
  // belong to it. profile '' = the union across every saved bucket + all
  // assignees, which is what the "All projects" / global Team view shows.
  async function computeTeamFor(profile) {
    const set = new Set();
    if (profile) {
      savedRosterFor(profile).forEach((n) => set.add(n));
    } else {
      const store = rosterStore();
      for (const arr of Object.values(store)) (arr || []).forEach((n) => set.add(String(n).trim()));
    }
    for (const p of state.projects) {
      if (!inProfile(p, profile)) continue;
      try {
        const md = await window.projects.read(p.file);
        const m = P.parseGantt(P.extractMermaidBlock(md).code);
        for (const t of m.tasks) if (t.assignee) set.add(t.assignee.trim());
      } catch { /* unreadable file — skip */ }
    }
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  // Refresh the live roster used by the Team view + assignee datalist for the
  // currently active profile.
  async function loadTeam() {
    state.team = await computeTeamFor(state.activeProfile);
  }

  // Add a name to the active profile's roster so it's offered going forward.
  function rememberAssignee(name) {
    const a = (name || '').trim();
    if (!a) return;
    const names = savedRosterFor(state.activeProfile);
    if (!names.includes(a)) setSavedRosterFor(state.activeProfile, [...names, a]);
    if (!state.team.includes(a)) {
      state.team.push(a);
      state.team.sort((x, y) => x.localeCompare(y));
    }
  }

  // ---- settings (profiles + team) --------------------------------------
  const settingsBackdrop = byId('settings-backdrop');
  const settingsBody = byId('settings-body');
  byId('settings-done').addEventListener('click', closeSettings);
  byId('team-add').addEventListener('click', addMember);
  byId('profile-add').addEventListener('click', addProfile);
  byId('team-edit-profile').addEventListener('change', (e) => {
    state.teamEditProfile = e.target.value;
    renderTeamMembers();
  });
  byId('clear-all').addEventListener('click', clearAll);
  settingsBackdrop.addEventListener('mousedown', (e) => { if (e.target === settingsBackdrop) closeSettings(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsBackdrop.hidden) closeSettings();
  });
  // Re-cap the modal if the window is resized while settings is open.
  window.addEventListener('resize', fitSettingsHeight);

  // Cap the settings panel to the window so its middle region (#settings-scroll)
  // scrolls instead of the panel spilling past the top and bottom edges.
  // innerHeight is device px; style lengths are layout px the browser then
  // multiplies by `zoom`, so divide by it — the same correction the context menu
  // and calendar popup use. (A CSS `vh` cap can't: zoom inflates it.)
  function fitSettingsHeight() {
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    settingsBody.style.maxHeight = (window.innerHeight - 40) / zoom + 'px';
  }

  // Human label for the team (profile) whose roster is being edited. Only used
  // while a profile is selected, so it's always the profile's own name now.
  function teamScopeLabel() { return state.teamEditProfile; }

  function openSettings() {
    // Team rosters are per-profile, so default the editor to the active profile,
    // else the first profile (there's nothing to manage until a profile exists).
    state.teamEditProfile = (state.activeProfile && state.profiles.includes(state.activeProfile))
      ? state.activeProfile : (state.profiles[0] || '');
    renderProfiles();
    populateTeamEditProfile();
    renderTeamMembers();
    settingsBackdrop.hidden = false;
    fitSettingsHeight();
  }
  function closeSettings() {
    settingsBackdrop.hidden = true;
  }

  // Wipe the app back to a clean slate: forget every linked workspace (the
  // project .md files themselves stay on disk) and clear all stored state
  // (profiles, per-profile rosters, active profile, collapsed folders), then
  // reload. Guarded by two confirmations whose buttons swap sides on the second
  // so muscle-memory can't blow straight through it.
  async function clearAll() {
    const ok1 = await confirmDialog('Hold on, are you sure?', {
      okLabel: 'Reset everything', cancelLabel: 'Cancel', danger: true,
    });
    if (!ok1) return;
    const ok2 = await confirmDialog('Okay, I understand, but please just confirm that you are sure.', {
      okLabel: 'Yes, reset the app', cancelLabel: 'Cancel', danger: true, swap: true,
    });
    if (!ok2) return;

    for (const f of state.folders.slice()) {
      try { await window.projects.removeWorkspace(f.path); } catch { /* ignore */ }
    }
    try { localStorage.clear(); } catch { /* ignore */ }
    location.reload();
  }

  // Fill the "editing which team" selector with every profile. Rosters are
  // per-profile only — there's no shared/all-profiles bucket to manage — so if
  // the current pick is gone (deleted) or unset, fall back to the first profile.
  function populateTeamEditProfile() {
    const sel = byId('team-edit-profile');
    sel.innerHTML = '';
    if (!state.profiles.includes(state.teamEditProfile)) {
      state.teamEditProfile = state.profiles[0] || '';
    }
    const opt = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      if (value === state.teamEditProfile) o.selected = true;
      sel.appendChild(o);
    };
    for (const name of state.profiles) opt(name, name);
  }

  async function renderTeamMembers() {
    const wrap = byId('team-members');
    // Rosters are per-profile; with no profile to target there's nothing to
    // manage, so steer the user to create one first and disable "Add member".
    if (!state.teamEditProfile) {
      byId('team-add').disabled = true;
      const e = document.createElement('div');
      e.className = 'tm-empty';
      e.textContent = 'Add a profile first, then pick it here to manage its team.';
      wrap.replaceChildren(e);
      return;
    }
    byId('team-add').disabled = false;
    // Compute first, then swap in one go: clearing the list up front would leave
    // it empty across the (IPC-backed) awaits, and the browser would paint that
    // collapsed frame — making the natural-height dialog blink as it shrinks and
    // re-expands when switching profiles.
    const members = await computeTeamFor(state.teamEditProfile);
    const frag = document.createDocumentFragment();
    if (!members.length) {
      const e = document.createElement('div');
      e.className = 'tm-empty';
      e.textContent = `No members in the ${teamScopeLabel()} team yet. Add someone below.`;
      frag.appendChild(e);
      wrap.replaceChildren(frag);
      return;
    }
    const counts = await countByAssignee(state.teamEditProfile);
    for (const name of members) {
      const n = counts.get(name) || 0;
      const row = document.createElement('div');
      row.className = 'tm-row';
      row.innerHTML =
        `<span class="tm-name"></span>` +
        `<span class="tm-count">${n} task${n === 1 ? '' : 's'}</span>` +
        `<button class="tm-menu" title="Actions" aria-label="Actions">⋮</button>`;
      row.querySelector('.tm-name').textContent = name;
      row.querySelector('.tm-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Rename', onClick: () => renameMember(name) },
          { separator: true },
          { label: 'Remove', danger: true, onClick: () => removeMember(name, n) },
        ]);
      });
      frag.appendChild(row);
    }
    wrap.replaceChildren(frag);
  }

  async function addMember() {
    const name = await promptText(`Add to the ${teamScopeLabel()} team`, '', 'Add');
    if (name === null) return;
    const a = name.trim();
    if (!a) return;
    const names = savedRosterFor(state.teamEditProfile);
    if (!names.includes(a)) setSavedRosterFor(state.teamEditProfile, [...names, a]);
    await refreshAfterTeamChange();
  }

  async function renameMember(oldName) {
    const next = await promptText('Rename member', oldName, 'Rename');
    if (next === null) return;
    const newName = next.trim();
    if (!newName || newName === oldName) return;
    // Reassign every matching task in the edited profile's projects.
    await applyAcrossProjects((t) => {
      if (t.assignee === oldName) { t.assignee = newName; return true; }
      return false;
    }, state.teamEditProfile);
    const names = savedRosterFor(state.teamEditProfile).filter((n) => n !== oldName);
    if (!names.includes(newName)) names.push(newName);
    setSavedRosterFor(state.teamEditProfile, names);
    await refreshAfterTeamChange();
  }

  async function removeMember(name, count) {
    const where = state.teamEditProfile ? ` ${state.teamEditProfile}` : '';
    const msg = count
      ? `Remove “${name}” from the${where} team? Their ${count} task${count === 1 ? '' : 's'} will become unassigned.`
      : `Remove “${name}” from the${where} team?`;
    if (!window.confirm(msg)) return;
    if (count) {
      await applyAcrossProjects((t) => {
        if (t.assignee === name) { t.assignee = ''; return true; }
        return false;
      }, state.teamEditProfile);
    }
    setSavedRosterFor(state.teamEditProfile, savedRosterFor(state.teamEditProfile).filter((n) => n !== name));
    await refreshAfterTeamChange();
  }

  // Count tasks per assignee within a profile's projects (for the manage panel).
  async function countByAssignee(profile) {
    const counts = new Map();
    for (const p of state.projects) {
      if (!inProfile(p, profile)) continue;
      try {
        const md = await window.projects.read(p.file);
        const m = P.parseGantt(P.extractMermaidBlock(md).code);
        for (const t of m.tasks) {
          if (!t.assignee) continue;
          counts.set(t.assignee, (counts.get(t.assignee) || 0) + 1);
        }
      } catch { /* skip */ }
    }
    return counts;
  }

  // Apply a task mutation to every project file in a profile's scope, saving
  // only those that change. mutate(task) -> true if it modified the task.
  // profile '' = every project.
  async function applyAcrossProjects(mutate, profile) {
    for (const p of state.projects) {
      if (!inProfile(p, profile)) continue;
      let md;
      try { md = await window.projects.read(p.file); } catch { continue; }
      const m = P.parseGantt(P.extractMermaidBlock(md).code);
      let changed = false;
      for (const t of m.tasks) if (mutate(t)) changed = true;
      if (changed) await window.projects.write(p.file, P.writeBackToMarkdown(md, m));
    }
  }

  // Reload in-memory models + the live roster after team changes touched files,
  // then refresh the open view and (if open) the Settings panel.
  async function refreshAfterTeamChange() {
    await loadTeam();
    if (state.mode === 'global') await enterGlobal();
    else if (state.currentFile) await selectProject(state.currentFile);
    else rerender();
    if (!settingsBackdrop.hidden) {
      populateTeamEditProfile();
      renderTeamMembers();
    }
  }

  // model/save default to the current single-project context; the global view
  // passes its source project's model + a file-specific writer instead.
  function openEditModal(id, model, save, file) {
    state.editModel = model || state.model;
    state.editSave = save || saveModel;
    const t = state.editModel.tasks.find((x) => x.id === id);
    if (!t) return;
    state.editingId = id;
    state.editSourceFile = file || state.currentFile; // the file this task lives in
    byId('modal-title').textContent = 'Edit task';
    byId('f-delete').hidden = false;
    // Show the destination picker (defaulting to the task's own project) so the
    // task can be moved elsewhere. editModel/editSave stay pointed at the source;
    // a changed selection triggers a cross-file move on save (see onSaveTask).
    byId('f-project-row').hidden = false;
    populateProjectSelect(state.editSourceFile);
    byId('f-save').disabled = false;
    populateAssigneeList();
    populateAfterList();

    byId('f-name').value = t.name || '';
    byId('f-assignee').value = t.assignee || '';
    const isAfter = /^after\s+/i.test(t.start || '');
    byId('f-start-mode').value = isAfter ? 'after' : 'date';
    byId('f-start').value = P.DATE_RE.test(t.start || '') ? t.start : '';
    byId('f-start').dataset.orig = t.start || '';
    const afterName = isAfter ? afterDisplayName(t.start, state.editModel) : '';
    byId('f-after').value = afterName;
    byId('f-after').dataset.orig = isAfter ? (t.start || '') : '';
    byId('f-after').dataset.origName = afterName;
    byId('f-before').value = '';
    byId('f-beforedate').value = '';
    syncStartMode();
    byId('f-duration').value = Math.max(0, Math.round(P.parseDurationDays(t.duration)));
    byId('f-status').value = t.status;
    byId('f-crit').checked = !!t.crit;
    byId('f-milestone').checked = !!t.milestone;

    showModal();
  }

  // status/assignee prefill the new task. The task's destination project is
  // chosen in the dialog's Project dropdown: it defaults to `presetFile` when
  // given, else the open project (blank in Global view), and `applyTaskTarget`
  // wires up the model + writer for whichever project is selected.
  function openNewModal(status, assignee, presetFile) {
    state.editingId = null;
    state.newStatus = status || 'todo';
    byId('modal-title').textContent = 'New task';
    byId('f-delete').hidden = true;

    byId('f-project-row').hidden = false;
    const dflt = (presetFile !== undefined ? presetFile
      : (state.mode === 'project' ? state.currentFile : '')) || '';
    populateProjectSelect(dflt);
    applyTaskTarget(dflt); // sets editModel/editSave + populates assignee/after lists

    byId('f-name').value = '';
    byId('f-assignee').value = assignee || '';
    byId('f-start-mode').value = 'date';
    byId('f-start').value = P.todayISO();
    byId('f-start').dataset.orig = '';
    byId('f-after').value = '';
    byId('f-after').dataset.orig = '';
    byId('f-after').dataset.origName = '';
    byId('f-before').value = '';
    byId('f-beforedate').value = '';
    syncStartMode();
    byId('f-duration').value = 3;
    byId('f-status').value = status || 'todo';
    byId('f-crit').checked = false;
    byId('f-milestone').checked = false;

    showModal();
  }

  // Fill the destination dropdown with every project, grouped by workspace, and
  // select `selectedFile` (a blank "Choose a project…" entry stays selectable so
  // the dialog can open with nothing chosen from the Global view).
  function populateProjectSelect(selectedFile) {
    const sel = byId('f-project');
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Choose a project…';
    sel.appendChild(ph);
    const grouped = new Set();
    for (const folder of state.folders) {
      const inFolder = state.projects.filter((p) => p.folderPath === folder.path);
      if (!inFolder.length) continue;
      grouped.add(folder.path);
      const og = document.createElement('optgroup');
      og.label = folder.name;
      for (const p of inFolder) {
        const o = document.createElement('option');
        o.value = p.file;
        o.textContent = p.title;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    // Defensive: any project not under a listed workspace, flat at the end.
    for (const p of state.projects) {
      if (grouped.has(p.folderPath)) continue;
      const o = document.createElement('option');
      o.value = p.file;
      o.textContent = p.title;
      sel.appendChild(o);
    }
    sel.value = selectedFile || '';
  }

  // Point the editor at the chosen destination project: set the model it edits
  // and the writer that persists it, then refresh the assignee + "after" lists so
  // they reflect that project. Save stays disabled until a project is picked.
  async function applyTaskTarget(file) {
    const saveBtn = byId('f-save');
    if (!file) {
      state.editModel = { tasks: [] };
      state.editSave = null;
      saveBtn.disabled = true;
      populateAssigneeList();
      populateAfterList();
      return;
    }
    saveBtn.disabled = false;
    const target = await resolveTarget(file, { navigate: true });
    state.editModel = target.model;
    state.editSave = target.save;
    populateAssigneeList();
    populateAfterList();
  }

  // Resolve a destination project file to the model to edit and a writer that
  // persists it. Three cases: the project already on screen (reuse its live model
  // + writer), one already loaded in the global view (edit its model, write its
  // file), or one not in memory (parse it fresh). When `navigate` is set, a
  // not-in-memory project is opened after the write so the user lands on it — used
  // when adding a new task, but NOT when moving (the user stays put).
  async function resolveTarget(file, { navigate = false } = {}) {
    if (state.mode === 'project' && file === state.currentFile && state.model) {
      return { model: state.model, save: saveModel };
    }
    const g = state.global.find((p) => p.file === file);
    if (g) {
      return {
        model: g.model,
        save: async () => {
          const md = await window.projects.read(file);
          await window.projects.write(file, P.writeBackToMarkdown(md, g.model));
        },
      };
    }
    const md = await window.projects.read(file);
    const m = P.parseGantt(P.extractMermaidBlock(md).code);
    return {
      model: m,
      save: async () => {
        const cur = await window.projects.read(file);
        await window.projects.write(file, P.writeBackToMarkdown(cur, m));
        if (navigate) await loadProjects(file);
      },
    };
  }

  function showModal() {
    modal.hidden = false;
    setTimeout(() => byId('f-name').focus(), 0);
  }
  function closeModal() {
    modal.hidden = true;
    state.editingId = null;
  }

  async function onSaveTask(e) {
    e.preventDefault();
    const name = byId('f-name').value.trim();
    if (!name) return;
    // New tasks need a destination project (the picker is hidden when editing).
    if (!state.editingId && (!state.editSave || !state.editModel)) return;

    const assignee = byId('f-assignee').value.trim(); // '' = unassigned
    // A name not already on the active profile's roster would silently become a
    // new team member — guard against a typo spawning a phantom person.
    if (assignee && !state.team.includes(assignee)) {
      const ok = await confirmDialog(
        `“${assignee}” isn’t on the team yet. Add them as a new team member for this task?`,
        { okLabel: 'Add member', cancelLabel: 'Cancel' });
      if (!ok) return;          // leave the modal open so the name can be fixed
    }
    rememberAssignee(assignee);
    const milestone = byId('f-milestone').checked;
    const durDays = Math.max(0, parseInt(byId('f-duration').value, 10) || 0);

    // "On a date" -> ISO date; "After another task" -> "after <id>"; "Before
    // another task" -> ISO date computed back from the target's start; "Before a
    // date" -> ISO date computed back from the chosen deadline.
    const startMode = byId('f-start-mode').value;
    const start = startMode === 'before' ? readBeforeStart(milestone ? 0 : durDays)
      : startMode === 'before-date' ? readBeforeDateStart(milestone ? 0 : durDays)
      : readStartValue();

    const duration = milestone ? '0d' : `${durDays || 1}d`;
    const status = byId('f-status').value;
    const crit = byId('f-crit').checked;

    if (state.editingId) {
      const t = state.editModel.tasks.find((x) => x.id === state.editingId);
      if (!t) { closeModal(); return; }
      const dest = byId('f-project').value;
      if (dest && dest !== state.editSourceFile) {
        // Move to another project: drop the task from its source file, then add
        // it to the destination file. We stay on the current view (the user's
        // choice), so the task simply vanishes from here.
        const i = state.editModel.tasks.indexOf(t);
        if (i !== -1) state.editModel.tasks.splice(i, 1);
        await state.editSave();

        const target = await resolveTarget(dest);
        // An "after <id>" start references a task in the old project that won't
        // exist here — fall back to a concrete date so the new chart stays valid.
        const movedStart = /^after\s+/i.test(start) ? P.todayISO() : start;
        target.model.tasks.push({
          name, assignee, id: freshId(target.model),
          status, crit, milestone, start: movedStart, duration,
        });
        await target.save();
        closeModal();
        rerender();
        return;
      }
      // Edit in place.
      t.name = name;
      t.assignee = assignee;
      t.start = start;
      t.duration = duration;
      t.status = status;
      t.crit = crit;
      t.milestone = milestone;
    } else {
      state.editModel.tasks.push({
        name, assignee, id: nextId(), status, crit, milestone, start, duration,
      });
    }

    await state.editSave();
    closeModal();
    rerender();
  }

  async function onDeleteTask() {
    if (!state.editingId) return;
    const i = state.editModel.tasks.findIndex((x) => x.id === state.editingId);
    if (i !== -1) state.editModel.tasks.splice(i, 1);
    await state.editSave();
    closeModal();
    rerender();
  }

  // Re-render whichever view is live after a task edit (project or global).
  function rerender() {
    if (state.mode === 'global') renderGlobalView();
    else renderCurrentView();
  }

  // Smallest unused tNN id within a given model's task list.
  function freshId(model) {
    const used = new Set(model.tasks.map((t) => t.id));
    let i = 1;
    let id;
    do { id = `t${i++}`; } while (used.has(id));
    return id;
  }
  function nextId() { return freshId(state.editModel); }

  // ---- new project / workspaces ----------------------------------------
  // Create a project in a workspace. If `folder` is given (folder's "+" or its
  // context menu) we use it; otherwise the user picks among open workspaces.
  // The dialog lets the user name the project and choose its profile (defaulting
  // to the active one).
  async function onNewProject(folder) {
    // A folder's own "+" (or its context menu) targets that workspace directly.
    // The top "+" always lets the user choose the workspace for this project —
    // including opening a brand-new one on the spot, even when none exist yet.
    const dir = folder ? folder.path : await pickWorkspace();
    if (!dir) return;
    const res = await promptNewProject('Untitled Project', state.activeProfile || '');
    if (res === null) return;
    const file = await window.projects.create(res.title.trim() || 'Untitled Project', dir, res.profile || '');
    collapsed.delete(dir); // make sure the new project is visible
    await loadProjects(file);
  }

  // ---- import / duplicate with date-shift ------------------------------
  // Whole-day signed distance between two ISO dates. Used to turn a chosen
  // anchor date into the uniform offset applied across the project.
  function daysBetween(aISO, bISO) {
    return Math.round((Date.parse(bISO + 'T00:00:00') - Date.parse(aISO + 'T00:00:00')) / 86400000);
  }

  // Create a new project in destDir from sourceMd, re-based on a user-chosen
  // anchor (project start, project end, or a specific task pinned to a date):
  // every absolute task date moves by the same offset (durations and relative
  // "after" gaps preserved), all tasks become unassigned and reset to To Do,
  // and it's tagged with the active profile. Used by both import and duplicate.
  async function importProjectInto(destDir, sourceMd, defaultTitle, titleText) {
    const model = P.parseGantt(P.extractMermaidBlock(sourceMd).code);
    if (!model.tasks.length) { window.alert('That file has no tasks to import.'); return; }

    const res = await promptReschedule(model, defaultTitle, titleText);
    if (res === null) return;
    const title = res.title.trim() || defaultTitle;
    const offset = res.offset;

    for (const t of model.tasks) {
      // Shift absolute dates; durations and "after <id>" gaps ride along
      // unchanged. A task may encode its end as a date in place of a duration —
      // shift that too so its length is preserved.
      if (t.start && P.DATE_RE.test(t.start)) t.start = P.addDays(t.start, offset);
      if (t.duration && P.DATE_RE.test(t.duration)) t.duration = P.addDays(t.duration, offset);
      t.assignee = '';     // imported tasks start unassigned
      t.status = 'todo';   // …and not yet started
    }
    model.title = title;
    model.profile = state.activeProfile || '';
    model.color = window.Palette.readColor(sourceMd) || ''; // carried in-block

    const md = `# ${title}\n\n\`\`\`mermaid\n${P.serializeGantt(model)}\n\`\`\`\n`;

    // create reserves a unique filename + validates the dir; then we overwrite
    // its starter template with the shifted project.
    const file = await window.projects.create(title, destDir, model.profile);
    await window.projects.write(file, md);
    collapsed.delete(destDir);
    await loadProjects(file);
  }

  async function importIntoFolder(folder) {
    const picked = await window.projects.pickImport();
    if (!picked) return;
    await importProjectInto(folder.path, picked.content, picked.name || 'Imported Project', 'Import as…');
  }

  async function duplicateProject(p) {
    const md = await window.projects.read(p.file);
    await importProjectInto(p.folderPath, md, `${p.title} (copy)`, 'Duplicate with new dates…');
  }

  // Choose the workspace for a new project, anchored to the new-project button:
  // every open workspace, plus "New workspace…" to open a fresh folder on the
  // spot. Resolves to the chosen directory path, or null if dismissed.
  function pickWorkspace() {
    return new Promise((resolve) => {
      const r = byId('new-project').getBoundingClientRect();
      let done = false;
      let chosen = false; // an item was clicked, so closing isn't a cancel
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const items = [{ header: 'Create project in…' }];
      for (const f of state.folders) {
        items.push({ label: f.name, onClick: () => { chosen = true; finish(f.path); } });
      }
      if (state.folders.length) items.push({ separator: true });
      items.push({
        label: 'New workspace…',
        onClick: async () => {
          chosen = true; // set before the await so the dismiss-watcher sees it
          const folder = await window.projects.addWorkspace();
          finish(folder ? folder.path : null);
        },
      });
      showContextMenu(r.left, r.bottom + 4, items);
      // If the menu is dismissed without a choice, resolve null on next tick.
      // The `chosen` guard stops this firing when "New workspace…" closes the
      // menu before its OS folder picker has resolved.
      setTimeout(() => {
        const obs = new MutationObserver(() => {
          if (!byId('context-menu')) { obs.disconnect(); if (!chosen) finish(null); }
        });
        obs.observe(document.body, { childList: true });
      }, 0);
    });
  }

  // "Open workspace" — link an existing folder on disk.
  async function openWorkspace() {
    const folder = await window.projects.addWorkspace();
    if (!folder) return;
    collapsed.delete(folder.path);
    if (state.mode === 'global') return enterGlobal();
    await loadProjects();
  }

  // Remove a workspace from the sidebar; the files stay on disk.
  async function removeWorkspace(folder) {
    if (!window.confirm(`Close workspace “${folder.name}”?\nThe folder and its files stay on disk.`)) return;
    await window.projects.removeWorkspace(folder.path);
    collapsed.delete(folder.path);
    saveCollapsed();
    const cur = state.projects.find((p) => p.file === state.currentFile);
    if (cur && cur.folderPath === folder.path) clearSelection();
    if (state.mode === 'global') return enterGlobal();
    await loadProjects(state.currentFile || undefined);
  }

  async function moveProject(p, folder) {
    const wasCurrent = state.currentFile === p.file;
    const newFile = await window.projects.move(p.file, folder.path);
    collapsed.delete(folder.path);
    await loadProjects(wasCurrent ? newFile : undefined);
  }

  async function deleteProject(p) {
    if (!window.confirm(`Delete project “${p.title}”?\nThis permanently removes ${p.file}.`)) return;
    await window.projects.remove(p.file);
    if (state.currentFile === p.file) clearSelection();
    await loadTeam();
    if (state.mode === 'global') return enterGlobal();
    await loadProjects();
  }

  // ---- right-click context menu ----------------------------------------
  function openProjectMenu(e, p) {
    const items = [
      { label: 'Rename…', onClick: () => renameProject(p) },
      { label: 'Reveal in folder', onClick: () => window.projects.revealItem(p.file) },
    ];
    items.push({ separator: true }, { header: 'Colour' });
    items.push({ swatches: true, current: p.color, onPick: (hex) => setProjectColor(p, hex) });
    // Every project carries a profile, so there's no "none" choice — only the
    // real profiles (and nothing at all until one exists).
    if (state.profiles.length) {
      items.push({ separator: true }, { header: 'Profile' });
      for (const name of state.profiles) {
        items.push({ label: name + (p.profile === name ? '  ✓' : ''), onClick: () => setProjectProfile(p, name) });
      }
    }
    const targets = state.folders.filter((f) => f.path !== p.folderPath);
    if (targets.length) {
      items.push({ separator: true }, { header: 'Move to workspace' });
      for (const f of targets) items.push({ label: f.name, onClick: () => moveProject(p, f) });
    }
    items.push({ separator: true });
    items.push({ label: 'Duplicate with new dates…', onClick: () => duplicateProject(p) });
    items.push({ label: 'Delete project', danger: true, onClick: () => deleteProject(p) });
    showContextMenu(e.clientX, e.clientY, items);
  }

  function openFolderMenu(e, folder) {
    const items = [
      { label: 'New project here', onClick: () => onNewProject(folder) },
      { label: 'Import project here…', onClick: () => importIntoFolder(folder) },
      { label: 'Reveal folder', onClick: () => window.projects.revealItem(folder.path) },
      { separator: true },
      { label: 'Close workspace', danger: true, onClick: () => removeWorkspace(folder) },
    ];
    showContextMenu(e.clientX, e.clientY, items);
  }

  function closeContextMenu() {
    const m = byId('context-menu');
    if (m) m.remove();
  }
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('contextmenu', (e) => {
    // Close a menu when right-clicking elsewhere (handlers re-open as needed).
    if (!e.target.closest('.project-item, .folder-head')) closeContextMenu();
  });
  window.addEventListener('blur', closeContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });

  function showContextMenu(x, y, items, opts) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.className = 'context-menu';
    // Let callers pin the menu width (the profile switcher matches the sidebar).
    if (opts && opts.width) { menu.style.minWidth = opts.width + 'px'; menu.style.width = opts.width + 'px'; }
    for (const it of items) {
      if (it.separator) {
        const s = document.createElement('div');
        s.className = 'ctx-sep';
        menu.appendChild(s);
      } else if (it.header) {
        const h = document.createElement('div');
        h.className = 'ctx-header';
        h.textContent = it.header;
        menu.appendChild(h);
      } else if (it.swatches) {
        const grid = document.createElement('div');
        grid.className = 'ctx-swatches';
        const cur = String(it.current || '').toLowerCase();
        for (const preset of window.Palette.PRESETS) {
          const b = document.createElement('button');
          b.className = 'swatch' + (preset.hex.toLowerCase() === cur ? ' selected' : '');
          b.style.background = preset.hex;
          b.title = preset.name;
          b.addEventListener('click', (ev) => { ev.stopPropagation(); closeContextMenu(); it.onPick(preset.hex); });
          grid.appendChild(b);
        }
        menu.appendChild(grid);
      } else {
        const b = document.createElement('button');
        b.className = 'ctx-item' + (it.danger ? ' danger' : '');
        b.textContent = it.label;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); closeContextMenu(); it.onClick(); });
        menu.appendChild(b);
      }
    }
    document.body.appendChild(menu);
    // Keep the menu inside the viewport. The incoming x/y and the rects below
    // are device pixels (getBoundingClientRect / clientX already reflect the
    // page `zoom`), but the values we write to style.left/top are *layout*
    // pixels that the browser then multiplies by `zoom`. Divide the clamped
    // device-px position by the zoom factor so the menu lands where intended —
    // otherwise it renders 1.2× too far down/right and falls off-screen.
    const r = menu.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const left = Math.min(x, window.innerWidth - r.width - 6);
    const top = Math.min(y, window.innerHeight - r.height - 6);
    menu.style.left = Math.max(0, left) / zoom + 'px';
    menu.style.top = Math.max(0, top) / zoom + 'px';
  }

  // Promise-based text prompt. Resolves to the entered string, or null on
  // cancel / Escape / backdrop click.
  function promptText(titleText, initial, okLabel) {
    const backdrop = byId('prompt-backdrop');
    const input = byId('prompt-input');
    byId('prompt-title').textContent = titleText;
    byId('prompt-ok').textContent = okLabel || 'OK';
    input.value = initial || '';

    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        backdrop.hidden = true;
        byId('prompt-form').removeEventListener('submit', onSubmit);
        byId('prompt-cancel').removeEventListener('click', onCancel);
        backdrop.removeEventListener('mousedown', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onSubmit = (e) => { e.preventDefault(); finish(input.value); };
      const onCancel = () => finish(null);
      const onBackdrop = (e) => { if (e.target === backdrop) finish(null); };
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };

      byId('prompt-form').addEventListener('submit', onSubmit);
      byId('prompt-cancel').addEventListener('click', onCancel);
      backdrop.addEventListener('mousedown', onBackdrop);
      document.addEventListener('keydown', onKey);

      backdrop.hidden = false;
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  // New-project dialog: a name field plus a profile picker. Defaults the profile
  // to whichever one is active (or "No profile" under "All projects"). Resolves
  // { title, profile } on Create, or null if cancelled.
  function promptNewProject(initialTitle, defaultProfile) {
    const backdrop = byId('newproj-backdrop');
    const nameInput = byId('newproj-name');
    const profileSel = byId('newproj-profile');
    nameInput.value = initialTitle || '';

    // Rebuild the profile options each time so newly added profiles show up.
    profileSel.innerHTML = '';
    const opts = [['', 'No profile (all)'], ...state.profiles.map((p) => [p, p])];
    for (const [value, label] of opts) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      profileSel.appendChild(o);
    }
    profileSel.value = state.profiles.includes(defaultProfile) ? defaultProfile : '';

    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        backdrop.hidden = true;
        byId('newproj-form').removeEventListener('submit', onSubmit);
        byId('newproj-cancel').removeEventListener('click', onCancel);
        backdrop.removeEventListener('mousedown', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onSubmit = (e) => { e.preventDefault(); finish({ title: nameInput.value, profile: profileSel.value }); };
      const onCancel = () => finish(null);
      const onBackdrop = (e) => { if (e.target === backdrop) finish(null); };
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };

      byId('newproj-form').addEventListener('submit', onSubmit);
      byId('newproj-cancel').addEventListener('click', onCancel);
      backdrop.addEventListener('mousedown', onBackdrop);
      document.addEventListener('keydown', onKey);

      backdrop.hidden = false;
      setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
    });
  }

  // Import / duplicate dialog: a name, a choice of which point in the schedule
  // to pin (project start, project end, or a specific task), and the date to pin
  // it to. Every absolute date then shifts by one uniform offset, so the chosen
  // anchor lands exactly on the picked date while durations and relative "after"
  // gaps ride along. Resolves { title, offset } on Create, or null if cancelled.
  function promptReschedule(model, defaultTitle, titleText) {
    const backdrop = byId('reschedule-backdrop');
    const nameInput = byId('reschedule-name');
    const taskSel = byId('reschedule-task');
    const dateInput = byId('reschedule-date');
    byId('reschedule-title').textContent = titleText || 'Import as…';
    nameInput.value = defaultTitle || '';

    // Resolve every task to absolute ms (shared scheduler), then read off the
    // project's true start/end and each pinnable task's current date.
    const { startMs, endMs } = P.resolveSchedule(model);
    const msToISO = (ms) => P.toISO(new Date(ms));
    const starts = [...startMs.values()];
    const ends = [...endMs.values()];
    const minStartISO = starts.length ? msToISO(Math.min(...starts)) : null;
    const maxEndISO = ends.length ? msToISO(Math.max(...ends)) : null;

    // Pinnable tasks = those that resolved to a concrete start. Milestones get a
    // ◆ marker since they're the usual thing to pin a schedule around.
    const taskISO = new Map();
    taskSel.innerHTML = '';
    for (const t of model.tasks) {
      if (!startMs.has(t.id)) continue;
      taskISO.set(t.id, msToISO(startMs.get(t.id)));
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = (t.milestone ? '◆ ' : '') + t.name;
      taskSel.appendChild(o);
    }
    const taskRadio = backdrop.querySelector('input[name="reschedule-anchor"][value="task"]');
    taskRadio.disabled = taskSel.options.length === 0;

    // Bind the app calendar popup once; the field stays a plain ISO text input.
    if (!dateInput.dataset.calBound) { window.DatePicker.attach(dateInput); dateInput.dataset.calBound = '1'; }

    const anchorVal = () => backdrop.querySelector('input[name="reschedule-anchor"]:checked').value;
    // The current (pre-shift) date of whichever anchor is selected, or null when
    // nothing in the project resolves to a concrete date.
    const currentISO = () => {
      const a = anchorVal();
      if (a === 'start') return minStartISO;
      if (a === 'end') return maxEndISO;
      return taskSel.value ? taskISO.get(taskSel.value) : null;
    };
    // Reflect the anchor choice: reveal the task dropdown only for "task", and
    // seed the date field with that anchor's current date as a starting point.
    const sync = () => {
      taskSel.hidden = anchorVal() !== 'task';
      dateInput.value = currentISO() || P.todayISO();
    };

    backdrop.querySelector('input[name="reschedule-anchor"][value="start"]').checked = true;
    sync();

    return new Promise((resolve) => {
      let done = false;
      const onAnchor = () => sync();
      const onTask = () => { dateInput.value = (taskSel.value ? taskISO.get(taskSel.value) : null) || P.todayISO(); };
      const radios = backdrop.querySelectorAll('input[name="reschedule-anchor"]');
      const finish = (val) => {
        if (done) return;
        done = true;
        backdrop.hidden = true;
        byId('reschedule-form').removeEventListener('submit', onSubmit);
        byId('reschedule-cancel').removeEventListener('click', onCancel);
        backdrop.removeEventListener('mousedown', onBackdrop);
        document.removeEventListener('keydown', onKey);
        for (const r of radios) r.removeEventListener('change', onAnchor);
        taskSel.removeEventListener('change', onTask);
        resolve(val);
      };
      const onSubmit = (e) => {
        e.preventDefault();
        const newDate = dateInput.value.trim();
        if (!P.DATE_RE.test(newDate)) { dateInput.focus(); return; }
        const cur = currentISO();
        const offset = cur ? daysBetween(cur, newDate) : 0;
        finish({ title: nameInput.value, offset });
      };
      const onCancel = () => finish(null);
      const onBackdrop = (e) => { if (e.target === backdrop) finish(null); };
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };

      byId('reschedule-form').addEventListener('submit', onSubmit);
      byId('reschedule-cancel').addEventListener('click', onCancel);
      backdrop.addEventListener('mousedown', onBackdrop);
      document.addEventListener('keydown', onKey);
      for (const r of radios) r.addEventListener('change', onAnchor);
      taskSel.addEventListener('change', onTask);

      backdrop.hidden = false;
      setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
    });
  }

  // Promise-based confirm dialog. Resolves true on confirm, false on cancel /
  // Escape / backdrop click. opts: { okLabel, cancelLabel, danger, swap }.
  // `swap` flips the button order (Confirm on the left) so a second prompt
  // can't be dismissed by reflex.
  function confirmDialog(message, opts) {
    opts = opts || {};
    const backdrop = byId('confirm-backdrop');
    const actions = byId('confirm-actions');
    byId('confirm-message').textContent = message;

    return new Promise((resolve) => {
      let done = false;
      const onBackdrop = (e) => { if (e.target === backdrop) finish(false); };
      const onKey = (e) => { if (e.key === 'Escape') finish(false); };
      function finish(val) {
        if (done) return;
        done = true;
        backdrop.hidden = true;
        actions.innerHTML = '';
        backdrop.removeEventListener('mousedown', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = opts.cancelLabel || 'Cancel';
      cancelBtn.addEventListener('click', () => finish(false));

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.textContent = opts.okLabel || 'OK';
      if (opts.danger) okBtn.className = 'danger';
      okBtn.addEventListener('click', () => finish(true));

      actions.innerHTML = '';
      if (opts.swap) { actions.appendChild(okBtn); actions.appendChild(cancelBtn); }
      else { actions.appendChild(cancelBtn); actions.appendChild(okBtn); }

      backdrop.addEventListener('mousedown', onBackdrop);
      document.addEventListener('keydown', onKey);
      backdrop.hidden = false;
    });
  }

  // ---- profiles ---------------------------------------------------------
  function loadProfileRoster() {
    try { return JSON.parse(localStorage.getItem('profileRoster') || '[]'); }
    catch { return []; }
  }
  function saveProfiles() {
    localStorage.setItem('profileRoster', JSON.stringify(state.profiles));
  }

  // Roster = persisted profile names + any profile tag found on a project.
  function loadProfiles() {
    const set = new Set(loadProfileRoster().map((s) => String(s).trim()).filter(Boolean));
    for (const p of state.projects) if (p.profile) set.add(p.profile.trim());
    state.profiles = [...set].sort((a, b) => a.localeCompare(b));
    saveProfiles();
    state.activeProfile = localStorage.getItem('activeProfile') || '';
    if (state.activeProfile && !state.profiles.includes(state.activeProfile)) state.activeProfile = '';
    updateProfileLabel();
  }

  function updateProfileLabel() {
    byId('active-profile').textContent = state.activeProfile || 'All projects';
  }

  async function setActiveProfile(name) {
    state.activeProfile = name || '';
    localStorage.setItem('activeProfile', state.activeProfile);
    updateProfileLabel();
    await loadTeam();            // roster is per-profile, so it changes here
    renderProjectList();
    // The global view is scoped to the active profile, so rebuild it from the
    // newly-filtered project set.
    if (state.mode === 'global') { await enterGlobal(); return; }
    // The open project may not belong to the new profile (it's no longer in the
    // filtered sidebar). renderCurrentView only bails when state.model is null,
    // so without this it would keep rendering the now-hidden project. Drop the
    // selection to the empty state, mirroring loadProjects' reload guard.
    if (state.currentFile) {
      const meta = state.projects.find((p) => p.file === state.currentFile);
      if (!meta || !inActiveProfile(meta)) { clearSelection(); return; }
    }
    rerender();                 // Team view columns follow the new roster
  }

  // Bottom-bar dropdown: pick a profile, or open Settings. Anchored to the
  // switcher; showContextMenu clamps it into view (so it opens upward here).
  function openProfileMenu(e) {
    if (e) e.stopPropagation(); // don't let this click reach the doc-level menu closer
    const r = byId('profile-switcher').getBoundingClientRect();
    const items = [{ label: 'All projects' + (!state.activeProfile ? '  ✓' : ''), onClick: () => setActiveProfile('') }];
    for (const name of state.profiles) {
      items.push({ label: name + (state.activeProfile === name ? '  ✓' : ''), onClick: () => setActiveProfile(name) });
    }
    items.push({ separator: true }, { label: '⚙ Settings…', onClick: openSettings });
    // Match the dropdown to the sidebar's width so it reads as part of the bar.
    // Rects are device px (page zoom); convert to the layout px we write to CSS.
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const sb = byId('sidebar').getBoundingClientRect();
    showContextMenu(sb.left, r.bottom, items, { width: Math.round(sb.width / zoom) });
  }

  async function renderProfiles() {
    const wrap = byId('profiles-list');
    wrap.innerHTML = '';
    if (!state.profiles.length) {
      const e = document.createElement('div');
      e.className = 'tm-empty';
      e.textContent = 'No profiles yet. Add one below.';
      wrap.appendChild(e);
      return;
    }
    const counts = new Map();
    for (const p of state.projects) if (p.profile) counts.set(p.profile, (counts.get(p.profile) || 0) + 1);
    for (const name of state.profiles) {
      const n = counts.get(name) || 0;
      const row = document.createElement('div');
      row.className = 'tm-row';
      row.innerHTML =
        `<span class="tm-name"></span>` +
        `<span class="tm-count">${n} project${n === 1 ? '' : 's'}</span>` +
        `<button class="tm-menu" title="Actions" aria-label="Actions">⋮</button>`;
      row.querySelector('.tm-name').textContent = name;
      row.querySelector('.tm-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Rename', onClick: () => renameProfile(name) },
          { separator: true },
          { label: 'Delete', danger: true, onClick: () => removeProfile(name, n) },
        ]);
      });
      wrap.appendChild(row);
    }
  }

  async function addProfile() {
    const name = await promptText('Add profile', '', 'Add');
    if (name === null) return;
    const n = name.trim();
    if (n && !state.profiles.includes(n)) {
      state.profiles.push(n);
      state.profiles.sort((a, b) => a.localeCompare(b));
      saveProfiles();
      // With the shared bucket gone, point the team editor at the first profile
      // the user creates so its team can be managed straight away.
      if (!state.teamEditProfile) state.teamEditProfile = n;
    }
    renderProfiles();
    populateTeamEditProfile();
    renderTeamMembers();
  }

  async function renameProfile(oldName) {
    const next = await promptText('Rename profile', oldName, 'Rename');
    if (next === null) return;
    const newName = next.trim();
    if (!newName || newName === oldName) return;
    await applyProfileRename(oldName, newName);
    renameRosterBucket(oldName, newName); // the profile's team follows the rename
    state.profiles = state.profiles.filter((n) => n !== oldName);
    if (!state.profiles.includes(newName)) state.profiles.push(newName);
    state.profiles.sort((a, b) => a.localeCompare(b));
    if (state.activeProfile === oldName) state.activeProfile = newName;
    if (state.teamEditProfile === oldName) state.teamEditProfile = newName;
    saveProfiles();
    localStorage.setItem('activeProfile', state.activeProfile);
    await refreshAfterProfileChange();
    renderProfiles();
    populateTeamEditProfile(); // the edited team may have been renamed/removed
    renderTeamMembers();
  }

  async function removeProfile(name, count) {
    const msg = count
      ? `Delete profile “${name}”? Its ${count} project${count === 1 ? '' : 's'} will become untagged.`
      : `Delete profile “${name}”?`;
    if (!window.confirm(msg)) return;
    if (count) await applyProfileRename(name, '');
    dropRosterBucket(name); // its team is deleted along with the profile
    state.profiles = state.profiles.filter((n) => n !== name);
    if (state.activeProfile === name) state.activeProfile = '';
    if (state.teamEditProfile === name) state.teamEditProfile = '';
    saveProfiles();
    localStorage.setItem('activeProfile', state.activeProfile);
    await refreshAfterProfileChange();
    renderProfiles();
    populateTeamEditProfile(); // the edited team may have been renamed/removed
    renderTeamMembers();
  }

  // Rewrite the profile tag on every project currently tagged `oldName`.
  async function applyProfileRename(oldName, newName) {
    for (const p of state.projects) {
      if (p.profile !== oldName) continue;
      let md;
      try { md = await window.projects.read(p.file); } catch { continue; }
      const m = P.parseGantt(P.extractMermaidBlock(md).code);
      m.profile = newName;
      await window.projects.write(p.file, P.writeBackToMarkdown(md, m));
    }
  }

  async function refreshAfterProfileChange() {
    updateProfileLabel();
    await loadProjects(state.currentFile || undefined);
    await loadTeam(); // the active profile (and its roster) may have changed
    if (state.mode === 'global') await enterGlobal();
  }

  // Rename a project (from its right-click menu). The title lives in two places
  // that must stay in sync: the markdown H1 heading (which the sidebar reads
  // first) and the mermaid `title` line (which the Timeline shows), so update
  // both, then refresh in-memory state + the open view.
  async function renameProject(p) {
    const next = await promptText('Rename project', p.title, 'Rename');
    if (next === null) return;
    const name = next.trim();
    if (!name || name === p.title) return;

    const md = await window.projects.read(p.file);
    const m = P.parseGantt(P.extractMermaidBlock(md).code);
    m.title = name;
    // Replace the first H1 heading if there is one (function replacement keeps
    // any '$' in the new name literal). Files without an H1 fall back to the
    // mermaid title, which we set above.
    const withHeading = /^\s*#\s+.+$/m.test(md)
      ? md.replace(/^(\s*#\s+).+$/m, (_, pre) => pre + name)
      : md;
    const newMd = P.writeBackToMarkdown(withHeading, m);
    await window.projects.write(p.file, newMd);

    p.title = name;
    const meta = state.projects.find((x) => x.file === p.file);
    if (meta) meta.title = name;
    const g = state.global.find((x) => x.file === p.file);
    if (g) g.title = name;
    if (state.currentFile === p.file) {
      state.rawMd = newMd;
      if (state.model) state.model.title = name;
    }
    renderProjectList();
    if (state.mode === 'global') renderGlobalView();
    else if (state.currentFile === p.file) renderCurrentView();
  }

  // Set one project's profile (from its right-click menu).
  async function setProjectProfile(p, name) {
    const md = await window.projects.read(p.file);
    const m = P.parseGantt(P.extractMermaidBlock(md).code);
    m.profile = name || '';
    const newMd = P.writeBackToMarkdown(md, m);
    await window.projects.write(p.file, newMd);

    p.profile = name || '';
    const meta = state.projects.find((x) => x.file === p.file);
    if (meta) meta.profile = name || '';
    if (name && !state.profiles.includes(name)) {
      state.profiles.push(name);
      state.profiles.sort((a, b) => a.localeCompare(b));
      saveProfiles();
    }
    if (state.currentFile === p.file) { state.rawMd = newMd; if (state.model) state.model.profile = name || ''; }
    renderProjectList();
  }

  // ---- project colour (set from the project right-click menu) ----------
  async function setProjectColor(p, hex) {
    const md = await window.projects.read(p.file);
    const newMd = window.Palette.writeColor(md, hex);
    await window.projects.write(p.file, newMd);

    p.color = hex;
    const meta = state.projects.find((x) => x.file === p.file);
    if (meta) meta.color = hex;
    const dot = document.querySelector(`.project-item[data-file="${CSS.escape(p.file)}"] .pi-dot`);
    if (dot) dot.style.background = hex;

    // Reflect the change live if the project is currently open / in the global
    // view. Sync state.model.color too: colour now lives in the mermaid block,
    // so a later task edit re-serializes the model — a stale colour there would
    // overwrite the one we just wrote.
    if (state.currentFile === p.file) {
      state.rawMd = newMd;
      state.color = hex;
      if (state.model) state.model.color = hex;
    }
    const g = state.global.find((x) => x.file === p.file);
    if (g) g.color = hex;
    rerender();
  }

  // ---- share meeting ----------------------------------------------------
  // The export button opens a dropdown (room for more items later); "Share
  // meeting" lets you pick a project / workspace / all, then spins up the
  // read-only LAN viewer (main process) and shows its address.
  let shareInfo = null;       // { active, primaryUrl, urls, port, title } while live
  let shareSelection = null;  // the picker row currently chosen
  let shareWifi = null;       // detected Wi-Fi SSID (or null) for the share copy

  byId('export-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = byId('export-btn').getBoundingClientRect();
    const items = shareInfo
      ? [
          { label: 'Sharing — show link', onClick: openShareModal },
          { label: 'Copy share link', onClick: () => copyText(shareInfo.primaryUrl) },
          { separator: true },
          { label: 'Export to PDF…', onClick: openPdfModal },
          { separator: true },
          { label: 'Stop sharing', danger: true, onClick: stopShare },
        ]
      : [
          { label: 'Start meeting', onClick: openShareModal },
          { separator: true },
          { label: 'Export to PDF…', onClick: openPdfModal },
        ];
    // Drop the menu straight down from the button's top-left corner (same
    // top-left anchoring the new-project workspace picker uses).
    showContextMenu(r.left, r.bottom + 4, items);
  });

  function setExportSharing(on) { byId('export-btn').classList.toggle('sharing', !!on); }

  function openShareModal() {
    if (shareInfo) showActiveSharePanel();
    else {
      byId('share-active').hidden = true;
      byId('share-warn').hidden = true;
      byId('share-picker').hidden = false;
      buildShareOptions();
      refreshShareWifi();
    }
    byId('share-backdrop').hidden = false;
  }
  function closeShareModal() { byId('share-backdrop').hidden = true; }

  // Detect the current Wi-Fi network so the picker can name it and the warning /
  // active panels can be specific about which network guests must join. Shows the
  // last-known value immediately, then refreshes once the lookup returns.
  function refreshShareWifi() {
    setShareWifiNote(shareWifi);
    window.share?.wifi().then((ssid) => {
      shareWifi = ssid || null;
      setShareWifiNote(shareWifi);
    }).catch(() => {});
  }

  // SSID quoted for plain-text copy, or a generic phrase when unknown.
  function wifiPhrase() { return shareWifi ? `the “${shareWifi}” Wi-Fi` : 'your Wi-Fi'; }

  function setShareWifiNote(ssid) {
    const t = byId('share-wifi-note').querySelector('.share-wifi-text');
    t.textContent = '';
    if (ssid) {
      t.append('Everyone must be on the same Wi-Fi as this computer: ');
      const strong = document.createElement('strong');
      strong.textContent = ssid;
      t.append(strong);
    } else {
      t.append('Everyone must be on the same Wi-Fi network as this computer.');
    }
  }

  // Step 1b: warn that an OS firewall prompt is coming BEFORE it appears, so the
  // password/approval dialog is never a surprise. Continue actually starts.
  function showShareWarn() {
    if (!shareSelection) return;
    byId('share-warn').querySelector('.share-warn-body').textContent =
      `To let other devices on ${wifiPhrase()} reach this shared view, your computer ` +
      `will ask for permission — a password or a security approval — to allow it through ` +
      `the firewall. This only opens access to this shared content, nothing else.`;
    byId('share-picker').hidden = true;
    byId('share-warn').hidden = false;
  }

  // Build the radio list: "All projects", then each workspace (share the whole
  // folder + each of its projects), filtered by the active profile.
  function buildShareOptions() {
    const container = byId('share-options');
    container.innerHTML = '';
    shareSelection = null;

    const all = state.projects.filter(inActiveProfile);
    const startBtn = byId('share-start');
    if (!all.length) {
      container.innerHTML = '<div class="share-empty">No projects to share yet.</div>';
      startBtn.disabled = true;
      return;
    }
    startBtn.disabled = false;

    const opts = [];
    opts.push({
      kind: 'all',
      label: state.activeProfile ? `All ${state.activeProfile} projects` : 'All projects',
      title: state.activeProfile ? `${state.activeProfile} — all projects` : 'All projects',
      files: all.map((p) => p.file),
      count: all.length,
    });
    for (const folder of state.folders) {
      const inFolder = all.filter((p) => p.folderPath === folder.path);
      if (!inFolder.length) continue;
      opts.push({ kind: 'head', label: folder.name });
      if (inFolder.length > 1) {
        opts.push({
          kind: 'workspace', sub: true,
          label: `Everything in ${folder.name}`, title: folder.name,
          files: inFolder.map((p) => p.file), count: inFolder.length,
        });
      }
      for (const p of inFolder) {
        opts.push({ kind: 'project', sub: true, label: p.title, title: p.title, files: [p.file], color: window.Palette.colorFor(p) });
      }
    }

    // Preselect whatever's on screen: the open project, else "All projects".
    let preselect = opts[0];
    if (state.mode === 'project' && state.currentFile) {
      const found = opts.find((o) => o.kind === 'project' && o.files[0] === state.currentFile);
      if (found) preselect = found;
    }

    for (const o of opts) {
      if (o.kind === 'head') {
        const h = document.createElement('div');
        h.className = 'share-opt-head';
        h.textContent = o.label;
        container.appendChild(h);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'share-opt' + (o.sub ? ' sub' : '');
      const dot = o.color ? `<span class="so-dot" style="background:${o.color}"></span>` : '';
      const count = o.count ? `<span class="so-count">${o.count}</span>` : '';
      b.innerHTML = `<span class="so-radio"></span>${dot}<span class="so-label"></span>${count}`;
      b.querySelector('.so-label').textContent = o.label;
      b.addEventListener('click', () => {
        shareSelection = o;
        container.querySelectorAll('.share-opt').forEach((el) => el.classList.remove('selected'));
        b.classList.add('selected');
      });
      o._el = b;
      container.appendChild(b);
    }
    if (preselect && preselect._el) { shareSelection = preselect; preselect._el.classList.add('selected'); }
  }

  // Triggered from the warning step's "Continue & start": this is the call that
  // spins up the server and (in the main process) raises the firewall prompt.
  async function startShare() {
    if (!shareSelection) return;
    const { files, title } = shareSelection;
    const btn = byId('share-warn-continue');
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const res = await window.share.start({ files, title, view: state.view });
      shareInfo = Object.assign({}, res, { title });
      setExportSharing(true);
      showActiveSharePanel();
    } catch (err) {
      window.alert('Could not start sharing: ' + ((err && err.message) || err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Continue & start';
    }
  }

  function showActiveSharePanel() {
    byId('share-picker').hidden = true;
    byId('share-warn').hidden = true;
    byId('share-active').hidden = false;
    byId('share-url').textContent = shareInfo.primaryUrl;

    const alt = byId('share-alt');
    alt.innerHTML = '';
    const extras = (shareInfo.urls || []).filter((u) => u !== shareInfo.primaryUrl);
    if (extras.length) {
      const lead = document.createElement('div');
      lead.className = 'share-alt-item';
      lead.textContent = 'Other addresses to try:';
      alt.appendChild(lead);
      for (const u of extras) {
        const d = document.createElement('div');
        d.className = 'share-alt-item';
        d.textContent = u;
        alt.appendChild(d);
      }
    }

    // QR of the link (scan to open) + the PIN guests must type to get in.
    renderShareQr(shareInfo.primaryUrl);
    byId('share-pin').textContent = shareInfo.pin ? formatPin(shareInfo.pin) : '';
    byId('share-pin').closest('.share-join').hidden = !shareInfo.pin;

    byId('share-scope-note').textContent =
      `Sharing “${shareInfo.title}”. It updates live as you work — anyone on ${wifiPhrase()} ` +
      `with this link and the PIN can view it (read-only) until you stop.`;
  }

  // Spaced for readability on screen (e.g. "12 34"); the value typed is "1234".
  function formatPin(pin) {
    const s = String(pin);
    return s.length === 4 ? `${s.slice(0, 2)} ${s.slice(2)}` : s;
  }

  // Draw the meeting link as a QR into #share-qr — an inline SVG (one <path> for
  // all dark modules) so it stays crisp at any size and needs no <img>/data: URL.
  // window.QRCode (vendored node-qrcode core) builds the module matrix; we paint.
  function renderShareQr(url) {
    const box = byId('share-qr');
    const wrap = box.closest('.share-qr-wrap');
    box.innerHTML = '';
    if (!url || !window.QRCode) { wrap.hidden = true; return; }
    let qr;
    try { qr = window.QRCode.create(url, { errorCorrectionLevel: 'M' }); }
    catch { wrap.hidden = true; return; }
    wrap.hidden = false;

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

  async function stopShare() {
    try { await window.share.stop(); } catch { /* already gone */ }
    shareInfo = null;
    setExportSharing(false);
    closeShareModal();
  }

  // Clipboard with a file:// fallback (the async Clipboard API can be blocked).
  function copyText(text) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* nothing more we can do */ }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    fallback();
    return Promise.resolve();
  }

  byId('share-start').addEventListener('click', showShareWarn);
  byId('share-warn-continue').addEventListener('click', startShare);
  byId('share-warn-back').addEventListener('click', () => {
    byId('share-warn').hidden = true;
    byId('share-picker').hidden = false;
  });
  byId('share-cancel').addEventListener('click', closeShareModal);
  byId('share-done').addEventListener('click', closeShareModal);
  byId('share-stop').addEventListener('click', stopShare);
  byId('share-copy').addEventListener('click', () => {
    copyText(shareInfo ? shareInfo.primaryUrl : byId('share-url').textContent);
    const btn = byId('share-copy');
    btn.classList.add('copied');
    btn.textContent = 'Copied';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'Copy'; }, 1400);
  });
  byId('share-backdrop').addEventListener('mousedown', (e) => {
    if (e.target === byId('share-backdrop')) closeShareModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !byId('share-backdrop').hidden) closeShareModal();
  });

  // A window reload re-runs the renderer while the main-process server keeps
  // running; restore the active-share state so the button stays lit.
  window.share?.status().then((s) => {
    if (s && s.active) { shareInfo = Object.assign({}, s); setExportSharing(true); }
  }).catch(() => {});

  // ---- export to PDF ----------------------------------------------------
  // Builds a print-ready HTML document (window.PdfExport) and hands it to the
  // main process to render + save (window.pdfExport.save). The dialog picks the
  // scope (one project, or all profile projects) that feeds the Forecast + Team
  // pages, plus an independent project set for the Global timeline.
  let pdfDir = localStorage.getItem('pdfExportDir') || null; // chosen output folder, else Documents
  let appVersion = ''; // Projector version, for the PDF footer attribution

  // Show the chosen export folder (or the Documents default) in the dialog.
  function renderPdfFolder() {
    const el = byId('pdf-folder-path');
    el.classList.toggle('is-default', !pdfDir);
    el.textContent = pdfDir || 'Documents (default)';
    el.title = pdfDir || 'Documents (default)';
  }

  function openPdfModal() {
    buildPdfProjects();
    byId('pdf-forecast-on').checked = true;
    byId('pdf-team-on').checked = true;
    byId('pdf-global-on').checked = true;
    byId('pdf-team-alltasks').checked = false;
    byId('pdf-forecast-days').value = '7';
    byId('pdf-team-days').value = '7';
    byId('pdf-global-past').value = 'none';
    byId('pdf-global-future').value = 'all';
    byId('pdf-global-past-n').value = '3';
    byId('pdf-global-future-n').value = '3';
    const letter = document.querySelector('input[name="pdf-paper"][value="Letter"]');
    if (letter) letter.checked = true;
    syncPdfDays();
    syncPdfForecastSub();
    syncPdfTeamSub();
    syncPdfGlobal();
    syncPdfGlobalRange();
    renderPdfFolder();
    syncPdfExport();
    byId('pdf-backdrop').hidden = false;
  }
  function closePdfModal() { byId('pdf-backdrop').hidden = true; }

  // One project checklist that feeds every page (Forecast, Team, Global). It spans
  // every profile (one group per profile, then a "No profile" group), so a single
  // PDF can mix profiles. The default check state preselects the open project when
  // launched from a single project; otherwise it checks whatever the active
  // profile shows, leaving other profiles' projects listed but unchecked. Reuses
  // the .pdf-check row chrome + the .so-dot colour swatch.
  function buildPdfProjects() {
    const box = byId('pdf-projects');
    box.innerHTML = '';
    const all = state.projects;
    if (!all.length) {
      box.innerHTML = '<div class="pdf-empty">No projects.</div>';
      return;
    }
    const only = (state.mode === 'project' && state.currentFile
      && all.some((p) => p.file === state.currentFile)) ? state.currentFile : null;

    // Each project appears once, under its own profile (untagged → "No profile").
    const byTitle = (a, b) => a.title.localeCompare(b.title);
    const groups = [];
    for (const name of state.profiles) {
      const items = all.filter((p) => p.profile === name).sort(byTitle);
      if (items.length) groups.push({ label: name, items });
    }
    const untagged = all.filter((p) => !p.profile).sort(byTitle);
    if (untagged.length) groups.push({ label: 'No profile', items: untagged });

    const showHeaders = groups.length > 1;
    for (const g of groups) {
      if (showHeaders) {
        const hd = document.createElement('div');
        hd.className = 'pdf-group-label';
        hd.textContent = g.label;
        box.appendChild(hd);
      }
      for (const p of g.items) {
        const row = document.createElement('label');
        row.className = 'pdf-check';
        row.innerHTML = `<input type="checkbox"><span class="so-dot" style="background:${window.Palette.colorFor(p)}"></span><span class="pdf-check-label"></span>`;
        row.querySelector('.pdf-check-label').textContent = p.title;
        const inp = row.querySelector('input');
        inp.dataset.file = p.file;
        inp.checked = only ? (p.file === only) : inActiveProfile(p);
        box.appendChild(row);
      }
    }
  }

  // Bulk toggle for the project checklist, wired to the Select/Deselect all
  // buttons above it.
  function setAllPdfProjects(on) {
    byId('pdf-projects').querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = on; });
    syncPdfExport();
  }

  // The "All tasks" page is a sub-option of the Team page, so grey it out (and
  // ignore it on export) whenever the Team page itself is off.
  function syncPdfTeamSub() {
    const on = byId('pdf-team-on').checked;
    const sub = byId('pdf-team-alltasks');
    sub.disabled = !on;
    const row = sub.closest('.pdf-subopt');
    if (row) row.classList.toggle('disabled', !on);
  }

  // The "Upcoming milestones" page is a sub-option of the Forecast page, so grey
  // it out (and ignore it on export) whenever the Forecast page itself is off.
  function syncPdfForecastSub() {
    const on = byId('pdf-forecast-on').checked;
    const sub = byId('pdf-forecast-milestones');
    sub.disabled = !on;
    const row = sub.closest('.pdf-subopt');
    if (row) row.classList.toggle('disabled', !on);
  }

  // Team shares the forecast's window when both are on; otherwise it gets its
  // own days input.
  function syncPdfDays() {
    const fOn = byId('pdf-forecast-on').checked;
    byId('pdf-team-days-wrap').hidden = fOn;
    byId('pdf-team-shared').hidden = !fOn;
  }
  // Only the Global page's Past/Future range controls toggle with its checkbox;
  // the project checklist is shared by every page and always stays enabled.
  function syncPdfGlobal() {
    const on = byId('pdf-global-on').checked;
    const range = byId('pdf-global-range');
    range.classList.toggle('disabled', !on);
    range.querySelectorAll('select, input').forEach((el) => { el.disabled = !on; });
  }
  // Reveal each month-count input only when its select is in "limit" mode.
  function syncPdfGlobalRange() {
    byId('pdf-global-past-extra').hidden = byId('pdf-global-past').value !== 'limit';
    byId('pdf-global-future-extra').hidden = byId('pdf-global-future').value !== 'limit';
  }
  function syncPdfExport() {
    const anyPage = byId('pdf-forecast-on').checked || byId('pdf-team-on').checked || byId('pdf-global-on').checked;
    const anyProject = !!byId('pdf-projects').querySelector('input:checked');
    byId('pdf-export').disabled = !(anyPage && anyProject);
  }
  function clampDays(v) {
    const x = parseInt(v, 10);
    return Number.isFinite(x) ? Math.min(120, Math.max(1, x)) : 7;
  }
  function clampMonths(v) {
    const x = parseInt(v, 10);
    return Number.isFinite(x) ? Math.min(120, Math.max(1, x)) : 3;
  }

  // Read + parse each file into the { file, title, color, model } shape the PDF
  // builder (and the Global view) expect — same load path as enterGlobal().
  async function loadModelsFor(files) {
    const metaByFile = new Map(state.projects.map((p) => [p.file, p]));
    const out = [];
    for (const file of files) {
      const md = await window.projects.read(file);
      const model = P.parseGantt(P.extractMermaidBlock(md).code);
      const meta = metaByFile.get(file) || { title: model.title || file };
      out.push({
        file,
        title: meta.title || model.title || 'Project',
        color: window.Palette.colorFor({ color: window.Palette.readColor(md), title: meta.title, file }),
        model,
      });
    }
    return out;
  }

  async function doPdfExport() {
    const files = [...byId('pdf-projects').querySelectorAll('input:checked')].map((i) => i.dataset.file);
    if (!files.length) return;
    const forecast = {
      on: byId('pdf-forecast-on').checked,
      days: clampDays(byId('pdf-forecast-days').value),
      milestones: byId('pdf-forecast-on').checked && byId('pdf-forecast-milestones').checked,
    };
    const teamOn = byId('pdf-team-on').checked;
    const teamDays = forecast.on ? forecast.days : clampDays(byId('pdf-team-days').value);
    const team = { on: teamOn, days: teamDays, allTasks: teamOn && byId('pdf-team-alltasks').checked };
    const globalOn = byId('pdf-global-on').checked;
    if (!forecast.on && !team.on && !globalOn) return;

    const pageSize = (document.querySelector('input[name="pdf-paper"]:checked') || {}).value || 'Letter';
    const windowDays = forecast.on ? forecast.days : (team.on ? team.days : 7);
    // One checklist drives every page. A single project bands the Forecast by
    // assignee (like a project view); several band it by project.
    const scopeKind = files.length === 1 ? 'project' : 'all';
    // The checklist spans every profile, so name the export from the selection
    // rather than the active profile: one shared non-empty profile names it (and
    // enables "All <profile> projects"); a cross-profile selection has none.
    const metaByFile = new Map(state.projects.map((p) => [p.file, p]));
    const selProfiles = new Set(files.map((f) => (metaByFile.get(f) || {}).profile).filter(Boolean));
    const selProfile = selProfiles.size === 1 ? [...selProfiles][0] : '';
    const profileTotal = selProfile
      ? state.projects.filter((p) => inProfile(p, selProfile)).length
      : state.projects.length;
    let scopeTitle;
    if (files.length === 1) scopeTitle = (metaByFile.get(files[0]) || {}).title || 'Project';
    else if (files.length === profileTotal) scopeTitle = selProfile ? `All ${selProfile} projects` : 'All projects';
    else scopeTitle = `${files.length} projects`;
    const globalPast = { mode: byId('pdf-global-past').value, months: clampMonths(byId('pdf-global-past-n').value) };
    const globalFuture = { mode: byId('pdf-global-future').value, months: clampMonths(byId('pdf-global-future-n').value) };

    const btn = byId('pdf-export');
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      const models = await loadModelsFor(files);
      const byFile = new Map(models.map((m) => [m.file, m]));
      const scopeProjects = files.map((f) => byFile.get(f)).filter(Boolean);

      const html = window.PdfExport.buildDocument({
        scopeKind,
        scopeTitle,
        scopeProjects,
        forecast,
        team,
        windowDays,
        global: { on: globalOn, projects: scopeProjects, past: globalPast, future: globalFuture },
        pageSize,
        profileName: selProfile,
        todayISO: P.todayISO(),
        appVersion,
      });
      const safe = scopeTitle.replace(/[\\/:*?"<>|]+/g, ' ').trim();
      const defaultName = `Projector — ${safe} — ${P.todayISO()}.pdf`;
      const res = await window.pdfExport.save({ html, fileName: defaultName, dir: pdfDir || undefined });
      if (res && res.error) window.alert('Could not export PDF: ' + res.error);
      else if (res && res.path) closePdfModal();
      // canceled -> leave the dialog open
    } catch (err) {
      window.alert('Could not export PDF: ' + ((err && err.message) || err));
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
      syncPdfExport();
    }
  }

  byId('pdf-forecast-on').addEventListener('change', () => { syncPdfDays(); syncPdfForecastSub(); syncPdfExport(); });
  byId('pdf-team-on').addEventListener('change', () => { syncPdfTeamSub(); syncPdfExport(); });
  byId('pdf-global-on').addEventListener('change', () => { syncPdfGlobal(); syncPdfExport(); });
  byId('pdf-projects').addEventListener('change', syncPdfExport);
  byId('pdf-projects-all').addEventListener('click', () => setAllPdfProjects(true));
  byId('pdf-projects-none').addEventListener('click', () => setAllPdfProjects(false));
  byId('pdf-global-past').addEventListener('change', syncPdfGlobalRange);
  byId('pdf-global-future').addEventListener('change', syncPdfGlobalRange);
  byId('pdf-folder-btn').addEventListener('click', async () => {
    const res = await window.pdfExport.chooseFolder(pdfDir || undefined);
    if (res && res.dir) {
      pdfDir = res.dir;
      try { localStorage.setItem('pdfExportDir', pdfDir); } catch { /* storage blocked — keep the in-memory choice */ }
      renderPdfFolder();
    }
  });
  byId('pdf-cancel').addEventListener('click', closePdfModal);
  byId('pdf-export').addEventListener('click', doPdfExport);
  byId('pdf-backdrop').addEventListener('mousedown', (e) => {
    if (e.target === byId('pdf-backdrop')) closePdfModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !byId('pdf-backdrop').hidden) closePdfModal();
  });

  // ---- helpers ----------------------------------------------------------
  function byId(id) { return document.getElementById(id); }

  // ---- boot -------------------------------------------------------------
  // Show the app version in the Settings header (best-effort; non-fatal).
  window.appInfo?.getVersion().then((v) => {
    appVersion = v || '';
    const el = byId('settings-app-version');
    if (el && v) el.textContent = 'v' + v;
  }).catch(() => {});

  (async function init() {
    await loadProjects();
    loadProfiles();      // sets state.activeProfile before the roster is built
    migrateRoster();     // fold any legacy flat roster into the shared bucket
    await loadTeam();    // roster is scoped to the active profile
    renderProjectList(); // re-render now that the active profile filter is known

    // Restore the last-used view (Task List / Timeline / Team).
    const savedView = localStorage.getItem('lastView');
    if (['kanban', 'gantt', 'team'].includes(savedView)) state.view = savedView;

    // Reopen where the user left off: the global view, the same project, or —
    // failing that (e.g. everything was deleted) — straight to a blank global
    // view rather than the empty "No project selected" placeholder.
    const savedMode = localStorage.getItem('lastMode');
    const savedFile = localStorage.getItem('lastFile');
    const reopen = savedFile && state.projects.find((p) => p.file === savedFile && inActiveProfile(p));
    const first = state.projects.find(inActiveProfile);
    if (savedMode === 'global' || !first) await enterGlobal();
    else if (reopen) selectProject(savedFile);
    else selectProject(first.file);
  })();
})();
