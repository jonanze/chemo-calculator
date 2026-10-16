import { plan, toText, toHTML, formatDay, fromDay, toDay, label, flagText, baseTests, parseDays, groupConsecutive } from './engine.js';
import { SG_HOLIDAYS } from './holidays.js';
import { DEFAULT_SETTINGS, DEFAULT_ENTRY } from './defaults.js';
import { copyText } from './clip.js';
import { REGIMENS } from './regimens.js';
import { searchRegimens, matchesRegimen, doseLine } from './picker.js';

const $ = (sel, root = document) => root.querySelector(sel);
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

let settings = { ...DEFAULT_SETTINGS, ...store.get('cc.settings', {}) };
const entry = { ...DEFAULT_ENTRY, ...store.get('cc.entry', {}) };
let choices = {};
let edits = {};
let tcuOpts = {};
let labOpts = {};
let inpOpts = {};
// Treatment blocks (by start day) given as an inpatient in every cycle; reset for each patient
const inpDays = new Set();
let lastText = '';
let lastHTML = '';
// Recent-regimen chips were removed (Jonan, 14 Oct 2026); clear what they stored
try { localStorage.removeItem('cc.recent'); } catch { /* storage unavailable */ }
// The usual TCU-to-chemo gap, learned from the last copy, fills an empty chemo date
let usualGap = store.get('cc.gap', null);
let chemoAuto = false;
// Listed regimen the entry was picked from; its doses show while the entry still matches
const BY_KEY = new Map(REGIMENS.map((r) => [r.key, r]));
let pickedKey = entry.ref ?? null;

const el = {
  name: $('#name'), cycleDays: $('#cycleDays'), days: $('#days'), review: $('#review'), chemo: $('#chemo'),
  cycle: $('#cycle'), labTests: $('#labTests'), midLabTests: $('#midLabTests'),
  error: $('#error'), timeline: $('#timeline'), copy: $('#copy'), clear: $('#clear'),
};

// ---------- Inputs ----------

// The regimen entry is remembered between visits; dates and cycle are not.
function restoreEntry() {
  el.name.value = entry.name;
  el.cycleDays.value = entry.cycleDays;
  el.days.value = entry.days;
  $('#every').value = entry.every;
  el.labTests.value = entry.labTests;
  el.midLabTests.value = entry.midLabTests || '';
}

function saveEntry(input) {
  store.set('cc.entry', {
    name: el.name.value.trim(), cycleDays: Number(el.cycleDays.value) || DEFAULT_ENTRY.cycleDays,
    days: el.days.value.trim(), every: input.every, labTests: input.labTests, midLabTests: input.midLabTests, ref: pickedKey,
  });
}

// ---------- Regimen search ----------

const pop = $('#regimen-pop');
const list = $('#regimen-list');
const refDoses = $('#ref-doses');
let matches = [];
let active = -1;

function renderRefDoses() {
  const r = BY_KEY.get(pickedKey);
  const on = matchesRegimen(currentEntryRaw(), r);
  refDoses.hidden = !on;
  refDoses.innerHTML = '';
  if (!on) return;
  // Doses for reference only; nothing here is calculated
  for (const d of r.doses) {
    const li = document.createElement('li');
    const line = doseLine(d);
    const b = document.createElement('b');
    b.textContent = line.slice(0, d[0].length);
    li.append(b, line.slice(d[0].length));
    refDoses.append(li);
  }
}

// The entry as typed, without the regimen check (renderRefDoses does that itself)
function currentEntryRaw() {
  return { name: el.name.value.trim(), cycleDays: Number(el.cycleDays.value), days: el.days.value.trim() };
}

function openPicker(query) {
  matches = searchRegimens(query, REGIMENS);
  active = -1;
  list.innerHTML = '';
  if (!matches.length) return closePicker();
  matches.forEach((r, i) => {
    const li = document.createElement('li');
    li.id = `rg-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    const n = document.createElement('span');
    n.className = 'rn';
    n.textContent = r.name;
    const sch = document.createElement('span');
    sch.className = 'rs';
    sch.textContent = r.cycleDays ? `q${r.cycleDays}d · ${r.days}` : r.days;
    const m = document.createElement('span');
    m.className = 'rm';
    m.textContent = `${r.tumour} · ${r.setting}`;
    li.append(n, sch, m);
    // Keep focus in the Name box so the list does not close before the click lands
    li.addEventListener('mousedown', (ev) => ev.preventDefault());
    li.addEventListener('click', () => pickRegimen(r));
    li.addEventListener('mousemove', () => { if (active !== i) setActive(i, false); });
    list.append(li);
  });
  pop.hidden = false;
  el.name.setAttribute('aria-expanded', 'true');
}

function closePicker() {
  pop.hidden = true;
  matches = [];
  active = -1;
  el.name.setAttribute('aria-expanded', 'false');
  el.name.removeAttribute('aria-activedescendant');
}

function setActive(i, scroll = true) {
  const items = list.children;
  if (items[active]) items[active].setAttribute('aria-selected', 'false');
  active = i;
  if (items[i]) {
    items[i].setAttribute('aria-selected', 'true');
    el.name.setAttribute('aria-activedescendant', items[i].id);
    if (scroll) items[i].scrollIntoView({ block: 'nearest' });
  } else el.name.removeAttribute('aria-activedescendant');
}

// Fills name, cycle length and treatment days; TCU every and lab tests stay as they are
function pickRegimen(r) {
  el.name.value = r.name;
  if (r.cycleDays) el.cycleDays.value = r.cycleDays;
  el.days.value = r.days;
  pickedKey = r.key;
  closePicker();
  resetPlan();
  saveEntry(readInput());
  render();
  renderRefDoses();
  // Chemoradiation and continuous orals have no cycle length; otherwise the next thing is a date
  if (!r.cycleDays) el.cycleDays.select();
  else if (!el.review.value) el.review.focus();
}

el.name.addEventListener('input', () => {
  if (el.name.value.trim().length >= 2) openPicker(el.name.value);
  else closePicker();
});

el.name.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    if (pop.hidden) { if (el.name.value.trim().length >= 2) openPicker(el.name.value); if (pop.hidden) return; }
    ev.preventDefault();
    const n = matches.length;
    setActive(ev.key === 'ArrowDown' ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1));
  } else if (ev.key === 'Enter' && !pop.hidden) {
    ev.preventDefault();
    if (active >= 0) pickRegimen(matches[active]);
    else closePicker();
  } else if (ev.key === 'Escape' && !pop.hidden) {
    // Close the list only; Esc does not clear the form from here
    ev.stopPropagation();
    closePicker();
  }
});

el.name.addEventListener('blur', closePicker);

// The form as the engine sees it. Reading changes nothing on the page; render() does that.
function readInput() {
  const num = (x) => (x.value ? Math.max(1, Math.floor(Number(x.value))) : null);
  const cycleDays = num(el.cycleDays);
  const days = parseDays(el.days.value);
  // A date being typed passes through years like 0002; wait for a whole one
  const date = (x) => (x.value >= '2000' ? x.value : '');
  return {
    regimen: cycleDays && days ? { name: el.name.value.trim(), cycleDays, days } : null,
    days, // parsed treatment days, or null while the box is invalid
    review: date(el.review),
    chemo: date(el.chemo),
    every: num($('#every')) || 1,
    tcuOpts,
    labOpts,
    labTests: el.labTests.value,
    midLabTests: el.midLabTests.value,
    cycle: num(el.cycle),
    inpDays: [...inpDays],
    inpOpts,
  };
}

// ---------- Output ----------

// Swap a date for a picker; a new date re-anchors that cycle and the ones after it.
function editDate(button, e) {
  const picker = document.createElement('input');
  picker.type = 'date';
  picker.className = 'date-picker';
  picker.value = fromDay(e.date);
  // A cycle can't be moved onto or before the treatment that comes before it
  if (e.minDate != null) picker.min = fromDay(e.minDate);
  // Typing a date fires change on every valid intermediate value, so wait for a pause,
  // Enter or blur before committing.
  let timer, done = false;
  const commit = () => {
    clearTimeout(timer);
    if (done) return; // render() removes the picker, which blurs it, which would commit again
    done = true;
    if (picker.value && picker.value !== fromDay(e.date) && picker.value >= (picker.min || '2000')) setEdit(e, picker.value);
    else render();
  };
  picker.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(commit, 900); });
  picker.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } if (ev.key === 'Escape') { done = true; render(); } });
  picker.addEventListener('blur', commit);
  button.replaceWith(picker);
  picker.focus();
  try { picker.showPicker(); } catch { /* not supported */ }
}

// PH reschedule picks after cycle k may no longer apply. With laterDays, D8/D15 edits from
// cycle k on go too, since they were typed against a schedule that has now moved.
function dropDownstream(k, laterDays) {
  for (const key of Object.keys(choices)) if (Number(key) > k) delete choices[key];
  if (!laterDays) return;
  const first = parseDays(el.days.value)?.[0];
  for (const key of Object.keys(edits)) {
    const [kind, ek, day] = key.split(':');
    if (kind === 'chemo' && Number(ek) >= k && Number(day) !== first) delete edits[key];
  }
}

// A TCU or D1 change re-anchors this cycle and those after it
function setEdit(e, value) {
  if (value) edits[e.editKey] = value;
  else delete edits[e.editKey];
  dropDownstream(e.k, e.kind === 'review' || e.day === parseDays(el.days.value)?.[0]);
  render();
}

// A PH TCU's new day carries its chemo, like a TCU edit
function choosePH(e, value) {
  dropDownstream(e.k, true);
  choices[e.key] = value;
  render();
}

// A pill that switches on and off (TCU options, labs rows, inpatient blocks)
function toggle(text, on, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-pressed', String(!!on));
  b.addEventListener('click', onClick);
  return b;
}

function toggleBox(...buttons) {
  const box = document.createElement('div');
  box.className = 'toggles';
  box.append(...buttons);
  return box;
}

// Labs comes last on every row so the pills that are usually on line up at the right edge
const TOGGLES = [['scan', 'Scan'], ['tech', 'Technical'], ['tele', 'Teleconsult'], ['labs', 'Labs']];
// A visit is either technical or a teleconsult, never both
const EXCLUSIVE = { tech: 'tele', tele: 'tech' };

function tcuToggles(e) {
  return toggleBox(...TOGGLES.map(([key, text]) => toggle(text, e.opts[key], () => {
    const next = { ...e.opts, [key]: !e.opts[key] };
    if (next[key] && EXCLUSIVE[key]) next[EXCLUSIVE[key]] = false;
    tcuOpts[e.k] = next;
    render();
  })));
}

// Each treatment block of each cycle can be inpatient or not, whatever the Visit card says
function inpatientToggle(e) {
  return toggleBox(toggle('Inpatient', e.inpatient, () => {
    inpOpts[e.inpKey] = !e.inpatient;
    render();
  }));
}

// A labs row can be switched off (dropped from the copy text), given its own tests, or,
// mid-cycle, turned into a clinic visit on the same day
function labsControls(e, name, res, input) {
  const set = (o) => { labOpts[e.labKey] = { ...labOpts[e.labKey], ...o }; render(); };
  const box = toggleBox();
  if (e.mid) box.append(toggle('TCU', e.tcu, () => set({ tcu: !e.tcu })));
  if (!e.off) {
    const t = toggle('Tests', e.tests?.trim(), () => editTests(t, e, name, res, input));
    box.append(t);
  }
  box.append(toggle('Labs', !e.off, () => set({ off: !e.off })));
  return box;
}

// Visit card: Outpatient/Inpatient for a single treatment block, or one button per block
// (BEP: D1-5 inpatient, D8 and D15 outpatient). Changing it sets every cycle afresh.
const inpTrack = $('#inp-days');
let inpShape = null;
function renderInpDays(days) {
  // While the days box is invalid (mid-typing) keep the inpatient days; they are pruned once it parses
  if (!days) { inpTrack.closest('fieldset').hidden = true; inpShape = null; return; }
  const blocks = groupConsecutive(days);
  for (const d of [...inpDays]) if (!blocks.some((b) => b[0] === d)) inpDays.delete(d);
  const shape = blocks.map((b) => b.join('-')).join() + '|' + [...inpDays].join();
  if (shape === inpShape) return;
  inpShape = shape;
  const focused = document.activeElement?.parentElement === inpTrack ? [...inpTrack.children].indexOf(document.activeElement) : -1;
  const set = (start, on) => () => {
    if (on) inpDays.add(start); else inpDays.delete(start);
    inpOpts = {};
    render();
  };
  inpTrack.innerHTML = '';
  if (blocks.length === 1) {
    const d = blocks[0][0];
    $('#inp-legend').textContent = 'Treatment';
    inpTrack.append(toggle('Outpatient', !inpDays.has(d), set(d, false)), toggle('Inpatient', inpDays.has(d), set(d, true)));
  } else {
    $('#inp-legend').textContent = 'Inpatient days';
    for (const b of blocks) {
      const on = inpDays.has(b[0]);
      inpTrack.append(toggle(b.length > 1 ? `D${b[0]}-${b[b.length - 1]}` : `D${b[0]}`, on, set(b[0], !on)));
    }
  }
  inpTrack.closest('fieldset').hidden = false;
  if (focused >= 0) inpTrack.children[focused]?.focus();
}

// Opens with this row's tests; clearing the box, or matching the default set, drops the override.
function editTests(button, e, name, res, input) {
  const box = document.createElement('input');
  box.type = 'text';
  box.className = 'tests';
  box.setAttribute('aria-label', 'Tests');
  const base = baseTests(e, input.labTests, input.midLabTests);
  box.value = e.tests?.trim() || base;
  box.addEventListener('input', () => {
    name.textContent = label({ ...e, tests: box.value }, res, input);
  });
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const v = box.value.trim();
    if (keep) labOpts[e.labKey] = { ...labOpts[e.labKey], tests: v && v !== base ? v : undefined };
    render();
  };
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    if (ev.key === 'Escape') finish(false);
  });
  box.addEventListener('blur', () => finish(true));
  button.replaceWith(box);
  box.focus();
  box.select();
}

// The title is set in capitals; intervals (q28d, q3w) and units (mg, mg/m²) keep their case
function setTitle(text) {
  const h = $('#summary-title');
  h.textContent = '';
  for (const part of text.split(/(\bq\d+[dhw]\b|\b\d*\s?(?:mg|mcg|g|ml|mL|kg)(?:\/(?:m²|m2|kg))?\b)/)) {
    if (!part) continue;
    if (/^(q\d+[dhw]|\d*\s?(mg|mcg|g|ml|mL|kg)(\/(m²|m2|kg))?)$/.test(part)) {
      const k = document.createElement('span');
      k.className = 'keep-case';
      k.textContent = part;
      h.append(k);
    } else h.append(part);
  }
}

function render() {
  const input = readInput();
  el.days.classList.toggle('invalid', !input.days);
  // Mid-cycle labs only exist when a cycle has a later treatment day (D8, D15)
  $('#mid-labs-field').hidden = !(input.days && groupConsecutive(input.days).length > 1);
  renderInpDays(input.days);
  el.timeline.innerHTML = '';
  el.copy.hidden = true;
  el.error.hidden = true;
  el.clear.hidden = !(el.review.value || el.chemo.value || el.cycle.value || inpDays.size);
  // The schedule header names the regimen; empty until there is a plan (no rhythm line, Jonan 16 Oct 2026)
  const R = input.regimen;
  setTitle(R && input.review && input.chemo ? (R.name || `q${R.cycleDays}d`) : '');
  if (!input.regimen || !input.review || !input.chemo) return;

  const res = plan(input, settings, SG_HOLIDAYS, choices, edits);
  if (res.error) {
    el.error.textContent = res.error;
    el.error.hidden = false;
    return;
  }

  // On screen a consecutive block (D1-5) is one row from its first day to its last; the copy
  // still lists every day (Jonan, 16 Oct 2026)
  const blockDays = (e) => res.events.filter((x) => x.kind === 'chemo' && x.k === e.k && x.block === e.block);
  for (const e of res.events) {
    if (e.kind === 'chemo' && e.blockLen > 1 && !e.blockStart) continue;
    const days = e.kind === 'chemo' && e.blockLen > 1 ? blockDays(e) : [e];
    const last = days[days.length - 1];
    const li = document.createElement('li');
    // A mid-cycle labs row turned into a clinic visit looks like a TCU row
    li.className = (e.tcu ? 'review' : e.kind) + (e.pending ? ' pending' : '');

    const date = document.createElement(e.editKey ? 'button' : 'span');
    date.className = 'date';
    // The weekday gets its own fixed-width slot so the dates line up
    const text = formatDay(e.date, settings.dateFormat);
    if (settings.dateFormat.startsWith('EEE ')) {
      const wd = document.createElement('span');
      wd.className = 'wd';
      wd.textContent = text.slice(0, 3);
      date.append(wd, text.slice(4));
    } else date.textContent = text;
    if (e.editKey) {
      date.type = 'button';
      date.classList.add('editable');
      date.addEventListener('click', () => editDate(date, e));
    }

    const what = document.createElement('span');
    what.className = 'what';
    const name = document.createElement('span');
    name.textContent = label(e, res, input) + (last !== e ? `-${last.shown}` : '');
    what.append(name);
    if (last !== e) {
      const until = document.createElement('span');
      until.className = 'until';
      until.textContent = `to ${formatDay(last.date, settings.dateFormat)}`;
      what.append(until);
    }
    // A later day's flag names its day (D5 PH); a flag shared by every day shows once
    const flags = [];
    const seen = new Set();
    for (const d of days) {
      for (const f of d.flags) {
        const text = (d === e || f.t === 'nodata' ? '' : `D${d.shown} `) + flagText(f, settings.dateFormat, true);
        if (!seen.has(text)) { seen.add(text); flags.push([f, text]); }
      }
    }
    for (const [f, text] of flags) {
      const c = document.createElement(f.t === 'edited' ? 'button' : 'span');
      c.className = `chip ${f.t}`;
      c.textContent = text;
      if (f.t === 'edited') {
        c.type = 'button';
        c.setAttribute('aria-label', 'Undo edit');
        c.addEventListener('click', () => setEdit(e, null));
      }
      what.append(c);
    }
    li.append(date, what);

    if (e.kind === 'review') li.append(tcuToggles(e));
    if (e.inpKey) li.append(inpatientToggle(e));
    if (e.kind === 'labs') {
      li.classList.toggle('off', e.off && !e.tcu);
      li.append(labsControls(e, name, res, input));
    }

    if (e.pending) {
      const choose = document.createElement('div');
      choose.className = 'choose';
      for (const opt of e.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = formatDay(opt, settings.dateFormat);
        b.addEventListener('click', () => choosePH(e, fromDay(opt)));
        choose.append(b);
      }
      const custom = document.createElement('input');
      custom.type = 'date';
      if (e.minDate != null) custom.min = fromDay(e.minDate);
      if (e.maxDate != null) custom.max = fromDay(e.maxDate);
      custom.addEventListener('change', () => {
        const n = custom.value >= '2000' ? toDay(custom.value) : null;
        if (n !== null && (e.minDate == null || n >= e.minDate) && (e.maxDate == null || n <= e.maxDate)) choosePH(e, custom.value);
      });
      choose.append(custom);
      li.append(choose);
    }
    el.timeline.append(li);
  }

  lastText = toText(res, input, settings);
  lastHTML = toHTML(res, input, settings);
  el.copy.hidden = false;
}

el.copy.addEventListener('click', async () => {
  await copyText(lastText, lastHTML);
  const gap = (toDay(el.chemo.value) - toDay(el.review.value));
  if (Number.isFinite(gap) && gap >= 0) { usualGap = gap; store.set('cc.gap', gap); }
  const t = el.copy.querySelector('span');
  t.textContent = 'Copied';
  el.copy.classList.add('done');
  setTimeout(() => { t.textContent = 'Copy'; el.copy.classList.remove('done'); }, 1200);
});

function resetPlan() {
  choices = {};
  edits = {};
  tcuOpts = {};
  labOpts = {};
  inpOpts = {};
}

$('#inputs').addEventListener('input', (ev) => {
  // An empty chemo date follows the TCU at the usual gap until it is typed over
  if (ev.target === el.chemo) chemoAuto = false;
  if (ev.target === el.review && usualGap != null && (chemoAuto || !el.chemo.value)) {
    if (el.review.value >= '2000') {
      el.chemo.value = fromDay(toDay(el.review.value) + usualGap);
      chemoAuto = true;
    } else if (chemoAuto) el.chemo.value = '';
  }
  // Name and lab tests only change wording; anything else re-plans from scratch
  if (![el.name, el.labTests, el.midLabTests].includes(ev.target)) resetPlan();
  saveEntry(readInput());
  render();
  renderRefDoses();
});

// Next patient: keep the regimen, clear the dates, cycle and per-visit choices
el.clear.addEventListener('click', () => {
  el.review.value = '';
  el.chemo.value = '';
  chemoAuto = false;
  el.cycle.value = '';
  inpDays.clear();
  resetPlan();
  render();
  el.review.focus();
});

// ---------- Settings ----------

const dialog = $('#settings');

function saveSettings() {
  store.set('cc.settings', settings);
}

function renderSettings() {
  for (const box of dialog.querySelectorAll('.days')) {
    const key = box.dataset.key;
    box.innerHTML = '';
    DAY_VALUES.forEach((v, i) => {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = settings[key].includes(v);
      cb.addEventListener('change', () => {
        settings[key] = DAY_VALUES.filter((d, j) => box.querySelectorAll('input')[j].checked);
        changed();
      });
      const s = document.createElement('span');
      s.textContent = DAY_NAMES[i].slice(0, 2);
      l.append(cb, s);
      box.append(l);
    });
  }

  for (const f of dialog.querySelectorAll('[data-key]:not(.days)')) {
    f.value = settings[f.dataset.key];
    f.onchange = () => {
      settings[f.dataset.key] = 'num' in f.dataset ? Math.max(0, Number(f.value) || 0) : f.value;
      if (f.dataset.key === 'visits') settings.visits = Math.max(1, settings.visits);
      changed();
    };
  }

  const closed = $('#closed');
  closed.innerHTML = '';
  [...settings.closedDates].sort().forEach((d) => {
    const li = document.createElement('li');
    li.className = 'chip';
    li.textContent = formatDay(toDay(d), settings.dateFormat);
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Remove');
    x.addEventListener('click', () => {
      settings.closedDates = settings.closedDates.filter((c) => c !== d);
      changed(true);
    });
    li.append(x);
    closed.append(li);
  });
}

function changed(rerenderSettings = false) {
  saveSettings();
  if (rerenderSettings) renderSettings();
  render();
}

$('#open-settings').addEventListener('click', () => { renderSettings(); dialog.showModal(); });

$('#closed-add').addEventListener('click', () => {
  const v = $('#closed-new').value;
  if (v && !settings.closedDates.includes(v)) settings.closedDates = [...settings.closedDates, v];
  $('#closed-new').value = '';
  changed(true);
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'chemocalc-settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#import').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
    changed(true);
  } catch {
    alert('Invalid file');
  }
  ev.target.value = '';
});

$('#reset').addEventListener('click', () => {
  if (!confirm('Reset settings?')) return;
  settings = structuredClone(DEFAULT_SETTINGS);
  changed(true);
});

// ---------- Start ----------

restoreEntry();
render();
renderRefDoses();

// Clinic shortcuts: Ctrl/⌘+Enter copies, Esc clears for the next patient, T in a date box is today
document.addEventListener('keydown', (ev) => {
  if ($('#schedule-view').hidden || dialog.open) return;
  const t = ev.target;
  const mod = ev.ctrlKey || ev.metaKey;
  if (t.type === 'date' && ev.key.toLowerCase() === 't' && !mod && !ev.altKey) {
    ev.preventDefault();
    const d = new Date();
    t.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    t.dispatchEvent(new Event(t.classList.contains('date-picker') ? 'change' : 'input', { bubbles: true }));
  } else if (ev.key === 'Enter' && mod && !el.copy.hidden) {
    ev.preventDefault();
    el.copy.click();
  } else if (ev.key === 'Escape' && !t.matches?.('.date-picker, input.tests') && !el.clear.hidden) {
    el.clear.click();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
