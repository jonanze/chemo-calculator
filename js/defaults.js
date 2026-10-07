// Weekdays: 0 = Sun … 6 = Sat
export const DEFAULT_REGIMENS = [
  { name: 'FOLFOX', cycleDays: 14, days: [1], every: 1, labs: true },
  { name: 'FOLFIRI', cycleDays: 14, days: [1], every: 1, labs: true },
  { name: 'FOLFOXIRI', cycleDays: 14, days: [1], every: 1, labs: true },
  { name: 'CAPOX', cycleDays: 21, days: [1], every: 1, labs: true },
  { name: 'Capecitabine', cycleDays: 21, days: [1], every: 1, labs: true },
  { name: 'Paclitaxel weekly', cycleDays: 28, days: [1, 8, 15], every: 1, labs: true },
  { name: 'Gem-cis', cycleDays: 21, days: [1, 8], every: 1, labs: true },
  { name: 'Carbo-etoposide', cycleDays: 21, days: [1, 2, 3], every: 1, labs: true },
  { name: 'Pembrolizumab q3w', cycleDays: 21, days: [1], every: 1, labs: true },
  { name: 'Pembrolizumab q6w', cycleDays: 42, days: [1], every: 1, labs: true },
  { name: 'T-DXd', cycleDays: 21, days: [1], every: 1, labs: true },
  { name: 'CDK4/6i', cycleDays: 28, days: [1], every: 1, labs: true },
];

export const DEFAULT_SETTINGS = {
  clinicDays: [1, 2, 3, 4, 5],
  labDays: [1, 2, 3, 4, 5],
  chemoDays: [1, 2, 3, 4, 5, 6],
  labsBefore: 1,            // days before a treatment day
  preCycleLabs: 'review',   // 'review' = same day as the review, 'offset' = labsBefore rule
  blockLabs: 'first',       // consecutive-day blocks: 'first' day only, or 'each'
  chemoPH: 'forward',       // 'forward' = move to next working day, 'flag' = flag only
  knockOn: 'original',      // 'original' = keep schedule, 'reanchor' = count from moved date
  visits: 2,
  dateFormat: 'EEE d/M/yy',
  closedDates: [],          // extra unit closures, 'YYYY-MM-DD'
};
