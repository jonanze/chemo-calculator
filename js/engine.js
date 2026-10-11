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
export function parseDays(text) {
  const src = String(text ?? '').trim() || '1';
  const days = new Set();
  for (const part of src.split(/[,/;\s]+/).filter(Boolean)) {
    const m = part.match(/^d?(\d+)(?:[-–]d?(\d+))?$/i);
    if (!m) return null;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b - a > 60) return null;
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

// edits: manual dates keyed 'tcu:<k>' or 'chemo:<k>:<day>'. An edited TCU or D1 re-anchors
// that cycle and every cycle after it; an edited later day (e.g. D8) moves only that block.
export function plan(input, settings, holidays, choices = {}, edits = {}) {
  const S = settings;
  const R = input.regimen;
  if (!R || !input.review || !input.chemo) return { error: 'incomplete', events: [] };

  const review0 = toDay(input.review);
  const chemo0 = toDay(input.chemo);
  const offset = chemo0 - review0;
  if (offset < 0) return { error: 'Treatment date is before clinic date', events: [] };

  const ph = new Map(Object.entries(holidays.dates).map(([d, name]) => [toDay(d), name]));
  const closed = new Set((S.closedDates || []).map(toDay));
  const covered = toDay(holidays.coveredThrough);
  const shut = (n) => ph.has(n) || closed.has(n);
  const open = (days) => (n) => days.includes(weekday(n)) && !shut(n);
  const clinicOK = open(S.clinicDays);
  const labOK = open(S.labDays);
  const chemoOK = open(S.chemoDays);
  const why = (n, ctx) => (ph.has(n) ? { t: 'ph', name: ph.get(n) } : closed.has(n) ? { t: 'closed' } : { t: 'off', ctx });

  const step = (from, dir, okFn, limit = 60) => {
    for (let n = from + dir, i = 0; i < limit; n += dir, i++) if (okFn(n)) return n;
    return null;
  };

  // A consecutive block (D1-3, D1-5) moves as a whole to the first start where
  // every one of its days is open, so it stays consecutive (Jonan, 11 Oct 2026).
  // floor: earliest start that keeps the shortest interval after the previous block.
  // earliest: a 'back' move never reaches the cycle's TCU.
  const adjustChemo = (p, len = 1, floor = -Infinity, earliest = -Infinity) => {
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
      const f = blockOK(start) ? start : step(start, 1, blockOK);
      if (f !== null) return { date: f, flags };
    }
    return { date: p, flags: chemoOK(p) ? [] : [why(p, 'chemo')] };
  };

  const computeLabs = (T) => {
    let c = T - S.labsBefore;
    while (!S.labDays.includes(weekday(c)) && c > T - 14) c--; // weekend: back to Friday
    if (!shut(c)) return { date: c, flags: [] };
    const f = step(c, 1, labOK);
    if (f !== null && f < T) return { date: f, flags: [why(c, 'labs'), { t: 'moved', from: c }] };
    const b = step(c, -1, labOK);
    return { date: b, flags: [why(c, 'labs'), { t: 'moved', from: c }] };
  };

  // A TCU on a closed clinic day waits for the user to pick the day before or after.
  // The picked day carries its chemo with it at the usual gap (like a TCU edit), so
  // an option is offered only if that chemo still lands after the previous treatment.
  const scheduleReview = (p, prevTreat, key, base) => {
    if (clinicOK(p)) return { ...base, date: p, flags: [] };
    const options = [step(p, -1, clinicOK, 14), step(p, 1, clinicOK, 14)]
      .filter((n) => n !== null && (prevTreat === null || n + offset > prevTreat));
    const chosen = choices[key] != null ? toDay(choices[key]) : null;
    if (chosen !== null) return { ...base, date: chosen, flags: [why(p, 'clinic'), { t: 'moved', from: p }] };
    const minDate = prevTreat === null ? null : prevTreat + 1 - offset;
    return { ...base, date: p, flags: [why(p, 'clinic')], pending: true, options, key, minDate };
  };

  const every = Math.max(1, Math.floor(input.every) || 1);
  const cd = R.cycleDays;
  const multiDay = R.days.length > 1;
  const lastK = every * S.visits;

  const blocks = groupConsecutive(R.days);
  const events = [];
  let prevD1 = null;
  // Shortest interval between treatment starts (a designed gap shorter than this is kept)
  const minGap = Math.max(1, Math.floor(S.minGap) || 1);
  let prevStart = null, prevStartDay = null, lastTreat = null;
  let anchor = chemo0, anchorK = 0;
  // Per-visit options. A visit's labs setting also covers the treatment days it
  // authorises, up to the next visit. A technical visit is the investigations
  // themselves (labs and/or scan on that day) with no appointment, so it has
  // no separate scan date.
  const optsFor = (k) => ({ labs: true, tech: false, tele: false, scan: false, ...(input.tcuOpts?.[k] || {}) });
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
    const cycleStart = lastTreat;
    for (const block of blocks) {
      const editKey = `chemo:${k}:${block[0]}`;
      const isKeyed = k === 0 && block[0] === blocks[0][0];
      let p = planned + block[0] - 1;
      const gap = prevStart === null ? null : block === blocks[0] ? cd + block[0] - prevStartDay : block[0] - prevStartDay;
      const floor = gap === null ? -Infinity : prevStart + Math.min(minGap, gap);
      const earliest = block === blocks[0] && isReview ? planned - offset + 1 : -Infinity;
      const minDate = lastTreat === null ? null : lastTreat + 1;
      let first;
      if (isKeyed) first = { date: p, flags: chemoOK(p) ? [] : [why(p, 'chemo')] };
      else if (edits[editKey]) {
        p = toDay(edits[editKey]);
        first = { date: p, flags: [...(chemoOK(p) ? [] : [why(p, 'chemo')]), { t: 'edited' }] };
      } else first = adjustChemo(p, block.length, floor, earliest);
      const shift = first.date - p;
      block.forEach((day, i) => {
        const date = p + day - block[0] + shift;
        const flags = i === 0 ? [...first.flags] : chemoOK(date) ? [] : [why(date, 'chemo')];
        const t = { kind: 'chemo', date, day, cycle, k, blockStart: i === 0, flags };
        if (i === 0 && !isKeyed) Object.assign(t, { editKey, minDate });
        treatments.push(t);
        lastTreat = date;
      });
      prevStart = first.date;
      prevStartDay = block[0];
    }
    const d1 = treatments[0].date;
    if (prevD1 !== null && d1 - prevD1 < cd) treatments[0].flags.push({ t: 'short', days: d1 - prevD1 });
    prevD1 = d1;

    let review = null;
    if (isReview) {
      const base = { kind: 'review', cycle, k, labs: false };
      if (k === 0) review = { ...base, date: review0, flags: clinicOK(review0) ? [] : [why(review0, 'clinic')] };
      else if (tcuEdit) {
        const t = toDay(tcuEdit);
        review = { ...base, date: t, flags: [...(clinicOK(t) ? [] : [why(t, 'clinic')]), { t: 'edited' }] };
      }
      // Anchor on the planned D1, so a chemo moved off a PH doesn't drag its review with it
      else if (phPick) {
        const from = scheduled - offset;
        review = { ...base, date: toDay(phPick), flags: [why(from, 'clinic'), { t: 'moved', from }] };
      } else review = scheduleReview(planned - offset, cycleStart, k, base);
      if (k > 0 && !review.pending) {
        review.editKey = `tcu:${k}`;
        // Its D1 (TCU + the usual gap) must stay after the previous cycle
        review.minDate = cycleStart + 1 - offset;
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
        if (t.day === treatments[0].day && review?.scanPrior && S.scanLabs === 'scan') {
          review.labsAtScan = true;
          continue;
        }
        if (t.day === treatments[0].day && review && (S.preCycleLabs === 'review' || review.tech)
            && (review.pending || (labOK(review.date) && review.date <= t.date))) {
          review.labs = true;
          continue;
        }
        const L = computeLabs(t.date);
        // Each standalone labs row can be switched off or given its own tests
        const labKey = `${k}:${t.day}`;
        const lo = input.labOpts?.[labKey] || {};
        events.push({ kind: 'labs', date: L.date, flags: L.flags, cycle, k, day: t.day, labKey, off: !!lo.off, tests: lo.tests });
      }
    }
    events.push(...treatments);
  }

  const order = { review: 0, labs: 1, chemo: 2 };
  for (const e of events) if (e.date > covered) e.flags.push({ t: 'nodata' });
  events.sort((a, b) => a.date - b.date || order[a.kind] - order[b.kind]);
  return { error: null, events, multiDay };
}

export function label(e, multiDay, labTests = '') {
  const dayTag = multiDay ? ` D${e.day}` : '';
  const own = e.kind === 'labs' && e.tests?.trim();
  const tests = own ? ` (${own})` : labTests.trim() ? ` (${labTests.trim()})` : '';
  switch (e.kind) {
    case 'review': {
      const labs = `labs${tests}`;
      if (e.tech) {
        const what = [e.labs && labs, e.scan && 'scan'].filter(Boolean).join(' and ');
        return `Technical visit${what ? ` for ${what}` : ''}`;
      }
      const tcu = e.tele ? 'TCU (teleconsult)' : 'TCU';
      if (!e.scanPrior) return `${tcu}${e.labs ? ` with ${labs}` : ''}`;
      if (e.labsAtScan) return `${tcu} with scan and ${labs} prior`;
      return `${tcu} with ${e.labs ? `${labs} and ` : ''}scan prior`;
    }
    case 'labs': return `Labs${tests}${multiDay ? ` pre-D${e.day}` : ''}`;
    default: return `${e.cycle ? `C${e.cycle}` : 'Chemo'}${dayTag}`;
  }
}

export function flagText(f, fmt) {
  switch (f.t) {
    case 'ph': return 'PH';
    case 'closed': return 'closed';
    case 'off': return { clinic: 'no clinic', chemo: 'unit closed', labs: 'no labs' }[f.ctx] || 'closed';
    case 'moved': return `moved from ${formatDay(f.from, fmt)}`;
    case 'short': return `${f.days}d interval`;
    case 'nodata': return 'PH data unavailable';
    default: return '';
  }
}

export function toText(result, input, S) {
  const R = input.regimen;
  const every = Math.max(1, Math.floor(input.every) || 1);
  const head = `${R.name ? `${R.name} ` : ''}q${R.cycleDays}d${every > 1 ? `, TCU every ${every} cycles` : ''}`;
  // A blank line before each TCU groups it with the chemo that follows
  const lines = result.events.filter((e) => !e.off).flatMap((e) => {
    const flags = e.flags.map((f) => flagText(f, S.dateFormat)).filter(Boolean);
    if (e.pending) flags.push('reschedule');
    const date = formatDay(e.date, S.dateFormat);
    const line = `- ${date} ${label(e, result.multiDay, input.labTests)}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
    return e.kind === 'review' ? ['', line] : [line];
  });
  return [head, ...lines].join('\n');
}
