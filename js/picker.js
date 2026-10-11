// Regimen search for the Name box. Pure functions so they can be tested in Node.

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
// A typed word matches the start of a word, so "folfox" finds mFOLFOX6 and "sclc" skips NSCLC
const hit = (toks, w) => toks.some((t) => t.startsWith(w) || (t[0] === 'm' && t.startsWith(w, 1)));

const index = new WeakMap();
function indexOf(r) {
  let x = index.get(r);
  if (!x) {
    x = {
      name: tokens(r.name),
      tag: tokens([r.tumour, r.setting].join(' ')),
      all: tokens([r.name, r.tumour, r.setting, ...(r.drugs || [])].join(' ')),
    };
    index.set(r, x);
  }
  return x;
}

// Every word typed must match. Names that start with the query rank first, then names
// matching every word, then tumour or setting matches, then the rest (drugs).
export function searchRegimens(query, list, limit = 40) {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const r of list) {
    const x = indexOf(r);
    if (!words.every((w) => hit(x.all, w))) continue;
    const n = norm(r.name);
    let score = 3;
    if (n.startsWith(q) || n.startsWith(`m${q}`)) score = 0;
    else if (words.every((w) => hit(x.name, w))) score = 1;
    else if (words.some((w) => hit(x.name, w))) score = 2;
    if (score === 3 && !words.some((w) => hit(x.tag, w))) score = 4;
    hits.push({ r, score });
  }
  hits.sort((a, b) => a.score - b.score || a.r.name.length - b.r.name.length || a.r.name.localeCompare(b.r.name));
  return hits.slice(0, limit).map((h) => h.r);
}

const daysKey = (d) => (d || '').replace(/\s+/g, '').toUpperCase();

// Reference doses show only while the entry still matches what was picked
export function matchesRegimen(entry, r) {
  if (!r) return false;
  return entry.name === r.name && daysKey(entry.days) === daysKey(r.days)
    && (r.cycleDays == null || Number(entry.cycleDays) === r.cycleDays);
}

// One reference line per drug, e.g. "Pertuzumab 420 mg IV D1 (C1 loading 840 mg)"
const UNIT = { 'mg/m2': 'mg/m²', 'mg/m2 BD': 'mg/m² BD' };
export function doseLine([drug, dose, unit, route, days, note]) {
  const name = drug.charAt(0).toUpperCase() + drug.slice(1);
  const amount = unit === 'AUC' ? `AUC ${dose}` : `${dose} ${UNIT[unit] || unit}`;
  const when = /^[\d,\s-]+$/.test(days) ? days.split(',').map((p) => `D${p.trim()}`).join('/') : days;
  return `${name} ${amount} ${route} ${when}${note ? ` (${note.replace(/mg\/m2/g, 'mg/m²')})` : ''}`;
}
