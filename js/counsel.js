import { DRUGS, INTENT } from './counsel-data.js';

// Sentence case for anything that stands as an item of its own
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const TIERS = [['common', 'Common'], ['serious', 'Serious, potentially life-threatening'], ['rare', 'Rare but significant']];

// A regimen's side effects, tier by tier. An effect several drugs cause is listed once, with every drug behind it,
// in the gravest tier any of them gives it.
export function toxicities(keys) {
  const drugs = keys.map((k) => DRUGS[k]).filter(Boolean);
  const all = new Set(drugs.map((d) => d.name));
  const rows = new Map();
  for (const d of drugs) {
    for (const [tier] of TIERS) {
      for (const t of d[tier]) {
        const row = rows.get(t) || { t, by: [], tiers: new Set() };
        if (!row.by.includes(d.name)) row.by.push(d.name);
        row.tiers.add(tier);
        rows.set(t, row);
      }
    }
  }
  const out = { common: [], serious: [], rare: [] };
  for (const r of rows.values()) {
    const tier = ['serious', 'common', 'rare'].find((x) => r.tiers.has(x));
    // A drug is named only for an effect that is its own
    out[tier].push({ t: r.t, by: r.by, all: all.size < 2 || r.by.length > 1 });
  }
  // Effects the drugs share lead; each drug's own follow, drug by drug
  for (const tier of Object.keys(out)) out[tier].sort((a, b) => (b.all - a.all));
  return out;
}

// IV is the default and goes unsaid; any other route follows the drug in brackets
const ROUTE = {
  'PO': 'oral', 'SC': 'subcutaneous', 'IM': 'IM', 'IM/IV': 'IM or IV', 'IV bolus': 'bolus',
  'IV over 12h': 'over 12 hours', 'IV CI 7 days': '7-day infusion',
};
const route = (r) => (r === 'IV' ? '' : ROUTE[r] || (/^IV CI (\d+)h$/.test(r) ? `${r.match(/\d+/)[0]}-hour infusion` : r));
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// "1-5" -> "days 1–5"; "1,8,15" -> "days 1, 8 and 15"; "continuous" -> "continuously"
function dayText(d) {
  if (d === 'continuous') return 'continuously';
  if (d === 'daily') return 'daily';
  const parts = String(d).split(',').map((p) => p.trim().replace('-', '–'));
  return `${parts.length === 1 && !parts[0].includes('–') ? 'day' : 'days'} ${list(parts)}`;
}
const firstDay = (d) => parseInt(d, 10) || 0;

// The schedule in words, without doses: doses stay reference only and never go into the record.
// Drugs given on the same days are named together: "Cisplatin and etoposide on days 1–5; bleomycin (IM or IV) on days 1, 8 and 15".
export function scheduleText(reg) {
  if (!reg) return '';
  const byDrug = new Map();
  let gcsf = false;
  for (const [drug, , , r, days] of reg.doses) {
    const d = DRUGS[drug];
    if (!d) continue;
    if (d.cls === 'G-CSF') { gcsf = true; continue; }
    if (d.supportive && d.name !== 'leucovorin') continue;
    const e = byDrug.get(d.name) || { routes: [], days: [] };
    const rt = route(r);
    if (rt && !e.routes.includes(rt)) e.routes.push(rt);
    if (!e.days.includes(String(days))) e.days.push(String(days));
    byDrug.set(d.name, e);
  }
  const groups = new Map();
  for (const [name, e] of byDrug) {
    const key = e.days.join('|');
    const g = groups.get(key) || { first: Math.min(...e.days.map(firstDay)), when: list(e.days.map(dayText)), names: [] };
    g.names.push(e.routes.length ? `${name} (${e.routes.join(' then ')})` : name);
    groups.set(key, g);
  }
  const gs = [...groups.values()].sort((a, b) => a.first - b.first);
  if (!gs.length) return '';
    // One drug group on day 1 needs no day: "Docetaxel every 21 days", "Cisplatin weekly"
  const day1 = gs.length === 1 && gs[0].when === 'day 1' && reg.cycleDays;
  const weekly = day1 && reg.cycleDays === 7;
  const body = day1 ? list(gs[0].names) : gs.map((g) => `${list(g.names)} ${g.when}`.replace(/ (days? )/, ' on $1')).join('; ');
  const every = weekly ? ' weekly' : reg.cycleDays ? `${gs.length > 1 ? ';' : day1 ? '' : ','} every ${reg.cycleDays} days` : '';
  return cap(`${body}${every}${gcsf ? ', with G-CSF support' : ''}`);
}

// The regimen's name as written in a note: the list's tumour tag dropped
export function noteName(name) {
  const n = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  // "Carboplatin + paclitaxel" reads as a sentence; "FOLFOX", "BEP x3" keep their capitals
  return /^[A-Z][a-z]/.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
}

const stop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

// Sentences with several possible readings: a click moves to the next; '' says nothing
export const CYCLES = {
  dpyd: [
    ['', 'DPYD genotyping not stated'],
    ['discussed', 'DPYD genotyping discussed.'],
    ['planned', 'DPYD genotyping sent before starting.'],
    ['normal', 'DPYD genotyping: no actionable variant.'],
    ['variant', 'DPYD genotyping: actionable variant; fluoropyrimidine dose reduced.'],
  ],
  decision: [
    ['proceed', 'Agrees to proceed; consent obtained.'],
    ['consider', 'Will consider the options before deciding.'],
    ['declined', 'Declined treatment.'],
    ['', 'Decision not stated'],
  ],
};
// Sentences the note offers; off is the set of those switched off, so 'alt' starts off
export const OFF_BY_DEFAULT = ['alt'];

// The note as parts the user can switch, cycle or edit. s: the facts from the rail, plus
// drugs (keys), off (Set of part ids and effect texts), extra ({ tier: [text] }), cycle ({ id: value }).
export function build(s) {
  const intent = INTENT[s.intent];
  const tox = toxicities(s.drugs);
  const on = (id) => !s.off.has(id);
  const parts = [];
  const line = (id, text) => text && parts.push({ id, text, on: on(id) });

  const what = [intent && s.intent !== 'curative' ? intent.label.toLowerCase() : '', s.name].filter(Boolean).join(' ');
  if (what || s.dx) line('head', stop(`Counselled regarding ${what || 'treatment'}${s.dx ? ` for ${s.dx}` : ''}${s.interpreter ? `, with a ${s.interpreter} interpreter` : ''}`));
  if (s.schedule) parts.push({ id: 'schedule', edit: true, lead: 'Schedule: ', text: cap(s.schedule), tail: `${s.duration ? `, for ${s.duration}` : ''}${s.rt ? ', with concurrent radiotherapy' : ''}`, on: on('schedule') });
  if (intent) line('intent', intent.text + (s.benefit ? ` ${stop(`Expected benefit: ${s.benefit}`)}` : ''));

  const tiers = TIERS.map(([tier, title]) => ({
    tier, title,
    items: [
      ...tox[tier].map((r) => ({ key: r.t, text: r.all ? cap(r.t) : `${cap(r.t)} (${r.by.join(', ')})`, on: on(r.t) })),
      ...(s.extra?.[tier] || []).map((t) => ({ key: t, text: cap(t), on: on(t), own: true })),
    ],
  })).filter((t) => t.items.length);
  if (tiers.length) parts.push({ id: 'tox', tiers, on: true });
  if (s.rt) line('rt', 'Radiotherapy adds fatigue and skin or mucosal reactions within the treated field.');
  if (s.trd) line('trd', `Risk of treatment-related death estimated at about ${s.trd}%.`);

  if (intent) line('alt', intent.observation);
  if (s.drugs.some((k) => DRUGS[k]?.fp)) parts.push({ id: 'dpyd', cycle: CYCLES.dpyd, value: s.cycle.dpyd || '', on: true });
  line('hbv', 'Hepatitis B screening before treatment discussed.');
  line('fertility', 'Effects on fertility and need for contraception discussed.');
  line('fever', 'Advised to seek urgent care for fever ≥38 °C or other warning symptoms.');
  line('written', 'Written information given.');
  line('questions', 'Questions answered; patient verbalised understanding.');
  parts.push({ id: 'decision', cycle: CYCLES.decision, value: s.cycle.decision ?? 'proceed', on: true });
  for (const p of parts) if (p.cycle) { p.text = p.cycle.find(([v]) => v === p.value)[1]; p.on = p.value !== ''; }
  return parts;
}

// Plain text of what is switched on, line for line as the note shows it
export function toText(parts) {
  const lines = [];
  for (const p of parts) {
    if (!p.on) continue;
    if (p.tiers) {
      const t = p.tiers.map(({ title, items }) => {
        const on = items.filter((i) => i.on).map((i) => i.text);
        return on.length ? `${title}: ${on.join('; ')}.` : '';
      }).filter(Boolean);
      if (t.length) lines.push('Side effects discussed:', ...t.map((x) => `・ ${x}`));
    } else lines.push(p.edit ? stop(`${p.lead}${p.text}${p.tail}`) : p.text);
  }
  return lines.join('\n').replace(/^./, cap);
}

// Convenience for tests and samples: the note straight from the facts
export const note = (s) => toText(build({ off: new Set(OFF_BY_DEFAULT), extra: {}, cycle: {}, ...s }));
