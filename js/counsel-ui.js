import { REGIMENS } from './regimens.js';
import { DRUGS, INTENT, SETTING_INTENT, CURATIVE_TUMOURS } from './counsel-data.js';
import { TIERS, toxicities, note, scheduleText, noteName } from './counsel.js';
import { copyText, flash } from './clip.js';

// Nothing here is stored: the note lives on screen only.
const $ = (sel) => document.querySelector(sel);
const form = $('#counsel-inputs');
const out = $('#cn-note');

// One option per regimen; the tumour tells apart regimens that share a name
const label = (r) => `${r.name} · ${r.tumour}`;
const byLabel = new Map(REGIMENS.map((r) => [label(r), r]));
$('#cn-regimens').append(...REGIMENS.map((r) => new Option(label(r))));
for (const [k, v] of Object.entries(INTENT)) $('#cn-intent').add(new Option(v.label, k));
$('#cn-intent').value = 'palliative';

// Drugs anyone can add: one entry per drug, supportive drugs last
const PICK = [...new Map(Object.entries(DRUGS).map(([k, d]) => [d.name, k])).entries()]
  .sort(([a, ka], [b, kb]) => (DRUGS[ka].supportive - DRUGS[kb].supportive) || a.localeCompare(b));
function fillAdd() {
  const add = $('#cn-add');
  add.replaceChildren(new Option('Add drug', ''));
  for (const [name, k] of PICK) if (!drugs.includes(k)) add.add(new Option(`${name} · ${DRUGS[k].cls}`, k));
}

let drugs = [];
let off = new Set();
let extra = { common: [], serious: [], rare: [] };
let layout = 'lines';

function renderChips() {
  const box = $('#cn-chips');
  box.replaceChildren(...drugs.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cn-chip';
    b.textContent = `${DRUGS[k].name} ×`;
    b.setAttribute('aria-label', `Remove ${DRUGS[k].name}`);
    b.addEventListener('click', () => { drugs = drugs.filter((x) => x !== k); changed(); });
    return b;
  }));
  fillAdd();
  $('#cn-dpyd-row').hidden = !drugs.some((k) => DRUGS[k].fp);
}

function renderTox() {
  const box = $('#cn-tox');
  box.replaceChildren();
  if (!drugs.length) return;
  const tox = toxicities(drugs);
  for (const [tier, title] of TIERS) {
    const h = document.createElement('h3');
    h.textContent = title;
    const ul = document.createElement('ul');
    const rows = [...tox[tier].map((x) => ({ ...x, own: false })), ...extra[tier].map((t) => ({ t, by: [], all: true, own: true }))];
    for (const x of rows) {
      const li = document.createElement('li');
      const lab = document.createElement('label');
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.checked = !off.has(x.t);
      tick.addEventListener('change', () => {
        if (x.own && !tick.checked) extra[tier] = extra[tier].filter((t) => t !== x.t);
        else if (tick.checked) off.delete(x.t); else off.add(x.t);
        if (x.own) renderTox();
        render();
      });
      lab.append(tick, document.createTextNode(x.t));
      li.append(lab);
      if (!x.all) {
        const by = document.createElement('span');
        by.className = 'by';
        by.textContent = x.by.join(', ');
        li.append(by);
      }
      ul.append(li);
    }
    // Anything else said goes in below the tier
    const li = document.createElement('li');
    li.className = 'cn-other';
    const add = document.createElement('input');
    add.type = 'text';
    add.setAttribute('aria-label', `Add to ${title.toLowerCase()}`);
    add.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !add.value.trim()) return;
      ev.preventDefault();
      extra[tier].push(add.value.trim());
      renderTox();
      render();
      box.querySelectorAll('.cn-other input')[TIERS.findIndex(([t]) => t === tier)].focus();
    });
    li.append(add);
    ul.append(li);
    box.append(h, ul);
  }
}

const state = () => ({
  name: $('#cn-name').value.trim(), schedule: $('#cn-schedule').value.trim(), duration: $('#cn-duration').value.trim(),
  rt: $('#cn-rt').checked, intent: $('#cn-intent').value, dx: $('#cn-dx').value.trim(), benefit: $('#cn-benefit').value.trim(),
  trd: $('#cn-trd').value, observation: $('#cn-observation').checked, dpyd: $('#cn-dpyd').value, hbv: $('#cn-hbv').checked,
  fertility: $('#cn-fertility').checked, fever: $('#cn-fever').checked, written: $('#cn-written').checked,
  questions: $('#cn-questions').checked, interpreter: $('#cn-interpreter').value.trim(), decision: $('#cn-decision').value,
  drugs, off, extra, compact: layout === 'compact',
});

const words = () => { const t = out.value.trim(); $('#cn-words').textContent = t ? `${t.split(/\s+/).length} words` : ''; };
function render() {
  const s = state();
  out.value = s.name || s.drugs.length || s.dx ? note(s) : '';
  words();
}
function changed() { renderChips(); renderTox(); render(); }

function pick(r) {
  drugs = [...new Set(r.drugs)].filter((k) => DRUGS[k]);
  off = new Set();
  extra = { common: [], serious: [], rare: [] };
  $('#cn-name').value = noteName(r.name);
  $('#cn-schedule').value = scheduleText(r);
  $('#cn-rt').checked = r.setting === 'chemoradiation';
  $('#cn-intent').value = CURATIVE_TUMOURS.some((t) => r.tumour.includes(t)) ? 'curative' : SETTING_INTENT[r.setting] || $('#cn-intent').value;
  changed();
}

$('#cn-regimen').addEventListener('input', () => { const r = byLabel.get($('#cn-regimen').value); if (r) pick(r); });
$('#cn-add').addEventListener('change', (ev) => { if (ev.target.value) { drugs.push(ev.target.value); changed(); } });
form.addEventListener('input', (ev) => { if (!['cn-regimen', 'cn-add'].includes(ev.target.id)) render(); });
for (const r of document.querySelectorAll('[name="cn-layout"]')) r.addEventListener('change', () => { layout = r.value; render(); });
out.addEventListener('input', words);
$('#cn-copy').addEventListener('click', async () => { await copyText(out.value); flash($('#cn-copy')); });
$('#cn-clear').addEventListener('click', () => {
  form.reset();
  $('#cn-intent').value = 'palliative';
  drugs = [];
  changed();
});

// Opening Counsel with a regimen already picked on Schedule carries it across
document.querySelector('[data-tab="counsel"]').addEventListener('click', () => {
  if (drugs.length) return;
  const name = $('#name')?.value;
  const r = REGIMENS.find((x) => x.name === name);
  if (r) { $('#cn-regimen').value = label(r); pick(r); }
});

changed();
