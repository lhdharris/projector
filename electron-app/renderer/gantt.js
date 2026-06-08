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

  // Below this per-day width (px), a faint rule on every day reads as a grey
  // wash rather than a grid, so addDayGridlines leaves those (monthly-tick)
  // charts to the month rules alone. The weekly regime (22px) clears it.
  const DAY_LINE_MIN_PX = 16;

  // Mermaid draws the gantt's bottom axis (line + date labels) at
  // y = chartHeight - 50, not flush to the SVG bottom. The floating strip crops
  // the whole region from that axis line down to the SVG bottom and overlaps it
  // exactly, so this number must track Mermaid's layout. Covering the full region
  // (not just the label band) means the today-line stub / bottom margin below the
  // dates can't peek out beneath the floating strip.
  const AXIS_LINE_FROM_BOTTOM = 50;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Axis regime by span. Short projects get a gridline + weekday label on
  // EVERY day, spaced generously so nothing feels cramped; medium ones step up
  // to weekly ticks but keep the weekday + day-of-month label (the weekly
  // gridlines all land on Sundays, so this confirms the week boundary — the
  // month is already shown in the sticky top header, no need to repeat it).
  // Long projects step up to monthly ticks, where the tick *is* the month
  // marker. `px` is the per-day width that pins a constant horizontal scale.
  function axisFor(days) {
    if (days <= 120) return { tickInterval: '1day',   axisFormat: '%a %d',   px: 46 };
    if (days <= 400) return { tickInterval: '1week',  axisFormat: '%a %d',   px: 22 };
    return { tickInterval: '1month', axisFormat: "%b '%y", px: 11 };
  }

  // Total width that gives the chart its regime's constant px-per-day. We size
  // to the project's actual span so a short project (e.g. a week) stays compact
  // and fits the canvas in one view rather than being padded out into a forced
  // horizontal scroll. resolveSpan() already returns MIN_DAYS for the no-dates
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
  function resolveSpan(model) {
    const DAY = 86400000;
    // GanttParse.resolveSchedule replays Mermaid's scheduling to a fixpoint and
    // is the single source of truth for task start/end timestamps (shared with
    // the PDF export). We only add the aggregate min/max/day-count the chart
    // sizing needs on top of its per-task maps.
    const { startMs, endMs } = global.GanttParse.resolveSchedule(model);
    const tasks = model.tasks;

    let min = Infinity;
    let max = -Infinity;
    for (const t of tasks) {
      if (startMs.has(t.id) && startMs.get(t.id) < min) min = startMs.get(t.id);
      if (endMs.has(t.id) && endMs.get(t.id) > max) max = endMs.get(t.id);
    }
    const ok = Number.isFinite(min) && Number.isFinite(max);
    return {
      startMs,                                  // taskId -> start ms, for the month header's x-calibration
      minMs: ok ? min : null,
      maxMs: ok ? max : null,
      days: ok ? Math.round((max - min) / DAY) + 1 : MIN_DAYS,
    };
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
        // Mermaid sizes each section band as taskCount * (barHeight + barGap),
        // and centres the section label in it. A roomy gap means even a
        // one-task band (one row) is tall enough to hold a two-line wrapped
        // label (see wrapSectionLabels) without the lines colliding.
        barGap: 16,
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
  let lastSpan = null;     // { startMs, minMs, maxMs, days } from the last render
  let lastTaskShiftY = 0;  // px the task group was nudged down to centre in bands

  // Defuse task names that collide with Mermaid's gantt line grammar. The chart
  // is rendered from a freshly serialized copy, so we patch the names render-side
  // only; the on-disk file keeps exactly what the user wrote. Two collisions:
  //
  // 1. Reserved leading words. The lexer treats a handful of words as line
  //    directives when they lead a line — `call`/`click`/`href` (task
  //    interactions), `title`, `section`, `dateFormat`, `excludes`, a leading
  //    YYYY-MM-DD date, etc. A task literally NAMED "Call vendor" or "Title
  //    slide" derails the parse with a cryptic "got 'callbackname'"-style error.
  //    A zero-width space prefix is invisible in the bar but stops the keyword
  //    from matching at the start of the line.
  //
  // 2. A colon in the name. ':' is Mermaid's delimiter between a task's name and
  //    its metadata (the lexer reads the name as [^:\n]+), so a name like
  //    "Update website: landing page" truncates the bar label at the colon and
  //    spills the rest into the metadata slots — breaking the click target, or
  //    the whole render. We swap each ':' for a colon look-alike (U+A789) the
  //    lexer doesn't treat as a delimiter; it reads as a colon in the label.
  const ZWSP = '​';
  const COLON_LOOKALIKE = '꞉'; // ꞉ MODIFIER LETTER COLON
  const GANTT_RESERVED_RE =
    /^\s*(?:gantt|dateFormat|inclusiveEndDates|topAxis|axisFormat|tickInterval|includes|excludes|todayMarker|title|acc(?:Title|Descr|Description)|weekday|weekend|section|click|call|href)\b|^\s*\d{4}-\d{2}-\d{2}\b/i;

  function defuseReservedNames(model) {
    let changed = false;
    const tasks = model.tasks.map((t) => {
      if (!t.name) return t;
      let name = t.name;
      if (name.includes(':')) name = name.split(':').join(COLON_LOOKALIKE);
      if (GANTT_RESERVED_RE.test(name)) name = ZWSP + name;
      if (name === t.name) return t;
      changed = true;
      return Object.assign({}, t, { name });
    });
    return changed ? Object.assign({}, model, { tasks }) : model;
  }

  // opts.colorForTask(task) -> hex  recolours each bar in the project colour,
  // shaded by status (see Palette.shade). Omitted -> Mermaid's themed palette.
  async function render(targetEl, model, handlers, opts) {
    lastSpan = resolveSpan(model);
    configure(lastSpan.days);
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
      // Flip any task label Mermaid parked in the left section gutter over to
      // the right of its bar (and widen the canvas to fit) BEFORE captureBaseSize,
      // so baseW reflects any widening.
      reflowLeftLabels(targetEl, id);
      // Wrap any section label (project title in the global view) that's too wide
      // for the gutter onto a second line, so it stops spilling over the bars.
      wrapSectionLabels(targetEl);
      // Mermaid parks each bar at the TOP of its (taller) row band, dumping the
      // barGap as dead space below, so titles ride high in their block. Nudge the
      // whole task group down to sit centred. Must precede addGroupSeparators,
      // which reads the bars' positions to place the per-project rules.
      centerTaskRows(targetEl, id);
      // Mermaid also leaves the section labels (assignee / project title) a couple
      // of px low in their bands; recentre so a single-task band reads as centred.
      // Before addGroupSeparators, which folds the (now-centred) label boxes in.
      centerSectionLabels(targetEl);
      captureBaseSize(targetEl);
      // A heavier vertical rule at each month boundary, so multi-month spans read
      // as months rather than an undifferentiated run of day/week gridlines.
      addMonthBoundaries(targetEl);
      // Faint vertical rule on every unlabelled day, so a weekly/monthly-tick
      // chart still shows where each day falls between the labelled dates.
      addDayGridlines(targetEl);
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

  // When a task name is wider than its bar, Mermaid draws the label OUTSIDE the
  // bar; for a bar near the chart's left edge on a short timeline it picks the
  // LEFT side (class taskTextOutsideLeft, text-anchor:end), so the label lands in
  // the LEFT_PADDING section-label gutter and overlaps the section titles. Flip
  // every such label to the right of its bar instead — never obstructing the
  // sections — and widen the SVG if a flipped label runs past the current right
  // edge, so a very short chart can scroll to reveal it rather than clipping it.
  function reflowLeftLabels(targetEl, renderId) {
    const svg = targetEl.querySelector('svg');
    if (!svg) return;
    const lefts = svg.querySelectorAll('text.taskTextOutsideLeft');
    if (!lefts.length) return;

    const prefix = renderId + '-';
    const PAD = 6; // gap between the bar's right edge and the label
    let maxRight = 0;
    lefts.forEach((text) => {
      // id is `${renderId}-${taskId}-text`; the bar carries `${renderId}-${taskId}`.
      const id = text.id || '';
      if (!id.startsWith(prefix) || !id.endsWith('-text')) return;
      const taskId = id.slice(prefix.length, -'-text'.length);
      const bar = svg.querySelector(`[id="${CSS.escape(prefix + taskId)}"]`);
      if (!bar) return;
      let box;
      try { box = bar.getBBox(); } catch (_) { return; } // rect or milestone path
      const x = box.x + box.width + PAD;
      text.setAttribute('x', String(x));
      // Swap only the placement token so the label inherits text-anchor:start and
      // the outside-fill colour; gantt-clickable (added by wireSvg) is preserved.
      const cls = text.getAttribute('class') || '';
      text.setAttribute('class', cls.replace('taskTextOutsideLeft', 'taskTextOutsideRight'));
      let w = 0;
      try { w = text.getBBox().width; } catch (_) {} // width is independent of x/anchor
      maxRight = Math.max(maxRight, x + w);
    });

    // Grow the viewBox (and width attr) so a flipped label past the old right
    // edge becomes scrollable instead of being clipped by the SVG root.
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length === 4 && Number.isFinite(vb[2]) && maxRight + 12 > vb[2]) {
      vb[2] = Math.round(maxRight + 12);
      svg.setAttribute('viewBox', vb.join(' '));
      svg.setAttribute('width', String(vb[2]));
    }
  }

  // Mermaid draws each section label (a full project title in the global view)
  // as a single-line <text> pinned in the left gutter; one wider than the gutter
  // spills right over the task bars. Mermaid already lays multi-line labels out
  // itself — a <text dy="-(lines-1)/2 em"> wrapping per-line <tspan x="10">, the
  // first line alignment-baseline:central and later lines dy="1em" — so we wrap
  // an over-wide label onto a second line in that exact shape, ellipsising line
  // two if it still overflows. The roomy barGap (see configure) keeps even a
  // one-task band tall enough for the two lines to sit without colliding.
  function wrapSectionLabels(targetEl) {
    const svg = targetEl.querySelector('svg');
    if (!svg) return;
    const labels = svg.querySelectorAll('text.sectionTitle');
    if (!labels.length) return;
    const PAD = 6;
    const ELLIPSIS = '…';

    labels.forEach((text) => {
      // Leave labels Mermaid already split onto multiple lines alone.
      if (text.querySelectorAll('tspan').length > 1) return;
      const full = (text.textContent || '').trim();
      if (!full) return;
      let box;
      try { box = text.getBBox(); } catch (_) { return; }
      const avail = LEFT_PADDING - box.x - PAD;
      if (avail <= 0 || box.width <= avail) return; // already fits the gutter

      const x = text.getAttribute('x') || '10';

      // Measure candidates with a throwaway tspan so they inherit the label font.
      const probe = document.createElementNS(SVG_NS, 'tspan');
      text.appendChild(probe);
      const widthOf = (s) => {
        probe.textContent = s;
        try { return probe.getComputedTextLength(); } catch (_) { return 0; }
      };

      // Greedily fill line 1; the remaining words spill to line 2.
      const words = full.split(/\s+/);
      let l1 = '';
      let i = 0;
      for (; i < words.length; i++) {
        const cand = l1 ? l1 + ' ' + words[i] : words[i];
        if (l1 && widthOf(cand) > avail) break;
        l1 = cand;
      }
      let l2 = words.slice(i).join(' ');
      if (l2 && widthOf(l2) > avail) {
        while (l2 && widthOf(l2 + ELLIPSIS) > avail) l2 = l2.slice(0, -1);
        l2 = l2.replace(/\s+$/, '') + ELLIPSIS;
      }
      text.removeChild(probe);
      if (!l2) return; // a single unbreakable word — leave the one line as-is

      // Rebuild as two centred lines, mirroring Mermaid's own multi-line shape
      // but with leading: a 1em line gap makes 13px glyphs touch, so space the
      // lines LINE_GAP apart and shift the block up by half that to stay centred.
      const LINE_GAP = 1.35; // em, line-to-line spacing
      text.textContent = '';
      text.setAttribute('dy', `${-LINE_GAP / 2}em`);
      const t1 = document.createElementNS(SVG_NS, 'tspan');
      t1.setAttribute('x', x);
      t1.setAttribute('alignment-baseline', 'central');
      t1.textContent = l1;
      const t2 = document.createElementNS(SVG_NS, 'tspan');
      t2.setAttribute('x', x);
      t2.setAttribute('alignment-baseline', 'central');
      t2.setAttribute('dy', `${LINE_GAP}em`);
      t2.textContent = l2;
      text.appendChild(t1);
      text.appendChild(t2);
    });
  }

  // Vertically centre each task's bar + label within its row band. Mermaid sizes
  // every row band as barHeight + barGap and pins the bar to the band's TOP, so
  // the whole barGap becomes empty space BELOW the bar and the title sits high in
  // its block rather than midway between the row dividers. The bars + labels (and
  // milestone diamonds + link wrappers) all live in a single <g>, so one
  // translate on that group recentres them together without disturbing the bands,
  // gridlines, today line or section labels. We measure the offset from the
  // rendered geometry — the gap between a bar's centre and its band's centre — so
  // it tracks Mermaid's layout rather than hard-coding the barGap. addGroupSeparators
  // reads the bars' (unshifted) y attributes, so we record the shift for it to add.
  function centerTaskRows(targetEl, renderId) {
    lastTaskShiftY = 0;
    const svg = targetEl.querySelector('svg');
    if (!svg || !lastModel || !lastModel.tasks.length) return;
    const prefix = renderId + '-';

    // Row bands: one `rect.section*` per task row, taller than the bar it holds.
    const bands = [];
    svg.querySelectorAll('rect.section').forEach((r) => {
      const y = parseFloat(r.getAttribute('y'));
      const h = parseFloat(r.getAttribute('height'));
      if (Number.isFinite(y) && Number.isFinite(h)) bands.push({ y, h });
    });
    if (!bands.length) return;

    // A representative task bar (first task that has a rect) and the group it's in.
    let bar = null;
    let group = null;
    for (const t of lastModel.tasks) {
      const el = svg.querySelector(`[id="${CSS.escape(prefix + t.id)}"]`);
      if (!el) continue;
      const rect = el.tagName.toLowerCase() === 'rect'
        ? el
        : (el.querySelector && el.querySelector('rect'));
      if (rect) { bar = rect; group = rect.closest('g'); break; }
    }
    if (!bar || !group) return;
    const by = parseFloat(bar.getAttribute('y'));
    const bh = parseFloat(bar.getAttribute('height'));
    if (!Number.isFinite(by) || !Number.isFinite(bh)) return;

    // The band that vertically contains this bar; centre the bar in it.
    const barCenter = by + bh / 2;
    const band = bands.find((b) => barCenter >= b.y && barCenter <= b.y + b.h);
    if (!band) return;
    const delta = (band.y + band.h / 2) - barCenter;
    if (Math.abs(delta) < 0.5) return; // already centred — leave it alone

    const prev = group.getAttribute('transform');
    group.setAttribute('transform', `${prev ? prev + ' ' : ''}translate(0, ${delta})`);
    lastTaskShiftY = delta;
  }

  // Vertically centre each section label on its band. Mermaid centres the label
  // (the assignee in the single-project view, the project title in the global
  // view) on its section but with a small constant downward baseline bias, so on
  // a tall multi-task band it looks centred while on a short single-task band the
  // title sits visibly low. We rebuild each section's full vertical extent from
  // its row bands and nudge the label's box onto that centre. Runs as a sibling
  // of centerTaskRows so the two together leave a single-task row reading as
  // bar + label both centred between the row dividers.
  function centerSectionLabels(targetEl) {
    const svg = targetEl.querySelector('svg');
    if (!svg) return;
    const labels = [...svg.querySelectorAll('text.sectionTitle')];
    if (!labels.length) return;

    // Per-row section bands -> per-section extents. Consecutive rows in one
    // section share a sectionN class; the styles alternate, so adjacent sections
    // always differ — runs of equal class therefore delimit whole sections.
    const rows = [...svg.querySelectorAll('rect.section')]
      .map((r) => ({
        y: parseFloat(r.getAttribute('y')),
        h: parseFloat(r.getAttribute('height')),
        cls: r.getAttribute('class') || '',
      }))
      .filter((r) => Number.isFinite(r.y) && Number.isFinite(r.h))
      .sort((a, b) => a.y - b.y);
    if (!rows.length) return;
    const runs = [];
    for (const r of rows) {
      const last = runs[runs.length - 1];
      if (last && last.cls === r.cls && Math.abs(r.y - last.bottom) < 1) {
        last.bottom = r.y + r.h;
      } else {
        runs.push({ cls: r.cls, top: r.y, bottom: r.y + r.h });
      }
    }

    // Match labels to runs in vertical order; bail on any mismatch rather than
    // risk centring a label on the wrong band.
    const items = [];
    for (const label of labels) {
      let box;
      try { box = label.getBBox(); } catch (_) { return; }
      items.push({ label, box });
    }
    items.sort((a, b) => a.box.y - b.box.y);
    if (items.length !== runs.length) return;

    items.forEach(({ label, box }, i) => {
      const center = (runs[i].top + runs[i].bottom) / 2;
      const delta = center - (box.y + box.height / 2);
      if (Math.abs(delta) < 0.5) return;
      // Section labels are positioned by a y attribute (Mermaid) that the wrapped
      // two-line tspans inherit, so shifting y moves the whole block; fall back to
      // a transform if some build ever drops the attribute.
      const y = parseFloat(label.getAttribute('y'));
      if (Number.isFinite(y)) {
        label.setAttribute('y', String(y + delta));
      } else {
        const prev = label.getAttribute('transform');
        label.setAttribute('transform', `${prev ? prev + ' ' : ''}translate(0, ${delta})`);
      }
    });
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
      // centerTaskRows nudged the bars down via a group transform, leaving their
      // y attributes untouched; add that shift so the rules land in the real gaps.
      const y = parseFloat(rect.getAttribute('y')) + lastTaskShiftY;
      const h = parseFloat(rect.getAttribute('height')) || 0;
      if (!Number.isFinite(y)) return;
      const key = task.assignee || '';
      const b = bands.get(key) || { top: Infinity, bottom: -Infinity };
      b.top = Math.min(b.top, y);
      b.bottom = Math.max(b.bottom, y + h);
      bands.set(key, b);
    });

    // A wrapped two-line section label (wrapSectionLabels) is centred on its
    // band but, for a one-task band, spills past the single bar. Fold each
    // label's own vertical extent into its band before placing the rule, so the
    // separator lands in the real gap between labels rather than through line two.
    const bandList = [...bands.values()].filter((b) => Number.isFinite(b.top));
    svg.querySelectorAll('text.sectionTitle').forEach((label) => {
      let box;
      try { box = label.getBBox(); } catch (_) { return; }
      if (!box || !Number.isFinite(box.y)) return;
      const cy = box.y + box.height / 2;
      // The label is centred in its band, so its centre falls in one band's bar
      // range; fall back to the nearest band centre if it sits in a gap.
      let band = bandList.find((b) => cy >= b.top && cy <= b.bottom);
      if (!band) {
        let bestD = Infinity;
        for (const b of bandList) {
          const d = Math.abs((b.top + b.bottom) / 2 - cy);
          if (d < bestD) { bestD = d; band = b; }
        }
      }
      if (!band) return;
      band.top = Math.min(band.top, box.y);
      band.bottom = Math.max(band.bottom, box.y + box.height);
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
    updateMonthHeader(lastTarget);
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

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // First-of-month timestamps from the start month's 1st through maxMs. The
  // first entry can precede minMs (a mid-month start) — its label is clamped to
  // the chart's left edge in updateMonthHeader.
  function monthStarts(minMs, maxMs) {
    const out = [];
    let cur = new Date(new Date(minMs).getFullYear(), new Date(minMs).getMonth(), 1);
    while (cur.getTime() <= maxMs) {
      out.push(cur.getTime());
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return out;
  }

  // A linear date(ms) -> x (SVG units) map, calibrated from the rendered chart
  // rather than assumed, so it survives Mermaid's internal padding and version
  // drift. We pair task-bar rects (left edge x = scale(start)) with the start
  // dates resolved by resolveSpan, then fit a line through the two anchors with
  // the widest date separation. Falls back to the regime's constant px-per-day
  // from minMs when fewer than two dated bars exist (e.g. an all-milestone or
  // single-task project).
  function buildDateToX(targetEl) {
    const svg = targetEl.querySelector('svg');
    if (!svg || !lastSpan || !lastModel) return null;
    const startMs = lastSpan.startMs;
    const pts = [];
    for (const t of lastModel.tasks) {
      if (!startMs.has(t.id)) continue;
      // The renderId-taskId id may sit on the bar rect or a wrapping group.
      let rect = null;
      for (const el of svg.querySelectorAll(`[id$="-${t.id}"]`)) {
        if (el.tagName.toLowerCase() === 'rect') { rect = el; break; }
        const r = el.querySelector && el.querySelector('rect');
        if (r) { rect = r; break; }
      }
      if (!rect) continue;
      const x = parseFloat(rect.getAttribute('x'));
      if (Number.isFinite(x)) pts.push({ ms: startMs.get(t.id), x });
    }
    if (pts.length >= 2) {
      let lo = pts[0], hi = pts[0];
      for (const p of pts) { if (p.ms < lo.ms) lo = p; if (p.ms > hi.ms) hi = p; }
      if (hi.ms !== lo.ms) {
        const m = (hi.x - lo.x) / (hi.ms - lo.ms);
        const b = lo.x - m * lo.ms;
        return (ms) => m * ms + b;
      }
    }
    const px = axisFor(lastSpan.days).px;
    const DAY = 86400000;
    const base = lastSpan.minMs;
    return (ms) => LEFT_PADDING + ((ms - base) / DAY) * px;
  }

  // Read the rendered date axis: the gridlines' shared vertical extent
  // (yTop..yBot, absolute SVG units) and each tick's x. The month rules and the
  // faint day rules both hang on this — to span exactly the gridline height, and
  // to snap onto / skip the lines Mermaid already drew. The bottom-axis gridlines
  // live in a `.grid` group translated down to the axis line (y = chartHeight -
  // 50); d3 draws each tick line from an IMPLICIT y1=0 up to a negative y2 (the
  // tickSize), so we read a tick's RENDERED box (getBBox captures the implicit y1)
  // and add the group's translateY to land in absolute SVG coords. Reading the
  // raw y1/y2 attributes doesn't work — d3 omits y1, leaving only the single y2,
  // which collapses yTop===yBot into a zero-length (invisible) line. Each d3 tick
  // is a <g transform="translate(x,0)"> wrapping the gridline, so the line's x
  // lives in the group transform (its own x1/x2 are local). Falls back to the
  // whole region above the bottom axis when the grid can't be measured (e.g.
  // rendered hidden).
  function measureGrid(svg) {
    const grid = svg.querySelector('.grid');
    let yTop = Infinity;
    let yBot = -Infinity;
    const tickXs = [];           // rendered gridline x's (SVG units), to snap onto
    if (grid) {
      const tl = grid.transform.baseVal;
      const gx = tl && tl.numberOfItems ? tl.getItem(0).matrix.e : 0;
      const ty = tl && tl.numberOfItems ? tl.getItem(0).matrix.f : 0;
      grid.querySelectorAll('.tick').forEach((tick) => {
        const ln = tick.querySelector('line');
        if (!ln) return;
        let bb;
        try { bb = ln.getBBox(); } catch (_) { return; }
        yTop = Math.min(yTop, ty + bb.y);
        yBot = Math.max(yBot, ty + bb.y + bb.height);
        const tt = tick.transform.baseVal;
        if (tt && tt.numberOfItems) tickXs.push(gx + tt.getItem(0).matrix.e);
      });
    }
    if (!Number.isFinite(yTop) || !Number.isFinite(yBot) || yBot - yTop < 4) {
      yTop = 0;
      yBot = baseH - AXIS_LINE_FROM_BOTTOM;
    }
    return { grid, yTop, yBot, tickXs };
  }

  // A 2px vertical rule inside the chart at the first of each month, drawn behind
  // the task bars so multi-month timelines segment visibly into months (the
  // day/week gridlines alone give no monthly cue). Lives in SVG units like the
  // bars, so it scales with zoom for free (unlike the HTML month-label header).
  // Calibrated with the same date->x map as the header so each line sits under
  // its month label. Only the boundaries strictly inside the span get a line —
  // the first month begins at/before the chart's left edge, which is no boundary.
  function addMonthBoundaries(targetEl) {
    const svg = targetEl.querySelector('svg');
    if (!svg || !lastSpan || !baseH) return;
    const { minMs, maxMs } = lastSpan;
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return;
    const months = monthStarts(minMs, maxMs).filter((ms) => ms > minMs);
    if (!months.length) return;
    const toX = buildDateToX(targetEl);
    if (!toX) return;

    // Span the lines over the same vertical extent as Mermaid's gridlines.
    const { grid, yTop, yBot, tickXs } = measureGrid(svg);

    // toX is a 2-point linear fit of d3's date scale, so a boundary can land a
    // hair off the gridline d3 actually drew — the rule then reads as a faint
    // double line beside the day line instead of thickening it. When a gridline
    // sits right at the 1st (the daily and monthly regimes always have one) snap
    // onto its exact x so the two overlap. The 8px tolerance is well under a
    // day's width, so the weekly regime (Sunday ticks, usually no line on the
    // 1st) keeps its calibrated x rather than jumping to a nearby Sunday.
    const SNAP_PX = 8;

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'gantt-month-bounds');
    for (const ms of months) {
      const x0 = toX(ms);
      if (!Number.isFinite(x0)) continue;
      let x = x0;
      let bestD = SNAP_PX;
      for (const tx of tickXs) {
        const d = Math.abs(tx - x0);
        if (d <= bestD) { bestD = d; x = tx; }
      }
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'gantt-month-bound');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', String(yTop));
      line.setAttribute('y2', String(yBot));
      group.appendChild(line);
    }
    if (!group.childNodes.length) return;
    // After `.grid` so the rules sit over the gridlines/section bands but before
    // the task bars that follow in document order, which paint on top.
    if (grid && grid.nextSibling) grid.parentNode.insertBefore(group, grid.nextSibling);
    else if (grid) grid.parentNode.appendChild(group);
    else svg.appendChild(group);
  }

  // Faint vertical rule on every day the axis doesn't already mark, so a chart on
  // weekly (or coarser) ticks still shows where each day falls between the
  // labelled dates — e.g. a weekly axis labels the Sundays, and these fill in the
  // six days between. Lives in SVG units like the month rules, so it scales with
  // zoom for free, and is calibrated with the same date->x map. Skipped on the
  // densest scales (px < DAY_LINE_MIN_PX), where a line every day would smear into
  // a grey wash and the month rules carry the structure alone. Days that coincide
  // with a gridline Mermaid already drew (the weekly Sundays) are left to it so we
  // don't thicken them.
  function addDayGridlines(targetEl) {
    const svg = targetEl.querySelector('svg');
    if (!svg || !lastSpan || !baseH) return;
    const { minMs, maxMs } = lastSpan;
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return;
    const axis = axisFor(lastSpan.days);
    if (axis.tickInterval === '1day' || axis.px < DAY_LINE_MIN_PX) return;
    const toX = buildDateToX(targetEl);
    if (!toX) return;

    const { grid, yTop, yBot, tickXs } = measureGrid(svg);
    const SNAP_PX = 6; // a day within this of a tick IS that tick — don't redraw

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'gantt-day-lines');
    // Walk local midnights across the span (setDate stays on the day boundary
    // through DST, unlike adding a fixed 86.4M ms).
    const cur = new Date(minMs);
    cur.setHours(0, 0, 0, 0);
    for (; cur.getTime() <= maxMs; cur.setDate(cur.getDate() + 1)) {
      const ms = cur.getTime();
      if (ms < minMs) continue;
      const x = toX(ms);
      if (!Number.isFinite(x)) continue;
      let onTick = false;
      for (const tx of tickXs) { if (Math.abs(tx - x) <= SNAP_PX) { onTick = true; break; } }
      if (onTick) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'gantt-day-line');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', String(yTop));
      line.setAttribute('y2', String(yBot));
      group.appendChild(line);
    }
    if (!group.childNodes.length) return;
    // Insert right after `.grid` too: addMonthBoundaries already put its group
    // there, so this lands BETWEEN `.grid` and the month rules — the faint day
    // lines paint beneath the heavier month rules (and both beneath the bars).
    if (grid && grid.nextSibling) grid.parentNode.insertBefore(group, grid.nextSibling);
    else if (grid) grid.parentNode.appendChild(group);
    else svg.appendChild(group);
  }

  // Floating month header. Mermaid's date axis (daily/weekly ticks) doesn't mark
  // which month a date falls in, so a multi-month project has no monthly anchor.
  // We add a sticky strip of month labels: as the first child of the
  // horizontally-scrolling render box it tracks horizontal scroll for free, and
  // position:sticky;top:0 (style.css) pins it to the top of the view while the
  // chart scrolls down. Only shown when the span crosses a month boundary.
  // Rebuilt on every render/zoom (cheap) to stay scale-locked.
  function updateMonthHeader(targetEl) {
    if (!targetEl) return;
    const old = targetEl.querySelector(':scope > .gantt-month-header');
    if (old) old.remove();
    const svg = targetEl.querySelector('svg');
    if (!svg || !baseW || !lastSpan) return;
    const { minMs, maxMs } = lastSpan;
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return;

    const months = monthStarts(minMs, maxMs);
    if (months.length < 2) return;      // single month: nothing to mark

    const toX = buildDateToX(targetEl);
    if (!toX) return;

    const header = document.createElement('div');
    header.className = 'gantt-month-header';
    header.style.width = `${Math.round(baseW * zoom)}px`;

    let prevYear = null;
    for (const ms of months) {
      const d = new Date(ms);
      // Clamp a month beginning before the chart to its left edge.
      const x = Math.max(0, toX(Math.max(ms, minMs)) * zoom);
      const label = document.createElement('div');
      label.className = 'gantt-month-label';
      label.style.left = `${Math.round(x)}px`;
      label.dataset.natural = String(Math.round(x)); // boundary x, for the scroll pin
      const y = d.getFullYear();
      label.textContent = y !== prevYear ? `${MONTHS[d.getMonth()]} ${y}` : MONTHS[d.getMonth()];
      prevYear = y;
      header.appendChild(label);
    }
    // Prepend so it sits at the chart's top and scrolls horizontally with it.
    targetEl.insertBefore(header, targetEl.firstChild);

    // Cache each label's rendered width (one layout read, post-insert) for the
    // pin math, then pin for the current scroll position and keep it pinned.
    for (const lbl of header.children) lbl.dataset.w = String(lbl.offsetWidth);
    const scroll = targetEl.closest('.gantt-scroll');
    if (!scroll) return;
    pinMonthHeader(scroll);
    if (!scroll.__monthPinBound) {
      scroll.__monthPinBound = true;
      scroll.addEventListener('scroll', () => pinMonthHeader(scroll), { passive: true });
    }
  }

  // Keep the month label for the region at the viewport's left edge pinned there
  // as the chart scrolls sideways, so a multi-month chart always names the month
  // you're looking at instead of going blank between boundaries that can sit far
  // apart. The active label rides the left edge until the next month's label
  // reaches it and pushes it off (a sticky-section-header feel). Cheap: reads
  // scrollLeft and writes left on a handful of labels — widths are pre-cached, so
  // no layout thrash. Re-queries the header each call since render/zoom rebuilds it.
  function pinMonthHeader(scroll) {
    const header = scroll.querySelector('.gantt-month-header');
    if (!header) return;
    const labels = header.children;
    const sl = scroll.scrollLeft;
    let active = -1;
    for (let i = 0; i < labels.length; i++) {
      const nat = parseFloat(labels[i].dataset.natural) || 0;
      labels[i].style.left = `${nat}px`;            // reset to its boundary
      if (nat <= sl) active = i;                    // last month at/left of the edge
    }
    if (active < 0) return;                          // scrolled before the first month
    const el = labels[active];
    const nat = parseFloat(el.dataset.natural) || 0;
    const w = parseFloat(el.dataset.w) || 0;
    let x = sl;
    if (active + 1 < labels.length) {
      const next = parseFloat(labels[active + 1].dataset.natural) || 0;
      x = Math.min(x, next - w - 4);                 // next month pushes it off-edge
    }
    el.style.left = `${Math.round(Math.max(x, nat))}px`;
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
