// Pure scheduling engine. Dates are whole UTC day numbers; never Date objects
// with times, so there are no timezone slips.

const MS_DAY = 86400000;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const toDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
};
export const fromDay = (n) => new Date(n * MS_DAY).toISOString().slice(0, 10);
export const weekday = (n) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday

export function formatDay(n, fmt = 'EEE d/M/yy') {
  const d = new Date(n * MS_DAY);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const pad = (x) => String(x).padStart(2, '0');
  const tokens = {
    EEE: WEEKDAY[weekday(n)], yyyy: String(y), yy: pad(y % 100),
    MMM: MONTH[m], MM: pad(m + 1), M: String(m + 1), dd: pad(day), d: String(day),
  };
  return fmt.replace(/EEE|yyyy|yy|MMM|MM|M|dd|d/g, (t) => tokens[t]);
}

// Accepts '1', 'D1/D8', '1,8,15', 'D1-3', 'd1-3, d8'. Returns sorted days, or null if invalid.
// With a cycle length, a day past the end of the cycle is rejected (it would land on the next cycle)
export function parseDays(text, cycleDays = null) {
  const src = String(text ?? '').trim() || '1';
  const days = new Set();
  for (const part of src.split(/[,/;\s]+/).filter(Boolean)) {
    const m = part.match(/^d?(\d+)(?:[-–]d?(\d+))?$/i);
    if (!m) return null;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b - a > 60) return null;
    if (cycleDays && b > cycleDays) return null;
    for (let d = a; d <= b; d++) days.add(d);
  }
  return [...days].sort((x, y) => x - y);
}

export function groupConsecutive(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const blocks = [];
  for (const d of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else blocks.push([d]);
  }
  return blocks;
}

// Longest gap from a clinic visit to its treatment, in days
const MAX_TCU_GAP = 7;

// TCU every N cycles, from the form or a saved entry
const everyOf = (input) => Math.max(1, Math.floor(input.every) || 1);

// k counts cycles from the one entered (k = 0).
// choices: picked days for a TCU on a closed clinic day, keyed by k.
// edits: manual dates keyed 'tcu:<k>' or 'chemo:<k>:<day>'. An edit moves only what comes after
// it: an edited TCU or D1 re-anchors later cycles; an edited D8 also moves that cycle's D15.
// input.inpDays: block starts given as an inpatient in every cycle; input.inpOpts['<k>:<day>']
// overrides one block of one cycle.
export function plan(input, settings, holidays, choices = {}, edits = {}) {
  const S = settings;
  const R = input.regimen;
  if (!R || !input.review || !input.chemo) return { error: 'incomplete', events: [] };

  const review0 = toDay(input.review);
  const chemo0 = toDay(input.chemo);
  const offset = chemo0 - review0;
  if (offset < 0) return { error: 'Treatment date is before clinic date', events: [] };
  // A clinic visit is never more than a week before its treatment (Jonan, 16 Oct 2026)
  if (offset > MAX_TCU_GAP) return { error: 'Treatment date is more than a week after clinic date', events: [] };
  // Labs at TCU only (e.g. Phesgo, TCU every 4 cycles): none before the other doses (Jonan, 16 Oct 2026)
  const tcuLabsOnly = input.labsAt === 'tcu';

  const ph = new Map(Object.entries(holidays.dates).map(([d, name]) => [toDay(d), name]));
  // A closed date shuts clinic, labs and the unit, or just one of them ('YYYY-MM-DD@chemo')
  const closed = { clinic: new Set(), labs: new Set(), chemo: new Set() };
  for (const c of S.closedDates || []) {
    const [d, kind] = String(c).split('@');
    for (const ctx of closed[kind] ? [kind] : Object.keys(closed)) closed[ctx].add(toDay(d));
  }
  const covered = toDay(holidays.coveredThrough);
  const shut = (n, ctx) => ph.has(n) || closed[ctx].has(n);
  const open = (days, ctx) => (n) => days.includes(weekday(n)) && !shut(n, ctx);
  const clinicOK = open(S.clinicDays, 'clinic');
  const labOK = open(S.labDays, 'labs');
  const chemoOK = open(S.chemoDays, 'chemo');
  // Why a day is closed for this kind of event: a PH, a closed date, or not one of its weekdays
  const why = (n, ctx) => (ph.has(n) ? { t: 'ph', name: ph.get(n) } : closed[ctx]?.has(n) ? { t: 'closed' } : { t: 'off', ctx });
  // Flags for a treatment or labs day. Inpatient care is given on the ward, so PHs, closed
  // dates and unit days don't apply and nothing moves; a PH is still labelled so it can be
  // seen (Jonan, 15 Oct 2026).
  const closure = (n, ctx, inpatient) => {
    if (inpatient) return ph.has(n) ? [why(n, ctx)] : [];
    const ok = ctx === 'chemo' ? chemoOK : ctx === 'labs' ? labOK : clinicOK;
    return ok(n) ? [] : [why(n, ctx)];
  };

  const step = (from, dir, okFn, limit = 60) => {
    for (let n = from + dir, i = 0; i < limit; n += dir, i++) if (okFn(n)) return n;
    return null;
  };

  // A consecutive block (D1-3, D1-5) moves as a whole to the first start where
  // every one of its days is open, so it stays consecutive (Jonan, 11 Oct 2026), up to 3 days.
  // floor: earliest start that keeps the shortest interval after the previous block.
  // earliest: a 'back' move never reaches the cycle's TCU.
  const adjustChemo = (p, len, floor, earliest, inp) => {
    if (inp) return { date: p, flags: closure(p, 'chemo', true) };
    const blockOK = (s) => { for (let i = 0; i < len; i++) if (!chemoOK(s + i)) return false; return true; };
    const ok = blockOK(p);
    if (ok && p >= floor) return { date: p, flags: [] };
    let bad = p;
    if (!ok) while (chemoOK(bad)) bad++;
    const flags = [...(ok ? [] : [why(bad, 'chemo')]), { t: 'moved', from: p }];
    if (!ok && S.chemoPH === 'back') {
      const lo = Math.max(floor, earliest);
      const b = p - lo > 0 ? step(p, -1, blockOK, Math.min(14, p - lo)) : null;
      if (b !== null) return { date: b, flags };
    }
    // 'back' falls through to forward when no earlier day fits
    if (ok || S.chemoPH !== 'flag') {
      const start = Math.max(ok ? p : p + 1, floor);
      // A block moves at most 3 days; past that it stays put, flagged, for a hand edit
      // (Jonan, 16 Oct 2026). Single days keep the open search.
      const f = blockOK(start) ? start : step(start, 1, blockOK, len > 1 ? Math.max(0, p + 3 - start) : undefined);
      if (f !== null) return { date: f, flags };
    }
    return { date: p, flags: closure(p, 'chemo', false) };
  };

  const computeLabs = (T, inp) => {
    let c = T - S.labsBefore;
    if (inp) return { date: c, flags: closure(c, 'labs', true) }; // ward bloods, any day
    while (!S.labDays.includes(weekday(c)) && c > T - 14) c--; // weekend: back to Friday
    if (!shut(c, 'labs')) return { date: c, flags: [] };
    const f = step(c, 1, labOK);
    if (f !== null && f < T) return { date: f, flags: [why(c, 'labs'), { t: 'moved', from: c }] };
    const b = step(c, -1, labOK);
    return { date: b, flags: [why(c, 'labs'), { t: 'moved', from: c }] };
  };

  // A TCU on a closed clinic day waits for the user to pick the day before or after.
  // Later TCUs carry their chemo with them at the usual gap, so a day is offered only if that
  // chemo still lands after the previous treatment. The entered TCU keeps the entered chemo,
  // so it has to stay on or before it.
  const scheduleReview = (p, k, base, { prevTreat = null, maxDate = null, earliest = null } = {}) => {
    if (clinicOK(p)) return { ...base, date: p, flags: [] };
    const minDate = prevTreat === null ? earliest : prevTreat + 1 - offset;
    const options = [step(p, -1, clinicOK, 14), step(p, 1, clinicOK, 14)]
      .filter((n) => n !== null && (minDate === null || n >= minDate) && (maxDate === null || n <= maxDate));
    if (choices[k] != null) return { ...base, date: toDay(choices[k]), flags: [why(p, 'clinic'), { t: 'moved', from: p }] };
    return { ...base, date: p, flags: [why(p, 'clinic')], pending: true, options, key: k, minDate, maxDate };
  };

  const every = everyOf(input);
  const cd = R.cycleDays;
  const multiDay = R.days.length > 1;
  const lastK = every * S.visits;

  const blocks = groupConsecutive(R.days);
  const allDays = new Set(input.inpDays || []);
  const isInpatient = (k, start) => input.inpOpts?.[`${k}:${start}`] ?? allDays.has(start);
  // Shortest interval between treatment starts (a designed gap shorter than this is kept)
  const minGap = Math.max(1, Math.floor(S.minGap) || 1);
  // Per-visit options. A visit's labs setting also covers the treatment days it
  // authorises, up to the next visit. A technical visit is the investigations
  // themselves (labs and/or scan on that day) with no appointment, so it has
  // no separate scan date.
  const optsFor = (k) => ({ labs: true, tech: false, tele: false, scan: false, ...(input.tcuOpts?.[k] || {}) });

  // State carried from one cycle to the next:
  //   anchor, anchorK   the D1 that later cycles count from, and its k (an edited TCU or D1 re-anchors)
  //   prevD1            last cycle's D1, for the short-interval flag and the 'reanchor' setting
  //   prevStart,        start of the last treatment block and its nominal day, for the
  //   prevStartDay      shortest-interval floor
  //   lastTreat         the last treatment day given, which nothing may land on or before
  //   current           the options of the TCU in force (labs on or off, technical, teleconsult, scan)
  const events = [];
  let anchor = chemo0, anchorK = 0;
  let prevD1 = null, prevStart = null, prevStartDay = null, lastTreat = null;
  let current = optsFor(0);

  for (let k = 0; k <= lastK; k++) {
    let planned = S.knockOn === 'reanchor' && k > 0 ? prevD1 + cd : anchor + (k - anchorK) * cd;
    const cycle = input.cycle ? input.cycle + k : null;
    const isReview = k % every === 0;
    const tcuEdit = isReview && k > 0 ? edits[`tcu:${k}`] : undefined;
    const d1Edit = k > 0 ? edits[`chemo:${k}:${blocks[0][0]}`] : undefined;
    const scheduled = planned;
    // A rescheduled PH TCU moves its chemo at the usual gap. Like a chemo moved off a PH,
    // later cycles keep the original schedule unless Settings says to count from the moved date.
    const phPick = isReview && k > 0 && !tcuEdit && choices[k] != null && !clinicOK(planned - offset)
      ? choices[k] : undefined;
    const tcuMove = tcuEdit || phPick;
    if (d1Edit || tcuMove) {
      planned = d1Edit ? toDay(d1Edit) : toDay(tcuMove) + offset;
      if (d1Edit || tcuEdit) {
        anchor = planned;
        anchorK = k;
      }
    }

    const treatments = [];
    const prevTreat = lastTreat; // last treatment of the previous cycle
    // An edited D8 pushes the later days of its cycle (D15) by the same amount
    let push = 0;
    for (const block of blocks) {
      const editKey = `chemo:${k}:${block[0]}`;
      // The entered treatment date is changed in the Visit card, not on its row
      const entered = k === 0 && block === blocks[0];
      const inp = isInpatient(k, block[0]);
      // After a PH TCU move only D1 follows it; D8/D15 keep their planned days (Jonan, 11 Oct 2026)
      let p = (phPick && block !== blocks[0] ? scheduled : planned) + block[0] - 1 + push;
      const gap = prevStart === null ? null : block === blocks[0] ? cd + block[0] - prevStartDay : block[0] - prevStartDay;
      const floor = gap === null ? -Infinity : prevStart + Math.min(minGap, gap);
      const earliest = block === blocks[0] && isReview ? planned - offset + 1 : -Infinity;
      const minDate = lastTreat === null ? null : lastTreat + 1;
      let first;
      if (!entered && edits[editKey]) {
        const was = p;
        p = toDay(edits[editKey]);
        if (block !== blocks[0]) push += p - was;
        first = { date: p, flags: [...closure(p, 'chemo', inp), { t: 'edited' }] };
      } else first = adjustChemo(p, block.length, floor, earliest, inp);
      const shift = first.date - p;
      block.forEach((day, i) => {
        const date = p + day - block[0] + shift;
        const flags = i === 0 ? [...first.flags] : closure(date, 'chemo', inp);
        const t = { kind: 'chemo', date, day, cycle, k, block: block[0], blockLen: block.length, blockStart: i === 0, flags, inpatient: inp };
        if (i === 0) t.inpKey = `${k}:${block[0]}`;
        if (i === 0 && !entered) Object.assign(t, { editKey, minDate });
        treatments.push(t);
        lastTreat = date;
      });
      prevStart = first.date;
      prevStartDay = block[0];
    }
    const d1 = treatments[0].date;
    // Labels count the actual day of the cycle from D1, so a D8 kept on its old day after D1 moved reads D7
    for (const t of treatments) t.shown = t.date - d1 + 1;
    if (prevD1 !== null && d1 - prevD1 < cd) treatments[0].flags.push({ t: 'short', days: d1 - prevD1 });
    prevD1 = d1;

    let review = null;
    if (isReview) {
      const base = { kind: 'review', cycle, k, labs: false };
      if (k === 0) review = scheduleReview(review0, 0, base, { maxDate: treatments[0].date, earliest: chemo0 - MAX_TCU_GAP });
      else if (tcuEdit) {
        const t = toDay(tcuEdit);
        review = { ...base, date: t, flags: [...closure(t, 'clinic', false), { t: 'edited' }] };
      }
      // Anchor on the planned D1, so a chemo moved off a PH doesn't drag its review with it
      else if (phPick) {
        const from = scheduled - offset;
        review = { ...base, date: toDay(phPick), flags: [why(from, 'clinic'), { t: 'moved', from }] };
      // An edited D1 moves only what comes after it, so its TCU stays where it was planned
      } else review = scheduleReview((d1Edit ? scheduled : planned) - offset, k, base, { prevTreat });
      // A D1 can't be moved before its own TCU
      const t0 = treatments[0];
      if (t0.editKey && !review.pending) t0.minDate = Math.max(t0.minDate ?? -Infinity, review.date);
      if (k > 0 && !review.pending) {
        review.editKey = `tcu:${k}`;
        // Its D1 (TCU + the usual gap) must stay after the previous cycle
        review.minDate = prevTreat + 1 - offset;
      }
      current = optsFor(k);
      review.tech = current.tech;
      review.tele = current.tele && !current.tech;
      review.scan = current.scan;
      review.opts = current;
      // A physical TCU's scan is undated ("prior"), so it can be booked flexibly.
      // A technical visit's scan is on the visit day itself.
      review.scanPrior = current.scan && !current.tech;
      events.push(review);
    }

    if (current.labs) {
      for (const t of treatments) {
        if (S.blockLabs === 'first' && !t.blockStart) continue;
        if (tcuLabsOnly && (!review || t.day !== treatments[0].day)) continue;
        if (t.day === treatments[0].day && review?.scanPrior && S.scanLabs === 'scan') {
          review.labsAtScan = true;
          continue;
        }
        // Labs at the TCU serve its D1 only while fresh; a D1 further out gets its own labs,
        // unless labs are at TCU only
        if (t.day === treatments[0].day && review && (S.preCycleLabs === 'review' || review.tech || tcuLabsOnly)
            && (tcuLabsOnly || t.date - review.date <= (S.tcuLabsDays ?? 7))
            && (review.pending || (labOK(review.date) && review.date <= t.date))) {
          review.labs = true;
          continue;
        }
        const L = computeLabs(t.date, t.inpatient);
        // Each standalone labs row can be switched off or given its own tests
        const labKey = `${k}:${t.day}`;
        const lo = input.labOpts?.[labKey] || {};
        // Labs before a later treatment day (D8, D15) are mid-cycle labs
        const mid = t.day !== treatments[0].day;
        // A TCU cycle's own D1 labs, moved off the TCU day, keep the TCU tests; every other labs
        // row is a pre-dose check with the pre-dose tests
        const tcuSet = !mid && !!review;
        // A mid-cycle labs check can be turned into a clinic visit on the same day
        const tcu = mid && !!lo.tcu;
        const flags = tcu ? [...L.flags, ...closure(L.date, 'clinic', false)] : L.flags;
        events.push({ kind: 'labs', date: L.date, flags, cycle, k, day: t.day, shown: t.shown, labKey, mid, tcuSet, tcu, off: !!lo.off, tests: lo.tests, inpatient: !!t.inpatient });
      }
    }
    events.push(...treatments);
  }

  const order = { review: 0, labs: 1, chemo: 2 };
  for (const e of events) if (e.date > covered) e.flags.push({ t: 'nodata' });
  events.sort((a, b) => a.date - b.date || order[a.kind] - order[b.kind]);
  return { error: null, events, multiDay, inpatient: inpatientSummary(blocks, lastK, isInpatient) };
}

// Inpatient is said once. When every cycle has the same inpatient blocks, the note goes in the
// header ('inpatient', or 'D1-5 inpatient' when only some blocks are) and no line is tagged;
// otherwise the first day of each inpatient block is tagged.
function inpatientSummary(blocks, lastK, isInpatient) {
  const name = (b) => (b.length > 1 ? `D${b[0]}-${b[b.length - 1]}` : `D${b[0]}`);
  const of = (k) => blocks.filter((b) => isInpatient(k, b[0]));
  const first = of(0);
  for (let k = 1; k <= lastK; k++) {
    if (of(k).map(name).join() !== first.map(name).join()) return { note: null, perLine: true };
  }
  if (!first.length) return { note: null, perLine: false };
  return { note: first.length === blocks.length ? 'inpatient' : `${first.map(name).join(', ')} inpatient`, perLine: false };
}

// The default tests for a line: TCU labs use the TCU set; labs before the other doses use the
// pre-dose set when one is given, else the TCU set (Jonan, 16 Oct 2026)
export function baseTests(e, labTests = '', doseLabTests = '') {
  return (e.kind === 'labs' && !e.tcuSet && doseLabTests.trim()) || labTests.trim();
}

// A row's own tests, set on the schedule, win over the default set
export function rowTests(e) {
  return ((e.kind === 'labs' ? e.tests : e.kind === 'review' ? e.opts?.tests : '') || '').trim();
}

// The labs as a line names them: the tests themselves ('FBC RP LFT'), or 'labs' only when none
// are set ('Labs' where it opens a ward line).
export function labsPhrase(e, input) {
  const own = rowTests(e) || baseTests(e, input.labTests, input.midLabTests);
  return own || (e.kind === 'labs' && e.inpatient && !e.tcu ? 'Labs' : 'labs');
}

// The row text for an event, e.g. 'TCU with FBC and scan prior', 'Technical visit for FBC pre-D8', 'C4 D1'

// Cycle and day as Settings write them: 'C3 D8', '#3 D8', 'C3.2', '#3.2'. The dot form gives the
// day's place in the cycle (D15 of D1/8/15 is .3); regimens with consecutive-day blocks keep the day.
function cycleDay(e, input, S) {
  const c = e.cycle ? `${S.cycleLabel === '#' ? '#' : 'C'}${e.cycle}` : '';
  const R = input.regimen;
  const dot = S.dayLabel === 'dot' && c && groupConsecutive(R.days).every((b) => b.length === 1);
  if (dot) return { cycle: c, day: `${c}.${R.days.indexOf(e.day) + 1}`, tag: `.${R.days.indexOf(e.day) + 1}` };
  const d = `D${e.shown ?? e.day}`;
  return { cycle: c, day: d, tag: ` ${d}` };
}

export function label(e, result, input, S = {}) {
  const cd = cycleDay(e, input, S);
  const dayTag = result.multiDay ? cd.tag : '';
  const labs = labsPhrase(e, input);
  switch (e.kind) {
    case 'review': {
      if (e.tech) {
        const what = [e.labs && labs, e.scan && 'scan'].filter(Boolean).join(' and ');
        return `Technical visit${what ? ` for ${what}` : ''}`;
      }
      if (e.tele) {
        if (!e.scanPrior) return `TCU (teleconsult)${e.labs ? ` with ${labs}` : ''}`;
        if (e.labsAtScan) return `TCU (teleconsult) with scan and ${labs} prior`;
        return `TCU (teleconsult) with ${e.labs ? `${labs} and ` : ''}scan prior`;
      }
      if (!e.scanPrior) return `TCU${e.labs ? ` with ${labs} on arrival` : ''}`;
      if (e.labsAtScan) return `TCU with ${labs} and scan prior`;
      return e.labs ? `TCU with ${labs} on arrival and scan prior` : 'TCU with scan prior';
    }
    case 'labs': {
      const pre = result.multiDay ? ` pre-${cd.day}` : '';
      if (e.tcu) return `TCU${pre}${e.off ? '' : ` with ${labs} on arrival`}`;
      // A visit for labs alone is a technical visit; on the ward they are just labs
      return e.inpatient ? `${labs}${pre}` : `Technical visit for ${labs}${pre}`;
    }
    default: return `${cd.cycle || 'Chemo'}${dayTag}`;
  }
}

// A flag as text: the copy's bracketed form, or the short capitalised chip on a schedule row
const CHIP = { closed: 'Closed', clinic: 'No clinic', chemo: 'Unit closed', labs: 'No labs', nodata: 'No PH data', edited: 'Edited ×' };
export function flagText(f, fmt, chip = false) {
  switch (f.t) {
    case 'ph': return 'PH';
    case 'closed': return chip ? CHIP.closed : 'closed';
    case 'off': return chip ? CHIP[f.ctx] || CHIP.closed : { clinic: 'no clinic', chemo: 'unit closed', labs: 'no labs' }[f.ctx] || 'closed';
    case 'moved': return `${chip ? 'from' : 'moved from'} ${formatDay(f.from, fmt)}`;
    case 'short': return `${f.days}d${chip ? '' : ' interval'}`;
    case 'nodata': return chip ? CHIP.nodata : 'PH data unavailable';
    case 'edited': return chip ? CHIP.edited : '';
    default: return '';
  }
}

// EMR lines for the copy. A blank line before each TCU
// groups it with the chemo that follows.
function emrLines(result, input, S) {
  const R = input.regimen;
  // Inpatient is said once: in the header when every cycle is, otherwise on the first day of each admission
  const inp = result.inpatient || {};
  // Treatment days only when there is more than D1: D1/8/15, D1-5/8/15
  const days = R.days.length > 1 || R.days[0] !== 1
    ? `D${groupConsecutive(R.days).map((b) => (b.length > 1 ? `${b[0]}-${b[b.length - 1]}` : b[0])).join('/')} `
    : '';
  const head = `${R.name ? `${R.name} ` : ''}${days}q${R.cycleDays}d${inp.note ? ` (${inp.note})` : ''}`;
  const lines = result.events.filter((e) => !e.off || e.tcu).map((e) => {
    const flags = e.flags.map((f) => flagText(f, S.dateFormat)).filter(Boolean);
    if (e.pending) flags.push('reschedule');
    const visit = e.kind === 'review' || !!e.tcu;
    return {
      kind: visit ? 'review' : e.kind, gap: visit, date: formatDay(e.date, S.dateFormat),
      // □ a TCU, ■ chemo, ・ investigations alone (labs, or a technical visit)
      mark: e.kind === 'chemo' ? '■' : visit && !e.tech ? '□' : '・',
      text: label(e, result, input, S) + (inp.perLine && e.inpatient && e.blockStart ? ' (inpatient)' : ''),
      flags,
    };
  });
  return { head, lines };
}

// The copy marks each line as the schedule does, the header in 【】, flags after ※
export function toText(result, input, S) {
  const { head, lines } = emrLines(result, input, S);
  const out = lines.flatMap((l) => {
    const line = `${l.mark} ${l.date} ${l.text}${l.flags.length ? ` ※${l.flags.join(', ')}` : ''}`;
    return l.gap ? ['', line] : [line];
  });
  return [`【${head}】`, ...out].join('\n');
}
