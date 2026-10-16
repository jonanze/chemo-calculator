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
    // A block with no open start within 3 days stays put, its closed day flagged for a hand edit
    const open = DEFAULT_SETTINGS.chemoDays.includes(weekday(c.date)) && !PH.has(c.date);
    assert.ok(open || c.flags.some((f) => ['ph', 'off', 'closed'].includes(f.t)), `${at}: chemo on a closed day ${formatDay(c.date)}, unflagged`);
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

// Blocks move at most 3 days, else stay flagged for a hand edit (Jonan, 16 Oct 2026)
test('outpatient D1-5 never runs two cycles a week apart', () => {
  // Topotecan C1 Mon 30/11/26: C2's week has Christmas, the next New Year; C2 stays on 21/12, flagged
  const res = plan({ regimen: { name: 'Topo', cycleDays: 21, days: [1, 2, 3, 4, 5] }, review: '2026-11-27', chemo: '2026-11-30', every: 1, cycle: 1 }, S(), SG_HOLIDAYS);
  const d1 = res.events.filter((e) => e.kind === 'chemo' && e.day === 1).map((e) => e.date);
  for (let j = 1; j < d1.length; j++) assert.ok(d1[j] - d1[j - 1] > 14, `C${j + 1} only ${d1[j] - d1[j - 1]} days after C${j}`);
});

test('outpatient BEP: a slipped D1-5 does not leave the next TCU inside the previous cycle', () => {
  sweep({ name: 'BEP', cycleDays: 21, days: [1, 2, 3, 4, 5, 8, 15] }, invariants, { weekdays: [1] });
});

test('treatment days beyond the cycle length are rejected', () => {
  assert.equal(parseDays('D1, D8, D22', 21), null);
});

// A clinic visit is at most a week before its treatment (Jonan, 16 Oct 2026)
test('a treatment more than a week after its clinic date is refused', () => {
  const ff = { name: 'FOLFOX', cycleDays: 14, days: [1] };
  assert.equal(plan({ regimen: ff, review: '2026-10-05', chemo: '2026-10-21', every: 2, cycle: 1 }, S(), SG_HOLIDAYS).error,
    'Treatment date is more than a week after clinic date');
  assert.equal(plan({ regimen: ff, review: '2026-10-05', chemo: '2026-10-12', every: 2, cycle: 1 }, S(), SG_HOLIDAYS).error, null);
  // The entered TCU on a PH is offered only days within a week of the entered treatment:
  // TCU Mon 9/11/26 (Deepavali in lieu), chemo Mon 16/11/26; Fri 6/11 would be 10 days before
  const r = plan({ regimen: ff, review: '2026-11-09', chemo: '2026-11-16', every: 2, cycle: 1 }, S({ visits: 1 }), SG_HOLIDAYS)
    .events.find((e) => e.kind === 'review' && e.k === 0);
  assert.equal(r.pending, true);
  assert.deepEqual(r.options.map(fromDay), ['2026-11-10']);
});

test('TCU labs serve D1 only within the valid window; a later D1 gets its own labs', () => {
  // Carbo-etoposide: TCU Mon 12/4/27, C1 Mon 19/4/27 (7 days): labs at the TCU
  const ce = { name: 'CE', cycleDays: 21, days: [1, 2, 3] };
  const tcuOf = (res) => res.events.find((e) => e.kind === 'review' && e.k === 0);
  const ownLabs = (res) => res.events.find((e) => e.kind === 'labs' && e.k === 0 && e.day === 1);
  const at7 = plan({ regimen: ce, review: '2027-04-12', chemo: '2027-04-19', every: 1, cycle: 1 }, S({ visits: 1 }), SG_HOLIDAYS);
  assert.equal(tcuOf(at7).labs, true);
  // A shorter window gives C1 its own labs the working day before
  const at3 = plan({ regimen: ce, review: '2027-04-12', chemo: '2027-04-19', every: 1, cycle: 1 }, S({ visits: 1, tcuLabsDays: 3 }), SG_HOLIDAYS);
  assert.equal(tcuOf(at3).labs, false);
  assert.equal(fromDay(ownLabs(at3).date), '2027-04-16');
  // TCU Fri 9/4/27, C1 entered Fri 16/4: the block can't run into Sunday, moves to Mon 19/4,
  // 10 days after the TCU, so C1 gets its own labs on Fri 16/4
  const slipped = plan({ regimen: ce, review: '2027-04-09', chemo: '2027-04-16', every: 1, cycle: 1 }, S({ visits: 1 }), SG_HOLIDAYS);
  assert.equal(fromDay(slipped.events.find((e) => e.kind === 'chemo' && e.k === 0).date), '2027-04-19');
  assert.equal(tcuOf(slipped).labs, false);
  assert.equal(fromDay(ownLabs(slipped).date), '2027-04-16');
});

test('a closed date can shut only the clinic, the labs or the unit', () => {
  const ff = { name: 'FOLFOX', cycleDays: 14, days: [1] };
  // TCU Mon 12/10/26, chemo Tue 13/10/26; C2 TCU Mon 26/10, labs at it, chemo Tue 27/10
  const run = (closedDates) => plan({ regimen: ff, review: '2026-10-12', chemo: '2026-10-13', every: 1, cycle: 1 }, S({ visits: 1, closedDates }), SG_HOLIDAYS)
    .events.filter((e) => e.k === 1);
  const unit = run(['2026-10-27@chemo']);
  assert.equal(fromDay(unit.find((e) => e.kind === 'chemo').date), '2026-10-28');
  assert.equal(unit.find((e) => e.kind === 'review').pending, undefined);
  const clinic = run(['2026-10-26@clinic']);
  assert.equal(clinic.find((e) => e.kind === 'review').pending, true);
  assert.equal(fromDay(clinic.find((e) => e.kind === 'chemo').date), '2026-10-27');
  const labs = run(['2026-10-26@labs']);
  assert.equal(labs.find((e) => e.kind === 'review').pending, undefined);
  assert.equal(fromDay(labs.find((e) => e.kind === 'labs').date), '2026-10-23'); // Fri before
  // A bare date shuts all three, as before
  const all = run(['2026-10-26']);
  assert.equal(all.find((e) => e.kind === 'review').pending, true);
});
