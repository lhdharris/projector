// Global view model builder. Merges every project's task model into two
// combined models — one for the all-projects Kanban, one for the all-projects
// Gantt — and hands back the colour/label lookups plus the maps needed to map
// a clicked/dragged element back to its source project + original task.
//
// Kanban tasks get synthetic ids ("g<proj>_<n>") so a card can be traced to its
// file. Gantt tasks get namespaced ids ("p<proj>__<origId>") and their section
// set to the project title, so projects stack as labelled bands; "after <id>"
// dependencies are rewritten to the namespaced ids so they still resolve.

(function (global) {
  'use strict';

  function remapStart(start, remap) {
    if (!start) return start;
    const m = /^after\s+(.+)$/i.exec(String(start).trim());
    if (!m) return start;
    const ids = m[1].split(/\s+/).filter(Boolean).map((id) => remap.get(id) || id);
    return `after ${ids.join(' ')}`;
  }

  // projects: [{ file, title, color, model }]
  function build(projects) {
    const kTasks = [];
    const gTasks = [];
    const kInfo = new Map(); // gid  -> { file, origId, color, title }
    const gInfo = new Map(); // nsid -> { file, origId, color, title, assignee }

    projects.forEach((proj, idx) => {
      const color = global.Palette.colorFor(proj);
      const remap = new Map();      // origId -> namespaced Gantt id
      const gidByOrig = new Map();  // origId -> synthetic Kanban id
      proj.model.tasks.forEach((t, j) => {
        remap.set(t.id, `p${idx}__${t.id}`);
        gidByOrig.set(t.id, `g${idx}_${j}`);
      });

      // Each project becomes a labelled band (section = project title); the
      // title shown on the left is enough, so we don't add a separate summary
      // bar spanning the band.
      proj.model.tasks.forEach((t, j) => {
        const gid = `g${idx}_${j}`;
        // Remap "after" refs to the Kanban ids so cards can name predecessors.
        kTasks.push(Object.assign({}, t, { id: gid, start: remapStart(t.start, gidByOrig) }));
        kInfo.set(gid, { file: proj.file, origId: t.id, color, title: proj.title });

        // The global Gantt bands by project, so override the per-bar grouping
        // (the serializer groups by `assignee`) with the project title. The
        // original assignee is stashed in gInfo so the timeline's team-member
        // filter can still narrow to one person across all projects.
        const nsid = remap.get(t.id);
        gTasks.push(Object.assign({}, t, {
          id: nsid,
          assignee: proj.title || 'Project',
          start: remapStart(t.start, remap),
        }));
        gInfo.set(nsid, { file: proj.file, origId: t.id, color, title: proj.title, assignee: t.assignee || '' });
      });
    });

    return {
      kanbanModel: { title: 'All projects', dateFormat: 'YYYY-MM-DD', tasks: kTasks },
      ganttModel: { title: 'All projects', dateFormat: 'YYYY-MM-DD', tasks: gTasks },
      colorForKanban: (t) => (kInfo.get(t.id) || {}).color,
      projectLabel: (t) => (kInfo.get(t.id) || {}).title,
      colorForGantt: (t) => (gInfo.get(t.id) || {}).color,
      kInfo,
      gInfo,
    };
  }

  global.GlobalView = { build };
})(window);
