// Kanban view: three status columns (To Do / In Progress / Done) mapped to
// Mermaid's done/active tags. Each card carries its Gantt section as a
// colored badge. Dragging a card to another column changes its status tag;
// the host (renderer.js) writes the model back to the .md file.

(function (global) {
  'use strict';

  const COLUMNS = [
    { key: 'todo',   label: 'To Do' },
    { key: 'active', label: 'In Progress' },
    { key: 'done',   label: 'Done' },
  ];

  // Stable pastel per assignee name, so a person reads the same across cards
  // and matches the feel of the rest of the chrome.
  function sectionHue(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }

  function dateRange(task) {
    if (!task.start || !global.GanttParse.DATE_RE.test(task.start)) {
      // "after X" or unspecified — let the Gantt resolve it; show what we have.
      return task.start || '';
    }
    const days = global.GanttParse.parseDurationDays(task.duration);
    if (task.milestone || days <= 0) return task.start;
    const end = global.GanttParse.addDays(task.start, days);
    return `${task.start} → ${end}`;
  }

  // opts (all optional):
  //   colorForTask(task) -> hex   project colour applied as the card accent
  //   projectLabel(task)  -> str  extra badge naming the task's project (global)
  //   readOnlyAdd         -> bool hide the "+ Add task" button (global view)
  function render(container, model, handlers, opts) {
    opts = opts || {};
    container.innerHTML = '';

    for (const col of COLUMNS) {
      const colEl = document.createElement('div');
      colEl.className = 'kanban-col';
      colEl.dataset.status = col.key;

      const tasks = model.tasks.filter((t) => t.status === col.key);

      const head = document.createElement('div');
      head.className = 'kanban-col-head';
      head.innerHTML = `<span>${escapeHtml(col.label)}</span><span class="count">${tasks.length}</span>`;
      colEl.appendChild(head);

      const listEl = document.createElement('div');
      listEl.className = 'kanban-list';
      colEl.appendChild(listEl);

      for (const task of tasks) {
        listEl.appendChild(card(task, handlers, opts));
      }

      if (!opts.readOnlyAdd) {
        const add = document.createElement('button');
        add.className = 'kanban-add';
        add.textContent = '+ Add task';
        add.addEventListener('click', () => handlers.onAddTask(col.key));
        colEl.appendChild(add);
      }

      // Drop target wiring.
      colEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        colEl.classList.add('drag-over');
      });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
      colEl.addEventListener('drop', (e) => {
        e.preventDefault();
        colEl.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        if (id) handlers.onMoveTask(id, col.key);
      });

      container.appendChild(colEl);
    }
  }

  function card(task, handlers, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card' + (task.crit ? ' crit' : '') + (task.milestone ? ' milestone' : '');
    el.draggable = true;
    el.dataset.id = task.id;

    // Project-colour accent: a tinted body + left border. crit/milestone keep
    // their own left border (CSS overrides), so the project colour shows via
    // the body tint and the project badge for those cards.
    // Sticky-note look: soft project-colour body with a barely-there border.
    const hex = opts.colorForTask ? opts.colorForTask(task) : null;
    if (hex && global.Palette) {
      const border = global.Palette.cardBorder(hex);
      el.style.background = global.Palette.cardFill(hex);
      el.style.borderTopColor = border;
      el.style.borderRightColor = border;
      el.style.borderBottomColor = border;
      // Leave the left border to CSS for crit/milestone so their accent shows.
      if (!task.crit && !task.milestone) el.style.borderLeftColor = border;
    }

    const badges = [];
    const projLabel = opts.projectLabel ? opts.projectLabel(task) : '';
    if (projLabel && hex) {
      badges.push(
        `<span class="badge card-project" style="background:${escapeHtml(global.Palette.tint(hex))};color:${escapeHtml(global.Palette.ink(hex))}">${escapeHtml(projLabel)}</span>`
      );
    }
    // Assignee badge sits in the project's colour family (see Palette.sectionChip)
    // so it reads as part of the sticky note; falls back to a per-name hue only
    // when the task has no project colour. Unassigned tasks show no badge.
    const assignee = task.assignee || '';
    if (assignee) {
      let secBg, secFg;
      if (hex && global.Palette) {
        const chip = global.Palette.sectionChip(hex, assignee);
        secBg = chip.bg; secFg = chip.fg;
      } else {
        const hue = sectionHue(assignee);
        secBg = `hsl(${hue},55%,90%)`; secFg = `hsl(${hue},45%,32%)`;
      }
      badges.push(
        `<span class="badge" style="background:${escapeHtml(secBg)};color:${escapeHtml(secFg)}">${escapeHtml(assignee)}</span>`
      );
    }
    if (task.milestone) badges.push('<span class="badge ms">◆ milestone</span>');
    if (task.crit) badges.push('<span class="badge crit">critical</span>');

    const range = dateRange(task);
    el.innerHTML = `
      <div class="card-name">${escapeHtml(task.name || 'Untitled')}</div>
      <div class="card-badges">${badges.join('')}</div>
      ${range ? `<div class="card-dates">${escapeHtml(range)}</div>` : ''}
    `;

    el.addEventListener('click', () => handlers.onEditTask(task.id));
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  global.Kanban = { render, COLUMNS };
})(window);
