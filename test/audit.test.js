// Engine audit (16 Oct 2026): invariants swept over every start date in the PH data, plus
// known gaps pinned as todo tests. Findings: project-files chemo-calculator/engine-audit/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, toDay, fromDay, weekday, formatDay, parseDays } from '../js/engine.js';
import { SG_HOLIDAYS } from '../js/holidays.js';
import { DEFAULT_SETTINGS } from '../js/defaults.js';

const S = (o = {}) => ({ ...DEFAULT_SETTINGS, ...o });
const PH = new Set(Object.keys(SG_HOLIDAYS.dates).map(toDay));
const workdayBefore = (d) => { let r = d - 1; while ([0, 6].includes(weekday(r))) r--; return r; };

// Every weekday start from Jan 2026 to Aug 2027, TCU the working day before, three visits
function sweep(regimen, check, { weekdays = [1, 2, 3, 4, 5], settings = {} } = {}) {
  for (let d = toDay('2026-01-05'); d < toDay('2027-09-01'); d++) {
    if (!weekdays.includes(weekday(d))) continue;
    const input = { regimen, review: fromDay(workdayBefore(d)), chemo: fromDay(d), every: 1, cycle: 1 };
    check(plan(input, S({ visits: 3, ...settings }), SG_HOLIDAYS), formatDay(d));
  }
}

function invariants(res, at) {
  const chemo = res.events.filter((e) => e.kind === 'chemo');
  for (const c of chemo) {
    assert.ok(DEFAULT_SETTINGS.chemoDays.includes(weekday(c.date)) && !PH.has(c.date), `${at}: chemo on a closed day ${formatDay(c.date)}`);
  }
  for (let j = 1; j < chemo.length; j++) assert.ok(chemo[j].date > chemo[j - 1].date, `${at}: treatments out of order`);
  for (const l of res.events.filter((e) => e.kind === 'labs')) {
    const t = chemo.find((c) => c.k === l.k && c.day === l.day);
    assert.ok(l.date < t.date, `${at}: labs not before treatment`);
    assert.ok(DEFAULT_SETTINGS.labDays.includes(weekday(l.date)) && !PH.has(l.date), `${at}: labs on a closed day`);
  }
  for (const r of res.events.filter((e) => e.kind === 'review' && e.k > 0)) {
    const prev = chemo.filter((c) => c.k < r.k).at(-1);
    assert.ok(r.date > prev.date, `${at}: TCU ${formatDay(r.date)} not after the previous treatment`);
  }
}

test('single-day and D1/D8/D15 regimens keep every invariant over 2026-27', () => {
  for (const r of [
    { name: 'FOLFOX', cycleDays: 14, days: [1] },
    { name: 'wPac', cycleDays: 7, days: [1] },
    { name: 'q21', cycleDays: 21, days: [1] },
    { name: 'Gem-cis', cycleDays: 21, days: [1, 8] },
    { name: 'Gem-nab', cycleDays: 28, days: [1, 8, 15] },
  ]) sweep(r, invariants);
});

test('outpatient D1-5 never runs two cycles a week apart', { todo: 'block slips are unbounded and the 6-day floor lets q21 collapse to 7 days' }, () => {
  // Topotecan C1 Mon 30/11/26: C2 slips 21/12 -> 4/1/27 (Christmas, New Year); C3 stays on 11/1/27
  const res = plan({ regimen: { name: 'Topo', cycleDays: 21, days: [1, 2, 3, 4, 5] }, review: '2026-11-27', chemo: '2026-11-30', every: 1, cycle: 1 }, S(), SG_HOLIDAYS);
  const d1 = res.events.filter((e) => e.kind === 'chemo' && e.day === 1).map((e) => e.date);
  for (let j = 1; j < d1.length; j++) assert.ok(d1[j] - d1[j - 1] > 14, `C${j + 1} only ${d1[j] - d1[j - 1]} days after C${j}`);
});

test('outpatient BEP: a slipped D1-5 does not leave the next TCU inside the previous cycle', { todo: 'D8/D15 keep planned days; the floor cascades the slip while TCUs stay on the grid' }, () => {
  sweep({ name: 'BEP', cycleDays: 21, days: [1, 2, 3, 4, 5, 8, 15] }, invariants, { weekdays: [1] });
});

test('treatment days beyond the cycle length are rejected', { todo: 'parseDays has no cycle length; D22 in q21 overlaps C2 D1' }, () => {
  assert.equal(parseDays('D1, D8, D22', 21), null);
});

test('a TCU entered well before C1 does not set the gap for later TCUs', { todo: 'spec gap: the entered TCU-to-chemo gap is used for every cycle' }, () => {
  // FOLFOX: TCU Mon 5/10/26, C1 delayed to Wed 21/10/26; the C3 TCU lands before C2
  const res = plan({ regimen: { name: 'FOLFOX', cycleDays: 14, days: [1] }, review: '2026-10-05', chemo: '2026-10-21', every: 2, cycle: 1 }, S(), SG_HOLIDAYS);
  invariants(res, 'FOLFOX delayed C1');
});
