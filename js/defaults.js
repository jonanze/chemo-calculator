// Weekdays: 0 = Sun … 6 = Sat
export const DEFAULT_ENTRY = { name: '', cycleDays: 21, days: 'D1', every: 1, labTests: '', midLabTests: '', labsAt: 'dose', ref: null };

export const DEFAULT_SETTINGS = {
  clinicDays: [1, 2, 3, 4, 5],
  labDays: [1, 2, 3, 4, 5],
  chemoDays: [1, 2, 3, 4, 5, 6],
  labsBefore: 1,            // days before a treatment day
  scanLabs: 'tcu',          // labs for a TCU with a scan: 'tcu' day or 'scan' day
  preCycleLabs: 'review',   // 'review' = same day as the review, 'offset' = labsBefore rule
  tcuLabsDays: 7,           // TCU-day labs serve a D1 up to this many days later; beyond, D1 gets its own labs
  blockLabs: 'first',       // consecutive-day blocks: 'first' day only, or 'each'
  chemoPH: 'forward',       // 'forward' = next working day, 'back' = previous one if it fits, 'flag' = flag only
  minGap: 6,                // shortest interval between treatment starts, in days
  knockOn: 'original',      // 'original' = keep schedule, 'reanchor' = count from moved date
  visits: 2,
  dateFormat: 'EEE d/M/yy',
  cycleLabel: 'C',          // cycle prefix: 'C' (C3) or '#' (#3)
  dayLabel: 'D',            // treatment day: 'D' (C3 D8) or 'dot', its place in the cycle (C3.2)
  closedDates: [],          // extra closures: 'YYYY-MM-DD' shuts everything, 'YYYY-MM-DD@clinic|labs|chemo' one kind
};
