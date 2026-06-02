// Gantt view: renders the project's Mermaid gantt block with mermaid.js,
// themed to match the rest of the app, with clickable task bars (open the
// task editor) and zoom controls. We serialize the current model rather than
// the raw file text so the chart reflects in-memory edits immediately.

(function (global) {
  'use strict';

  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  // Room on the left for section labels. Section names in the global view are
  // full project titles (e.g. "Stewardship Campaign"), so this is generous
  // enough that long names don't spill over into the bars.
  const LEFT_PADDING = 180;
  const MIN_DAYS = 21;
  const MAX_WIDTH = 9000;

  // Mermaid draws the gantt's bottom axis (line + date labels) at
  // y = chartHeight - 50, not flush to the SVG bottom. The floating strip crops
  // the whole region from that axis line down to the SVG bottom and overlaps it
  // exactly, so this number must track Mermaid's layout. Covering the full region
  // (not just the label band) means the today-line stub / bottom margin below the
  // dates can't peek out beneath the floating strip.
  const AXIS_LINE_FROM_BOTTOM = 50;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Axis regime by span. Short projects get a gridline + weekday label on
  // EVERY day, spaced generously so nothing feels cramped; longer ones step up
  // to weekly/monthly ticks (and a tighter day scale) to stay legible. `px` is
  // the per-day width that pins a constant horizontal scale.
  function axisFor(days) {
    if (days <= 120) return { tickInterval: '1day',   axisFormat: '%a %d',   px: 46 };
    if (days <= 400) return { tickInterval: '1week',  axisFormat: '%b %d',   px: 22 };
    return { tickInterval: '1month', axisFormat: "%b '%y", px: 11 };
  }

  // Total width that gives the chart its regime's constant px-per-day. We size
  // to the project's actual span so a short project (e.g. a week) stays compact
  // and fits the canvas in one view rather than being padded out into a forced
  // horizontal scroll. spanDays() already returns MIN_DAYS for the no-dates
  // case, so an empty/relative-only project still gets a sane default width.
  function chartWidth(days) {
    const px = axisFor(days).px;
    const total = LEFT_PADDING + Math.max(1, days) * px;
    return Math.min(MAX_WIDTH, Math.round(total));
  }

  // Calendar span (in days) covered by the project's timeline. We must resolve
  // the SAME dates Mermaid lays out, not just the tasks with literal dates: a
  // task may start "after <ids>" or (with a bare duration) right after the
  // previous task, so a project that's mostly dependency chains still occupies
  // real calendar time. Measuring only literal-date tasks undercounts the span,
  // which sizes the chart too narrow — Mermaid then crams the full timeline into
  // it, so the days bunch up/overlap while the short canvas leaves whitespace.
  //
  // We replay Mermaid's resolution to a fixpoint so out-of-order "after" refs
  // and chains settle: absolute date wins; "after a b" starts at the latest end
  // of its refs; a blank start follows the previous task; a date in the duration
  // slot is an explicit end. Each pass resolves whatever became answerable.
  function spanDays(model) {
    const P = global.GanttParse;
    const DAY = 86400000;
    const tasks = model.tasks;
    const startMs = new Map();
    const endMs = new Map();

    for (let pass = 0; pass <= tasks.length; pass++) {
      let progressed = false;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!startMs.has(t.id)) {
          let s = null;
          if (t.start && P.DATE_RE.test(t.start)) {
            const v = Date.parse(t.start + 'T00:00:00');
            if (!Number.isNaN(v)) s = v;
          } else if (t.start && /^after\s+/i.test(t.start)) {
            const ids = t.start.trim().split(/\s+/).slice(1);
            let mx = -Infinity;
            let ok = ids.length > 0;
            for (const id of ids) {
              if (endMs.has(id)) mx = Math.max(mx, endMs.get(id));
              else ok = false;
            }
            if (ok && Number.isFinite(mx)) s = mx;
          } else if (!t.start) {
            const prev = tasks[i - 1];
            if (prev && endMs.has(prev.id)) s = endMs.get(prev.id);
          }
          if (s != null) { startMs.set(t.id, s); progressed = true; }
        }
        if (startMs.has(t.id) && !endMs.has(t.id)) {
          let e = null;
          if (t.duration && P.DATE_RE.test(t.duration)) {
            const v = Date.parse(t.duration + 'T00:00:00');
            if (!Number.isNaN(v)) e = v;
          } else {
            const dur = t.milestone ? 0 : Math.max(0, P.parseDurationDays(t.duration));
            e = startMs.get(t.id) + dur * DAY;
          }
          if (e != null) { endMs.set(t.id, e); progressed = true; }
        }
      }
      if (!progressed) break;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const t of tasks) {
      if (startMs.has(t.id) && startMs.get(t.id) < min) min = startMs.get(t.id);
      if (endMs.has(t.id) && endMs.get(t.id) > max) max = endMs.get(t.id);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return MIN_DAYS;
    return Math.round((max - min) / DAY) + 1;
  }

  function configure(days) {
    const axis = axisFor(days);
    global.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: FONT,
      // theme:'base' lets themeVariables fully drive the palette so the chart
      // sits in union with the app's greys + #89cff0 accent.
      theme: 'base',
      themeVariables: {
        fontFamily: FONT,
        fontSize: '13px',
        // To Do (untagged) tasks
        taskBkgColor: '#e6e6e6',
        taskBorderColor: '#cfcfcf',
        taskTextColor: '#2a2a2a',
        taskTextDarkColor: '#2a2a2a',
        taskTextLightColor: '#2a2a2a',
        taskTextOutsideColor: '#555555',
        taskTextClickableColor: '#1a5b7a',
        // In Progress (active) — app accent
        activeTaskBkgColor: '#bfe4f4',
        activeTaskBorderColor: '#89cff0',
        // Done — soft green
        doneTaskBkgColor: '#d7ecdd',
        doneTaskBorderColor: '#9ed4ae',
        // Critical — matches the card crit accent
        critBkgColor: '#fbe4dd',
        critBorderColor: '#e8694a',
        // Section bands + grid
        sectionBkgColor: '#f4f6f7',
        altSectionBkgColor: '#ffffff',
        sectionBkgColor2: '#eef1f3',
        gridColor: '#e2e2e2',
        todayLineColor: '#e8694a',
        titleColor: '#555555',
      },
      gantt: {
        // A fixed width (not the container width) keeps the day scale constant.
        useWidth: chartWidth(days),
        useMaxWidth: false,
        barHeight: 22,
        barGap: 6,
        topPadding: 48,
        leftPadding: LEFT_PADDING,
        gridLineStartPadding: 35,
        fontSize: 13,
        sectionFontSize: 13,
        numberSectionStyles: 2,
        // Weekly/monthly ticks + compact labels so dates never overlap.
        tickInterval: axis.tickInterval,
        axisFormat: axis.axisFormat,
        // For weekly ticks, anchor the gridline on Sunday (the start of the
        // week) rather than Mermaid's effective default, so the slightly
        // heavier week-boundary line lands on Sunday, not Saturday.
        weekday: 'sunday',
      },
    });
  }

  let counter = 0;
  let zoom = 1;
  let lastTarget = null;
  let lastModel = null;
  let lastHandlers = null;
  let lastColorForTask = null;
  let baseW = 0;
  let baseH = 0;

  // Mermaid's gantt lexer treats a handful of words as line directives when they
  // lead a line — `call`/`click`/`href` (task interactions), `title`, `section`,
  // `dateFormat`, `excludes`, a leading YYYY-MM-DD date, etc. A task literally
  // NAMED "Call vendor" or "Title slide" therefore derails the parse with a
  // cryptic "got 'callbackname'"-style error. The chart is rendered from a
  // freshly serialized copy, so we defuse the collision render-side only: prefix
  // a zero-width space to any colliding name. It's invisible in the bar but stops
  // the keyword from matching at the start of the line. The on-disk file is left
  // exactly as the user wrote it.
  const ZWSP = '​';
  const GANTT_RESERVED_RE =
    /^\s*(?:gantt|dateFormat|inclusiveEndDates|topAxis|axisFormat|tickInterval|includes|excludes|todayMarker|title|acc(?:Title|Descr|Description)|weekday|weekend|section|click|call|href)\b|^\s*\d{4}-\d{2}-\d{2}\b/i;

  function defuseReservedNames(model) {
    let changed = false;
    const tasks = model.tasks.map((t) => {
      if (t.name && GANTT_RESERVED_RE.test(t.name)) {
        changed = true;
        return Object.assign({}, t, { name: ZWSP + t.name });
      }
      return t;
    });
    return changed ? Object.assign({}, model, { tasks }) : model;
  }

  // opts.colorForTask(task) -> hex  recolours each bar in the project colour,
  // shaded by status (see Palette.shade). Omitted -> Mermaid's themed palette.
  async function render(targetEl, model, handlers, opts) {
    configure(spanDays(model));
    lastTarget = targetEl;
    lastModel = model;
    lastHandlers = handlers || lastHandlers;
    lastColorForTask = (opts && opts.colorForTask) || null;

    // The title lives in an HTML element centered over the toolbar (see
    // setToolbarTitle) rather than inside the SVG — Mermaid centers its SVG
    // title on the chart width, which scrolls out of the middle of the view.
    setToolbarTitle(targetEl, model.title);

    if (!model.tasks.length) {
      targetEl.innerHTML =
        '<div class="gantt-empty">No tasks yet. Add some in the Task List view, ' +
        'then switch back here to see the timeline.</div>';
      return;
    }

    const code = global.GanttParse.serializeGantt(defuseReservedNames(model));
    try {
      const id = `gantt-svg-${++counter}`;
      const { svg } = await global.mermaid.render(id, code);
      targetEl.innerHTML = svg;
      wireSvg(targetEl, id);
      captureBaseSize(targetEl);
      // Global view only: faint rules between the per-project bands.
      if (targetEl.id === 'global-gantt-render') addGroupSeparators(targetEl, id);
      applyZoom();
      // On opening the Timeline (not on in-place re-renders), scroll so today
      // sits dead-centre when the chart is wider than the view.
      if (opts && opts.centerOnToday) centerToday(targetEl);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      targetEl.innerHTML =
        `<div class="gantt-error"><div class="gantt-error-title">Couldn’t render the timeline</div>` +
        `<pre>${escapeHtml(msg)}</pre>` +
        `<div class="gantt-error-detail">Check the Mermaid syntax in the .md file.</div></div>`;
    }
  }

  // The Timeline title shows in an app-styled HTML element centered over the
  // toolbar (which spans the content width), so it stays put in the middle of
  // the view while the chart scrolls beneath it. Each gantt view owns one.
  function setToolbarTitle(targetEl, title) {
    const viewSel = targetEl.id === 'global-gantt-render' ? '#global-gantt' : '#gantt';
    const el = document.querySelector(`${viewSel} .gantt-title`);
    if (el) el.textContent = title || '';
  }

  // Horizontally scroll the view so the red "today" line is centred. Mermaid
  // draws it as line.today; its x is in SVG units, and the rendered chart width
  // is baseW * zoom, so the on-screen x is simply x * zoom. No-op when today is
  // outside the project's span (Mermaid then draws no marker).
  function centerToday(targetEl) {
    const scroll = targetEl.closest('.gantt-scroll');
    const svg = targetEl.querySelector('svg');
    if (!scroll || !svg || !baseW) return;
    const today = svg.querySelector('line.today') || svg.querySelector('.today');
    if (!today) return;
    const x = parseFloat(today.getAttribute('x1'));
    if (!Number.isFinite(x)) return;
    scroll.scrollLeft = Math.max(0, x * zoom - scroll.clientWidth / 2);
  }

  // Make every task bar / label clickable -> open the task editor. Mermaid
  // tags task elements with id="<renderId>-<taskId>".
  function wireSvg(targetEl, renderId) {
    const prefix = renderId + '-';
    const byId = new Map((lastModel ? lastModel.tasks : []).map((t) => [t.id, t]));
    const els = targetEl.querySelectorAll(`[id^="${CSS.escape(renderId)}-"]`);
    els.forEach((el) => {
      const taskId = el.id.slice(prefix.length);
      if (!taskId) return;
      el.classList.add('gantt-clickable');
      el.addEventListener('click', () => {
        if (lastHandlers && lastHandlers.onEditTask) lastHandlers.onEditTask(taskId);
      });
      recolour(el, byId.get(taskId));
    });
  }

  // Recolour a single task's bar in its project colour. Mermaid themes bars by
  // status, so we override the rendered fill/stroke on the shape elements
  // (rects + milestone diamonds) using Palette.shade for status contrast.
  function recolour(el, task) {
    if (!lastColorForTask || !task || !global.Palette) return;
    const hex = lastColorForTask(task);
    // Done tasks read as "finished": a neutral grey bar, but keep the project's
    // colour on the border so you can still tell what they belong to.
    let fill, stroke;
    if (task.status === 'done') {
      fill = '#e8e8e8';
      stroke = global.Palette.cardBorder(hex);
    } else {
      const sh = global.Palette.shade(hex, task.status);
      fill = sh.fill;
      stroke = sh.stroke;
    }
    const paint = (node) => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'rect' || tag === 'path') {
        node.style.fill = fill;
        node.style.stroke = stroke;
      }
    };
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect' || tag === 'path') paint(el);
    else if (tag === 'g') el.querySelectorAll('rect, path').forEach(paint);
  }

  // Global (grouped) view: each project is one Mermaid section (global.js sets
  // every task's `assignee` to its project title), so draw a faint horizontal
  // rule between consecutive project bands. We derive each band's vertical extent
  // from its own task-bar rows (tagged id="<renderId>-<taskId>") rather than
  // Mermaid's internal section rects, then place the rule at the midpoint of the
  // gap between one band's bottom and the next band's top. The lines go in a group
  // inserted right after `.grid` so they paint behind the task bars.
  function addGroupSeparators(targetEl, renderId) {
    const svg = targetEl.querySelector('svg');
    if (!svg || !lastModel || !baseW) return;
    const prefix = renderId + '-';
    const byId = new Map(lastModel.tasks.map((t) => [t.id, t]));

    const bands = new Map(); // project title -> { top, bottom } in SVG units
    svg.querySelectorAll(`rect[id^="${CSS.escape(renderId)}-"]`).forEach((rect) => {
      const task = byId.get(rect.id.slice(prefix.length));
      if (!task) return;
      const y = parseFloat(rect.getAttribute('y'));
      const h = parseFloat(rect.getAttribute('height')) || 0;
      if (!Number.isFinite(y)) return;
      const key = task.assignee || '';
      const b = bands.get(key) || { top: Infinity, bottom: -Infinity };
      b.top = Math.min(b.top, y);
      b.bottom = Math.max(b.bottom, y + h);
      bands.set(key, b);
    });

    const ordered = [...bands.values()]
      .filter((b) => Number.isFinite(b.top))
      .sort((a, b) => a.top - b.top);
    if (ordered.length < 2) return;

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'gantt-group-seps');
    for (let i = 1; i < ordered.length; i++) {
      const y = (ordered[i - 1].bottom + ordered[i].top) / 2;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'gantt-group-sep');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(baseW));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      group.appendChild(line);
    }
    const grid = svg.querySelector('.grid');
    if (grid && grid.nextSibling) grid.parentNode.insertBefore(group, grid.nextSibling);
    else svg.appendChild(group);
  }

  function captureBaseSize(targetEl) {
    const svg = targetEl.querySelector('svg');
    if (!svg) { baseW = baseH = 0; return; }
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length === 4 && vb[2] && vb[3]) {
      baseW = vb[2];
      baseH = vb[3];
    } else {
      const r = svg.getBoundingClientRect();
      baseW = r.width; baseH = r.height;
    }
  }

  function applyZoom() {
    if (!lastTarget) return;
    const svg = lastTarget.querySelector('svg');
    if (!svg || !baseW) return;
    svg.style.maxWidth = 'none';
    svg.style.width = `${Math.round(baseW * zoom)}px`;
    svg.style.height = `${Math.round(baseH * zoom)}px`;
    updateFloatingAxis(lastTarget);
    updateZoomLabel();
  }

  // Floating date axis. Mermaid only draws the axis at the chart's bottom, so a
  // chart taller than the window scrolls its dates out of view. We mirror that
  // bottom axis into a sticky strip placed inside the SAME horizontally-
  // scrolling box as the chart: it tracks horizontal scroll for free, and
  // `position: sticky; bottom: 0` (see style.css) pins it to the viewport
  // bottom only while the chart overflows downward.
  //
  // The strip is a tiny SVG whose viewBox crops the chart's bottom region (from
  // the axis line down to the SVG's bottom edge), with the cloned `.grid` kept at
  // its ORIGINAL transform so the dates land at the same x/y as the real axis. A
  // negative top margin equal to that region's height lays the strip exactly over
  // the real axis, so at rest (chart fits, or scrolled to the bottom) the two
  // coincide pixel-for-pixel and the strip is invisible — it only visibly detaches
  // once you scroll the real axis off-screen. Because it spans the whole region
  // below the axis line, its opaque background also caps the today-line stub and
  // bottom margin, so nothing pokes out beneath the date row. Rebuilt on every
  // render/zoom (cheap) to stay scale-locked.
  function updateFloatingAxis(targetEl) {
    if (!targetEl) return;
    const old = targetEl.querySelector(':scope > .gantt-axis-float');
    if (old) old.remove();
    const svg = targetEl.querySelector('svg');
    if (!svg || !baseW || !baseH) return;
    // The bottom axis is the first .grid group (topAxis is off, so it's also
    // the only one).
    const grid = svg.querySelector('.grid');
    if (!grid) return;

    const bandTop = baseH - AXIS_LINE_FROM_BOTTOM; // axis-line y, in SVG units
    const strip = document.createElementNS(SVG_NS, 'svg');
    strip.setAttribute('class', 'gantt-axis-float');
    strip.setAttribute('viewBox', `0 ${bandTop} ${baseW} ${AXIS_LINE_FROM_BOTTOM}`);
    strip.setAttribute('preserveAspectRatio', 'none');
    strip.style.width = `${Math.round(baseW * zoom)}px`;
    strip.style.height = `${Math.round(AXIS_LINE_FROM_BOTTOM * zoom)}px`;
    // Pull the strip up onto the real axis (its region sits AXIS_LINE_FROM_BOTTOM
    // above the SVG's bottom edge). Net added height is zero — the region lies
    // within the chart's own vertical extent.
    strip.style.marginTop = `${-Math.round(AXIS_LINE_FROM_BOTTOM * zoom)}px`;

    // Keep the clone's original transform so its ticks stay aligned; the
    // gridlines/domain line run out of the cropped band and are hidden in CSS,
    // leaving just the date labels.
    strip.appendChild(grid.cloneNode(true));
    targetEl.appendChild(strip);
  }

  function updateZoomLabel() {
    const txt = `${Math.round(zoom * 100)}%`;
    ['gantt-zoom-label', 'g-zoom-label'].forEach((id) => {
      const lbl = document.getElementById(id);
      if (lbl) lbl.textContent = txt;
    });
  }

  function setZoom(z) {
    zoom = Math.min(3, Math.max(0.4, z));
    applyZoom();
  }
  function zoomIn()  { setZoom(zoom + 0.2); }
  function zoomOut() { setZoom(zoom - 0.2); }
  function zoomReset() { setZoom(1); }
  function getZoom() { return zoom; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  global.Gantt = { render, zoomIn, zoomOut, zoomReset, getZoom, updateZoomLabel };
})(window);
