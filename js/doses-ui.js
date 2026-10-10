import { compute, mg, UNIT, CR_FLOOR } from './doses.js';

const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Tabs ----------
// The open tab lives in the URL hash so a reload stays put.

function showTab(name) {
  const tab = name === 'doses' ? 'doses' : 'schedule';
  $('#schedule-view').hidden = tab !== 'schedule';
  $('#doses-view').hidden = tab !== 'doses';
  $('#open-settings').hidden = tab !== 'schedule';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
}

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => { history.replaceState(null, '', `#${b.dataset.tab}`); showTab(b.dataset.tab); });
}
showTab(location.hash.slice(1));

// ---------- Doses ----------
// Nothing here is stored: patient measurements stay on screen only.

const form = $('#dose-inputs');
const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : NaN; };
const fmt = (x, dp) => (Number.isFinite(x) ? x.toFixed(dp) : '');

// Dark workbook fills (e.g. PO Vino) need light text to stay legible
function ink(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18 ? '#ffffff' : '#16181b';
}

function card(title, fill, unit) {
  const c = document.createElement('section');
  c.className = 'drug';
  if (fill) { c.style.background = fill; c.style.color = ink(fill); c.classList.add('filled'); }
  const h = document.createElement('h3');
  h.textContent = title;
  if (unit) {
    const u = document.createElement('span');
    u.textContent = unit;
    h.append(u);
  }
  c.append(h);
  const t = document.createElement('table');
  c.append(t);
  return { c, t };
}

function row(t, cells, cls = '') {
  const tr = t.insertRow();
  tr.className = cls;
  for (const [text, k] of cells) {
    const td = tr.insertCell();
    td.textContent = text;
    if (k) td.className = k;
  }
}

function renderDoses() {
  const sex = form.elements.sex.value;
  const r = compute({
    ht: num('#ht'), wt: num('#wt'), sex, age: num('#age'), cr: num('#cr'), crclWt: form.elements.crclWt.value,
  });

  const derived = [
    ['BSA', fmt(r.bsa, 2), 'm²'],
    ['BMI', fmt(r.bmi, 1), ''],
    ['IBW', fmt(r.ibw, 1), 'kg'],
    ['AIBW (for MIRV)', fmt(r.aibw, 1), 'kg'],
    ['IBW Devine', fmt(r.devine, 1), 'kg'],
    ['Adjusted body wt', fmt(r.adjusted, 1), 'kg'],
    ['CrCl', fmt(r.crcl, 1), 'mL/min'],
  ];
  const list = $('#derived');
  list.innerHTML = '';
  for (const [k, v, u] of derived) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v ? `${v} ${u}`.trim() : '';
    if (k === 'BMI' && r.bmi > 25) dd.classList.add('flag');
    if (k === 'CrCl' && v && num('#cr') < CR_FLOOR) dd.textContent += ` (Cr ${CR_FLOOR})`;
    list.append(dt, dd);
  }

  const grid = $('#drugs');
  grid.innerHTML = '';
  const cb = card('Carboplatin', null, 'AUC');
  for (const x of r.carbo) {
    row(cb.t, [[`AUC${x.auc}`], [x.mg == null ? '' : `${mg(x.mg)} mg`, 'mg'], [`max ${x.max}`, x.over ? 'note over' : 'note']]);
  }
  grid.append(cb.c);
  for (const d of r.drugs) {
    const { c, t } = card(d.name, d.fill, UNIT[d.per]);
    for (const x of d.rows) {
      // A card with a cap note keeps a note cell on every row so the mg column lines up
      const note = !d.cap ? null : d.cap.dose === x.dose ? [d.cap.label, x.over ? 'note over' : 'note'] : ['', 'note'];
      row(t, [[`${x.dose}${d.suffix || ''}`], [x.mg == null ? '' : `${mg(x.mg)} mg`, 'mg'], ...(note ? [note] : [])],
        d.bold?.includes(x.dose) ? 'bold' : '');
    }
    grid.append(c);
  }
}

form.addEventListener('input', renderDoses);
$('#dose-clear').addEventListener('click', () => {
  for (const id of ['#ht', '#wt', '#age', '#cr']) $(id).value = '';
  renderDoses();
  $('#ht').focus();
});
renderDoses();
