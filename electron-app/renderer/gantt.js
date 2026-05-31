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

  // Calendar span (in days) covered by the tasks that have concrete dates.
  function spanDays(model) {
    let min = Infinity;
    let max = -Infinity;
    const P = global.GanttParse;
    for (const t of model.tasks) {
      if (!t.start || !P.DATE_RE.test(t.start)) continue; // skip "after"/blank
      const startMs = Date.parse(t.start + 'T00:00:00');
      if (Number.isNaN(startMs)) continue;
      const dur = t.milestone ? 0 : Math.max(0, P.parseDurationDays(t.duration));
      const endMs = startMs + dur * 86400000;
      if (startMs < min) min = startMs;
      if (endMs > max) max = endMs;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return MIN_DAYS;
    return Math.round((max - min) / 86400000) + 1;
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

  // opts.colorForTask(task) -> hex  recolours each bar in the project colour,
  // shaded by status (see Palette.shade). Omitted -> Mermaid's themed palette.
  async function render(targetEl, model, handlers, opts) {
    configure(spanDays(model));
    lastTarget = targetEl;
    lastModel = model;
    lastHandlers = handlers || lastHandlers;
    lastColorForTask = (opts && opts.colorForTask) || null;

    if (!model.tasks.length) {
      targetEl.innerHTML =
        '<div class="gantt-empty">No tasks yet. Add some in the Task List view, ' +
        'then switch back here to see the timeline.</div>';
      return;
    }

    const code = global.GanttParse.serializeGantt(model);
    try {
      const id = `gantt-svg-${++counter}`;
      const { svg } = await global.mermaid.render(id, code);
      targetEl.innerHTML = svg;
      wireSvg(targetEl, id);
      captureBaseSize(targetEl);
      applyZoom();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      targetEl.innerHTML =
        `<div class="gantt-error"><div class="gantt-error-title">Couldn’t render the timeline</div>` +
        `<pre>${escapeHtml(msg)}</pre>` +
        `<div class="gantt-error-detail">Check the Mermaid syntax in the .md file.</div></div>`;
    }
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
    updateZoomLabel();
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
