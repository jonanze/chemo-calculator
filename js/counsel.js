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

const ROUTE = {
  'IV': 'IV', 'IV bolus': 'IV bolus', 'PO': 'orally', 'SC': 'subcutaneously', 'IM': 'IM', 'IM/IV': 'IM or IV',
  'IV over 12h': 'IV over 12 hours', 'IV CI 7 days': 'as a 7-day infusion',
};
const route = (r) => ROUTE[r] || (/^IV CI (\d+)h$/.test(r) ? `as a ${r.match(/\d+/)[0]}-hour infusion` : r);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// "1-5" -> "days 1 to 5"; "1,8,15" -> "days 1, 8 and 15"
function dayText(d) {
  const parts = String(d).split(',').map((p) => p.trim().replace('-', ' to '));
  return `${parts.length === 1 && !parts[0].includes(' to ') ? 'day' : 'days'} ${list(parts)}`;
}

// The schedule in words, without doses: doses stay reference only and never go into the record
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
    if (!e.routes.includes(route(r))) e.routes.push(route(r));
    if (!e.days.includes(dayText(days))) e.days.push(dayText(days));
    byDrug.set(d.name, e);
  }
  const entries = [...byDrug.entries()];
  const sameDays = new Set(entries.map(([, e]) => e.days.join())).size === 1;
  const parts = entries.map(([name, e]) => `${name} ${e.routes.join(' then ')}${sameDays ? '' : ` on ${list(e.days)}`}`);
  const when = sameDays && entries.length ? ` on ${list(entries[0][1].days)}` : '';
  const every = reg.cycleDays ? `, every ${reg.cycleDays} days` : '';
  return cap(`${sameDays ? list(parts) : parts.join('; ')}${when}${every}${gcsf ? ', with G-CSF support' : ''}`);
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
    ['planned', 'DPYD genotyping requested before starting.'],
    ['normal', 'DPYD genotype: No actionable variant.'],
    ['variant', 'DPYD genotype: Actionable variant; fluoropyrimidine dose reduced accordingly.'],
  ],
  decision: [
    ['proceed', 'Wishes to proceed; consent obtained.'],
    ['consider', 'Wishes to consider the options before deciding.'],
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
  if (s.rt) line('rt', 'Radiotherapy adds to fatigue and to skin and mucosal reactions in the treated area.');
  if (s.trd) line('trd', `Estimated risk of treatment-related death about ${s.trd}%.`);

  if (intent) line('alt', intent.observation);
  if (s.drugs.some((k) => DRUGS[k]?.fp)) parts.push({ id: 'dpyd', cycle: CYCLES.dpyd, value: s.cycle.dpyd || '', on: true });
  line('hbv', 'Hepatitis B screening before treatment discussed.');
  line('fertility', 'Effects on fertility and the need for contraception discussed.');
  line('fever', 'Advised to seek urgent care for fever of 38 °C or above, or other warning symptoms.');
  line('written', 'Written information given.');
  line('questions', 'Questions answered; understanding verbalised.');
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
