import { plan, toText, formatDay, fromDay, toDay, label, parseDays } from './engine.js';
import { SG_HOLIDAYS } from './holidays.js';
import { DEFAULT_SETTINGS, DEFAULT_ENTRY } from './defaults.js';

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
let lastText = '';

const el = {
  name: $('#name'), cycleDays: $('#cycleDays'), days: $('#days'), review: $('#review'), chemo: $('#chemo'),
  cycle: $('#cycle'), labTests: $('#labTests'),
  error: $('#error'), timeline: $('#timeline'), copy: $('#copy'),
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

function setEvery(n) {
  $('#every').value = n;
}

function readInput() {
  const every = Math.max(1, Math.floor(Number($('#every').value)) || 1);
  const num = (x) => (x.value ? Math.max(1, Math.floor(Number(x.value))) : null);
  const cycleDays = num(el.cycleDays);
  const days = parseDays(el.days.value);
  el.days.classList.toggle('invalid', !days);
  return {
    regimen: cycleDays && days ? { name: el.name.value.trim(), cycleDays, days } : null,
    review: el.review.value,
    chemo: el.chemo.value,
    every,
    tcuOpts,
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
  // Typing a date fires change on every valid intermediate value, so wait for a pause,
  // Enter or blur before committing.
  let timer;
  const commit = () => {
    clearTimeout(timer);
    if (picker.value && picker.value !== fromDay(e.date) && picker.value >= '2000') setEdit(e, picker.value);
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
  // PH reschedule picks from this cycle on may no longer apply
  for (const key of Object.keys(choices)) if (key === 'eot' || Number(key) >= e.k) delete choices[key];
  render();
}

const TOGGLES = [['labs', 'Labs'], ['tech', 'Technical'], ['ct', 'CT'], ['mri', 'MRI']];

function tcuToggles(e) {
  const box = document.createElement('div');
  box.className = 'toggles';
  for (const [key, text] of TOGGLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    const on = key === 'labs' ? e.opts.labs || e.opts.tech : e.opts[key];
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      const next = { ...e.opts, [key]: !on };
      // A technical visit is a labs visit
      if (key === 'tech' && next.tech) next.labs = true;
      if (key === 'labs' && !next.labs) next.tech = false;
      tcuOpts[e.k] = next;
      render();
    });
    box.append(b);
  }
  return box;
}

function render() {
  const input = readInput();
  el.timeline.innerHTML = '';
  el.copy.hidden = true;
  el.error.hidden = true;
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
    date.textContent = formatDay(e.date, settings.dateFormat);
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
  try {
    await navigator.clipboard.writeText(lastText);
  } catch {
    const t = document.createElement('textarea');
    t.value = lastText;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  el.copy.textContent = 'Copied';
  setTimeout(() => { el.copy.textContent = 'Copy'; }, 1200);
});

$('#inputs').addEventListener('input', (ev) => {
  // Name and lab tests only change wording; anything else re-plans from scratch
  if (ev.target !== el.name && ev.target !== el.labTests) {
    choices = {};
    edits = {};
    tcuOpts = {};
  }
  saveEntry(readInput());
  render();
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
