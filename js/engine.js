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
  if (offset < 0) return { error: 'Chemo date is before TCU date', events: [] };

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

  const adjustChemo = (p) => {
    if (chemoOK(p)) return { date: p, flags: [] };
    if (S.chemoPH === 'forward') {
      const f = step(p, 1, chemoOK);
      if (f !== null) return { date: f, flags: [why(p, 'chemo'), { t: 'moved', from: p }] };
    }
    return { date: p, flags: [why(p, 'chemo')] };
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

  const scheduleReview = (p, d1, key, base) => {
    if (clinicOK(p)) return { ...base, date: p, flags: [] };
    const options = [step(p, -1, clinicOK, 14), step(p, 1, clinicOK, 14)]
      .filter((n) => n !== null && (d1 === null || n <= d1));
    const chosen = choices[key] != null ? toDay(choices[key]) : null;
    if (chosen !== null) return { ...base, date: chosen, flags: [why(p, 'clinic'), { t: 'moved', from: p }] };
    return { ...base, date: p, flags: [why(p, 'clinic')], pending: true, options, key };
  };

  const every = Math.max(1, Math.floor(input.every) || 1);
  const cd = R.cycleDays;
  const multiDay = R.days.length > 1;
  const capped = input.cycle && input.total;
  let lastK = every * S.visits;
  if (capped) lastK = Math.min(lastK, input.total - input.cycle);
  if (lastK < 0) return { error: 'Cycle exceeds total', events: [] };

  const blocks = groupConsecutive(R.days);
  const events = [];
  let prevD1 = null;
  let nextPlanned = null;
  let reviews = 0;
  let anchor = chemo0, anchorK = 0;

  for (let k = 0; k <= lastK; k++) {
    let planned = S.knockOn === 'reanchor' && k > 0 ? prevD1 + cd : anchor + (k - anchorK) * cd;
    const cycle = input.cycle ? input.cycle + k : null;
    const isReview = k % every === 0;
    const tcuEdit = isReview && k > 0 ? edits[`tcu:${k}`] : undefined;
    const d1Edit = k > 0 ? edits[`chemo:${k}:${blocks[0][0]}`] : undefined;
    if (d1Edit || tcuEdit) {
      planned = d1Edit ? toDay(d1Edit) : toDay(tcuEdit) + offset;
      anchor = planned;
      anchorK = k;
    }

    const treatments = [];
    for (const block of blocks) {
      const editKey = `chemo:${k}:${block[0]}`;
      const isKeyed = k === 0 && block[0] === blocks[0][0];
      let p = planned + block[0] - 1;
      let first;
      if (isKeyed) first = { date: p, flags: chemoOK(p) ? [] : [why(p, 'chemo')] };
      else if (edits[editKey]) {
        p = toDay(edits[editKey]);
        first = { date: p, flags: [...(chemoOK(p) ? [] : [why(p, 'chemo')]), { t: 'edited' }] };
      } else first = adjustChemo(p);
      const shift = first.date - p;
      block.forEach((day, i) => {
        const date = p + day - block[0] + shift;
        const flags = i === 0 ? [...first.flags] : chemoOK(date) ? [] : [why(date, 'chemo')];
        const t = { kind: 'chemo', date, day, cycle, k, blockStart: i === 0, flags };
        if (i === 0 && !isKeyed) t.editKey = editKey;
        treatments.push(t);
      });
    }
    const d1 = treatments[0].date;
    if (prevD1 !== null && d1 - prevD1 < cd) treatments[0].flags.push({ t: 'short', days: d1 - prevD1 });
    prevD1 = d1;
    nextPlanned = S.knockOn === 'reanchor' ? d1 + cd : planned + cd;

    let review = null;
    if (isReview) {
      const base = { kind: 'review', cycle, k, labs: false };
      if (k === 0) review = { ...base, date: review0, flags: clinicOK(review0) ? [] : [why(review0, 'clinic')] };
      else if (tcuEdit) {
        const t = toDay(tcuEdit);
        review = { ...base, date: t, flags: [...(clinicOK(t) ? [] : [why(t, 'clinic')]), { t: 'edited' }] };
        reviews++;
      }
      // Anchor on the planned D1, so a chemo moved off a PH doesn't drag its review with it
      else { review = scheduleReview(planned - offset, d1, k, base); reviews++; }
      if (k > 0 && !review.pending) review.editKey = `tcu:${k}`;
      events.push(review);
    }

    if (input.labs) {
      for (const t of treatments) {
        if (S.blockLabs === 'first' && !t.blockStart) continue;
        if (t.day === treatments[0].day && review && S.preCycleLabs === 'review'
            && (review.pending || (labOK(review.date) && review.date <= t.date))) {
          review.labs = true;
          continue;
        }
        const L = computeLabs(t.date);
        events.push({ kind: 'labs', date: L.date, flags: L.flags, cycle, k, day: t.day });
      }
    }
    events.push(...treatments);
  }

  if (capped && input.cycle + lastK === input.total && reviews < S.visits) {
    events.push(scheduleReview(nextPlanned - offset, null, 'eot', { kind: 'eot', labs: false }));
  }

  const order = { review: 0, eot: 0, labs: 1, chemo: 2 };
  for (const e of events) if (e.date > covered) e.flags.push({ t: 'nodata' });
  events.sort((a, b) => a.date - b.date || order[a.kind] - order[b.kind]);
  return { error: null, events, multiDay };
}

export function label(e, multiDay) {
  const pre = e.cycle ? ` pre-C${e.cycle}` : '';
  const dayTag = multiDay ? ` D${e.day}` : '';
  switch (e.kind) {
    case 'review': return `TCU${e.labs ? ' + labs' : ''}${pre}`;
    case 'eot': return 'End-of-treatment TCU';
    case 'labs': return `Labs${e.cycle ? ` pre-C${e.cycle}${dayTag}` : dayTag ? ` pre${dayTag}` : ''}`;
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
  const lines = result.events.map((e) => {
    const flags = e.flags.map((f) => flagText(f, S.dateFormat)).filter(Boolean);
    if (e.pending) flags.push('reschedule');
    const date = formatDay(e.date, S.dateFormat);
    return `- ${date} ${label(e, result.multiDay)}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
  });
  return [head, ...lines].join('\n');
}
