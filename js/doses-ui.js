import { compute, mg, UNIT, CR_FLOOR } from './doses.js';
import { copyText, flash } from './clip.js';

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

// The unit heads the dose-level column, so "mg/m²" sits over 175, 150… and not over the mg doses
function card(title, fill, unit) {
  const c = document.createElement('section');
  c.className = 'drug';
  if (fill) { c.style.background = fill; c.style.color = ink(fill); c.classList.add('filled'); }
  const h = document.createElement('h3');
  h.textContent = title;
  c.append(h);
  const t = document.createElement('table');
  const th = t.createTHead().insertRow();
  for (const text of [unit, 'mg']) {
    const cell = document.createElement('th');
    cell.textContent = text;
    th.append(cell);
  }
  t.createTBody();
  c.append(t);
  return { c, t: t.tBodies[0], head: th };
}

function row(t, cells, cls = '', copy = '') {
  const tr = t.insertRow();
  tr.className = cls;
  // A tap copies the order line, e.g. "Paclitaxel 80 mg/m² = 142 mg"
  if (copy) {
    tr.classList.add('copyable');
    tr.addEventListener('click', () => { copyText(copy); flash(tr); });
  }
  for (const [text, k] of cells) {
    const td = tr.insertCell();
    if (k) td.className = k;
    // mg values sit in a span so an over-cap highlight hugs the number
    if (k === 'mg') { const v = document.createElement('span'); v.textContent = text; td.append(v); } else td.textContent = text;
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
  summary = summaryLine(r, sex);
  list.classList.toggle('copyable', !!summary);
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
  cb.head.append(document.createElement('th'));
  for (const x of r.carbo) {
    const line = x.mg == null ? '' : `Carboplatin AUC ${x.auc} = ${mg(x.mg)} mg${x.over ? ` (above max ${x.max} mg)` : ''} (CrCl ${fmt(r.crcl, 1)} mL/min)`;
    row(cb.t, [[String(x.auc)], [x.mg == null ? '' : mg(x.mg), 'mg'], [`max ${x.max}`, x.over ? 'note over' : 'note']], '', line);
  }
  grid.append(cb.c);
  for (const d of r.drugs) {
    const { c, t } = card(d.name, d.fill, UNIT[d.per]);
    for (const x of d.rows) {
      const cls = [d.bold?.includes(x.dose) && 'bold', x.over && 'over'].filter(Boolean).join(' ');
      const s = d.suffix || '';
      const line = x.mg == null ? '' : `${d.name.replace(/\s*\(.*\)$/, '')} ${x.dose} ${UNIT[d.per]}${s} = ${mg(x.mg)} mg${s}${x.over ? ` (over ${d.cap.label})` : ''}`;
      row(t, [[`${x.dose}${s}`], [x.mg == null ? '' : mg(x.mg), 'mg']], cls, line);
    }
    // The cap note sits under the table so it never squeezes the mg column
    if (d.cap) {
      const p = document.createElement('p');
      const over = d.rows.some((x) => x.over);
      p.className = `cap${over ? ' over' : ''}`;
      p.textContent = `${d.cap.label} (${d.cap.dose} ${UNIT[d.per]})`;
      c.append(p);
    }
    grid.append(c);
  }
}

// One line for the EMR: body size, then CrCl with what went into it
let summary = '';
function summaryLine(r, sex) {
  const ht = num('#ht'), wt = num('#wt'), age = num('#age'), cr = num('#cr');
  const parts = [];
  if (Number.isFinite(ht)) parts.push(`Ht ${ht} cm`);
  if (Number.isFinite(wt)) parts.push(`Wt ${wt} kg`);
  if (r.bsa) parts.push(`BSA ${fmt(r.bsa, 2)} m²`, `BMI ${fmt(r.bmi, 1)}`);
  let line = parts.join(', ');
  if (r.crcl != null) {
    const w = form.elements.crclWt.value === 'adjusted' ? 'adjusted wt' : 'actual wt';
    const used = cr < CR_FLOOR ? `Cr ${cr}, floored to ${CR_FLOOR}` : `Cr ${cr}`;
    line += `${line ? '. ' : ''}CrCl ${fmt(r.crcl, 1)} mL/min (Cockcroft-Gault, ${age} ${sex}, ${w}, ${used})`;
  }
  return line;
}
$('#derived').addEventListener('click', () => {
  if (!summary) return;
  copyText(summary);
  flash($('#derived'));
});

form.addEventListener('input', renderDoses);
// Enter (Next on a phone keyboard) steps through the four boxes, then closes the keyboard
const ORDER = ['#ht', '#wt', '#age', '#cr'];
form.addEventListener('keydown', (ev) => {
  const i = ORDER.findIndex((id) => $(id) === ev.target);
  if (ev.key !== 'Enter' || i < 0) return;
  ev.preventDefault();
  if (i < ORDER.length - 1) $(ORDER[i + 1]).focus(); else ev.target.blur();
});
$('#dose-clear').addEventListener('click', () => {
  for (const id of ['#ht', '#wt', '#age', '#cr']) $(id).value = '';
  renderDoses();
  $('#ht').focus();
});
renderDoses();
