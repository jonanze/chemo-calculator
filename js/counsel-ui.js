import { REGIMENS } from './regimens.js';
import { DRUGS, INTENT, SETTING_INTENT, CURATIVE_TUMOURS } from './counsel-data.js';
import { build, toText, scheduleText, noteName, cap, OFF_BY_DEFAULT } from './counsel.js';
import { copyText, flash } from './clip.js';

// The note is the interface: the rail holds the facts, and every sentence and side effect in the
// note is clicked on or off, cycled or edited in place. Nothing is stored.
const $ = (sel) => document.querySelector(sel);
const form = $('#counsel-inputs');
const doc = $('#cn-doc');

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
  for (const [name, k] of PICK) if (!drugs.includes(k)) add.add(new Option(`${cap(name)} · ${DRUGS[k].cls}`, k));
}

let drugs = [];
let schedule = '';
let off = new Set(OFF_BY_DEFAULT);
let extra = { common: [], serious: [], rare: [] };
let cycle = {};
let layout = 'lines';
let parts = [];
let picked = null;

// The regimen's name, or the drugs themselves once the set no longer matches a listed regimen
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const name = () => (picked && sameSet(drugs, [...new Set(picked.drugs)].filter((k) => DRUGS[k]))
  ? noteName(picked.name)
  : drugs.filter((k) => !DRUGS[k].supportive).map((k) => DRUGS[k].name).join(' + '));
const facts = () => ({
  name: name(), schedule, duration: $('#cn-duration').value.trim(), rt: $('#cn-rt').checked,
  intent: $('#cn-intent').value, dx: $('#cn-dx').value.trim(), benefit: $('#cn-benefit').value.trim(), trd: $('#cn-trd').value,
  interpreter: $('#cn-interpreter').value.trim(), drugs, off, extra, cycle,
});

function renderChips() {
  $('#cn-chips').replaceChildren(...drugs.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cn-chip';
    b.textContent = `${cap(DRUGS[k].name)} ×`;
    b.setAttribute('aria-label', `Remove ${DRUGS[k].name}`);
    b.addEventListener('click', () => { drugs = drugs.filter((x) => x !== k); render(); });
    return b;
  }));
  fillAdd();
}

const toggle = (id) => { off.has(id) ? off.delete(id) : off.add(id); render(); };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A sentence: click switches it off and back; off ones stay visible, struck through
function sentence(p) {
  const b = el('button', `cn-part${p.on ? '' : ' off'}`, p.text);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(p.on));
  b.addEventListener('click', () => toggle(p.id));
  return b;
}

// A sentence with several readings: click moves to the next
function cycler(p) {
  const b = el('button', `cn-part cn-cycle${p.on ? '' : ' off'}`, p.text);
  b.type = 'button';
  b.addEventListener('click', () => {
    const i = p.cycle.findIndex(([v]) => v === p.value);
    cycle[p.id] = p.cycle[(i + 1) % p.cycle.length][0];
    render();
  });
  return b;
}

// The schedule: edited in place, switched off by its marker
function editable(p) {
  const row = el('div', `cn-part cn-edit${p.on ? '' : ' off'}`);
  const mark = el('button', 'cn-mark');
  mark.type = 'button';
  mark.setAttribute('aria-label', 'Include the schedule');
  mark.setAttribute('aria-pressed', String(p.on));
  mark.addEventListener('click', () => toggle(p.id));
  const text = el('span', 'cn-text', p.text);
  text.contentEditable = 'plaintext-only';
  text.spellcheck = false;
  text.addEventListener('input', () => { schedule = text.textContent; parts = build(facts()); words(); });
  text.addEventListener('blur', () => render());
  row.append(mark, el('span', null, p.lead), text, el('span', null, `${p.tail}.`));
  return row;
}

// Side effects: each one a click away from gone, and a field at the end of each tier for one more
function tiers(p) {
  const box = el('div', 'cn-tiers');
  box.append(el('div', 'cn-lead', 'Side effects discussed:'));
  for (const t of p.tiers) {
    const row = el('div', 'cn-tier');
    row.append(el('span', 'cn-title', `${t.title}: `));
    t.items.forEach((i, n) => {
      // A span, not a button, so the items flow as one sentence
      const b = el('span', `cn-item${i.on ? '' : ' off'}`, i.text);
      b.setAttribute('role', 'button');
      b.tabIndex = 0;
      b.setAttribute('aria-pressed', String(i.on));
      const hit = () => {
        if (i.own) { extra[t.tier] = extra[t.tier].filter((x) => x !== i.key); render(); return; }
        toggle(i.key);
      };
      b.addEventListener('click', hit);
      b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); hit(); } });
      row.append(b, el('span', 'cn-sep', n < t.items.length - 1 ? '; ' : '.'));
    });
    const add = el('input', 'cn-add');
    add.type = 'text';
    add.setAttribute('aria-label', `Add to ${t.title.toLowerCase()}`);
    add.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !add.value.trim()) return;
      ev.preventDefault();
      extra[t.tier].push(add.value.trim());
      render();
      doc.querySelectorAll('.cn-add')[p.tiers.indexOf(t)]?.focus();
    });
    row.append(add);
    box.append(row);
  }
  return box;
}

const words = () => {
  const t = toText(parts, layout === 'compact').trim();
  $('#cn-words').textContent = t ? `${t.split(/\s+/).length} words` : '';
};

function render() {
  renderChips();
  parts = drugs.length || $('#cn-dx').value.trim() ? build(facts()) : [];
  doc.replaceChildren(...parts.map((p) => (p.tiers ? tiers(p) : p.cycle ? cycler(p) : p.edit ? editable(p) : sentence(p))));
  words();
}

function pick(r) {
  drugs = [...new Set(r.drugs)].filter((k) => DRUGS[k]);
  schedule = scheduleText(r);
  off = new Set(OFF_BY_DEFAULT);
  extra = { common: [], serious: [], rare: [] };
  cycle = {};
  $('#cn-rt').checked = r.setting === 'chemoradiation';
  $('#cn-intent').value = CURATIVE_TUMOURS.some((t) => r.tumour.includes(t)) ? 'curative' : SETTING_INTENT[r.setting] || $('#cn-intent').value;
  picked = r;
  render();
}

$('#cn-regimen').addEventListener('input', () => { const r = byLabel.get($('#cn-regimen').value); if (r) pick(r); });
$('#cn-add').addEventListener('change', (ev) => { if (ev.target.value) { drugs.push(ev.target.value); render(); } });
form.addEventListener('input', (ev) => { if (!['cn-regimen', 'cn-add'].includes(ev.target.id)) render(); });
for (const r of document.querySelectorAll('[name="cn-layout"]')) r.addEventListener('change', () => { layout = r.value; words(); });
$('#cn-copy').addEventListener('click', async () => { await copyText(toText(parts, layout === 'compact')); flash($('#cn-copy')); });
$('#cn-clear').addEventListener('click', () => {
  form.reset();
  $('#cn-intent').value = 'palliative';
  drugs = []; schedule = ''; picked = null;
  off = new Set(OFF_BY_DEFAULT); extra = { common: [], serious: [], rare: [] }; cycle = {};
  render();
});

// Opening Counsel with a regimen already picked on Schedule carries it across
document.querySelector('[data-tab="counsel"]').addEventListener('click', () => {
  if (drugs.length) return;
  const r = REGIMENS.find((x) => x.name === $('#name')?.value);
  if (r) { $('#cn-regimen').value = label(r); pick(r); }
});

render();
