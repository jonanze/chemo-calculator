import { DRUGS, INTENT } from './counsel-data.js';

// Sentence case for anything that stands as an item of its own
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Each tier is one sentence in the note
export const TIERS = [
  ['common', 'Common', 'Common side effects discussed include, but are not limited to, '],
  ['serious', 'Serious', 'Serious side effects discussed include '],
  ['rare', 'Rare but significant', 'Rare but significant side effects discussed include '],
];

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

// IV is the default and goes unsaid; any other route is said after the drug
const ROUTE = {
  'PO': 'orally', 'SC': 'subcutaneously', 'IM': 'IM', 'IM/IV': 'IM or IV', 'IV bolus': 'as a bolus',
  'IV over 12h': 'over 12 hours', 'IV CI 7 days': 'as a 7-day infusion',
};
const route = (r) => (r === 'IV' ? '' : ROUTE[r] || (/^IV CI (\d+)h$/.test(r) ? `as a ${r.match(/\d+/)[0]}-hour infusion` : r));
export const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// "1-5" -> "days 1–5"; "1,8,15" -> "days 1, 8 and 15"; "continuous" -> "continuously"
function dayText(d) {
  if (d === 'continuous') return 'continuously';
  if (d === 'daily') return 'daily';
  const parts = String(d).split(',').map((p) => p.trim().replace('-', '–'));
  return `${parts.length === 1 && !parts[0].includes('–') ? 'day' : 'days'} ${list(parts)}`;
}
const firstDay = (d) => parseInt(d, 10) || 0;

// The schedule in words, without doses: doses stay reference only and never go into the record.
// Drugs given on the same days are named together:
// "Bleomycin IM or IV on days 1, 8 and 15, plus cisplatin and etoposide on days 1–5, every 21 days"
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
    // "as a bolus then as a 46-hour infusion" reads "as a bolus then a 46-hour infusion"
    g.names.push(e.routes.length ? `${name} ${e.routes.join(' then ').replace(/ then as a /g, ' then a ')}` : name);
    groups.set(key, g);
  }
  const gs = [...groups.values()].sort((a, b) => a.first - b.first);
  if (!gs.length) return '';
  // One drug group on day 1 needs no day: "Docetaxel every 21 days", "Cisplatin weekly"
  const day1 = gs.length === 1 && gs[0].when === 'day 1' && reg.cycleDays;
  const weekly = day1 && reg.cycleDays === 7;
  const body = day1 ? list(gs[0].names) : gs.map((g) => `${list(g.names)} ${g.when}`.replace(/ (days? )/, ' on $1')).join(', plus ');
  // A comma before "every" once a route has been said, so the interval doesn't read as part of the infusion
  const said = [...byDrug.values()].some((e) => e.routes.length);
  const every = weekly ? ' weekly' : reg.cycleDays ? `${day1 && !said ? '' : ','} every ${reg.cycleDays} days` : '';
  return cap(`${body}${every}${gcsf ? ', with G-CSF support' : ''}`);
}

// The regimen's name as written in a note: the list's tumour tag dropped
export function noteName(name) {
  const n = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return lower(n);
}
// "Carboplatin + paclitaxel" reads as a sentence; "FOLFOX", "BEP x3" keep their capitals
const lower = (n) => (/^[A-Z][a-z]/.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n);

const stop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
const IO = /PD-1|PD-L1|CTLA-4|LAG-3/;

// Sentences with several possible readings: a click moves to the next; '' says nothing
export const CYCLES = {
  dpyd: [
    ['', 'DPYD genotyping not stated'],
    ['discussed', 'DPYD genotyping before fluoropyrimidine treatment was discussed.'],
    ['planned', 'DPYD genotyping before fluoropyrimidine treatment is planned.'],
    ['normal', 'DPYD genotyping showed no actionable variant.'],
    ['variant', 'DPYD genotyping identified a variant, and the fluoropyrimidine dose will be reduced accordingly.'],
  ],
  decision: [
    ['proceed', 'The patient wishes to proceed, and consent for treatment was obtained.'],
    ['consider', 'The patient wishes to consider the options further before deciding.'],
    ['declined', 'The patient has declined treatment after discussion of the above.'],
    ['', 'Decision not stated'],
  ],
};
// Sentences the note offers; off is the set of those switched off, so 'alt' starts off
export const OFF_BY_DEFAULT = ['alt'];

// A tier as one sentence of the effects switched on. Effects every drug shares come first, then each drug's own:
// "nausea and vomiting, fatigue and myelosuppression, as well as diarrhoea and mucositis from 5-FU, and
// laryngopharyngeal dysaesthesia from oxaliplatin". Returns pieces: strings, and the items themselves.
export function tierPieces(t) {
  const on = t.items.filter((i) => i.on);
  if (!on.length) return [];
  const join = (xs) => xs.flatMap((x, n) => (n === 0 ? [x] : [n === xs.length - 1 ? ' and ' : ', ', x]));
  const shared = on.filter((i) => !i.by);
  const byDrug = new Map();
  for (const i of on.filter((x) => x.by)) byDrug.set(i.by, [...(byDrug.get(i.by) || []), i]);
  const groups = [...byDrug].map(([drug, xs]) => [...join(xs), ` from ${drug}`]);
  const out = [t.lead, ...join(shared)];
  groups.forEach((g, n) => {
    if (n === 0 && shared.length) out.push(', as well as ');
    else if (n > 0) out.push(n === groups.length - 1 ? ', and ' : ', ');
    out.push(...g);
  });
  out.push('.');
  return out;
}
const tierText = (t) => tierPieces(t).map((x) => (typeof x === 'string' ? x : x.text)).join('');

// The note as parts the user can switch, cycle or edit, each in a paragraph (para).
// s: the facts from the rail, plus drugs (keys), off (Set of part ids and effect texts),
// extra ({ tier: [text] }), cycle ({ id: value }).
export function build(s) {
  const intent = INTENT[s.intent];
  const tox = toxicities(s.drugs);
  const on = (id) => !s.off.has(id);
  const parts = [];
  let para = 0;
  const line = (id, text) => text && parts.push({ id, text, on: on(id), para });

  // Opening: what was discussed, then why it is given
  const named = s.drugs.filter((k) => DRUGS[k] && !DRUGS[k].supportive).map((k) => DRUGS[k].name);
  const what = s.name || 'systemic anticancer therapy';
  const spelt = s.name && named.length && !named.every((n) => s.name.toLowerCase().includes(n.toLowerCase())) ? ` (${list(named)})` : '';
  const rt = s.rt && !/\bRT\b|radiotherapy/i.test(s.name || '') ? ' given concurrently with radiotherapy' : '';
  if (s.name || s.dx) line('head', `Counselled the patient regarding ${intent ? `${intent.word} ` : ''}${what}${spelt}${rt}${s.dx ? ` for ${s.dx}` : ''}.`);
  if (intent) line('intent', intent.text);
  if (s.schedule) {
    const tail = `${s.duration ? `, for ${s.duration}` : ''}, subject to tolerance${s.intent === 'palliative' ? ' and response' : ''}`;
    parts.push({ id: 'schedule', edit: true, lead: 'The planned schedule is ', text: lower(s.schedule), tail, on: on('schedule'), para });
  }
  if (s.benefit) line('benefit', stop(`Expected benefit was discussed: ${s.benefit}`));

  // Side effects: a paragraph per tier
  for (const [tier, title, lead] of TIERS) {
    const items = [
      ...tox[tier].map((r) => ({ key: r.t, text: r.t, by: r.all ? null : r.by.join(' and '), on: on(r.t) })),
      ...(s.extra?.[tier] || []).map((t) => ({ key: t, text: t, by: null, on: on(t), own: true })),
    ];
    if (items.length) parts.push({ id: `tox-${tier}`, tier, title, lead, items, on: true, para: ++para });
  }
  para++;
  line('trd', s.trd ? `The risk of treatment-related death was discussed and estimated at approximately ${s.trd}%.` : 'The risk of treatment-related death was discussed.');

  // Everything else discussed, as one paragraph
  para++;
  if (s.rt) line('rt', 'Radiotherapy side effects, which may add to those of chemotherapy, will be discussed separately by Radiation Oncology.');
  if (s.drugs.some((k) => DRUGS[k]?.fp)) parts.push({ id: 'dpyd', cycle: CYCLES.dpyd, value: s.cycle.dpyd || '', on: true, para });
  line('hbv', 'Hepatitis B screening before treatment was discussed.');
  line('fertility', 'Effects on fertility, contraception during and after treatment, and avoidance of pregnancy and breastfeeding were discussed.');
  line('fever', 'Fever, when to seek urgent care and dietary advice were discussed.');
  if (s.drugs.some((k) => IO.test(DRUGS[k]?.cls || ''))) line('io', 'Immune-related side effects can occur at any time, including after treatment ends. The patient was advised to tell any treating doctor about immunotherapy exposure.');
  if (intent) line('alt', `Alternatives were discussed, including ${intent.alt}.`);
  if (s.interpreter) line('interpreter', `Counselling was conducted with ${/^[aeiou]/i.test(s.interpreter) ? 'an' : 'a'} ${s.interpreter} interpreter.`);
  line('written', 'Written information was provided.');
  line('questions', 'The patient verbalised understanding, and questions were answered.');
  parts.push({ id: 'decision', cycle: CYCLES.decision, value: s.cycle.decision ?? 'proceed', on: true, para });
  for (const p of parts) if (p.cycle) { p.text = p.cycle.find(([v]) => v === p.value)[1]; p.on = p.value !== ''; }
  return parts;
}

// Plain text of what is switched on, paragraph for paragraph as the note shows it
export function toText(parts) {
  const paras = new Map();
  for (const p of parts) {
    if (!p.on) continue;
    const t = p.tier ? tierText(p) : p.edit ? stop(`${p.lead}${p.text}${p.tail}`) : p.text;
    if (t) paras.set(p.para, [...(paras.get(p.para) || []), t]);
  }
  return [...paras.values()].map((xs) => xs.join(' ')).join('\n\n');
}

// Convenience for tests and samples: the note straight from the facts
export const note = (s) => toText(build({ off: new Set(OFF_BY_DEFAULT), extra: {}, cycle: {}, ...s }));
