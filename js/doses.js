// Dose calculator, ported from Jonan's "Calculators IBW AIBW" workbook.
// Height in cm, weight in kg, creatinine in µmol/L.

export const bsa = (ht, wt) => Math.sqrt((ht * wt) / 3600); // Mosteller
export const bmi = (ht, wt) => wt / (ht / 100) ** 2;
export const ibwMirv = (ht) => 0.9 * ht - 92; // mirvetuximab label (female)
export const devine = (ht, sex) => (sex === 'M' ? 50 : 45.5) + 0.91 * (ht - 152.4);
export const adjusted = (ibw, wt) => ibw + 0.4 * (wt - ibw);

// Cockcroft-Gault in SI units. Creatinine is floored at 62 µmol/L for both sexes
// (the workbook floored women only; Jonan chose both, 10 Oct 2026).
export const CR_FLOOR = 62;
export function crcl({ age, wt, cr, sex }) {
  const used = Math.max(cr, CR_FLOOR);
  return { value: ((sex === 'F' ? 1.04 : 1.23) * (140 - age) * wt) / used, crUsed: used };
}

// Calvert; the max is the dose at a GFR of 125 mL/min
export const carbo = (gfr, auc) => (gfr + 25) * auc;
export const carboMax = (auc) => 150 * auc;
export const CARBO_AUCS = [1.5, 2, 4, 4.5, 5, 6];

// Fill colours are the workbook's own (Office theme tints resolved to hex).
// per: what the dose multiplies. bold: doses the workbook shows in bold.
export const DRUGS = [
  { name: 'Paclitaxel', fill: '#FFFD78', per: 'bsa', doses: [60, 70, 80, 110, 135, 150, 160, 175], bold: [110, 135, 150, 160, 175] },
  { name: 'Abraxane (100 mg vials)', fill: '#FFC000', per: 'bsa', doses: [125, 180, 210, 220, 260], bold: [260] },
  { name: 'Docetaxel', fill: '#FF9933', per: 'bsa', doses: [60, 75, 90, 100] },
  { name: 'Doxorubicin', fill: '#F2DCDB', per: 'bsa', doses: [60] },
  { name: 'PLD', fill: '#D99694', per: 'bsa', doses: [30, 40] },
  { name: 'Cyclo', fill: '#B7DEE8', per: 'bsa', doses: [600] },
  { name: 'Cisplatin', fill: '#4F81BD', per: 'bsa', doses: [30, 35, 40, 50, 70], cap: { dose: 40, mg: 70, label: 'CCRT cap 70 mg' } },
  { name: 'Gemcitabine', fill: '#B3A2C7', per: 'bsa', doses: [600, 800, 1000] },
  { name: 'Capecitabine', fill: '#C3D69B', per: 'bsa', doses: [825, 1000, 1250], suffix: ' BD' },
  { name: 'IV Vino', fill: '#77933C', per: 'bsa', doses: [25, 30] },
  { name: 'PO Vino', fill: '#4F6228', per: 'bsa', doses: [60, 80] },
  { name: 'Eribulin (1 mg vials)', fill: '#E6E0EC', per: 'bsa', doses: [1.4, 1.1, 0.7] },
  { name: 'Bevacizumab', fill: '#BFBFBF', per: 'wt', doses: [7.5, 10, 15] },
  { name: 'Trastuzumab', fill: '#EEECE1', per: 'wt', doses: [8, 6] },
  { name: 'T-DM1 (160 mg vials)', fill: '#C4BD97', per: 'wt', doses: [3.6, 3, 2.4] },
  { name: 'T-DXd (100 mg vials)', fill: '#948A54', per: 'wt', doses: [5.4, 4.4, 3.2] },
  { name: 'MIRV (100 mg vials)', fill: '#FDEADA', per: 'aibw', doses: [6, 5, 4] },
];

export const UNIT = { bsa: 'mg/m²', wt: 'mg/kg', aibw: 'mg/kg AIBW' };

// Display rounding only; the workbook shows raw values
export function mg(x) {
  if (!Number.isFinite(x)) return '';
  if (x < 10) return x.toFixed(2);
  if (x < 100) return x.toFixed(1);
  return String(Math.round(x));
}

// Everything the panel shows, from whichever inputs are filled in
export function compute({ ht, wt, sex, age, cr, crclWt = 'actual' }) {
  const has = (x) => Number.isFinite(x) && x > 0;
  const out = {};
  if (has(ht) && has(wt)) {
    out.bsa = bsa(ht, wt);
    out.bmi = bmi(ht, wt);
    out.ibw = ibwMirv(ht);
    out.aibw = adjusted(out.ibw, wt);
    out.devine = devine(ht, sex);
    out.adjusted = adjusted(out.devine, wt);
  }
  const basis = { bsa: out.bsa, wt: has(wt) ? wt : undefined, aibw: out.aibw };
  out.drugs = DRUGS.map((d) => ({
    ...d,
    rows: d.doses.map((dose) => {
      const m = basis[d.per] != null ? dose * basis[d.per] : null;
      return { dose, mg: m, over: d.cap && d.cap.dose === dose && m != null && m > d.cap.mg };
    }),
  }));
  const w = crclWt === 'adjusted' ? out.adjusted : wt;
  if (has(age) && has(w) && has(cr)) {
    const c = crcl({ age, wt: w, cr, sex });
    out.crcl = c.value;
    out.crUsed = c.crUsed;
    out.carbo = CARBO_AUCS.map((auc) => {
      const dose = carbo(c.value, auc);
      return { auc, mg: dose, max: carboMax(auc), over: dose > carboMax(auc) };
    });
  } else out.carbo = CARBO_AUCS.map((auc) => ({ auc, mg: null, max: carboMax(auc), over: false }));
  return out;
}
