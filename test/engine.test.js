import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, toText, formatDay, toDay, fromDay, weekday, groupConsecutive, parseDays } from '../js/engine.js';
import { SG_HOLIDAYS } from '../js/holidays.js';
import { DEFAULT_SETTINGS } from '../js/defaults.js';

const S = (o = {}) => ({ ...DEFAULT_SETTINGS, ...o });
const R = {
  folfox: { name: 'FOLFOX', cycleDays: 14, days: [1] },
  gemcis: { name: 'Gem-cis', cycleDays: 21, days: [1, 8] },
  carboEto: { name: 'Carbo-etoposide', cycleDays: 21, days: [1, 2, 3] },
};
const rows = (res) => res.events.map((e) => [e.kind, fromDay(e.date), e.cycle ?? null, e.day ?? null]);
const find = (res, kind, cycle, day = 1) =>
  res.events.find((e) => e.kind === kind && e.cycle === cycle && (e.day ?? 1) === day);

test('date helpers', () => {
  assert.equal(weekday(toDay('2026-10-07')), 3); // Wed
  assert.equal(formatDay(toDay('2026-10-14')), 'Wed 14/10/26');
  assert.equal(formatDay(toDay('2027-01-01'), 'EEE dd/MM/yyyy'), 'Fri 01/01/2027');
  assert.equal(formatDay(toDay('2026-11-09'), 'd MMM yyyy'), '9 Nov 2026');
  assert.deepEqual(groupConsecutive([8, 1, 2, 3, 15]), [[1, 2, 3], [8], [15]]);
});

test('every holiday date matches its MOM weekday', () => {
  // Spot-check: in-lieu days are Mondays
  for (const d of ['2026-06-01', '2026-08-10', '2026-11-09', '2027-02-08']) assert.equal(weekday(toDay(d)), 1);
});

const folfoxInput = {
  regimen: R.folfox, review: '2026-10-09', chemo: '2026-10-12', every: 3, labs: true, cycle: 3,
};

test('FOLFOX q14, review every 3, Monday chemo with Friday labs', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS);
  assert.equal(res.error, null);
  const r0 = find(res, 'review', 3);
  assert.equal(fromDay(r0.date), '2026-10-09');
  assert.equal(r0.labs, true);
  assert.equal(fromDay(find(res, 'labs', 4).date), '2026-10-23'); // Fri before Mon
  assert.equal(fromDay(find(res, 'chemo', 4).date), '2026-10-26');
});

test('chemo on PH moves forward; labs that would hit chemo day move back', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS);
  const c5 = find(res, 'chemo', 5);
  assert.equal(fromDay(c5.date), '2026-11-10'); // 9/11 Deepavali in lieu -> Tue
  assert.deepEqual(c5.flags.map((f) => f.t), ['ph', 'moved']);
  const l5 = find(res, 'labs', 5);
  assert.equal(fromDay(l5.date), '2026-11-06'); // Mon PH, Tue is chemo -> back to Fri
});

test('original schedule keeps grid and flags the short interval', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS);
  const c6 = find(res, 'chemo', 6);
  assert.equal(fromDay(c6.date), '2026-11-23');
  assert.deepEqual(c6.flags, [{ t: 'short', days: 13 }]);
  const r6 = find(res, 'review', 6);
  assert.equal(fromDay(r6.date), '2026-11-20');
  assert.equal(r6.labs, true);
});

test('reanchor setting counts on from the moved date', () => {
  const res = plan(folfoxInput, S({ knockOn: 'reanchor' }), SG_HOLIDAYS);
  assert.equal(fromDay(find(res, 'chemo', 6).date), '2026-11-24');
  assert.deepEqual(find(res, 'chemo', 6).flags, []);
});

test('clinic visit on PH prompts with previous and next clinic day', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS);
  const r9 = find(res, 'review', 9);
  assert.equal(r9.pending, true);
  assert.equal(fromDay(r9.date), '2027-01-01');
  assert.deepEqual(r9.options.map(fromDay), ['2026-12-31', '2027-01-04']);
  assert.equal(r9.labs, true);
  assert.equal(fromDay(find(res, 'chemo', 9).date), '2027-01-04');
  // Output window ends with the chemo after visit 2
  assert.equal(res.events.at(-1).cycle, 9);
});

test('choosing a reschedule date resolves the prompt', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS, { 6: '2026-12-31' });
  const r9 = find(res, 'review', 9);
  assert.equal(r9.pending, undefined);
  assert.equal(fromDay(r9.date), '2026-12-31');
  assert.deepEqual(r9.flags.map((f) => f.t), ['ph', 'moved']);
});

test('gem-cis D1/D8: review pre-cycle only, labs before each treatment day', () => {
  const res = plan(
    { regimen: R.gemcis, review: '2026-10-13', chemo: '2026-10-14', every: 1, labs: true, cycle: 1 },
    S(), SG_HOLIDAYS,
  );
  assert.deepEqual(rows(res), [
    ['review', '2026-10-13', 1, null],
    ['chemo', '2026-10-14', 1, 1],
    ['labs', '2026-10-20', 1, 8],
    ['chemo', '2026-10-21', 1, 8],
    ['review', '2026-11-03', 2, null],
    ['chemo', '2026-11-04', 2, 1],
    ['labs', '2026-11-10', 2, 8],
    ['chemo', '2026-11-11', 2, 8],
    ['review', '2026-11-24', 3, null],
    ['chemo', '2026-11-25', 3, 1],
    ['labs', '2026-12-01', 3, 8],
    ['chemo', '2026-12-02', 3, 8],
  ]);
});

test('consecutive-day block: labs before first day only, or each day by setting', () => {
  const input = { regimen: R.carboEto, review: '2026-10-13', chemo: '2026-10-14', every: 2, labs: true, cycle: 1 };
  const first = plan(input, S({ visits: 1 }), SG_HOLIDAYS);
  const c2labs = first.events.filter((e) => e.kind === 'labs' && e.cycle === 2);
  assert.deepEqual(c2labs.map((e) => [fromDay(e.date), e.day]), [['2026-11-03', 1]]);
  const each = plan(input, S({ visits: 1, blockLabs: 'each' }), SG_HOLIDAYS);
  assert.equal(each.events.filter((e) => e.kind === 'labs' && e.cycle === 2).length, 3);
});

test('labs on a PH move forward when that still precedes chemo', () => {
  const res = plan(
    { regimen: R.folfox, review: '2026-02-04', chemo: '2026-02-06', every: 2, labs: true, cycle: 1 },
    S({ labsBefore: 2, visits: 1 }), SG_HOLIDAYS,
  );
  // C2 Fri 20/2/26: labs due Wed 18/2 (CNY) -> Thu 19/2
  const l2 = find(res, 'labs', 2);
  assert.equal(fromDay(l2.date), '2026-02-19');
});

test('saturday chemo gets Friday labs', () => {
  const res = plan(
    { regimen: R.folfox, review: '2026-10-09', chemo: '2026-10-10', every: 2, labs: true, cycle: 1 },
    S({ visits: 1 }), SG_HOLIDAYS,
  );
  assert.equal(fromDay(find(res, 'chemo', 2).date), '2026-10-24');
  assert.equal(fromDay(find(res, 'labs', 2).date), '2026-10-23');
});

test('total cycles caps output and adds end-of-treatment review', () => {
  const res = plan({ ...folfoxInput, every: 1, cycle: 5, total: 6 }, S(), SG_HOLIDAYS);
  assert.deepEqual(res.events.filter((e) => e.kind === 'chemo').map((e) => e.cycle), [5, 6]);
  const eot = res.events.at(-1);
  assert.equal(eot.kind, 'eot');
  assert.equal(fromDay(eot.date), '2026-11-06'); // C6 Mon 26/10 + 14 - 3
});

test('labs off produces no labs', () => {
  const off = { labs: false };
  const res = plan({ ...folfoxInput, tcuOpts: { 0: off, 3: off, 6: off } }, S(), SG_HOLIDAYS);
  assert.equal(res.events.some((e) => e.kind === 'labs' || e.labs), false);
});

test('errors', () => {
  assert.equal(plan({ ...folfoxInput, chemo: '2026-10-08' }, S(), SG_HOLIDAYS).error, 'Chemo date is before TCU date');
  assert.equal(plan({ ...folfoxInput, cycle: 7, total: 6 }, S(), SG_HOLIDAYS).error, 'Cycle exceeds total');
});

test('dates beyond PH coverage are flagged', () => {
  const res = plan({ ...folfoxInput, review: '2027-12-17', chemo: '2027-12-20' }, S(), SG_HOLIDAYS);
  assert.ok(res.events.some((e) => e.flags.some((f) => f.t === 'nodata')));
});

test('EMR text', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS);
  const text = toText(res, folfoxInput, S());
  const lines = text.split('\n');
  assert.equal(lines[0], 'FOLFOX q14d, TCU every 3 cycles');
  assert.equal(lines[1], '');
  assert.equal(lines[2], '- Fri 9/10/26 TCU with labs');
  assert.ok(lines.includes('- Tue 10/11/26 C5 [PH, moved from Mon 9/11/26]'));
  assert.ok(lines.includes('- Mon 23/11/26 C6 [13d interval]'));
  assert.ok(lines.includes('- Fri 1/1/27 TCU with labs [PH, reschedule]'));
});

test('review stays on its usual day when the chemo it precedes moves off a PH', () => {
  const res = plan({ ...folfoxInput, every: 1, cycle: 1 }, S(), SG_HOLIDAYS);
  // C3 planned Mon 9/11 (PH) -> Tue 10/11; review stays Fri 6/11, not Sat 7/11
  assert.equal(fromDay(find(res, 'chemo', 3).date), '2026-11-10');
  const r3 = find(res, 'review', 3);
  assert.equal(fromDay(r3.date), '2026-11-06');
  assert.deepEqual(r3.flags, []);
  assert.equal(r3.pending, undefined);
});

test('non-clinic day flag names the reason', () => {
  const res = plan({ ...folfoxInput, every: 1, cycle: 1 }, S({ clinicDays: [1, 2, 3, 4] }), SG_HOLIDAYS);
  const r2 = find(res, 'review', 2);
  assert.equal(r2.pending, true);
  assert.deepEqual(r2.flags, [{ t: 'off', ctx: 'clinic' }]);
});

test('treatment days parsing', () => {
  assert.deepEqual(parseDays(''), [1]);
  assert.deepEqual(parseDays('D1'), [1]);
  assert.deepEqual(parseDays('D1/D8'), [1, 8]);
  assert.deepEqual(parseDays('1,8,15'), [1, 8, 15]);
  assert.deepEqual(parseDays('D1-3'), [1, 2, 3]);
  assert.deepEqual(parseDays('d1-3, d8'), [1, 2, 3, 8]);
  assert.equal(parseDays('day one'), null);
  assert.equal(parseDays('D3-1'), null);
});

test('EMR header without a regimen name', () => {
  const input = { ...folfoxInput, regimen: { name: '', cycleDays: 21, days: [1] } };
  const text = toText(plan(input, S(), SG_HOLIDAYS), input, S());
  assert.equal(text.split('\n')[0], 'q21d, TCU every 3 cycles');
});

test('editing a chemo D1 re-anchors that cycle and everything after', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS, {}, { 'chemo:1:1': '2026-11-02' });
  const c4 = find(res, 'chemo', 4);
  assert.equal(fromDay(c4.date), '2026-11-02');
  assert.deepEqual(c4.flags, [{ t: 'edited' }]);
  assert.equal(fromDay(find(res, 'labs', 4).date), '2026-10-30');
  assert.equal(fromDay(find(res, 'chemo', 5).date), '2026-11-16');
  assert.equal(fromDay(find(res, 'review', 6).date), '2026-11-27');
  assert.equal(fromDay(find(res, 'chemo', 6).date), '2026-11-30');
  assert.deepEqual(find(res, 'chemo', 6).flags, []);
});

test('editing a TCU moves its chemo by the same gap and re-anchors the rest', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS, {}, { 'tcu:3': '2026-11-27' });
  const r6 = find(res, 'review', 6);
  assert.equal(fromDay(r6.date), '2026-11-27');
  assert.ok(r6.flags.some((f) => f.t === 'edited'));
  assert.equal(fromDay(find(res, 'chemo', 6).date), '2026-11-30');
  assert.equal(fromDay(find(res, 'chemo', 8).date), '2026-12-28');
  assert.equal(fromDay(find(res, 'review', 9).date), '2027-01-08');
  assert.equal(fromDay(find(res, 'chemo', 9).date), '2027-01-11');
  // Earlier cycles are untouched
  assert.equal(fromDay(find(res, 'chemo', 5).date), '2026-11-10');
});

test('editing a D8 moves only that treatment day', () => {
  const input = { regimen: R.gemcis, review: '2026-10-13', chemo: '2026-10-14', every: 1, labs: true, cycle: 1 };
  const res = plan(input, S(), SG_HOLIDAYS, {}, { 'chemo:1:8': '2026-11-12' });
  assert.equal(fromDay(find(res, 'chemo', 2, 8).date), '2026-11-12');
  assert.equal(fromDay(find(res, 'labs', 2, 8).date), '2026-11-11');
  assert.equal(fromDay(find(res, 'chemo', 3).date), '2026-11-25');
});

test('editable rows carry an edit key; keyed C1 and pending TCUs do not', () => {
  const res = plan(folfoxInput, S(), SG_HOLIDAYS);
  assert.equal(find(res, 'chemo', 3).editKey, undefined);
  assert.equal(find(res, 'review', 3).editKey, undefined);
  assert.equal(find(res, 'chemo', 4).editKey, 'chemo:1:1');
  assert.equal(find(res, 'review', 6).editKey, 'tcu:3');
  assert.equal(find(res, 'review', 9).editKey, undefined); // pending PH choice
});

test('edited dates are not annotated in EMR text', () => {
  const edits = { 'chemo:1:1': '2026-11-02' };
  const text = toText(plan(folfoxInput, S(), SG_HOLIDAYS, {}, edits), folfoxInput, S());
  assert.ok(text.split('\n').includes('- Mon 2/11/26 C4'));
});

test('lab tests are named on every labs entry and in EMR text', () => {
  const input = { ...folfoxInput, labTests: 'FBC, RP, LFT, CEA' };
  const lines = toText(plan(input, S(), SG_HOLIDAYS), input, S()).split('\n');
  assert.equal(lines[2], '- Fri 9/10/26 TCU with labs (FBC, RP, LFT, CEA)');
  assert.ok(lines.includes('- Fri 23/10/26 Labs (FBC, RP, LFT, CEA)'));
  assert.ok(lines.includes('- Mon 26/10/26 C4'));
});

test('labs off at one TCU drops its labs and the labs it covers, and only those', () => {
  const res = plan({ ...folfoxInput, tcuOpts: { 3: { labs: false } } }, S(), SG_HOLIDAYS);
  assert.equal(find(res, 'review', 3).labs, true);
  assert.ok(find(res, 'labs', 4));
  assert.equal(find(res, 'review', 6).labs, false);
  assert.equal(find(res, 'labs', 7), undefined);
  assert.equal(find(res, 'labs', 8), undefined);
  assert.equal(find(res, 'review', 9).labs, true);
});

test('technical visit is the investigations themselves, with no separate scan date', () => {
  const input = { ...folfoxInput, labTests: 'FBC', tcuOpts: { 3: { tech: true, scan: true } } };
  const res = plan(input, S({ preCycleLabs: 'offset' }), SG_HOLIDAYS);
  const r6 = find(res, 'review', 6);
  assert.equal(r6.tech, true);
  assert.equal(r6.labs, true);
  assert.equal(r6.scan, true);
  assert.equal(res.events.some((e) => e.kind === 'scan'), false);
  assert.equal(find(res, 'labs', 6), undefined);
  assert.ok(toText(res, input, S()).split('\n').includes('- Fri 20/11/26 Technical visit for labs (FBC) and scan'));
});

test('technical visit with labs off is scan only, and drops labs until the next visit', () => {
  const input = { ...folfoxInput, tcuOpts: { 3: { tech: true, labs: false, scan: true } } };
  const res = plan(input, S(), SG_HOLIDAYS);
  assert.ok(toText(res, input, S()).split('\n').includes('- Fri 20/11/26 Technical visit for scan'));
  assert.equal(find(res, 'labs', 7), undefined);
});

test('scan before a TCU is undated, stated as prior, on one TCU line', () => {
  const input = { ...folfoxInput, labTests: 'FBC', tcuOpts: { 3: { scan: true } } };
  const res = plan(input, S(), SG_HOLIDAYS);
  const r6 = find(res, 'review', 6);
  assert.equal(r6.scanPrior, true);
  assert.equal(res.events.some((e) => e.kind === 'scan'), false);
  const lines = toText(res, input, S()).split('\n');
  assert.ok(lines.includes('- Fri 20/11/26 TCU with labs (FBC) and scan prior'));
});

test('scan-only TCU reads as scan prior', () => {
  const input = { regimen: R.gemcis, review: '2026-10-13', chemo: '2026-10-14', every: 1, cycle: 1, tcuOpts: { 1: { scan: true, labs: false } } };
  const res = plan(input, S(), SG_HOLIDAYS);
  assert.ok(toText(res, input, S()).split('\n').includes('- Tue 3/11/26 TCU with scan prior'));
});

test('labs can go with the scan instead of the TCU', () => {
  const input = { ...folfoxInput, labTests: 'FBC', tcuOpts: { 3: { scan: true } } };
  const res = plan(input, S({ scanLabs: 'scan' }), SG_HOLIDAYS);
  const r6 = find(res, 'review', 6);
  assert.equal(r6.labs, false);
  assert.equal(r6.labsAtScan, true);
  const lines = toText(res, input, S({ scanLabs: 'scan' })).split('\n');
  assert.ok(lines.includes('- Fri 20/11/26 TCU with scan and labs (FBC) prior'));
  assert.ok(find(res, 'labs', 7));
});


test('teleconsult TCU reads TCU (teleconsult)', () => {
  const input = { ...folfoxInput, labTests: 'FBC', tcuOpts: { 3: { tele: true, scan: true } } };
  const res = plan(input, S(), SG_HOLIDAYS);
  const lines = toText(res, input, S()).split('\n');
  assert.ok(lines.includes('- Fri 20/11/26 TCU (teleconsult) with labs (FBC) and scan prior'));
  const off = { ...folfoxInput, tcuOpts: { 3: { tele: true, labs: false } } };
  assert.ok(toText(plan(off, S(), SG_HOLIDAYS), off, S()).split('\n').includes('- Fri 20/11/26 TCU (teleconsult)'));
});

test('labs before a later treatment day name the day', () => {
  const input = { regimen: R.gemcis, review: '2026-10-13', chemo: '2026-10-14', every: 1, cycle: 1 };
  const lines = toText(plan(input, S(), SG_HOLIDAYS), input, S()).split('\n');
  assert.ok(lines.some((l) => / Labs pre-D8$/.test(l)), lines.join('\n'));
  assert.ok(lines.every((l) => !/pre-C/.test(l)));
});

test('a labs row can be switched off or given its own tests', () => {
  const input = { regimen: R.gemcis, review: '2026-10-13', chemo: '2026-10-14', every: 1, cycle: 1, labTests: 'FBC, RP, LFT' };
  const base = plan(input, S(), SG_HOLIDAYS);
  const d8 = base.events.filter((e) => e.kind === 'labs' && e.day === 8);
  assert.ok(d8.length >= 2);
  const withOpts = { ...input, labOpts: { [d8[0].labKey]: { tests: 'FBC' }, [d8[1].labKey]: { off: true } } };
  const res = plan(withOpts, S(), SG_HOLIDAYS);
  const lines = toText(res, withOpts, S()).split('\n');
  const labLines = lines.filter((l) => / Labs /.test(l));
  assert.equal(labLines.length, base.events.filter((e) => e.kind === 'labs').length - 1);
  assert.ok(labLines.some((l) => l.endsWith('Labs (FBC) pre-D8')));
  assert.ok(lines.some((l) => l.includes('TCU with labs (FBC, RP, LFT)')));
});
