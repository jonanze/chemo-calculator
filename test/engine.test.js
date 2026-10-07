import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, toText, formatDay, toDay, fromDay, weekday, groupConsecutive } from '../js/engine.js';
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
  const res = plan({ ...folfoxInput, labs: false }, S(), SG_HOLIDAYS);
  assert.equal(res.events.some((e) => e.kind === 'labs' || e.labs), false);
});

test('errors', () => {
  assert.equal(plan({ ...folfoxInput, chemo: '2026-10-08' }, S(), SG_HOLIDAYS).error, 'Chemo date is before review date');
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
  assert.equal(lines[0], 'FOLFOX q14d, review every 3 cycles');
  assert.equal(lines[1], '- Fri 9/10/26 Review + labs pre-C3');
  assert.ok(lines.includes('- Tue 10/11/26 C5 [PH, moved from Mon 9/11/26]'));
  assert.ok(lines.includes('- Mon 23/11/26 C6 [13d interval]'));
  assert.ok(lines.includes('- Fri 1/1/27 Review + labs pre-C9 [PH, reschedule]'));
});
