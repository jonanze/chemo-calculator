// Counselling content: what each drug's side effects are, in three tiers.
// common: frequent, expected; serious: potentially life-threatening; rare: uncommon but significant.
// Shared wording comes from T, so an effect caused by several drugs in a regimen is said once.

export const T = {
  // Blood and infection
  myelo: 'myelosuppression',
  fn: 'febrile neutropenia and sepsis',
  thrombo: 'thrombocytopenia with bleeding risk',
  anaemia: 'anaemia, sometimes needing transfusion',
  // Gut
  nv: 'nausea and vomiting',
  diarrhoea: 'diarrhoea',
  severeDiarrhoea: 'severe diarrhoea with dehydration or acute kidney injury',
  mucositis: 'mucositis',
  constipation: 'constipation',
  appetite: 'reduced appetite',
  taste: 'taste change',
  // General
  fatigue: 'fatigue',
  alopecia: 'alopecia',
  hsr: 'infusion or hypersensitivity reactions, including anaphylaxis',
  extravasation: 'tissue injury from extravasation',
  // Skin
  hfs: 'hand–foot syndrome',
  rash: 'rash and pruritus',
  egfrSkin: 'acneiform rash, dry skin and paronychia',
  nails: 'nail changes',
  scar: 'severe skin reactions, including SJS/TEN',
  // Nerves
  neuropathy: 'peripheral neuropathy, can be permanent',
  // Lung and heart
  pneumonitis: 'pneumonitis',
  cardiomyopathy: 'cardiomyopathy and heart failure',
  lvef: 'reduced LVEF',
  qt: 'QT prolongation and arrhythmia',
  vasospasm: 'coronary vasospasm, including myocardial infarction',
  vte: 'venous thromboembolism',
  ate: 'arterial thromboembolism, including myocardial infarction and stroke',
  // Kidney, liver, metabolic
  aki: 'acute kidney injury',
  liver: 'raised liver enzymes',
  hepatotox: 'severe liver injury',
  hyperglycaemia: 'hyperglycaemia',
  // Other
  pres: 'posterior reversible encephalopathy syndrome',
  secondary: 'treatment-related leukaemia or myelodysplasia',
  hus: 'haemolytic uraemic syndrome',
  onj: 'osteonecrosis of the jaw',
  bone: 'bone thinning and fracture',
  hotFlush: 'hot flushes',
  arthralgia: 'arthralgia and myalgia',
  hypertension: 'hypertension',
  bleeding: 'bleeding',
  perforation: 'bowel perforation',
  wound: 'delayed wound healing',
  proteinuria: 'proteinuria',
  oedema: 'fluid retention and oedema',
  hypothyroid: 'hypothyroidism',
  // Immunotherapy
  ioCommon: 'immune-related thyroid dysfunction',
  ioSerious: 'immune-related inflammation of any organ, including colitis, pneumonitis, hepatitis, nephritis and endocrinopathies such as type 1 diabetes',
  ioRare: 'immune-related myocarditis, myositis, myasthenia or encephalitis',
  // Bispecific T-cell engagers
  crs: 'cytokine release syndrome',
  icans: 'immune effector cell-associated neurotoxicity',
};

const CHEMO = { common: [T.myelo, T.fatigue], serious: [T.fn] };
const FP = {
  common: [T.diarrhoea, T.mucositis, T.nv, T.fatigue],
  serious: [T.severeDiarrhoea, T.fn, T.vasospasm],
  rare: ['severe or fatal toxicity with DPD deficiency'],
};
const IO = {
  common: [T.fatigue, T.rash, T.diarrhoea, T.ioCommon],
  serious: [T.ioSerious],
  rare: [T.ioRare, T.hsr],
};
const CTLA4 = { ...IO, serious: [T.ioSerious + ', more frequent with anti-CTLA-4'] };
const VEGF_AB = {
  common: [T.hypertension, T.proteinuria, 'nosebleeds'],
  serious: [T.perforation, T.bleeding, T.ate],
  rare: [T.wound, T.pres, 'fistula', T.vte],
};
const VEGF_TKI = {
  common: [T.hypertension, T.diarrhoea, T.fatigue, T.hfs, T.hypothyroid, T.mucositis, T.taste],
  serious: [T.bleeding, T.ate, T.perforation, T.hepatotox],
  rare: [T.lvef, T.qt, T.pres, T.wound, T.proteinuria],
};
const EGFR_AB = {
  common: [T.egfrSkin, 'hypomagnesaemia', T.diarrhoea, T.fatigue],
  serious: ['severe skin reactions'],
  rare: [T.pneumonitis, 'keratitis'],
};
const CDK46 = {
  common: [T.myelo, T.fatigue, T.nv],
  serious: [],
  rare: [T.pneumonitis, T.vte],
};
const AI = {
  common: [T.hotFlush, T.arthralgia, T.fatigue],
  serious: [T.bone],
  rare: ['raised cholesterol'],
};
const ADT = {
  common: [T.hotFlush, T.fatigue, 'reduced libido and erectile dysfunction', 'weight gain'],
  serious: [T.bone, 'cardiovascular events'],
  rare: ['mood change'],
};
const BRAF_MEK = {
  common: ['fever', T.fatigue, T.rash, T.nv, T.diarrhoea, T.arthralgia],
  serious: ['severe pyrexia with hypotension or dehydration', T.bleeding, T.lvef],
  rare: ['serous retinopathy or retinal vein occlusion', 'uveitis', 'new skin cancers'],
};
const SSA = {
  common: ['diarrhoea or steatorrhoea', 'abdominal pain', 'injection-site reactions', 'gallstones'],
  serious: [],
  rare: [T.hyperglycaemia, 'bradycardia', 'pancreatitis'],
};
const GCSF = { common: ['bone pain'], serious: [], rare: ['splenic rupture'] };
const NONE = { common: [], serious: [], rare: [] };

// name: as written in the note; cls: shown in the drug picker
export const DRUGS = {
  'abemaciclib': { name: 'abemaciclib', cls: 'CDK4/6 inhibitor', ...CDK46, common: [T.diarrhoea, T.myelo, T.fatigue, T.nv], serious: [T.severeDiarrhoea], rare: [T.pneumonitis, T.vte, T.hepatotox] },
  'abiraterone': { name: 'abiraterone', cls: 'Androgen synthesis inhibitor', common: [T.hypertension, 'hypokalaemia', T.oedema, T.fatigue], serious: [T.hepatotox, 'heart failure'], rare: ['adrenal insufficiency if stopped abruptly'] },
  'aflibercept': { name: 'aflibercept', cls: 'Anti-VEGF fusion protein', ...VEGF_AB, common: [...VEGF_AB.common, 'hoarse voice'] },
  'amivantamab': { name: 'amivantamab', cls: 'EGFR–MET bispecific antibody', common: [T.egfrSkin, T.hsr + ', mostly with the first dose', 'hypoalbuminaemia with oedema', T.mucositis], serious: [T.vte, 'severe skin reactions'], rare: [T.pneumonitis, 'keratitis'] },
  'atezolizumab': { name: 'atezolizumab', cls: 'Anti-PD-L1 antibody', ...IO },
  'avelumab': { name: 'avelumab', cls: 'Anti-PD-L1 antibody', ...IO },
  'axitinib': { name: 'axitinib', cls: 'VEGFR tyrosine kinase inhibitor', ...VEGF_TKI },
  'bevacizumab': { name: 'bevacizumab', cls: 'Anti-VEGF antibody', ...VEGF_AB },
  'binimetinib': { name: 'binimetinib', cls: 'MEK inhibitor', ...BRAF_MEK },
  'bleomycin': { name: 'bleomycin', cls: 'Antitumour antibiotic', common: ['fever and chills', 'skin darkening and thickening', T.mucositis], serious: ['pneumonitis and lung fibrosis'], rare: ['lifelong risk of lung injury from high-concentration oxygen', T.hsr] },
  'cabazitaxel': { name: 'cabazitaxel', cls: 'Taxane', common: [T.myelo, T.diarrhoea, T.fatigue, T.nv], serious: [T.fn, T.severeDiarrhoea], rare: [T.hsr, T.aki] },
  'cabozantinib': { name: 'cabozantinib', cls: 'Multikinase inhibitor', ...VEGF_TKI, rare: [...VEGF_TKI.rare, T.onj] },
  'calcium folinate': { name: 'leucovorin', cls: 'Folate (modulates 5-FU)', ...NONE, supportive: true },
  'calcium folinate (leucovorin)': { name: 'leucovorin', cls: 'Folate (modulates 5-FU)', ...NONE, supportive: true },
  'capecitabine': { name: 'capecitabine', cls: 'Fluoropyrimidine (oral)', fp: true, ...FP, common: [T.hfs, ...FP.common] },
  'capivasertib': { name: 'capivasertib', cls: 'AKT inhibitor', common: [T.hyperglycaemia, T.diarrhoea, T.rash, T.nv], serious: ['diabetic ketoacidosis', T.scar], rare: [] },
  'carboplatin': { name: 'carboplatin', cls: 'Platinum', common: [T.myelo, T.nv, T.fatigue], serious: [T.fn, T.thrombo, T.hsr], rare: [T.neuropathy, T.aki] },
  'cemiplimab': { name: 'cemiplimab', cls: 'Anti-PD-1 antibody', ...IO },
  'cetuximab': { name: 'cetuximab', cls: 'Anti-EGFR antibody', ...EGFR_AB, serious: [T.hsr, 'severe skin reactions'] },
  'cisplatin': { name: 'cisplatin', cls: 'Platinum', common: [T.nv, T.myelo, T.fatigue, 'tinnitus and hearing loss', 'hypomagnesaemia and hypokalaemia', T.neuropathy], serious: [T.aki, T.fn], rare: [T.vte, T.ate, T.hsr] },
  'cyclophosphamide': { name: 'cyclophosphamide', cls: 'Alkylating agent', ...CHEMO, common: [T.myelo, T.nv, T.alopecia, T.fatigue], rare: ['haemorrhagic cystitis', T.secondary] },
  'dabrafenib': { name: 'dabrafenib', cls: 'BRAF inhibitor', ...BRAF_MEK },
  'dactinomycin': { name: 'dactinomycin', cls: 'Antitumour antibiotic', ...CHEMO, common: [T.myelo, T.nv, T.mucositis, T.alopecia, T.fatigue], rare: [T.extravasation, 'sinusoidal obstruction syndrome'] },
  'darolutamide': { name: 'darolutamide', cls: 'Androgen receptor inhibitor', common: [T.fatigue], serious: [], rare: [T.rash, 'falls and fractures'] },
  'degarelix': { name: 'degarelix', cls: 'GnRH antagonist', ...ADT, common: [...ADT.common, 'injection-site reactions'] },
  'denosumab': { name: 'denosumab', cls: 'Anti-RANKL antibody', common: ['hypocalcaemia', T.arthralgia], serious: [T.onj], rare: ['atypical femoral fracture', 'rebound vertebral fractures if stopped'] },
  'docetaxel': { name: 'docetaxel', cls: 'Taxane', ...CHEMO, common: [T.myelo, T.alopecia, T.fatigue, T.oedema, T.nails, T.mucositis, T.neuropathy, T.diarrhoea], serious: [T.fn, T.hsr], rare: [T.pneumonitis, 'epiphora from lacrimal duct stenosis', 'colitis'] },
  'dostarlimab': { name: 'dostarlimab', cls: 'Anti-PD-1 antibody', ...IO },
  'doxorubicin': { name: 'doxorubicin', cls: 'Anthracycline', common: [T.myelo, T.nv, T.alopecia, T.mucositis, T.fatigue, 'red urine for 1–2 days'], serious: [T.fn, T.extravasation], rare: ['cumulative dose-related cardiomyopathy and heart failure', T.secondary] },
  'doxorubicin pegylated liposomal': { name: 'pegylated liposomal doxorubicin', cls: 'Anthracycline (liposomal)', common: [T.hfs, T.mucositis, T.myelo, T.fatigue], serious: [T.hsr, T.fn], rare: [T.cardiomyopathy] },
  'pegylated liposomal doxorubicin': { name: 'pegylated liposomal doxorubicin', cls: 'Anthracycline (liposomal)', common: [T.hfs, T.mucositis, T.myelo, T.fatigue], serious: [T.hsr, T.fn], rare: [T.cardiomyopathy] },
  'durvalumab': { name: 'durvalumab', cls: 'Anti-PD-L1 antibody', ...IO },
  'encorafenib': { name: 'encorafenib', cls: 'BRAF inhibitor', ...BRAF_MEK, common: [...BRAF_MEK.common, 'skin thickening and papillomas'] },
  'enfortumab vedotin': { name: 'enfortumab vedotin', cls: 'Anti-nectin-4 antibody–drug conjugate', common: [T.rash, T.neuropathy, T.alopecia, T.fatigue, T.taste, 'dry eyes'], serious: [T.scar, 'hyperglycaemia, including ketoacidosis'], rare: [T.pneumonitis, T.extravasation] },
  'enzalutamide': { name: 'enzalutamide', cls: 'Androgen receptor inhibitor', common: [T.fatigue, T.hotFlush, T.hypertension, 'falls and fractures'], serious: ['seizures'], rare: [T.pres] },
  'epirubicin': { name: 'epirubicin', cls: 'Anthracycline', common: [T.myelo, T.nv, T.alopecia, T.mucositis, T.fatigue, 'red urine for 1–2 days'], serious: [T.fn, T.extravasation], rare: ['cumulative dose-related cardiomyopathy and heart failure', T.secondary] },
  'eribulin mesilate': { name: 'eribulin', cls: 'Microtubule inhibitor', ...CHEMO, common: [T.myelo, T.fatigue, T.alopecia, T.neuropathy, T.nv], rare: [T.qt] },
  'etoposide': { name: 'etoposide', cls: 'Topoisomerase II inhibitor', ...CHEMO, common: [T.myelo, T.alopecia, T.nv, T.fatigue], rare: [T.hsr, T.secondary] },
  'everolimus': { name: 'everolimus', cls: 'mTOR inhibitor', common: [T.mucositis, T.rash, T.fatigue, T.diarrhoea, T.hyperglycaemia, 'raised cholesterol'], serious: ['non-infectious pneumonitis', 'infections'], rare: [T.aki] },
  'exemestane': { name: 'exemestane', cls: 'Aromatase inhibitor', ...AI },
  'filgrastim': { name: 'filgrastim', cls: 'G-CSF', ...GCSF, supportive: true },
  'fluorouracil': { name: '5-FU', cls: 'Fluoropyrimidine', fp: true, ...FP, common: [...FP.common, T.myelo, T.hfs], rare: [...FP.rare, 'hyperammonaemic encephalopathy', 'central line infection or thrombosis'] },
  'fulvestrant': { name: 'fulvestrant', cls: 'Oestrogen receptor degrader', common: ['injection-site pain', T.hotFlush, T.arthralgia], serious: [], rare: [T.liver, T.hsr] },
  'gemcitabine': { name: 'gemcitabine', cls: 'Antimetabolite', ...CHEMO, common: [T.myelo, T.fatigue, 'flu-like symptoms', T.nv, T.rash, T.liver, T.oedema], rare: [T.pneumonitis, T.hus, 'capillary leak syndrome', T.pres] },
  'goserelin': { name: 'goserelin', cls: 'GnRH agonist', ...ADT, rare: [...ADT.rare, 'tumour flare on starting'] },
  'ifosfamide': { name: 'ifosfamide', cls: 'Alkylating agent', common: [T.myelo, T.nv, T.alopecia, T.fatigue], serious: [T.fn, 'encephalopathy with confusion or drowsiness', 'haemorrhagic cystitis', 'renal tubular toxicity'], rare: [T.secondary, 'cardiotoxicity'] },
  'imatinib': { name: 'imatinib', cls: 'Tyrosine kinase inhibitor', common: ['periorbital and ankle oedema', T.nv, 'muscle cramps', T.diarrhoea, T.fatigue, T.rash], serious: ['pleural or pericardial effusion', 'gastrointestinal bleeding'], rare: [T.hepatotox, 'heart failure'] },
  'ipilimumab': { name: 'ipilimumab', cls: 'Anti-CTLA-4 antibody', ...CTLA4 },
  'irinotecan': { name: 'irinotecan', cls: 'Topoisomerase I inhibitor', common: ['early (cholinergic) and delayed diarrhoea', T.nv, T.alopecia, T.myelo, T.fatigue], serious: [T.severeDiarrhoea, T.fn], rare: [T.pneumonitis] },
  'irinotecan nanoliposomal': { name: 'liposomal irinotecan', cls: 'Topoisomerase I inhibitor (liposomal)', common: [T.diarrhoea, T.nv, T.myelo, T.fatigue, T.appetite], serious: [T.severeDiarrhoea, T.fn], rare: [T.pneumonitis, T.hsr] },
  'lanreotide': { name: 'lanreotide', cls: 'Somatostatin analogue', ...SSA },
  'lenvatinib': { name: 'lenvatinib', cls: 'Multikinase inhibitor', ...VEGF_TKI },
  'leuprorelin': { name: 'leuprorelin', cls: 'GnRH agonist', ...ADT, rare: [...ADT.rare, 'tumour flare on starting'] },
  'lomustine': { name: 'lomustine', cls: 'Alkylating agent (oral)', common: ['delayed myelosuppression, lowest at 4–6 weeks', T.nv, T.fatigue], serious: [T.fn, T.thrombo], rare: ['lung fibrosis', T.secondary] },
  'lurbinectedin': { name: 'lurbinectedin', cls: 'Alkylating agent', ...CHEMO, common: [T.myelo, T.fatigue, T.nv], rare: [T.hepatotox, T.extravasation] },
  'mesna': { name: 'mesna', cls: 'Bladder protectant', ...NONE, supportive: true },
  'methotrexate': { name: 'methotrexate', cls: 'Antifolate', common: [T.mucositis, T.myelo, T.nv, T.liver], serious: [T.aki, T.fn], rare: [T.pneumonitis] },
  'mirvetuximab soravtansine': { name: 'mirvetuximab soravtansine', cls: 'Anti-FRα antibody–drug conjugate', common: ['keratopathy with blurred vision and dry eyes', T.neuropathy, T.nv, T.fatigue, T.diarrhoea], serious: ['severe corneal damage'], rare: [T.pneumonitis] },
  'mitomycin': { name: 'mitomycin', cls: 'Antitumour antibiotic', ...CHEMO, common: ['delayed myelosuppression', T.nv, T.fatigue], rare: [T.hus, T.pneumonitis, T.extravasation] },
  'nab-paclitaxel': { name: 'nab-paclitaxel', cls: 'Taxane', ...CHEMO, common: [T.alopecia, T.neuropathy, T.myelo, T.fatigue, T.nv], rare: [T.pneumonitis] },
  'niraparib': { name: 'niraparib', cls: 'PARP inhibitor', common: [T.anaemia, 'thrombocytopenia', T.nv, T.fatigue, T.hypertension], serious: ['severe cytopenias'], rare: [T.secondary, T.pres] },
  'nivolumab': { name: 'nivolumab', cls: 'Anti-PD-1 antibody', ...IO },
  'octreotide (modified release)': { name: 'octreotide LAR', cls: 'Somatostatin analogue', ...SSA },
  'olaparib': { name: 'olaparib', cls: 'PARP inhibitor', common: [T.anaemia, T.nv, T.fatigue, T.taste], serious: ['severe cytopenias'], rare: [T.secondary, T.pneumonitis, T.vte] },
  'osimertinib': { name: 'osimertinib', cls: 'EGFR tyrosine kinase inhibitor', common: [T.diarrhoea, T.rash, 'dry skin', 'paronychia', T.mucositis], serious: [T.pneumonitis, T.qt], rare: [T.lvef, 'keratitis', T.scar] },
  'oxaliplatin': { name: 'oxaliplatin', cls: 'Platinum', common: ['cumulative peripheral neuropathy, can be permanent', 'cold-induced throat and hand dysaesthesia', T.nv, T.fatigue, T.myelo], serious: [T.fn, T.hsr], rare: [T.pneumonitis, 'immune haemolysis or thrombocytopenia', 'sinusoidal obstruction syndrome', T.pres] },
  'paclitaxel': { name: 'paclitaxel', cls: 'Taxane', ...CHEMO, common: [T.alopecia, T.neuropathy, T.myelo, T.fatigue, T.arthralgia], serious: [T.fn, T.hsr], rare: [T.pneumonitis, 'bradycardia'] },
  'palbociclib': { name: 'palbociclib', cls: 'CDK4/6 inhibitor', ...CDK46, common: [T.myelo, T.fatigue, T.mucositis, 'hair thinning'] },
  'panitumumab': { name: 'panitumumab', cls: 'Anti-EGFR antibody', ...EGFR_AB },
  'pazopanib': { name: 'pazopanib', cls: 'VEGFR tyrosine kinase inhibitor', ...VEGF_TKI, common: [...VEGF_TKI.common, 'hair depigmentation'] },
  'pegfilgrastim': { name: 'pegfilgrastim', cls: 'G-CSF', ...GCSF, supportive: true },
  'pembrolizumab': { name: 'pembrolizumab', cls: 'Anti-PD-1 antibody', ...IO },
  'pemetrexed': { name: 'pemetrexed', cls: 'Antifolate', ...CHEMO, common: [T.fatigue, T.nv, T.myelo, T.rash, T.mucositis], serious: [T.fn, T.aki], rare: [T.pneumonitis] },
  'pertuzumab': { name: 'pertuzumab', cls: 'Anti-HER2 antibody', common: [T.diarrhoea, T.rash, T.fatigue], serious: [T.lvef], rare: [T.hsr] },
  'prednisolone': { name: 'prednisolone', cls: 'Corticosteroid', common: [T.hyperglycaemia, 'insomnia and mood change', 'indigestion', 'increased appetite'], serious: ['infections'], rare: ['adrenal insufficiency if stopped abruptly'], supportive: true },
  'procarbazine': { name: 'procarbazine', cls: 'Alkylating agent (oral)', common: [T.myelo, T.nv, T.fatigue], serious: ['hypertensive crisis with tyramine-rich food, alcohol or interacting drugs'], rare: [T.neuropathy, T.secondary] },
  'ramucirumab': { name: 'ramucirumab', cls: 'Anti-VEGFR2 antibody', ...VEGF_AB },
  'relatlimab': { name: 'relatlimab', cls: 'Anti-LAG-3 antibody', ...IO },
  'ribociclib': { name: 'ribociclib', cls: 'CDK4/6 inhibitor', ...CDK46, common: [T.myelo, T.nv, T.fatigue, T.liver], serious: [T.qt, T.hepatotox], rare: [T.pneumonitis, T.scar] },
  'sacituzumab govitecan': { name: 'sacituzumab govitecan', cls: 'Anti-TROP2 antibody–drug conjugate', common: [T.myelo, T.diarrhoea, T.nv, T.alopecia, T.fatigue], serious: [T.fn, T.severeDiarrhoea], rare: [T.hsr] },
  'sorafenib': { name: 'sorafenib', cls: 'Multikinase inhibitor', ...VEGF_TKI },
  'sunitinib': { name: 'sunitinib', cls: 'VEGFR tyrosine kinase inhibitor', ...VEGF_TKI, common: [...VEGF_TKI.common, 'yellow skin discolouration and hair depigmentation'] },
  'tarlatamab': { name: 'tarlatamab', cls: 'DLL3 × CD3 bispecific T-cell engager', common: ['fever', T.taste, T.fatigue, T.appetite], serious: [T.crs, T.icans], rare: [T.fn] },
  'temozolomide': { name: 'temozolomide', cls: 'Alkylating agent (oral)', common: [T.nv, T.fatigue, T.constipation, 'thrombocytopenia'], serious: ['prolonged myelosuppression'], rare: ['Pneumocystis pneumonia, especially with radiotherapy', T.hepatotox, T.secondary] },
  'topotecan': { name: 'topotecan', cls: 'Topoisomerase I inhibitor', ...CHEMO, common: [T.myelo, T.fatigue, T.nv, T.alopecia] },
  'trabectedin': { name: 'trabectedin', cls: 'Alkylating agent', common: [T.nv, T.fatigue, T.myelo, T.liver], serious: [T.hepatotox, 'rhabdomyolysis', T.fn], rare: ['capillary leak syndrome', T.lvef, T.extravasation] },
  'trametinib': { name: 'trametinib', cls: 'MEK inhibitor', ...BRAF_MEK },
  'trastuzumab': { name: 'trastuzumab', cls: 'Anti-HER2 antibody', common: [T.hsr + ', mostly with the first dose', T.fatigue, T.diarrhoea], serious: ['reduced LVEF and heart failure'], rare: [T.pneumonitis] },
  'trastuzumab deruxtecan': { name: 'trastuzumab deruxtecan', cls: 'Anti-HER2 antibody–drug conjugate', common: [T.nv, T.fatigue, T.alopecia, T.myelo], serious: ['interstitial lung disease'], rare: [T.lvef] },
  'trastuzumab emtansine': { name: 'trastuzumab emtansine', cls: 'Anti-HER2 antibody–drug conjugate', common: [T.fatigue, 'thrombocytopenia', T.liver, T.nv, T.neuropathy], serious: [T.hepatotox, T.bleeding], rare: [T.pneumonitis, T.lvef] },
  'tremelimumab': { name: 'tremelimumab', cls: 'Anti-CTLA-4 antibody', ...CTLA4 },
  'trifluridine/tipiracil': { name: 'trifluridine/tipiracil', cls: 'Nucleoside analogue (oral)', ...CHEMO, common: [T.myelo, T.nv, T.fatigue, T.diarrhoea, T.appetite] },
  'vinblastine': { name: 'vinblastine', cls: 'Vinca alkaloid', ...CHEMO, common: [T.myelo, T.constipation, T.neuropathy, T.fatigue], rare: [T.extravasation] },
  'vincristine': { name: 'vincristine', cls: 'Vinca alkaloid', common: [T.neuropathy, T.constipation, 'jaw pain'], serious: ['paralytic ileus', T.extravasation], rare: ['hyponatraemia from SIADH'] },
  'vinorelbine': { name: 'vinorelbine', cls: 'Vinca alkaloid', ...CHEMO, common: [T.myelo, T.constipation, T.fatigue, T.neuropathy], rare: [T.extravasation, 'paralytic ileus'] },
  'zoledronic acid': { name: 'zoledronic acid', cls: 'Bisphosphonate', common: ['acute-phase reaction after the first dose', 'hypocalcaemia'], serious: [T.onj, T.aki], rare: ['atypical femoral fracture', 'uveitis or scleritis'] },
};

// Fill in any tier a drug leaves out
for (const d of Object.values(DRUGS)) for (const t of ['common', 'serious', 'rare']) d[t] ||= [];

// What each intent means, said once in the note
export const INTENT = {
  adjuvant: {
    label: 'Adjuvant',
    text: 'Curative intent. Treatment after complete resection aims to lower the risk of recurrence by treating micrometastatic disease; it reduces but does not eliminate that risk.',
    observation: 'Observation alone discussed as an alternative.',
  },
  neoadjuvant: {
    label: 'Neoadjuvant',
    text: 'Curative intent. Treatment before surgery aims to shrink the tumour, improve the chance of complete resection and treat micrometastatic disease early; the disease may progress during treatment.',
    observation: 'Upfront surgery discussed as an alternative.',
  },
  perioperative: {
    label: 'Perioperative',
    text: 'Curative intent. Treatment before and after surgery aims to improve the chance of complete resection and lower the risk of recurrence.',
    observation: 'Surgery alone discussed as an alternative.',
  },
  definitive: {
    label: 'Definitive',
    text: 'Curative intent. Chemotherapy is given with radiotherapy to enhance its effect, at the cost of more acute side effects.',
    observation: 'Radiotherapy alone discussed as an alternative.',
  },
  curative: {
    label: 'Curative',
    text: 'Curative intent; this disease can be cured with systemic treatment alone.',
    observation: 'Alternatives, including no treatment, discussed.',
  },
  palliative: {
    label: 'Palliative',
    text: 'Treatment is not expected to cure the disease. It aims to control the disease, relieve symptoms and prolong life while maintaining quality of life. Response is not guaranteed; treatment continues while it is effective and tolerated.',
    observation: 'Best supportive care alone discussed as an alternative.',
  },
};

// A regimen's setting in the list maps to an intent
// Germ cell tumours and GTN are treated with curative intent even when metastatic
export const CURATIVE_TUMOURS = ['Germ cell', 'GTN'];
export const SETTING_INTENT = { adjuvant: 'adjuvant', neoadjuvant: 'neoadjuvant', perioperative: 'perioperative', chemoradiation: 'definitive', metastatic: 'palliative', maintenance: 'palliative' };
