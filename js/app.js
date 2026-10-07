import { plan, toText, formatDay, fromDay, toDay, label } from './engine.js';
import { SG_HOLIDAYS } from './holidays.js';
import { DEFAULT_SETTINGS, DEFAULT_REGIMENS } from './defaults.js';

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
let regimens = store.get('cc.regimens', null) || structuredClone(DEFAULT_REGIMENS);
let choices = {};
let lastText = '';

const el = {
  regimen: $('#regimen'), review: $('#review'), chemo: $('#chemo'),
  cycle: $('#cycle'), total: $('#total'), labs: $('#labs'),
  error: $('#error'), timeline: $('#timeline'), copy: $('#copy'),
};

// ---------- Inputs ----------

function renderRegimenOptions() {
  const current = el.regimen.value;
  el.regimen.innerHTML = '';
  regimens.forEach((r, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${r.name} · q${r.cycleDays}d${r.days.length > 1 ? ` · D${r.days.join(',')}` : ''}`;
    el.regimen.append(o);
  });
  if (current && regimens[Number(current)]) el.regimen.value = current;
}

function applyRegimenDefaults() {
  const r = regimens[Number(el.regimen.value)];
  if (!r) return;
  setEvery(r.every || 1);
  el.labs.checked = r.labs !== false;
}

function setEvery(n) {
  const radio = $(`#every input[value="${n}"]`);
  if (radio) radio.checked = true;
}

function readInput() {
  const every = Number($('#every input:checked')?.value || 1);
  const num = (x) => (x.value ? Math.max(1, Math.floor(Number(x.value))) : null);
  return {
    regimen: regimens[Number(el.regimen.value)],
    review: el.review.value,
    chemo: el.chemo.value,
    every,
    labs: el.labs.checked,
    cycle: num(el.cycle),
    total: num(el.total),
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
    default: return '';
  }
}

function render() {
  const input = readInput();
  el.timeline.innerHTML = '';
  el.copy.hidden = true;
  el.error.hidden = true;
  if (!input.regimen || !input.review || !input.chemo) return;

  const res = plan(input, settings, SG_HOLIDAYS, choices);
  if (res.error) {
    el.error.textContent = res.error;
    el.error.hidden = false;
    return;
  }

  for (const e of res.events) {
    const li = document.createElement('li');
    li.className = e.kind + (e.pending ? ' pending' : '');

    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = formatDay(e.date, settings.dateFormat);

    const what = document.createElement('span');
    what.className = 'what';
    const name = document.createElement('span');
    name.textContent = label(e, res.multiDay);
    what.append(name);
    for (const f of e.flags) {
      const c = document.createElement('span');
      c.className = `chip ${f.t}`;
      c.textContent = chipText(f);
      what.append(c);
    }
    li.append(date, what);

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
  if (ev.target === el.regimen) applyRegimenDefaults();
  choices = {};
  render();
});

// ---------- Settings ----------

const dialog = $('#settings');

function saveSettings() {
  store.set('cc.settings', settings);
  store.set('cc.regimens', regimens);
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

  const body = $('#regimens tbody');
  body.innerHTML = '';
  regimens.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cell = (inputEl) => { const td = document.createElement('td'); td.append(inputEl); tr.append(td); return inputEl; };
    const text = (value, onChange, type = 'text') => {
      const inp = document.createElement('input');
      inp.type = type;
      inp.value = value;
      inp.addEventListener('change', () => { onChange(inp.value); changed(); renderRegimenOptions(); });
      return inp;
    };
    cell(text(r.name, (v) => { r.name = v.trim() || r.name; }));
    cell(text(r.cycleDays, (v) => { r.cycleDays = Math.max(1, Number(v) || r.cycleDays); }, 'number'));
    cell(text(r.days.join(','), (v) => {
      const days = v.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1);
      if (days.length) r.days = [...new Set(days)].sort((a, b) => a - b);
    }));
    cell(text(r.every || 1, (v) => { r.every = Math.max(1, Number(v) || 1); }, 'number'));
    const lab = document.createElement('input');
    lab.type = 'checkbox';
    lab.checked = r.labs !== false;
    lab.addEventListener('change', () => { r.labs = lab.checked; changed(); });
    cell(lab);
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete');
    del.addEventListener('click', () => {
      regimens.splice(i, 1);
      renderRegimenOptions();
      changed(true);
    });
    cell(del);
    body.append(tr);
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

$('#regimen-add').addEventListener('click', () => {
  regimens.push({ name: 'New regimen', cycleDays: 21, days: [1], every: 1, labs: true });
  renderRegimenOptions();
  changed(true);
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ settings, regimens }, null, 2)], { type: 'application/json' });
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
    if (Array.isArray(data.regimens) && data.regimens.length) regimens = data.regimens;
    renderRegimenOptions();
    changed(true);
  } catch {
    alert('Invalid file');
  }
  ev.target.value = '';
});

$('#reset').addEventListener('click', () => {
  if (!confirm('Reset settings and regimens?')) return;
  settings = structuredClone(DEFAULT_SETTINGS);
  regimens = structuredClone(DEFAULT_REGIMENS);
  renderRegimenOptions();
  applyRegimenDefaults();
  changed(true);
});

// ---------- Start ----------

renderRegimenOptions();
applyRegimenDefaults();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
