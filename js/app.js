import { plan, toText, formatDay, fromDay, toDay, label, parseDays } from './engine.js';
import { SG_HOLIDAYS } from './holidays.js';
import { DEFAULT_SETTINGS, DEFAULT_ENTRY } from './defaults.js';
import { copyText } from './clip.js';

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
let lastText = '';
// Regimens used recently (stored only when copied, so half-typed entries never land here)
let recent = store.get('cc.recent', []);
const RECENT_MAX = 6;
// The usual TCU-to-chemo gap, learned from the last copy, fills an empty chemo date
let usualGap = store.get('cc.gap', null);
let chemoAuto = false;

const el = {
  name: $('#name'), cycleDays: $('#cycleDays'), days: $('#days'), review: $('#review'), chemo: $('#chemo'),
  cycle: $('#cycle'), labTests: $('#labTests'),
  error: $('#error'), timeline: $('#timeline'), copy: $('#copy'), clear: $('#clear'),
};

// ---------- Inputs ----------

// The regimen entry is remembered between visits; dates and cycle are not.
function restoreEntry() {
  el.name.value = entry.name;
  el.cycleDays.value = entry.cycleDays;
  el.days.value = entry.days;
  setEvery(entry.every);
  el.labTests.value = entry.labTests;
}

function saveEntry(input) {
  store.set('cc.entry', {
    name: el.name.value.trim(), cycleDays: Number(el.cycleDays.value) || DEFAULT_ENTRY.cycleDays,
    days: el.days.value.trim(), every: input.every, labTests: input.labTests,
  });
}

const regimenKey = (r) => `${r.name.toLowerCase()}|${r.cycleDays}|${r.days.replace(/\s+/g, '').toUpperCase()}`;

function currentEntry() {
  return {
    name: el.name.value.trim(), cycleDays: Number(el.cycleDays.value) || DEFAULT_ENTRY.cycleDays,
    days: el.days.value.trim() || 'D1', every: Math.max(1, Math.floor(Number($('#every').value)) || 1), labTests: el.labTests.value.trim(),
  };
}

function rememberRegimen() {
  const r = currentEntry();
  recent = [r, ...recent.filter((x) => regimenKey(x) !== regimenKey(r))].slice(0, RECENT_MAX);
  store.set('cc.recent', recent);
  renderRecent();
}

function renderRecent() {
  const box = $('#recent');
  box.innerHTML = '';
  box.hidden = recent.length === 0;
  const now = regimenKey(currentEntry());
  for (const r of recent) {
    const chip = document.createElement('span');
    chip.className = 'recent-chip';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = r.name ? `${r.name} q${r.cycleDays}` : `q${r.cycleDays} ${r.days}`;
    b.setAttribute('aria-pressed', String(regimenKey(r) === now));
    b.addEventListener('click', () => {
      el.name.value = r.name;
      el.cycleDays.value = r.cycleDays;
      el.days.value = r.days;
      setEvery(r.every);
      el.labTests.value = r.labTests;
      resetPlan();
      saveEntry(readInput());
      render();
      renderRecent();
    });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'remove';
    x.setAttribute('aria-label', `Remove ${b.textContent}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      recent = recent.filter((y) => y !== r);
      store.set('cc.recent', recent);
      renderRecent();
    });
    chip.append(b, x);
    box.append(chip);
  }
}

function setEvery(n) {
  $('#every').value = n;
}

function readInput() {
  const every = Math.max(1, Math.floor(Number($('#every').value)) || 1);
  const num = (x) => (x.value ? Math.max(1, Math.floor(Number(x.value))) : null);
  const cycleDays = num(el.cycleDays);
  const days = parseDays(el.days.value);
  el.days.classList.toggle('invalid', !days);
  // A date being typed passes through years like 0002; wait for a whole one
  const date = (x) => (x.value >= '2000' ? x.value : '');
  return {
    regimen: cycleDays && days ? { name: el.name.value.trim(), cycleDays, days } : null,
    review: date(el.review),
    chemo: date(el.chemo),
    every,
    tcuOpts,
    labOpts,
    labTests: el.labTests.value,
    cycle: num(el.cycle),
  };
}

// ---------- Output ----------

function chipText(f) {
  switch (f.t) {
    case 'ph': return 'PH';
    case 'closed': return 'Closed';
    case 'off': return { clinic: 'No clinic', chemo: 'Unit closed', labs: 'No labs' }[f.ctx] || 'Closed';
    case 'moved': return `from ${formatDay(f.from, settings.dateFormat)}`;
    case 'short': return `${f.days}d`;
    case 'nodata': return 'No PH data';
    case 'edited': return 'Edited ×';
    default: return '';
  }
}

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
  let timer;
  const commit = () => {
    clearTimeout(timer);
    if (picker.value && picker.value !== fromDay(e.date) && picker.value >= (picker.min || '2000')) setEdit(e, picker.value);
    else render();
  };
  picker.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(commit, 900); });
  picker.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } if (ev.key === 'Escape') render(); });
  picker.addEventListener('blur', commit);
  button.replaceWith(picker);
  picker.focus();
  try { picker.showPicker(); } catch { /* not supported */ }
}

function setEdit(e, value) {
  if (value) edits[e.editKey] = value;
  else delete edits[e.editKey];
  // A TCU or D1 change re-anchors this cycle and those after it, so a D8/D15 date
  // typed against the old schedule would now sit in the wrong place (even before D1)
  const first = readInput().regimen?.days[0];
  if (e.kind === 'review' || e.day === first) {
    for (const key of Object.keys(edits)) {
      const [kind, k, day] = key.split(':');
      if (kind === 'chemo' && Number(k) >= e.k && Number(day) !== first) delete edits[key];
    }
  }
  // PH reschedule picks from this cycle on may no longer apply
  for (const key of Object.keys(choices)) if (Number(key) >= e.k) delete choices[key];
  render();
}

const TOGGLES = [['labs', 'Labs'], ['scan', 'Scan'], ['tech', 'Technical'], ['tele', 'Teleconsult']];
// A visit is either technical or a teleconsult, never both
const EXCLUSIVE = { tech: 'tele', tele: 'tech' };

function tcuToggles(e) {
  const box = document.createElement('div');
  box.className = 'toggles';
  for (const [key, text] of TOGGLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    const on = e.opts[key];
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      const next = { ...e.opts, [key]: !on };
      if (!on && EXCLUSIVE[key]) next[EXCLUSIVE[key]] = false;
      tcuOpts[e.k] = next;
      render();
    });
    box.append(b);
  }
  return box;
}

// A labs row can be switched off (dropped from the copy text) or given its own tests.
// Typing updates the row in place so the field keeps focus.
function labsControls(e, name, multiDay, input) {
  const box = document.createElement('div');
  box.className = 'toggles';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Labs';
  b.setAttribute('aria-pressed', String(!e.off));
  b.addEventListener('click', () => {
    labOpts[e.labKey] = { ...labOpts[e.labKey], off: !e.off };
    render();
  });
  box.append(b);
  if (!e.off) {
    const own = e.tests?.trim();
    const t = document.createElement('button');
    t.type = 'button';
    t.textContent = 'Tests';
    t.setAttribute('aria-pressed', String(!!own));
    t.addEventListener('click', () => editTests(t, e, name, multiDay, input));
    box.append(t);
  }
  return box;
}

// Opens with this row's tests; clearing the box, or matching the main Lab tests, drops the override.
function editTests(button, e, name, multiDay, input) {
  const box = document.createElement('input');
  box.type = 'text';
  box.className = 'tests';
  box.setAttribute('aria-label', 'Tests');
  box.value = e.tests?.trim() || input.labTests.trim();
  box.addEventListener('input', () => {
    name.textContent = label({ ...e, tests: box.value }, multiDay, input.labTests);
  });
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const v = box.value.trim();
    if (keep) labOpts[e.labKey] = { ...labOpts[e.labKey], tests: v && v !== input.labTests.trim() ? v : undefined };
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

function render() {
  const input = readInput();
  el.timeline.innerHTML = '';
  el.copy.hidden = true;
  el.error.hidden = true;
  el.clear.hidden = !(el.review.value || el.chemo.value || el.cycle.value);
  // The card title names the regimen and its rhythm; empty until there is a plan
  const R = input.regimen;
  $('#summary-title').textContent = R && input.review && input.chemo ? (R.name || `q${R.cycleDays}d`) : '';
  $('#summary-meta').textContent = R && input.review && input.chemo
    ? [`q${R.cycleDays}d`, el.days.value.trim() || 'D1', `TCU every ${input.every === 1 ? 'cycle' : `${input.every} cycles`}`, input.cycle && `from C${input.cycle}`].filter(Boolean).join(' · ')
    : '';
  if (!input.regimen || !input.review || !input.chemo) return;

  const res = plan(input, settings, SG_HOLIDAYS, choices, edits);
  if (res.error) {
    el.error.textContent = res.error;
    el.error.hidden = false;
    return;
  }

  for (const e of res.events) {
    const li = document.createElement('li');
    li.className = e.kind + (e.pending ? ' pending' : '');

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
    name.textContent = label(e, res.multiDay, input.labTests);
    what.append(name);
    for (const f of e.flags) {
      const c = document.createElement(f.t === 'edited' ? 'button' : 'span');
      c.className = `chip ${f.t}`;
      c.textContent = chipText(f);
      if (f.t === 'edited') {
        c.type = 'button';
        c.setAttribute('aria-label', 'Undo edit');
        c.addEventListener('click', () => setEdit(e, null));
      }
      what.append(c);
    }
    li.append(date, what);

    if (e.kind === 'review') li.append(tcuToggles(e));
    if (e.kind === 'labs') {
      li.classList.toggle('off', e.off);
      li.append(labsControls(e, name, res.multiDay, input));
    }

    if (e.pending) {
      const choose = document.createElement('div');
      choose.className = 'choose';
      for (const opt of e.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = formatDay(opt, settings.dateFormat);
        b.addEventListener('click', () => { choices[e.key] = fromDay(opt); render(); });
        choose.append(b);
      }
      const custom = document.createElement('input');
      custom.type = 'date';
      custom.addEventListener('change', () => {
        if (custom.value) { choices[e.key] = custom.value; render(); }
      });
      choose.append(custom);
      li.append(choose);
    }
    el.timeline.append(li);
  }

  lastText = toText(res, input, settings);
  el.copy.hidden = false;
}

el.copy.addEventListener('click', async () => {
  await copyText(lastText);
  rememberRegimen();
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
  if (ev.target !== el.name && ev.target !== el.labTests) resetPlan();
  saveEntry(readInput());
  render();
  renderRecent();
});

// Next patient: keep the regimen, clear the dates, cycle and per-visit choices
el.clear.addEventListener('click', () => {
  el.review.value = '';
  el.chemo.value = '';
  chemoAuto = false;
  el.cycle.value = '';
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
  a.download = 'chemo-calculator-settings.json';
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
renderRecent();

// Clinic shortcuts: Ctrl/⌘+Enter copies, Esc clears for the next patient, T in a date box is today
document.addEventListener('keydown', (ev) => {
  if ($('#schedule-view').hidden || dialog.open) return;
  const t = ev.target;
  const mod = ev.ctrlKey || ev.metaKey;
  if (t.type === 'date' && ev.key.toLowerCase() === 't' && !mod && !ev.altKey) {
    ev.preventDefault();
    const d = new Date();
    t.value = fromDay(toDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));
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
