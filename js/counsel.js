import { DRUGS } from './counsel-data.js';

// The toxicities of a regimen, tier by tier, each attributed to the drugs that cause it
export function toxicities(drugs) {
  const tiers = { common: new Map(), serious: new Map(), rare: new Map() };
  for (const k of drugs) {
    const d = DRUGS[k];
    if (!d) continue;
    for (const tier of Object.keys(tiers)) {
      for (const x of d.tox?.[tier] || []) {
        const row = tiers[tier].get(x.t) || { t: x.t, fatal: false, by: [] };
        row.fatal ||= !!x.fatal;
        row.by.push(d.name);
        tiers[tier].set(x.t, row);
      }
    }
  }
  return Object.fromEntries(Object.entries(tiers).map(([k, m]) => [k, [...m.values()]]));
}

// The note itself: ported from the source once it arrives
export function note() {
  return '';
}
