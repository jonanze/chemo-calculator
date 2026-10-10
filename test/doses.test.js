import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, bsa, crcl, carbo, mg, DRUGS } from '../js/doses.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// Expected values worked from the workbook's own formulas
test('body size matches the workbook BSA sheet', () => {
  const r = compute({ ht: 160, wt: 70, sex: 'F' });
  near(r.bsa, Math.sqrt(160 * 70 / 3600));
  near(r.ibw, 0.9 * 160 - 92);
  near(r.aibw, 52 + 0.4 * (70 - 52));
  near(r.devine, 45.5 + 0.91 * (160 - 152.4));
  near(r.adjusted, r.devine + 0.4 * (70 - r.devine));
});

test('doses multiply BSA, weight or AIBW as in the workbook', () => {
  const r = compute({ ht: 160, wt: 70, sex: 'F' });
  const d = (name) => r.drugs.find((x) => x.name.startsWith(name));
  near(d('Paclitaxel').rows.find((x) => x.dose === 175).mg, 175 * bsa(160, 70));
  near(d('Bevacizumab').rows.find((x) => x.dose === 15).mg, 15 * 70);
  near(d('MIRV').rows.find((x) => x.dose === 6).mg, 6 * 59.2);
  near(d('Capecitabine').rows.find((x) => x.dose === 1250).mg, 1250 * bsa(160, 70));
});

test('female CrCl floors creatinine at 62 µmol/L; male uses measured', () => {
  near(crcl({ age: 60, wt: 70, cr: 50, sex: 'F' }).value, 1.04 * 80 * 70 / 62);
  near(crcl({ age: 60, wt: 70, cr: 90, sex: 'F' }).value, 1.04 * 80 * 70 / 90);
  near(crcl({ age: 60, wt: 70, cr: 50, sex: 'M' }).value, 1.23 * 80 * 70 / 50);
});

test('carboplatin is Calvert and flags doses above the max', () => {
  near(carbo(100, 5), 625);
  const r = compute({ ht: 175, wt: 70, sex: 'M', age: 60, cr: 50 });
  const auc5 = r.carbo.find((x) => x.auc === 5);
  near(auc5.mg, (1.23 * 80 * 70 / 50 + 25) * 5);
  assert.equal(auc5.max, 750);
  assert.equal(auc5.over, true);
});

test('cisplatin 40 mg/m² flags the CCRT 70 mg cap', () => {
  const big = compute({ ht: 180, wt: 90, sex: 'F' }).drugs.find((x) => x.name === 'Cisplatin');
  assert.equal(big.rows.find((x) => x.dose === 40).over, true);
  const small = compute({ ht: 150, wt: 45, sex: 'F' }).drugs.find((x) => x.name === 'Cisplatin');
  assert.equal(small.rows.find((x) => x.dose === 40).over, false);
});

test('nothing is computed until the inputs are there', () => {
  const r = compute({ ht: NaN, wt: NaN, sex: 'F' });
  assert.equal(r.bsa, undefined);
  assert.ok(r.drugs.every((d) => d.rows.every((x) => x.mg === null)));
  assert.ok(r.carbo.every((x) => x.mg === null));
});

test('display rounding', () => {
  assert.equal(mg(2.4694), '2.47');
  assert.equal(mg(42.54), '42.5');
  assert.equal(mg(308.66), '309');
  assert.equal(DRUGS.length, 17);
});
