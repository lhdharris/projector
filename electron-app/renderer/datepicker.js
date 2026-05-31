// A small, app-themed calendar popup that replaces the native
// <input type="date"> picker. The native popup can't be styled (square corners,
// a platform focus ring on the selected day); this one matches the rest of the
// UI — rounded corners, app-blue selection, no stray borders. The bound field
// is a plain text input holding an ISO YYYY-MM-DD string (or empty).
(function () {
  'use strict';

  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']; // Monday-first

  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  function todayISO() {
    const t = new Date();
    return toISO(t.getFullYear(), t.getMonth(), t.getDate());
  }
  // Parse ISO into { y, m, d } (m is 0-based) or null.
  function parseISO(s) {
    if (!ISO_RE.test(s || '')) return null;
    const [y, m, d] = s.split('-').map(Number);
    return { y, m: m - 1, d };
  }

  let popup = null;
  let state = null; // { input, field, viewY, viewM }

  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'cal-popup';
    popup.hidden = true;
    // Keep the input focused while interacting with the popup.
    popup.addEventListener('mousedown', (e) => e.preventDefault());
    popup.addEventListener('click', onPopupClick);
    document.body.appendChild(popup);
    return popup;
  }

  function shiftMonth(delta) {
    let m = state.viewM + delta;
    let y = state.viewY;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    state.viewM = m;
    state.viewY = y;
    render();
  }

  function pick(iso) {
    state.input.value = iso;
    state.input.dispatchEvent(new Event('input', { bubbles: true }));
    state.input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  function onPopupClick(e) {
    const nav = e.target.closest('[data-nav]');
    if (nav) { shiftMonth(Number(nav.dataset.nav)); return; }
    if (e.target.closest('[data-today]')) { pick(todayISO()); return; }
    if (e.target.closest('[data-clear]')) { pick(''); return; }
    const day = e.target.closest('.cal-day');
    if (day) pick(day.dataset.iso);
  }

  function render() {
    const { viewY, viewM, input } = state;
    const sel = parseISO(input.value.trim());
    const today = parseISO(todayISO());
    const first = new Date(viewY, viewM, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();

    let html = '<div class="cal-head">'
      + '<button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month">‹</button>'
      + `<span class="cal-month">${MONTHS[viewM]} ${viewY}</span>`
      + '<button type="button" class="cal-nav" data-nav="1" aria-label="Next month">›</button>'
      + '</div>';

    html += '<div class="cal-grid cal-weekdays">';
    for (const w of WEEKDAYS) html += `<span class="cal-wd">${w}</span>`;
    html += '</div>';

    html += '<div class="cal-grid cal-days">';
    for (let i = 0; i < startOffset; i++) html += '<span class="cal-blank"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      let cls = 'cal-day';
      if (sel && sel.y === viewY && sel.m === viewM && sel.d === d) cls += ' selected';
      else if (today.y === viewY && today.m === viewM && today.d === d) cls += ' today';
      html += `<button type="button" class="${cls}" data-iso="${toISO(viewY, viewM, d)}">${d}</button>`;
    }
    html += '</div>';

    html += '<div class="cal-foot">'
      + '<button type="button" class="cal-foot-btn" data-today>Today</button>'
      + '<button type="button" class="cal-foot-btn cal-clear" data-clear>Clear</button>'
      + '</div>';

    popup.innerHTML = html;
  }

  function position(field) {
    // getBoundingClientRect / innerWidth/Height are device px (they include the
    // page `zoom`), but the values we write to style.left/top are layout px the
    // browser then multiplies by `zoom`. Do the clamping in device px, then
    // divide by the zoom factor so the popup lands where intended — otherwise it
    // renders 1.2× too far down and falls off the bottom. (Mirrors the context-
    // menu logic in renderer.js / team.js.)
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const r = field.getBoundingClientRect();
    const pr = popup.getBoundingClientRect();
    const pw = pr.width;
    const ph = pr.height;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    if (top + ph > window.innerHeight - 8) top = r.top - 6 - ph; // flip above
    popup.style.left = Math.max(8, left) / zoom + 'px';
    popup.style.top = Math.max(8, top) / zoom + 'px';
  }

  function openFor(input, field) {
    ensurePopup();
    const cur = parseISO(input.value.trim()) || parseISO(todayISO());
    state = { input, field, viewY: cur.y, viewM: cur.m };
    render();
    popup.hidden = false;
    position(field);
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  }

  function onDocDown(e) {
    if (!state) return;
    if (popup.contains(e.target) || state.field.contains(e.target)) return;
    close();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  function close() {
    if (popup) popup.hidden = true;
    state = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  }

  // Bind a text input (inside a `.date-field` wrapper) to the calendar popup.
  function attach(input) {
    const field = input.closest('.date-field') || input.parentElement;
    const open = () => { if (!state || state.input !== input) openFor(input, field); };
    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    const btn = field.querySelector('.date-cal-btn');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); input.focus(); openFor(input, field); });
  }

  window.DatePicker = { attach };
})();
