import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIMENS } from '../js/regimens.js';
import { searchRegimens, matchesRegimen, doseLine as doseLineOf } from '../js/picker.js';
import { parseDays } from '../js/engine.js';

const names = (q) => searchRegimens(q, REGIMENS).map((r) => r.name);

test('every listed regimen has a unique key, valid days and a sane cycle', () => {
  assert.ok(REGIMENS.length > 300);
  const keys = new Set();
  for (const r of REGIMENS) {
    assert.ok(r.key && !keys.has(r.key), r.name);
    keys.add(r.key);
    assert.ok(parseDays(r.days), `${r.name}: ${r.days}`);
    assert.ok(r.cycleDays === null || (r.cycleDays >= 7 && r.cycleDays <= 366), `${r.name}: ${r.cycleDays}`);
  }
});

test('search ranks names that start with the query first', () => {
  assert.equal(names('folfox')[0], 'mFOLFOX6');
  assert.ok(names('capox').slice(0, 7).every((n) => n.startsWith('CAPOX')));
});

test('search matches word starts, so SCLC skips NSCLC and short words stay specific', () => {
  assert.ok(searchRegimens('sclc', REGIMENS).every((r) => !/^NSCLC$/.test(r.tumour)));
  assert.deepEqual(names('ec'), ['EC (3-weekly)']);
  assert.deepEqual(names('x'), []);
});

test('every word must match', () => {
  const hits = searchRegimens('carbo eto', REGIMENS);
  assert.ok(hits.length >= 5);
  for (const r of hits) assert.ok(r.drugs.includes('carboplatin') && r.drugs.includes('etoposide'), r.name);
});

test('reference doses hold only while name, frequency and days still match', () => {
  const r = REGIMENS.find((x) => x.name === 'mFOLFOX6');
  assert.ok(matchesRegimen({ name: 'mFOLFOX6', cycleDays: 14, days: 'd1' }, r));
  assert.ok(!matchesRegimen({ name: 'mFOLFOX6', cycleDays: 21, days: 'D1' }, r));
  assert.ok(!matchesRegimen({ name: 'FOLFOX', cycleDays: 14, days: 'D1' }, r));
  assert.ok(!matchesRegimen({ name: 'mFOLFOX6', cycleDays: 14, days: 'D1' }, undefined));
});

test('reference dose lines carry only dose and schedule', async () => {
  const tchp = REGIMENS.find((r) => r.name.startsWith('TCHP'));
  assert.ok(tchp.doses.map(doseLineOf).includes('Pertuzumab 420 mg IV D1 (C1 loading 840 mg)'));
  const { doseLine } = await import('../js/picker.js');
  const f = REGIMENS.find((r) => r.name === 'mFOLFOX6');
  assert.deepEqual(f.doses.map(doseLine), [
    'Oxaliplatin 85 mg/m² IV D1',
    'Calcium folinate (leucovorin) 50 mg IV bolus D1',
    'Fluorouracil 400 mg/m² IV bolus D1',
    'Fluorouracil 2400 mg/m² IV CI 46h D1',
  ]);
  assert.equal(doseLine(['carboplatin', 5, 'AUC', 'IV', '1']), 'Carboplatin AUC 5 IV D1');
  assert.equal(doseLine(['capecitabine', 1250, 'mg/m2 BD', 'PO', '1-14']), 'Capecitabine 1250 mg/m² BD PO D1-14');
  for (const r of REGIMENS) {
    assert.ok(r.doses.length > 0, r.name);
    for (const d of r.doses) {
      assert.ok(Number(d[1]) > 0 && d.length >= 5 && d.length <= 6, `${r.name}: ${d}`);
      // Dose notes carry doses and schedules only, never advice
      if (d[5]) assert.doesNotMatch(d[5], /consider|\bmay\b|trial|discretion|\balt\b|recommended/i, `${r.name}: ${d[5]}`);
    }
    assert.deepEqual(Object.keys(r), ['key', 'name', 'tumour', 'setting', 'cycleDays', 'days', 'drugs', 'doses'], r.name);
    assert.doesNotMatch(JSON.stringify(r), /https?:|www\./, r.name);
  }
});
