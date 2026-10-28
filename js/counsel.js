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

const DPYD = {
  discussed: 'DPYD genotyping discussed.',
  planned: 'DPYD genotyping requested before starting.',
  normal: 'DPYD genotype: No actionable variant.',
  variant: 'DPYD genotype: Actionable variant; fluoropyrimidine dose reduced accordingly.',
};
const DECISION = {
  proceed: 'Wishes to proceed; consent obtained.',
  consider: 'Wishes to consider the options before deciding.',
  declined: 'Declined treatment.',
};

const stop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

// The note, as plain text. s: the form, plus drugs (keys), off (Set of unticked effects) and extra ({ tier: [text] }).
export function note(s) {
  const intent = INTENT[s.intent];
  const tox = toxicities(s.drugs);
  const lines = [];

  const what = [intent && s.intent !== 'curative' ? intent.label.toLowerCase() : '', s.name].filter(Boolean).join(' ');
  if (what || s.dx) {
    lines.push(stop(`Counselled regarding ${what || 'treatment'}${s.dx ? ` for ${s.dx}` : ''}${s.interpreter ? `, with a ${s.interpreter} interpreter` : ''}`));
  }
  if (s.schedule) {
    lines.push(stop(`Schedule: ${cap(s.schedule)}${s.duration ? `, for ${s.duration}` : ''}${s.rt ? ', with concurrent radiotherapy' : ''}`));
  }
  if (intent) lines.push(intent.text + (s.benefit ? ` ${stop(`Expected benefit: ${s.benefit}`)}` : ''));

  const tiers = TIERS.map(([tier, title]) => {
    const items = tox[tier].filter((r) => !s.off.has(r.t)).map((r) => (r.all ? cap(r.t) : `${cap(r.t)} (${r.by.join(', ')})`));
    items.push(...(s.extra?.[tier] || []).map(cap));
    return items.length ? `${title}: ${items.join('; ')}.` : '';
  }).filter(Boolean);
  if (s.rt) tiers.push('Radiotherapy adds to fatigue and to skin and mucosal reactions in the treated area.');
  if (tiers.length) {
    if (s.compact) lines.push(`Side effects discussed. ${tiers.join(' ')}`);
    else lines.push('Side effects discussed:', ...tiers.map((t) => `・ ${t}`));
  }
  if (s.trd) lines.push(`Estimated risk of treatment-related death about ${s.trd}%.`);

  const other = [];
  if (s.observation && intent) other.push(intent.observation);
  if (s.dpyd && s.drugs.some((k) => DRUGS[k]?.fp)) other.push(DPYD[s.dpyd]);
  if (s.hbv) other.push('Hepatitis B screening before treatment discussed.');
  if (s.fertility) other.push('Effects on fertility and the need for contraception discussed.');
  if (s.fever) other.push('Advised to seek urgent care for fever of 38 °C or above, or other warning symptoms.');
  if (s.written) other.push('Written information given.');
  if (s.questions) other.push('Questions answered; understanding verbalised.');
  if (other.length) lines.push(other.join(' '));
  if (DECISION[s.decision]) lines.push(DECISION[s.decision]);

  return (s.compact ? lines.join(' ') : lines.join('\n')).replace(/^./, cap);
}
