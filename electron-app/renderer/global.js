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

  // Earliest start → latest end across a project's concrete-dated tasks, as
  // ISO strings, or null if nothing has a real date.
  function projectSpan(model) {
    const P = global.GanttParse;
    let min = Infinity, max = -Infinity;
    for (const t of model.tasks) {
      if (!t.start || !P.DATE_RE.test(t.start)) continue;
      const s = Date.parse(t.start + 'T00:00:00');
      if (Number.isNaN(s)) continue;
      const dur = t.milestone ? 0 : Math.max(0, P.parseDurationDays(t.duration));
      const e = s + dur * 86400000;
      if (s < min) min = s;
      if (e > max) max = e;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { start: P.toISO(new Date(min)), end: P.toISO(new Date(max)) };
  }

  // projects: [{ file, title, color, model }]
  function build(projects) {
    const kTasks = [];
    const gTasks = [];
    const kInfo = new Map(); // gid  -> { file, origId, color, title }
    const gInfo = new Map(); // nsid -> { file, origId, color, title }

    projects.forEach((proj, idx) => {
      const color = global.Palette.colorFor(proj);
      const remap = new Map();
      proj.model.tasks.forEach((t) => remap.set(t.id, `p${idx}__${t.id}`));

      // Summary bar first in each project's band: one bar spanning the whole
      // project, its tasks listed underneath. Clicking it opens the project.
      const span = projectSpan(proj.model);
      if (span) {
        const sid = `p${idx}__summary`;
        gTasks.push({
          name: proj.title || 'Project',
          id: sid,
          assignee: proj.title || 'Project',
          status: 'active',
          crit: false,
          milestone: false,
          start: span.start,
          duration: span.end,
        });
        gInfo.set(sid, { file: proj.file, origId: null, color, title: proj.title, summary: true });
      }

      proj.model.tasks.forEach((t, j) => {
        const gid = `g${idx}_${j}`;
        kTasks.push(Object.assign({}, t, { id: gid }));
        kInfo.set(gid, { file: proj.file, origId: t.id, color, title: proj.title });

        // The global Gantt bands by project, so override the per-bar grouping
        // (the serializer groups by `assignee`) with the project title.
        const nsid = remap.get(t.id);
        gTasks.push(Object.assign({}, t, {
          id: nsid,
          assignee: proj.title || 'Project',
          start: remapStart(t.start, remap),
        }));
        gInfo.set(nsid, { file: proj.file, origId: t.id, color, title: proj.title });
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
