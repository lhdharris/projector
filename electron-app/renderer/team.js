// Team view: one column per assignee (a "to-do list" per person), with that
// person's tasks colour-coded by project and ordered with critical tasks pinned
// to the top, then by soonest deadline (next up first), with done tasks sinking
// to the bottom. Unassigned tasks collect in a final "Unassigned" column.
// Dragging a card onto another column reassigns it.
//
// This shares the Kanban's column/card chrome but, unlike the Kanban (columns
// = status), here columns = people, so each card carries a small status tag and
// each column header a "⋮" menu (add a task to that person, or delete them).

(function (global) {
  'use strict';

  const UNASSIGNED = 'Unassigned';
  const STATUS = {
    todo:   { label: 'To Do' },
    active: { label: 'In Progress' },
    done:   { label: 'Done' },
  };
  // Pause before a status change shuffles the card to its new slot, so the move
  // reads as deliberate rather than an instant jump.
  const MOVE_DELAY_MS = 320;

  // End timestamp used for "soonest deadline" ordering. Undated / "after"
  // tasks have no resolvable deadline, so they sort last (Infinity).
  function endMs(task) {
    const P = global.GanttParse;
    if (!task.start || !P.DATE_RE.test(task.start)) return Infinity;
    const startMs = Date.parse(task.start + 'T00:00:00');
    if (Number.isNaN(startMs)) return Infinity;
    if (task.milestone) return startMs;
    const dur = Math.max(0, P.parseDurationDays(task.duration));
    return startMs + dur * 86400000;
  }

  // Card's secondary line. An "after <ids>" start resolves to the predecessor
  // task names — never the raw Mermaid id — mirroring the Kanban wording; a
  // dated task shows its "due <end>"; anything else shows nothing. nameById maps
  // a task id to its name (unknown ids fall back to the id so we never lose
  // information).
  function depOrDue(task, nameById) {
    const P = global.GanttParse;
    const start = (task.start || '').trim();
    const after = /^after\s+(.+)$/i.exec(start);
    if (after) {
      const names = after[1].split(/\s+/).filter(Boolean)
        .map((id) => (nameById && nameById.get(id)) || id);
      return afterLabel(names);
    }
    if (!start || !P.DATE_RE.test(start)) return '';
    if (task.milestone) return `due ${start}`;
    const days = P.parseDurationDays(task.duration);
    const end = days > 0 ? P.addDays(start, days) : start;
    return `due ${end}`;
  }

  // "Starts after ‘X’ is finished", joining multiple predecessors naturally.
  function afterLabel(names) {
    const quoted = names.map((n) => `‘${n}’`);
    if (quoted.length === 1) return `Starts after ${quoted[0]} is finished`;
    const last = quoted.pop();
    return `Starts after ${quoted.join(', ')} and ${last} are finished`;
  }

  // Critical pinned to the top, then soonest deadline (next up first), with Done
  // sinking to the bottom; name breaks ties for stability.
  function compareTasks(a, b) {
    const da = a.status === 'done', db = b.status === 'done';
    if (da !== db) return da ? 1 : -1;
    if (!!a.crit !== !!b.crit) return a.crit ? -1 : 1;
    const ea = endMs(a), eb = endMs(b);
    if (ea !== eb) return ea - eb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }

  // "Louis" -> "Louis'"; "Anna" -> "Anna's" (matches the user's example).
  function possessive(name) {
    const n = String(name || '').trim();
    return /s$/i.test(n) ? `${n}'` : `${n}'s`;
  }
  // A person's outstanding tasks as a markdown checkbox list, in display order
  // (Done excluded). Title like "# Louis' To Do List:".
  function toDoMarkdown(label, tasks) {
    const open = tasks.filter((t) => t.status !== 'done');
    const lines = open.map((t) => `- [ ] ${String(t.name || '').trim()}`);
    return [`# ${possessive(label)} To Do List:`, '', ...lines].join('\n');
  }

  // ---- small popup menu (status picker + column "⋮") -------------------
  let popupWired = false;
  function closePopup() { const m = document.getElementById('team-popup'); if (m) m.remove(); }
  function popupMenu(x, y, items) {
    closePopup();
    if (!popupWired) {
      popupWired = true;
      document.addEventListener('click', closePopup);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });
      window.addEventListener('blur', closePopup);
    }
    const menu = document.createElement('div');
    menu.id = 'team-popup';
    menu.className = 'team-popup';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'team-popup-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '');
      b.textContent = (it.checked ? '✓ ' : '') + it.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); closePopup(); it.onClick(); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    // x/y are device px (page zoom); style.left/top are layout px the browser
    // re-multiplies by zoom — divide so the menu lands where intended.
    const r = menu.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const left = Math.min(x, window.innerWidth - r.width - 6);
    const top = Math.min(y, window.innerHeight - r.height - 6);
    menu.style.left = Math.max(0, left) / zoom + 'px';
    menu.style.top = Math.max(0, top) / zoom + 'px';
  }

  // opts: { colorForTask(task)->hex, projectLabel(task)->str, roster:[names] }
  // handlers: { onEditTask(id), onReassign(id, assignee), onSetStatus(id, status),
  //             onAddTaskFor(assignee), onDeleteMember(name) }
  function render(container, tasks, handlers, opts) {
    opts = opts || {};
    // A status change re-renders the whole board. The .team-board is the
    // horizontal scroller, and we rebuild it from scratch below, so without
    // this its scrollLeft resets and the view snaps back to the leftmost
    // column. Capture the old position and restore it onto the new board.
    const prevBoard = container.querySelector('.team-board');
    const prevScrollLeft = prevBoard ? prevBoard.scrollLeft : 0;

    container.innerHTML = '';
    closePopup();

    // id -> name, so a card showing an "after <id>" dependency can name it.
    const nameById = new Map(tasks.map((t) => [t.id, t.name || '']));

    const board = document.createElement('div');
    board.className = 'team-board';

    // Bucket by assignee. When a roster is supplied, seed a column for every
    // member (even with no tasks) — global view passes the full roster so the
    // whole team shows. A single-project view omits it, so only people who
    // actually have a task in that project get a column. Anyone assigned always
    // gets one; columns are alphabetical with Unassigned pinned last.
    const buckets = new Map();
    for (const name of (opts.roster || [])) {
      if (name) buckets.set(name, []);
    }
    // Members in their run-out-of-tasks grace period keep an (empty) column so
    // they can grey out as feedback before dropping off.
    for (const name of (opts.linger || [])) {
      if (name && !buckets.has(name)) buckets.set(name, []);
    }
    for (const t of tasks) {
      const key = t.assignee || UNASSIGNED;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const named = [...buckets.keys()].filter((k) => k !== UNASSIGNED).sort((a, b) => a.localeCompare(b));
    const order = buckets.has(UNASSIGNED) ? [...named, UNASSIGNED] : named;

    if (!order.length) {
      const empty = document.createElement('div');
      empty.className = 'team-empty';
      empty.textContent = 'No team members yet. Add people with “Manage team”, or assign a task to someone.';
      board.appendChild(empty);
    } else {
      for (const key of order) {
        const assignee = key === UNASSIGNED ? '' : key;
        const list = buckets.get(key).slice().sort(compareTasks);
        board.appendChild(column(key, assignee, list, handlers, opts, nameById));
      }
    }
    container.appendChild(board);
    // Now that the new board is in the DOM (and its scrollWidth is known), put
    // the user back where they were; the browser clamps if it's now narrower.
    board.scrollLeft = prevScrollLeft;
  }

  function column(label, assignee, tasks, handlers, opts, nameById) {
    const colEl = document.createElement('div');
    colEl.className = 'kanban-col team-col' + (assignee ? '' : ' unassigned');
    if (assignee && opts.linger && opts.linger.has(assignee)) colEl.classList.add('lingering');
    colEl.dataset.assignee = assignee;

    const head = document.createElement('div');
    head.className = 'kanban-col-head';
    head.innerHTML =
      `<span class="team-name"></span>` +
      `<span class="count">${tasks.length}</span>` +
      `<button class="col-menu-btn" title="Member actions" aria-label="Member actions">⋮</button>`;
    head.querySelector('.team-name').textContent = label;

    head.querySelector('.col-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const items = [
        { label: 'Add task', onClick: () => handlers.onAddTaskFor && handlers.onAddTaskFor(assignee) },
        { label: 'Copy list as tasks', onClick: () => handlers.onCopyList && handlers.onCopyList(toDoMarkdown(label, tasks)) },
      ];
      if (assignee) {
        items.push({ label: 'Delete team member', danger: true, onClick: () => handlers.onDeleteMember && handlers.onDeleteMember(assignee) });
      }
      popupMenu(e.clientX, e.clientY, items);
    });
    colEl.appendChild(head);

    const listEl = document.createElement('div');
    listEl.className = 'kanban-list';
    for (const task of tasks) listEl.appendChild(card(task, handlers, opts, nameById));
    colEl.appendChild(listEl);

    // Drop a card here to reassign it to this column's person.
    colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('drag-over'); });
    colEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
    colEl.addEventListener('drop', (e) => {
      e.preventDefault();
      colEl.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) handlers.onReassign(id, assignee);
    });

    return colEl;
  }

  function card(task, handlers, opts, nameById) {
    const el = document.createElement('div');
    const status = task.status || 'todo';
    el.className = 'card ' + status + (task.crit ? ' crit' : '') + (task.milestone ? ' milestone' : '');
    el.draggable = true;
    el.dataset.id = task.id;

    // Status-aware shading (Palette.shade) so a person's mixed-status column
    // reads at a glance: To Do is the palest, In Progress shows the full pastel,
    // Done is lighter + desaturated. In Progress also gets a thicker border
    // (see .team-col .card.active) to stand out further from To Do.
    const hex = opts.colorForTask ? opts.colorForTask(task) : null;
    if (hex && global.Palette) {
      const sh = global.Palette.shade(hex, status);
      el.style.background = sh.fill;
      el.style.borderTopColor = sh.stroke;
      el.style.borderRightColor = sh.stroke;
      el.style.borderBottomColor = sh.stroke;
      if (!task.crit && !task.milestone) el.style.borderLeftColor = sh.stroke;
    }

    const badges = [];
    const projLabel = opts.projectLabel ? opts.projectLabel(task) : '';
    if (projLabel && hex && global.Palette) {
      badges.push(
        `<span class="badge card-project" style="background:${escapeHtml(global.Palette.tint(hex))};color:${escapeHtml(global.Palette.ink(hex))}">${escapeHtml(projLabel)}</span>`
      );
    }
    if (task.milestone) badges.push('<span class="badge ms">◆ milestone</span>');
    if (task.crit) badges.push('<span class="badge crit">critical</span>');

    const dateLine = depOrDue(task, nameById);
    el.innerHTML = `
      <div class="card-name">${escapeHtml(task.name || 'Untitled')}</div>
      <div class="card-status-row"></div>
      <div class="card-badges">${badges.join('')}</div>
      ${dateLine ? `<div class="card-dates">${escapeHtml(dateLine)}</div>` : ''}
    `;

    // Status tag under the title (mirrors the Task List pill). Clicking it opens
    // a small picker; choosing a new status pauses briefly, then reshuffles the
    // card to its new slot. Its clicks must not bubble to the card (edit) / drag.
    const tag = document.createElement('button');
    tag.type = 'button';
    // In Progress keeps the project-colour tint (it reads better than flat grey);
    // To Do / Done use the neutral grey .badge look, which stands out clearly as a
    // clickable dropdown even on those palest cards.
    tag.className = 'card-status-tag badge';
    tag.textContent = STATUS[status].label;
    if (status === 'active' && hex && global.Palette) {
      tag.style.background = global.Palette.tint(hex);
      tag.style.color = global.Palette.ink(hex);
    }
    tag.addEventListener('mousedown', (e) => e.stopPropagation());
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = tag.getBoundingClientRect();
      popupMenu(r.left, r.bottom + 2, ['active', 'todo', 'done'].map((key) => ({
        label: STATUS[key].label,
        checked: key === status,
        onClick: () => {
          if (key === status || !handlers.onSetStatus) return;
          // Optimistic tag update + brief pause, then commit (re-render reorders).
          tag.textContent = STATUS[key].label;
          el.classList.add('status-moving');
          setTimeout(() => handlers.onSetStatus(task.id, key), MOVE_DELAY_MS);
        },
      })));
    });
    el.querySelector('.card-status-row').appendChild(tag);

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

  global.Team = { render };
})(window);
