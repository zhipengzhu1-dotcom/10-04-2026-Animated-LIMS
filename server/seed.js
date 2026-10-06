// Demo data: replays ~5 months of life in a contract analytical lab through the real business logic
// (sample receipt, assignment, results, e-signatures, reviews, OOS investigations, CoAs, invoices),
// so every record, signature and audit-trail entry is internally consistent.
// All companies and people below are fictional.

import { all, get, run } from './db.js';
import { insert, update } from './repo.js';
import { setSettings, resetSettingsCache } from './settings.js';
import { hashPassword } from './auth.js';
import { setClock, localDate, today, initialsOf } from './util.js';
import { receiveSamples } from './routes/lab.js';
import { assignTests, startTest, saveResults, submitTest, reviewTest, approveTest, issueReport } from './workflow.js';
import { createMethod, setMethodStatus, newMethodVersion, createInstrument, logInstrument, createInventory } from './routes/resources.js';
import { createClient, createProject, setProjectStatus, createInvoice, setInvoiceStatus } from './routes/business.js';
import { createPortalAccount, submitSamples, submitRequest, acknowledgeSubmission, receiveSubmission, respondToRequest, createThread, postMessage } from './routes/portal.js';
import { createDocument, addVersion } from './routes/documents.js';
import { makeXlsx, makeDocx } from './ooxml.js';
import {
  createEntry, signEntry, witnessEntry, createInvestigation, updateInvestigation, closeInvestigation,
} from './routes/quality.js';

export const DEMO_PASSWORD = 'demo1234';

// ----- deterministic randomness -----
let seed = 20261001;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + (b - a) * rand();
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const USERS = [
  ['admin', 'Alex Morgan', 'admin', 'IT & Systems Administrator'],
  ['priya.raman', 'Priya Raman', 'manager', 'Laboratory Manager'],
  ['daniel.okafor', 'Daniel Okafor', 'qa', 'Head of Quality Assurance'],
  ['helena.weiss', 'Helena Weiss', 'qa', 'QA Specialist'],
  ['marco.bianchi', 'Marco Bianchi', 'scientist', 'Principal Scientist, Method Development'],
  ['sarah.lindqvist', 'Sarah Lindqvist', 'scientist', 'Senior Scientist, Chromatography'],
  ['kenji.watanabe', 'Kenji Watanabe', 'scientist', 'Senior Scientist, Mass Spectrometry'],
  ['amara.nwosu', 'Amara Nwosu', 'scientist', 'Senior Scientist, Elemental Analysis'],
  ['tom.fletcher', 'Tom Fletcher', 'analyst', 'Analyst II'],
  ['lucia.fernandez', 'Lucía Fernández', 'analyst', 'Analyst II'],
  ['wei.zhang', 'Wei Zhang', 'analyst', 'Analyst II'],
  ['fatima.alsayed', 'Fatima Al-Sayed', 'analyst', 'Analyst I'],
  ['jonas.becker', 'Jonas Becker', 'analyst', 'Analyst I'],
  ['chloe.martin', 'Chloé Martin', 'analyst', 'Analyst II'],
  ['ravi.patel', 'Ravi Patel', 'analyst', 'Analyst II'],
  ['emily.novak', 'Emily Novak', 'analyst', 'Analyst I'],
  ['samuel.mensah', 'Samuel Mensah', 'analyst', 'Stability Coordinator'],
  ['ingrid.larsen', 'Ingrid Larsen', 'analyst', 'Analyst I'],
  ['nadia.rossi', 'Nadia Rossi', 'analyst', 'Sample Reception Coordinator'],
  ['ben.carter', 'Ben Carter', 'analyst', 'Trainee Analyst'],
  ['grace.holloway', 'Grace Holloway', 'business', 'Business Development Manager'],
  ['oliver.grant', 'Oliver Grant', 'business', 'Finance & Invoicing'],
];

const CLIENTS = [
  { code: 'ACME', name: 'Acme Pharmaceuticals Inc.', contact_name: 'Dr. Laura Chen', contact_email: 'qc.release@acme-pharma.example', phone: '+1 555 0142', address: '1200 Industrial Parkway\nSpringfield, IL 62701\nUSA', payment_terms_days: 30 },
  { code: 'BLST', name: 'Bluestone Biologics', contact_name: 'Dr. Felix Romero', contact_email: 'analytics@bluestone-bio.example', phone: '+1 555 0177', address: '88 Harbor Science Center\nBoston, MA 02210\nUSA', payment_terms_days: 45 },
  { code: 'NWT', name: 'Northwind Therapeutics', contact_name: 'Hannah Schultz', contact_email: 'cmc@northwind-tx.example', phone: '+1 555 0108', address: '400 Lakeside Drive\nMadison, WI 53703\nUSA', payment_terms_days: 30 },
  { code: 'CNTS', name: 'Contoso Pharma', contact_name: 'Rahul Mehta', contact_email: 'stability@contoso-pharma.example', phone: '+1 555 0163', address: '75 Innovation Way\nRaleigh, NC 27601\nUSA', payment_terms_days: 60 },
  { code: 'GLBX', name: 'Globex Health', contact_name: 'Sofia Andersson', contact_email: 'supplier.quality@globex-health.example', phone: '+1 555 0121', address: '9 Commerce Plaza\nColumbus, OH 43215\nUSA', payment_terms_days: 30 },
];

// gen(sample) returns a plausible result value; used only by the demo generator.
const METHODS = [
  {
    code: 'ATM-0001', title: 'Assay and Related Substances of Metformin HCl Tablets by HPLC-UV', technique: 'HPLC-UV', owner: 'sarah.lindqvist',
    reference: 'USP Metformin Hydrochloride Tablets (modified) · SOP QC-HPLC-014', price: 650, tat_days: 5,
    scope: 'Quantitative assay and related substances in metformin HCl immediate-release tablets, 500–1000 mg.',
    procedure: '**Column:** XBridge C18, 4.6 × 150 mm, 3.5 µm, 30 °C\n**Mobile phase:** phosphate buffer pH 3.85 / acetonitrile (gradient)\n**Detection:** UV 218 nm · **Injection:** 10 µL\n\n**System suitability:** RSD of 5 standard injections ≤ 1.0 %; tailing ≤ 2.0; resolution metformin / impurity A ≥ 2.0\n\n1. Prepare standard at 0.5 mg/mL in diluent.\n2. Weigh and powder 20 tablets; prepare sample at nominal 0.5 mg/mL.\n3. Inject blank, SST, standards, samples, bracketing standard every 6 injections.',
    analytes: [
      { name: 'Assay', unit: '% label claim', spec_min: 95.0, spec_max: 105.0, decimals: 1, gen: () => between(98.2, 101.8) },
      { name: 'Impurity A (cyanoguanidine)', unit: '%', spec_max: 0.10, decimals: 2, gen: () => between(0.01, 0.05) },
      { name: 'Largest unspecified impurity', unit: '%', spec_max: 0.10, decimals: 2, gen: () => between(0.02, 0.07) },
      { name: 'Total impurities', unit: '%', spec_max: 0.50, decimals: 2, gen: () => between(0.08, 0.22) },
    ],
    history: [-260, -75], // v1 effective 260 days before the demo start, v2 effective 75 days before
  },
  {
    code: 'ATM-0002', title: 'Water Content by Volumetric Karl Fischer Titration', technique: 'Karl Fischer', owner: 'sarah.lindqvist',
    reference: 'USP <921> Method Ia · SOP QC-KF-003', price: 150, tat_days: 2,
    scope: 'Water determination in drug substances, drug products and excipients (0.05–10 % w/w).',
    procedure: 'Standardise titrant daily with sodium tartrate dihydrate (n=3, RSD ≤ 1.0 %).\nAccurately weigh sample equivalent to 10–30 mg water; titrate to electrometric end-point. Report mean of duplicate determinations.',
    analytes: [{ name: 'Water content', unit: '% w/w', spec_max: 0.50, decimals: 2, gen: () => between(0.12, 0.36) }],
  },
  {
    code: 'ATM-0003', title: 'Residual Solvents by Headspace GC-FID', technique: 'GC-Headspace', owner: 'amara.nwosu',
    reference: 'USP <467> / ICH Q3C(R9) · SOP QC-GC-007', price: 480, tat_days: 5,
    scope: 'Class 2 and 3 residual solvents in drug substances.',
    procedure: '**Column:** DB-624, 30 m × 0.32 mm, 1.8 µm\n**Oven:** 40 °C (20 min) → 10 °C/min → 240 °C\n**Headspace:** 80 °C, 60 min equilibration\n\nSample: 100 mg in 5 mL DMSO. Quantify against external standard.',
    analytes: [
      { name: 'Methanol', unit: 'ppm', spec_max: 3000, decimals: 0, gen: () => between(40, 600) },
      { name: 'Ethanol', unit: 'ppm', spec_max: 5000, decimals: 0, gen: () => between(100, 900) },
      { name: 'Acetone', unit: 'ppm', spec_max: 5000, decimals: 0, gen: () => between(10, 200) },
      { name: 'Dichloromethane', unit: 'ppm', spec_max: 600, decimals: 0, gen: () => between(0, 18) },
    ],
  },
  {
    code: 'ATM-0004', title: 'Dissolution of Immediate-Release Tablets and Capsules (USP Apparatus 2)', technique: 'Dissolution', owner: 'sarah.lindqvist',
    reference: 'USP <711> · SOP QC-DIS-002', price: 720, tat_days: 4,
    scope: 'Single time-point dissolution of IR oral solid dosage forms, n = 6.',
    procedure: '900 mL phosphate buffer pH 6.8, 37.0 ± 0.5 °C, paddles 50 rpm (sinkers for capsules).\nSample at 30 min, filter (0.45 µm, discard first 5 mL), quantify by UV or HPLC against standard.\n**Verify paddle height (25 ± 2 mm) and vessel centring before every run.**',
    analytes: [
      { name: 'Mean dissolved at 30 min (n=6)', unit: '%', spec_min: 80, decimals: 0, gen: () => between(86, 97) },
      { name: 'Lowest individual unit', unit: '%', decimals: 0, gen: () => between(81, 88) },
    ],
  },
  {
    code: 'ATM-0005', title: 'Elemental Impurities by ICP-MS (ICH Q3D Class 1)', technique: 'ICP-MS', owner: 'amara.nwosu',
    reference: 'USP <232>/<233>, ICH Q3D(R2) · SOP QC-ICP-001', price: 890, tat_days: 7,
    scope: 'Cd, Pb, As, Hg in drug products, APIs and excipients by closed-vessel microwave digestion and ICP-MS.',
    procedure: 'Microwave digestion: 0.25 g sample + 5 mL HNO₃ + 1 mL HCl. Dilute to 50 mL.\nInternal standards: Ge, In, Bi. Spike recovery 70–150 % (J = 0.3 × PDE).',
    analytes: [
      { name: 'Cadmium (Cd)', unit: 'µg/g', spec_max: 0.5, decimals: 3, gen: () => between(0.001, 0.012) },
      { name: 'Lead (Pb)', unit: 'µg/g', spec_max: 0.5, decimals: 3, gen: () => between(0.004, 0.06) },
      { name: 'Arsenic (As)', unit: 'µg/g', spec_max: 1.5, decimals: 3, gen: () => between(0.01, 0.09) },
      { name: 'Mercury (Hg)', unit: 'µg/g', spec_max: 3.0, decimals: 3, gen: () => between(0.001, 0.02) },
    ],
  },
  {
    code: 'ATM-0006', title: 'Identification by FTIR (ATR)', technique: 'FTIR', owner: 'sarah.lindqvist',
    reference: 'USP <197A> · SOP QC-IR-001', price: 180, tat_days: 2,
    scope: 'Identity of APIs and excipients by comparison with a reference spectrum.',
    procedure: 'Collect background, then sample spectrum 4000–650 cm⁻¹, 32 scans, 4 cm⁻¹ resolution. Compare with reference spectrum; correlation ≥ 0.95.',
    analytes: [{ name: 'Identification', result_type: 'text', spec_text: 'Conforms to reference spectrum', gen: () => 'Conforms to reference spectrum' }],
  },
  {
    code: 'ATM-0007', title: 'pH of a 5 % Aqueous Solution', technique: 'pH / Potentiometry', owner: 'sarah.lindqvist',
    reference: 'USP <791>', price: 90, tat_days: 2,
    scope: 'pH of water-soluble raw materials and drug substances.',
    procedure: 'Calibrate with pH 4.01, 7.00, 10.01 buffers (slope 95–105 %). Dissolve 5.0 g in 100 mL CO₂-free water; measure at 25 °C.',
    analytes: [{ name: 'pH', unit: '', spec_min: 4.5, spec_max: 6.5, decimals: 1, gen: () => between(5.1, 5.9) }],
  },
  {
    code: 'ATM-0008', title: 'Loss on Drying (105 °C, 3 h)', technique: 'Gravimetric', owner: 'sarah.lindqvist',
    reference: 'USP <731>', price: 120, tat_days: 3,
    scope: 'Volatile content of APIs and excipients.',
    procedure: 'Dry weighing bottle to constant weight. Weigh 1–2 g sample, dry at 105 °C for 3 h, cool in desiccator, reweigh.',
    analytes: [{ name: 'Loss on drying', unit: '%', spec_max: 1.0, decimals: 2, gen: () => between(0.15, 0.6) }],
  },
  {
    code: 'ATM-0009', title: 'Peptide Mapping of BLX-027 by UPLC-MS (Tryptic Digest)', technique: 'LC-MS', owner: 'kenji.watanabe', client: 'BLST', status: 'In Development',
    reference: 'ICH Q6B · Development protocol DP-BLST-027-01', price: 2400, tat_days: 10,
    scope: 'Identity and post-translational modification profile of the BLX-027 monoclonal antibody.',
    procedure: 'Denature (6 M GuHCl), reduce (DTT), alkylate (IAM), buffer exchange, trypsin 1:20 w/w 4 h at 37 °C.\nACQUITY Peptide CSH C18 2.1 × 150 mm, 0.1 % FA water/ACN gradient over 90 min, MSᴱ acquisition.',
    analytes: [
      { name: 'Sequence coverage', unit: '%', spec_min: 95.0, decimals: 1, gen: () => between(96.5, 99.4) },
      { name: 'Map comparable to reference', result_type: 'text', spec_text: 'Comparable to reference', gen: () => 'Comparable to reference' },
      { name: 'Met-255 oxidation', unit: '%', decimals: 1, gen: () => between(1.2, 3.4) },
    ],
  },
  {
    code: 'ATM-0010', title: 'Assay of Ibuprofen 400 mg Tablets by HPLC-UV', technique: 'HPLC-UV', owner: 'sarah.lindqvist', client: 'NWT', status: 'In Validation',
    reference: 'Validation protocol VP-NWT-IBU-01 (ICH Q2(R2))', price: 520, tat_days: 5,
    scope: 'Assay of ibuprofen in 400 mg film-coated tablets. Under validation for Northwind Therapeutics.',
    procedure: 'ZORBAX Eclipse Plus C18 4.6 × 100 mm, 3.5 µm; isocratic phosphate pH 2.5 / ACN 40:60; 1.5 mL/min; UV 220 nm.',
    analytes: [{ name: 'Assay', unit: '% label claim', spec_min: 95.0, spec_max: 105.0, decimals: 1, gen: () => between(98.6, 101.2) }],
  },
  {
    code: 'ATM-0011', title: 'Assay and Degradation Products of CX-114 Capsules by UPLC-UV', technique: 'UPLC-UV', owner: 'sarah.lindqvist', client: 'CNTS',
    reference: 'Client method CNTS-AM-114-02 (transferred) · SOP QC-UPLC-005', price: 780, tat_days: 5,
    scope: 'Stability-indicating assay and degradation products for CX-114 25 mg capsules.',
    procedure: 'ACQUITY BEH C18 2.1 × 100 mm, 1.7 µm, 40 °C; 0.1 % TFA / ACN gradient; UV 254 nm.',
    analytes: [
      { name: 'Assay', unit: '% label claim', spec_min: 90.0, spec_max: 110.0, decimals: 1, gen: (s) => between(99.5, 101.5) - (s.age || 0) * (s.hot ? 0.9 : 0.25) },
      { name: 'Degradant D1', unit: '%', spec_max: 0.20, decimals: 2, gen: (s) => between(0.02, 0.05) + (s.age || 0) * (s.hot ? 0.03 : 0.006) },
      { name: 'Total degradation products', unit: '%', spec_max: 1.0, decimals: 2, gen: (s) => between(0.10, 0.18) + (s.age || 0) * (s.hot ? 0.09 : 0.02) },
    ],
  },
  {
    code: 'ATM-0012', title: 'Appearance (Visual Inspection)', technique: 'Physical / Visual', owner: 'sarah.lindqvist',
    reference: 'SOP QC-GEN-010', price: 60, tat_days: 1,
    scope: 'Visual description of dosage forms and materials against the product description.',
    procedure: 'Examine under white light against black and white backgrounds. Record colour, shape, markings, defects.',
    analytes: [{ name: 'Appearance', result_type: 'text', spec_text: 'Conforms to description', gen: () => 'Conforms to description' }],
  },
  {
    code: 'ATM-0013', title: 'Nitrosamine Impurities (NDMA, NDEA) by LC-MS/MS', technique: 'LC-MS', owner: 'kenji.watanabe', status: 'Draft',
    reference: 'FDA guidance: Control of Nitrosamine Impurities in Human Drugs', price: 1450, tat_days: 7,
    scope: 'Trace determination of NDMA and NDEA in metformin and sartan drug products.',
    procedure: 'Draft — APCI positive, MRM. LOQ target 0.03 ppm.',
    analytes: [
      { name: 'NDMA', unit: 'ppm', spec_max: 0.096, decimals: 3 },
      { name: 'NDEA', unit: 'ppm', spec_max: 0.0265, decimals: 4 },
    ],
  },
];

const QUALIFICATIONS = {
  'priya.raman': ['ATM-0001', 'ATM-0002'],
  'sarah.lindqvist': ['ATM-0001', 'ATM-0004', 'ATM-0010', 'ATM-0011'],
  'kenji.watanabe': ['ATM-0009', 'ATM-0013', 'ATM-0005'],
  'marco.bianchi': ['ATM-0009', 'ATM-0001'],
  'amara.nwosu': ['ATM-0005', 'ATM-0003'],
  'tom.fletcher': ['ATM-0001', 'ATM-0002', 'ATM-0004', 'ATM-0006', 'ATM-0012'],
  'lucia.fernandez': ['ATM-0001', 'ATM-0004', 'ATM-0010', 'ATM-0011', 'ATM-0012'],
  'wei.zhang': ['ATM-0003', 'ATM-0005', 'ATM-0002', 'ATM-0008'],
  'fatima.alsayed': ['ATM-0001', 'ATM-0011', 'ATM-0012', 'ATM-0007', 'ATM-0008'],
  'jonas.becker': ['ATM-0002', 'ATM-0006', 'ATM-0007', 'ATM-0008', 'ATM-0012'],
  'chloe.martin': ['ATM-0004', 'ATM-0001', 'ATM-0011'],
  'ravi.patel': ['ATM-0003', 'ATM-0005', 'ATM-0008'],
  'emily.novak': ['ATM-0001', 'ATM-0002', 'ATM-0006', 'ATM-0010'],
  'samuel.mensah': ['ATM-0011', 'ATM-0012', 'ATM-0004', 'ATM-0002'],
  'ingrid.larsen': ['ATM-0006', 'ATM-0007', 'ATM-0008', 'ATM-0002', 'ATM-0012'],
  'nadia.rossi': ['ATM-0012', 'ATM-0006'],
  'ben.carter': ['ATM-0012', 'ATM-0008'],
};

// [code, name, type, manufacturer, model, location, calibration interval (days), calibration due relative to today (days)]
const INSTRUMENTS = [
  ['HPLC-01', 'Agilent 1260 Infinity II #1', 'HPLC', 'Agilent', '1260 Infinity II', 'Lab 2.01 — Chromatography', 180, 95],
  ['HPLC-02', 'Agilent 1290 Infinity II', 'HPLC', 'Agilent', '1290 Infinity II', 'Lab 2.01 — Chromatography', 180, 40],
  ['HPLC-03', 'Waters Alliance e2695', 'HPLC', 'Waters', 'Alliance e2695 / 2489 UV', 'Lab 2.02 — Chromatography', 180, -5],
  ['HPLC-04', 'Shimadzu Nexera XR', 'HPLC', 'Shimadzu', 'Nexera XR', 'Lab 2.02 — Chromatography', 180, 120],
  ['UPLC-01', 'Waters ACQUITY UPLC H-Class', 'UPLC', 'Waters', 'ACQUITY H-Class PLUS', 'Lab 2.02 — Chromatography', 180, 70],
  ['LCMS-01', 'Waters Xevo G2-XS QTof', 'LC-MS', 'Waters', 'Xevo G2-XS', 'Lab 3.01 — Mass Spectrometry', 365, 10],
  ['GC-01', 'Agilent 8890 GC / 7697A Headspace', 'GC', 'Agilent', '8890 + 7697A', 'Lab 2.03 — GC', 180, 150],
  ['ICPMS-01', 'Agilent 7900 ICP-MS', 'ICP-MS', 'Agilent', '7900', 'Lab 3.02 — Elemental', 180, 60],
  ['KF-01', 'Metrohm 917 Titrando KF', 'Karl Fischer Titrator', 'Metrohm', '917 Titrando', 'Lab 1.04 — Wet Chemistry', 90, 30],
  ['FTIR-01', 'Thermo Nicolet iS20 with ATR', 'FTIR Spectrometer', 'Thermo Fisher', 'Nicolet iS20', 'Lab 1.03 — Spectroscopy', 365, 200],
  ['DISS-01', 'Distek 2500 Dissolution System', 'Dissolution Bath', 'Distek', '2500 Select', 'Lab 1.05 — Dissolution', 180, 80],
  ['DISS-02', 'Agilent 708-DS Dissolution Apparatus', 'Dissolution Bath', 'Agilent', '708-DS', 'Lab 1.05 — Dissolution', 180, 25],
  ['BAL-01', 'Mettler Toledo XPR205 Analytical Balance', 'Analytical Balance', 'Mettler Toledo', 'XPR205', 'Weighing Room 1.02', 365, 150],
  ['BAL-02', 'Sartorius Cubis II MCA225S', 'Analytical Balance', 'Sartorius', 'Cubis II MCA225S', 'Weighing Room 1.02', 365, 9],
  ['PH-01', 'Mettler Toledo SevenExcellence pH meter', 'pH Meter', 'Mettler Toledo', 'SevenExcellence S470', 'Lab 1.04 — Wet Chemistry', 90, 45],
  ['OVEN-01', 'Memmert UN55 Drying Oven', 'Other', 'Memmert', 'UN55', 'Lab 1.04 — Wet Chemistry', 365, 100],
  ['SC-01', 'Stability Chamber 25 °C / 60 % RH', 'Stability Chamber', 'Binder', 'KBF 720', 'Stability Suite', 365, 180],
  ['SC-02', 'Stability Chamber 40 °C / 75 % RH', 'Stability Chamber', 'Binder', 'KBF 720', 'Stability Suite', 365, 180],
];

const INSTRUMENTS_FOR = {
  'HPLC-UV': ['HPLC-01', 'HPLC-02', 'HPLC-03', 'HPLC-04'], 'UPLC-UV': ['UPLC-01'], 'LC-MS': ['LCMS-01'], 'GC-Headspace': ['GC-01'],
  'ICP-MS': ['ICPMS-01'], 'Karl Fischer': ['KF-01'], FTIR: ['FTIR-01'], Dissolution: ['DISS-01', 'DISS-02'], 'pH / Potentiometry': ['PH-01'],
  Gravimetric: ['OVEN-01'],
};

// [key, category, name, supplier, catalog, lot, potency, quantity, unit, min, storage, expiry relative to today (days)]
const INVENTORY = [
  ['metRS', 'Reference Standard', 'Metformin Hydrochloride USP Reference Standard', 'USP', '1396309', 'R08840', '100.0 %', 180, 'mg', 50, 'Desiccator, 20–25 °C', 400],
  ['metA', 'Reference Standard', 'Metformin Related Compound A (cyanoguanidine) USP RS', 'USP', '1396320', 'F0K192', '99.7 %', 22, 'mg', 10, 'Refrigerated 2–8 °C', 20],
  ['metWS', 'Working Standard', 'Metformin HCl Working Standard WS-2026-03', 'In-house', null, 'WS-2026-03', '99.8 % (vs USP RS R08840)', 8.5, 'g', 2, 'Desiccator, 20–25 °C', 60],
  ['ibuRS', 'Reference Standard', 'Ibuprofen USP Reference Standard', 'USP', '1335508', 'R11230', '99.9 %', 350, 'mg', 100, '20–25 °C', 300],
  ['cxRS', 'Reference Standard', 'CX-114 Reference Standard (client-supplied)', 'Contoso Pharma', null, 'CX114-RS-03', '99.6 %', 1.2, 'g', 0.3, 'Refrigerated 2–8 °C', 150],
  ['cxD1', 'Reference Standard', 'CX-114 Degradant D1 Impurity Standard', 'Contoso Pharma', null, 'CX114-D1-01', '97.2 %', 15, 'mg', 5, 'Frozen −20 °C', -3],
  ['rsMix', 'Reference Standard', 'Residual Solvents Class 2 – Mixture A USP RS', 'USP', '1601281', 'R146N0', 'Certified', 6, 'ampoules', 2, '20–25 °C', 90],
  ['icpStd', 'Reference Standard', 'Multi-element ICP-MS Standard (Cd, Pb, As, Hg) 10 µg/mL', 'Inorganic Ventures', 'IV-ICPMS-71A', 'U2-MEB712345', 'Certified', 240, 'mL', 50, '20–25 °C', 200],
  ['blxRM', 'Reference Standard', 'BLX-027 Reference Material (client-supplied)', 'Bluestone Biologics', null, 'BLX027-RM-02', '10.2 mg/mL', 14, 'vials', 4, 'Deep frozen −80 °C', 365],
  ['kfReag', 'Reagent', 'HYDRANAL-Composite 5 (KF titrant)', 'Honeywell', '34805', 'SZBG2310', null, 1.5, 'L', 2, '20–25 °C', 210],
  ['kh2po4', 'Reagent', 'Potassium dihydrogen phosphate, AR grade', 'Merck', '1.04873', 'A1923873', null, 1.8, 'kg', 0.5, '20–25 °C', 900],
  ['trypsin', 'Reagent', 'Trypsin, sequencing grade modified', 'Promega', 'V5111', '0000498812', null, 9, 'vials', 3, 'Frozen −20 °C', 120],
  ['acn', 'Solvent', 'Acetonitrile, HPLC gradient grade', 'Fisher Chemical', 'A998-4', '2208734', null, 32, 'L', 10, 'Flammables cabinet', 700],
  ['meoh', 'Solvent', 'Methanol, HPLC grade', 'Fisher Chemical', 'A452-4', '2211956', null, 18, 'L', 8, 'Flammables cabinet', 650],
  ['lcmsWater', 'Solvent', 'Water, LC-MS grade', 'Honeywell', '39253', 'K1220', null, 12, 'L', 4, '20–25 °C', 400],
  ['dmso', 'Solvent', 'Dimethyl sulfoxide, headspace grade', 'Merck', '1.01900', 'K53182900', null, 0.9, 'L', 0.5, '20–25 °C', 25],
  ['xbridge', 'Column', 'Waters XBridge C18, 4.6 × 150 mm, 3.5 µm', 'Waters', '186003034', 'Col SN 0213', null, 1, 'column', null, 'Column cabinet', null],
  ['zorbax', 'Column', 'Agilent ZORBAX Eclipse Plus C18, 4.6 × 100 mm, 3.5 µm', 'Agilent', '959961-902', 'Col SN USUXR', null, 1, 'column', null, 'Column cabinet', null],
  ['beh', 'Column', 'Waters ACQUITY UPLC BEH C18, 2.1 × 100 mm, 1.7 µm', 'Waters', '186002352', 'Col SN 0187', null, 1, 'column', null, 'Column cabinet', null],
  ['csh', 'Column', 'Waters ACQUITY Peptide CSH C18, 2.1 × 150 mm, 1.7 µm', 'Waters', '186006938', 'Col SN 0231', null, 1, 'column', null, 'Column cabinet', null],
  ['db624', 'Column', 'Agilent DB-624, 30 m × 0.32 mm, 1.8 µm', 'Agilent', '123-1334', 'Col SN US8820', null, 1, 'column', null, 'GC lab', null],
];

const MATERIALS_FOR = {
  'ATM-0001': ['metWS', 'metA', 'acn', 'kh2po4', 'xbridge'], 'ATM-0002': ['kfReag'], 'ATM-0003': ['rsMix', 'dmso', 'db624'],
  'ATM-0004': ['metWS', 'kh2po4'], 'ATM-0005': ['icpStd'], 'ATM-0009': ['blxRM', 'trypsin', 'lcmsWater', 'csh'],
  'ATM-0010': ['ibuRS', 'acn', 'zorbax'], 'ATM-0011': ['cxRS', 'cxD1', 'acn', 'beh'],
};

export function seedDemo() {
  const NOW = Date.now();
  const START = NOW - 150 * DAY;
  const warnings = [];
  const U = {};
  const C = {};
  const M = {};
  const I = {};
  const INV = {};
  const P = {};

  const as = (username) => ({ user: U[username], ip: '127.0.0.1', trustedSigner: true });
  const at = (ms) => setClock(new Date(ms));
  const dayAt = (n, hour = 9, minute = 0) => {
    const d = new Date(START + n * DAY);
    d.setHours(hour, minute, 0, 0);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    while (+d > NOW) d.setTime(+d - DAY);
    return +d;
  };
  // Moves a timestamp into working hours (Mon–Fri 08:00–18:00).
  const work = (ms) => {
    const d = new Date(ms);
    if (d.getHours() >= 18) { d.setDate(d.getDate() + 1); d.setHours(8, int(30, 59), 0, 0); }
    if (d.getHours() < 8) d.setHours(8, int(30, 59), 0, 0);
    while (d.getDay() === 0 || d.getDay() === 6) { d.setDate(d.getDate() + 1); d.setHours(8, int(30, 59), 0, 0); }
    return +d;
  };

  // ---------- Settings, people, clients ----------
  at(START - 400 * DAY);
  setSettings({ user: { id: null, username: 'setup' } }, {
    lab_name: 'Demo Analytical Laboratories',
    lab_address: '100 Research Drive, Suite 200\nSpringfield, IL 62704\nUSA',
    lab_phone: '+1 555 0100',
    lab_email: 'lab@demo-analytical.example',
    lab_accreditation: 'cGMP compliant · FDA registered (demo)',
    currency: 'USD',
    tax_rate: '0',
    demo_mode: '1',
  });
  for (const [username, full_name, role, title] of USERS) {
    const id = insert({ user: { id: null, username: 'setup' } }, 'users', {
      username, full_name, initials: initialsOf(full_name), role, title, email: `${username}@demo-analytical.example`,
      password_hash: hashPassword(DEMO_PASSWORD), must_change_password: 0, active: 1, created_at: new Date(START - 400 * DAY).toISOString(),
    }, { summary: 'Demo account created' });
    U[username] = get('SELECT * FROM users WHERE id = ?', id);
  }
  at(START - 300 * DAY);
  for (const c of CLIENTS) C[c.code] = createClient(as('grace.holloway'), c).id;

  // ---------- Methods (with version history) ----------
  for (const def of METHODS) {
    const first = def.history ? START + def.history[0] * DAY : START - 200 * DAY;
    at(first - 10 * DAY);
    const body = {
      code: def.code, title: def.title, technique: def.technique, reference: def.reference, scope: def.scope, procedure: def.procedure,
      price: def.price, tat_days: def.tat_days, owner_id: U[def.owner].id, client_id: def.client ? C[def.client] : null,
      status: def.status === 'In Development' ? 'In Development' : 'Draft',
      analytes: def.analytes.map(({ gen, ...a }) => ({ result_type: 'numeric', ...a })),
    };
    if (def.history) {
      // v1 had looser impurity reporting; v2 tightened it.
      body.analytes = body.analytes.filter((a) => a.name !== 'Largest unspecified impurity');
    }
    let { id } = createMethod(as(def.owner), body);
    if (def.status === 'In Validation') setMethodStatus(as(def.owner), id, { status: 'In Validation' });
    if (!def.status) {
      at(first);
      setMethodStatus(as('daniel.okafor'), id, { status: 'Effective', comment: 'Validation report reviewed and approved' });
    }
    if (def.history) {
      at(START + def.history[1] * DAY - 12 * DAY);
      id = newMethodVersion(as(def.owner), id).id;
      const analytes = def.analytes.map(({ gen, ...a }, i) => ({ ...a, result_type: a.result_type || 'numeric', sort_order: i }));
      run('DELETE FROM method_analytes WHERE method_id = ?', id);
      for (const a of analytes) {
        run('INSERT INTO method_analytes (method_id, name, unit, result_type, spec_min, spec_max, spec_text, decimals, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          id, a.name, a.unit ?? null, a.result_type, a.spec_min ?? null, a.spec_max ?? null, a.spec_text ?? null, a.decimals ?? 2, a.sort_order);
      }
      update(as(def.owner), 'methods', id, { procedure: `${def.procedure}\n\n_v2: added reporting of the largest unspecified impurity (change control CC-2026-004)._` }, { summary: 'Method edited', extraChanges: { parameters: ['3 parameters', '4 parameters'] } });
      at(START + def.history[1] * DAY);
      setMethodStatus(as('daniel.okafor'), id, { status: 'Effective', comment: 'Change control CC-2026-004 approved' });
    }
    M[def.code] = { id, def, technique: def.technique };
  }

  // ---------- Training ----------
  at(START - 60 * DAY);
  for (const [username, codes] of Object.entries(QUALIFICATIONS)) {
    for (const code of codes) {
      const expires = username === 'ben.carter' && code === 'ATM-0008' ? localDate(new Date(NOW + 12 * DAY)) : null;
      insert(as('priya.raman'), 'qualifications', {
        user_id: U[username].id, method_code: code, qualified_at: localDate(new Date(START - int(60, 400) * DAY)), trained_by: U['sarah.lindqvist'].id, expires_at: expires,
      }, { code, summary: `${U[username].full_name} qualified on ${code}` });
    }
  }

  // ---------- Instruments with calibration history ----------
  for (const [code, name, type, manufacturer, model, location, interval, dueOffset] of INSTRUMENTS) {
    const due = NOW + dueOffset * DAY;
    const last = due - interval * DAY;
    at(Math.min(last, START) - 30 * DAY);
    const { id } = createInstrument(as('priya.raman'), {
      code, name, type, manufacturer, model, location, serial_no: `${model.replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase()}${int(10000, 99999)}`,
      calibration_interval_days: interval, status: 'Available',
    });
    at(last);
    logInstrument(as('sarah.lindqvist'), id, {
      kind: 'Calibration', performed_at: localDate(new Date(last)), outcome: 'Pass',
      description: type.includes('Balance') ? 'External calibration with certified weights E2 class (1 mg – 200 g). All points within tolerance.' : 'Annual/periodic calibration by vendor service engineer. All parameters within specification; certificate filed.',
      next_due: localDate(new Date(due)),
    });
    if (last + 40 * DAY < NOW && chance(0.6)) {
      at(work(last + 40 * DAY));
      logInstrument(as(pick(['tom.fletcher', 'wei.zhang', 'chloe.martin'])), id, { kind: 'Preventive Maintenance', description: pick(['Replaced pump seals and inlet filters; leak test passed.', 'Cleaned optics and replaced lamp; intensity check passed.', 'Routine PM: firmware updated, check valves cleaned.']), outcome: 'Pass' });
    }
    I[code] = id;
  }

  // ---------- Inventory ----------
  at(START - 20 * DAY);
  for (const [key, category, name, supplier, catalog_no, lot_no, potency, quantity, unit, min, storage, expiry] of INVENTORY) {
    INV[key] = createInventory(as('nadia.rossi'), {
      category, name, supplier, catalog_no, lot_no, potency, quantity, unit, min_quantity: min, storage,
      location: category === 'Column' ? 'Column cabinet C-1' : storage.includes('−') ? 'Freezer F-01' : storage.includes('2–8') ? 'Fridge R-02' : 'Store room S-1',
      received_date: localDate(new Date(START - 25 * DAY)), expiry_date: expiry == null ? null : localDate(new Date(NOW + expiry * DAY)),
    }).id;
  }

  // ---------- Event engine ----------
  const events = [];
  let seq = 0;
  const on = (ms, fn, chain = null) => events.push({ t: ms, seq: seq++, fn, chain });

  const qualifiedFor = (code) => all(`SELECT u.username, u.role,
      (SELECT COUNT(*) FROM tests t WHERE t.analyst_id = u.id AND t.status IN ('Pending','In Progress')) AS load
    FROM users u JOIN qualifications q ON q.user_id = u.id
    WHERE q.method_code = ? AND q.revoked = 0 AND (q.expires_at IS NULL OR q.expires_at >= ?) AND u.active = 1 AND u.role IN ('analyst','scientist')`, code, today());

  const pickAnalyst = (code) => {
    const list = qualifiedFor(code);
    const scientistsFirst = ['ATM-0009', 'ATM-0010'].includes(code);
    list.sort((a, b) => (a.load + (a.role === 'scientist' && !scientistsFirst ? 3 : 0) + rand()) - (b.load + (b.role === 'scientist' && !scientistsFirst ? 3 : 0) + rand()));
    return list[0]?.username;
  };
  const pickReviewer = (exclude) => pick(['sarah.lindqvist', 'kenji.watanabe', 'marco.bianchi', 'amara.nwosu', 'sarah.lindqvist', 'priya.raman'].filter((u) => !exclude.includes(u)));
  const pickApprover = (exclude) => pick(['daniel.okafor', 'helena.weiss', 'helena.weiss', 'priya.raman'].filter((u) => !exclude.includes(u)));

  const pickInstrument = (technique) => {
    const codes = INSTRUMENTS_FOR[technique];
    if (!codes) return null;
    const ok = codes.map((c) => get('SELECT * FROM instruments WHERE id = ?', I[c]))
      .filter((i) => !['Out of Service', 'Maintenance', 'Retired'].includes(i.status) && (!i.calibration_due || i.calibration_due >= today()));
    if (!ok.length) throw new Error(`No ${technique} instrument available`);
    return pick(ok).id;
  };
  const pickMaterials = (code) => (MATERIALS_FOR[code] || []).map((k) => get('SELECT * FROM inventory WHERE id = ?', INV[k]))
    .filter((m) => m.status === 'Active' && (!m.expiry_date || m.expiry_date >= today())).map((m) => m.id);

  const resultsFor = (testId, code, sampleCtx, override) => {
    const gens = Object.fromEntries(M[code].def.analytes.map((a) => [a.name, a.gen]));
    return all('SELECT * FROM results WHERE test_id = ? ORDER BY sort_order', testId).map((r) => {
      if (override && override[r.analyte] != null) return { id: r.id, value: override[r.analyte] };
      const v = gens[r.analyte]?.(sampleCtx);
      if (r.result_type === 'text') return { id: r.id, value: v, outcome: 'Pass' };
      return { id: r.id, value: Number(v.toFixed(Math.max(r.decimals, 1) + 1)) };
    });
  };

  /**
   * Plans the full life of one received sample. Every step is scheduled at a realistic time;
   * steps that would fall after "now" simply haven't happened yet.
   * spec.oos = { method, analyte, value, flow: 'confirmed' | 'invalidated' | 'open', retest }
   */
  function planSample(spec) {
    const sample = { dead: false, tests: {}, approvals: [] };
    const receiver = spec.receiver || pick(['nadia.rossi', 'nadia.rossi', 'jonas.becker', 'ingrid.larsen']);
    on(spec.at, () => {
      const res = receiveSamples(as(receiver), {
        client_id: C[spec.client], project_id: P[spec.project], sample_type: spec.type, storage: spec.storage, location: spec.location,
        priority: spec.priority || 'Standard', condition: spec.condition || 'Acceptable',
        received_at: new Date(spec.at).toISOString(), notes: spec.notes,
        samples: [{ description: spec.description, batch_no: spec.batch, client_ref: spec.clientRef, quantity: spec.quantity, container: spec.container }],
        method_ids: spec.methods.map((c) => M[c].id),
      });
      sample.id = res.samples[0].id;
      sample.code = res.samples[0].code;
      for (const t of all('SELECT t.id, m.code FROM tests t JOIN methods m ON m.id = t.method_id WHERE t.sample_id = ?', sample.id)) sample.tests[t.code] = t.id;
    }, sample);

    // Labs work faster on short-turnaround and rush work: scale the simulated pace to the due date.
    const tat = Math.max(...spec.methods.map((c) => M[c].def.tat_days));
    const pace = Math.min(1.2, Math.max(0.45, tat / 6)) * (spec.priority === 'Rush' ? 0.55 : 1);
    let lastApproval = 0;
    for (const code of spec.methods) {
      const chain = { parent: sample };
      const tid = () => sample.tests[code];
      const oos = spec.oos?.method === code ? spec.oos : null;
      const tAssign = work(spec.at + between(0.5, 8) * pace * HOUR);
      const tStart = work(tAssign + between(1, 20) * pace * HOUR + (spec.delay || 0) * DAY);
      const tResult = work(tStart + between(2, 22) * pace * HOUR);
      const tSubmit = tResult + between(0.3, 3) * HOUR;
      const tReview = work(tSubmit + between(2, 24) * pace * HOUR);
      on(tAssign, () => {
        chain.analyst = spec.analyst?.[code] || pickAnalyst(code);
        if (!chain.analyst) throw new Error(`Nobody qualified on ${code}`);
        assignTests(as('priya.raman'), { test_ids: [tid()], analyst_id: U[chain.analyst].id });
      }, chain);
      on(tStart, () => startTest(as(chain.analyst), tid()), chain);
      on(tResult, () => {
        const instrument = pickInstrument(M[code].technique);
        chain.instrument = instrument;
        const ic = instrument ? get('SELECT code FROM instruments WHERE id = ?', instrument).code : 'MANUAL';
        saveResults(as(chain.analyst), tid(), {
          instrument_id: instrument, material_ids: pickMaterials(code),
          raw_data_ref: instrument ? `${['HPLC', 'UPLC', 'LCMS'].some((p) => ic.startsWith(p)) ? 'Empower 3' : 'Instrument printout'} · ${ic} · ${localDate(new Date(tResult)).replace(/-/g, '')}-${String(int(1, 99)).padStart(3, '0')}` : null,
          comments: chance(0.25) ? pick(['System suitability passed.', 'Duplicate preparations agree within 0.5 %.', 'Run bracketed by check standards; all within 98–102 %.', 'No anomalies observed.']) : null,
          results: resultsFor(tid(), code, spec, oos ? { [oos.analyte]: oos.value } : null),
        });
      }, chain);
      on(tSubmit, () => {
        const out = submitTest(as(chain.analyst), tid(), { comment: null });
        chain.investigation = out.investigation?.id;
      }, chain);
      on(tReview, () => {
        chain.reviewer = pickReviewer([chain.analyst]);
        reviewTest(as(chain.reviewer), tid(), { decision: 'approve', comment: chance(0.2) ? 'Chromatography and calculations verified.' : null });
      }, chain);

      let tApprove;
      if (oos) {
        const tInv = work(tReview + between(20, 50) * HOUR);
        const tClose = work(tInv + between(2, 4) * DAY);
        on(tInv, () => updateInvestigation(as('priya.raman'), chain.investigation, {
          status: 'Under Investigation',
          root_cause: oos.flow === 'invalidated' ? oos.rootCause : oos.flow === 'confirmed' ? oos.rootCause : null,
          impact: oos.impact || null,
          conclusion: oos.flow === 'open' ? null : oos.flow === 'invalidated' ? 'Invalidated — assignable laboratory error' : 'Confirmed OOS — result valid',
          capa: oos.capa || null,
        }), chain);
        if (oos.flow === 'open') {
          tApprove = Infinity;
        } else {
          on(tClose, () => closeInvestigation(as('daniel.okafor'), chain.investigation, { comment: 'Phase I/II investigation report approved' }), chain);
          if (oos.flow === 'invalidated') {
            const tReject = work(tClose + between(1, 6) * HOUR);
            const tRetest = work(tReject + between(10, 30) * HOUR);
            const tResubmit = tRetest + 2 * HOUR;
            const tReReview = work(tResubmit + between(4, 20) * HOUR);
            on(tReject, () => {
              chain.approver = pickApprover([chain.analyst, chain.reviewer]);
              const inv = get('SELECT code FROM investigations WHERE id = ?', chain.investigation).code;
              approveTest(as(chain.approver), tid(), { decision: 'reject', comment: `Original result invalidated under ${inv}. Repeat analysis per SOP QC-021.` });
            }, chain);
            on(tRetest, () => {
              const inv = get('SELECT code FROM investigations WHERE id = ?', chain.investigation).code;
              saveResults(as(chain.analyst), tid(), { results: resultsFor(tid(), code, spec, { [oos.analyte]: oos.retest }).filter((r) => r.value === oos.retest), reason: `Repeat analysis after invalidated OOS (${inv}); paddle height corrected` });
            }, chain);
            on(tResubmit, () => submitTest(as(chain.analyst), tid(), { comment: 'Repeat analysis' }), chain);
            on(tReReview, () => {
              chain.reviewer = pickReviewer([chain.analyst, chain.approver]);
              reviewTest(as(chain.reviewer), tid(), { decision: 'approve', comment: 'Repeat data verified against investigation findings.' });
            }, chain);
            tApprove = work(tReReview + between(3, 24) * HOUR);
          } else {
            tApprove = work(tClose + between(2, 20) * HOUR);
          }
        }
      } else {
        tApprove = work(tReview + between(1, 18) * pace * HOUR);
      }
      if (Number.isFinite(tApprove)) {
        on(tApprove, () => {
          const approver = pickApprover([chain.analyst, chain.reviewer]);
          approveTest(as(approver), tid(), { decision: 'approve', comment: null });
        }, chain);
      }
      lastApproval = Math.max(lastApproval, tApprove);
    }
    if (Number.isFinite(lastApproval)) {
      on(work(lastApproval + between(1, 8) * HOUR), () => {
        if (get('SELECT status FROM samples WHERE id = ?', sample.id)?.status !== 'Approved') return;
        issueReport(as(pick(['daniel.okafor', 'helena.weiss'])), sample.id, { comment: null });
      }, sample);
    }
    return sample;
  }

  // ---------- Projects ----------
  const project = (day, client, body, lead) => on(dayAt(day, 10), () => {
    P[body.key] = createProject(as('grace.holloway'), {
      client_id: C[client], title: body.title, type: body.type, status: body.status || 'Active', lead_id: U[lead].id,
      po_number: body.po, budget: body.budget, start_date: localDate(new Date(dayAt(day))), due_date: body.due != null ? localDate(new Date(NOW + body.due * DAY)) : null, description: body.description,
    }).id;
  });
  project(-2, 'ACME', { key: 'release', title: 'Metformin HCl 500 mg Tablets — Batch Release Testing', type: 'Routine / Release Testing', po: 'PO-ACME-44710', budget: 90000, due: 200, description: 'Full release testing of commercial batches per ACME specification SPEC-MF500-07 (rev. 7). Standard TAT 5 working days; rush on request.' }, 'priya.raman');
  project(-1, 'CNTS', { key: 'stability', title: 'CX-114 25 mg Capsules — ICH Stability Study (3 batches)', type: 'Stability Study', po: 'CNTS-PO-88213', budget: 72000, due: 400, description: 'ICH Q1A(R2) stability: 25 °C/60 % RH (long term) and 40 °C/75 % RH (accelerated). Pulls at 0, 1, 3, 6, 9, 12 months. Protocol STP-CX114-01.' }, 'samuel.mensah');
  project(5, 'ACME', { key: 'solvents', title: 'Residual Solvents — Metformin API Supplier Qualification', type: 'Routine / Release Testing', po: 'PO-ACME-45102', budget: 6000, due: -80, description: 'Testing of 6 lots from a new API supplier for residual solvents and LOD.' }, 'amara.nwosu');
  project(8, 'CNTS', { key: 'raw', title: 'Raw Material Testing Programme 2026', type: 'Routine / Release Testing', po: 'CNTS-BO-2026-01', budget: 15000, due: 90, description: 'Identity, LOD and water content for incoming excipient lots (blanket order).' }, 'priya.raman');
  project(30, 'BLST', { key: 'mab', title: 'BLX-027 mAb — Peptide Mapping Method Development', type: 'Method Development', po: 'BLST-PO-1187', budget: 48000, due: 45, description: 'Develop and pre-qualify a UPLC-MS peptide mapping method for BLX-027 suitable for identity release testing and PTM monitoring. Milestone billing (3 milestones).' }, 'kenji.watanabe');
  project(55, 'GLBX', { key: 'ei', title: 'Elemental Impurities Screening (ICH Q3D) — Excipient Suppliers', type: 'Routine / Release Testing', po: 'GLBX-2026-0457', budget: 18000, due: 20, description: 'Class 1 elemental impurities screening of excipients from 4 suppliers as part of the ICH Q3D risk assessment.' }, 'amara.nwosu');
  project(105, 'NWT', { key: 'validation', title: 'Ibuprofen 400 mg Tablets — Assay Method Validation (ICH Q2(R2))', type: 'Method Validation', po: 'NWT-55-2026', budget: 35000, due: 25, description: 'Full validation of assay method ATM-0010: specificity, linearity, range, accuracy, precision, robustness. Report to support client regulatory filing.' }, 'sarah.lindqvist');
  project(142, 'NWT', { key: 'transfer', title: 'Naproxen Sodium Tablets — Method Transfer from Client Site', type: 'Method Transfer', status: 'Quoted', budget: 22000, due: 90, description: 'Comparative testing transfer of client assay & dissolution methods. Quote Q-2026-031 sent; awaiting PO.' }, 'sarah.lindqvist');

  // ---------- Samples ----------
  // ACME release batches, roughly twice a week.
  let batchNo = 2611;
  let invalidatedDone = false;
  let openDone = false;
  const releaseMethods = ['ATM-0001', 'ATM-0002', 'ATM-0004', 'ATM-0006'];
  for (let d = 0; d < 150; d += int(3, 5)) {
    const n = batchNo++;
    const spec = {
      at: dayAt(d, int(9, 15), int(0, 59)), client: 'ACME', project: 'release', type: 'Drug Product', storage: 'Ambient (15–25 °C)',
      location: 'Sample store A — shelf 2', description: 'Metformin HCl 500 mg Film-coated Tablets', batch: `MF5-${n}`, clientRef: `ACME-REL-${n}`,
      quantity: '2 × 100 tablets', container: 'HDPE bottle', methods: releaseMethods, priority: chance(0.12) ? 'Rush' : 'Standard',
      delay: chance(0.07) ? between(3, 6) : 0,
    };
    if (d >= 64 && d <= 68 && !invalidatedDone) {
      invalidatedDone = true;
      spec.oos = {
        method: 'ATM-0004', analyte: 'Mean dissolved at 30 min (n=6)', value: 74, flow: 'invalidated', retest: 91,
        rootCause: 'Phase I check found the paddle height of vessel 4 at 28 mm (limit 25 ± 2 mm) after the shaft was refitted during cleaning. Re-measurement of retained solutions confirmed low recovery confined to vessel 4.',
        impact: 'Only this run affected; DISS-01 runs since last verification reviewed — no other runs impacted.',
        capa: 'Paddle height verification added to the pre-run checklist in SOP QC-DIS-002 rev. 5; mechanical qualification of the bath repeated.',
      };
    }
    if (d >= 138 && d <= 143 && !openDone) {
      openDone = true;
      spec.oos = { method: 'ATM-0001', analyte: 'Impurity A (cyanoguanidine)', value: 0.14, flow: 'open' };
      spec.at = Math.min(spec.at, NOW - 9 * DAY);
      spec.delay = 0;
    }
    if (spec.at > NOW - 3 * DAY) spec.priority = 'Standard';
    planSample(spec);
  }

  // Contoso stability pulls: T0, 1M, 3M — and photostability samples this week.
  const pulls = [[0, 'T0', 0, ['25 °C/60 % RH']], [33, '1M', 1, ['25 °C/60 % RH', '40 °C/75 % RH']], [95, '3M', 3, ['25 °C/60 % RH', '40 °C/75 % RH']]];
  for (const [day, label, age, conditions] of pulls) {
    for (const cond of conditions) {
      for (const batch of ['CX25-0101', 'CX25-0102', 'CX25-0103']) {
        const hot = cond.startsWith('40');
        const spec = {
          at: dayAt(day + 1, 10, int(0, 50)), client: 'CNTS', project: 'stability', type: 'Stability', storage: 'Ambient (15–25 °C)',
          location: hot ? 'SC-02 pull tray' : 'SC-01 pull tray', description: `CX-114 25 mg Capsules — ${label} ${cond}`, batch, clientRef: `STB-${batch}-${label}-${hot ? '40' : '25'}`,
          quantity: '60 capsules', container: 'HDPE bottle (market pack)', methods: ['ATM-0011', 'ATM-0002', 'ATM-0012'], age, hot, receiver: 'samuel.mensah',
        };
        if (label === '3M' && hot && batch === 'CX25-0102') {
          spec.oos = {
            method: 'ATM-0011', analyte: 'Degradant D1', value: 0.27, flow: 'confirmed',
            rootCause: 'No laboratory error identified (Phase I): system suitability, standard and sample preparations verified; re-injection of the original solution confirmed 0.27 %. Degradation trend for batch CX25-0102 at 40 °C/75 % RH is steeper than for the other batches.',
            impact: 'Accelerated condition only; long-term 25 °C/60 % RH results for the batch are within specification. Client notified on day of confirmation.',
            capa: 'Client to assess formulation/packaging for batch CX25-0102 (moisture ingress). Laboratory: none required.',
          };
        }
        planSample(spec);
      }
    }
  }
  for (const batch of ['CX25-0101', 'CX25-0102', 'CX25-0103']) {
    planSample({
      at: NOW - between(20, 30) * HOUR, client: 'CNTS', project: 'stability', type: 'Stability', storage: 'Ambient, protect from light',
      location: 'Sample store B — shelf 1', description: 'CX-114 25 mg Capsules — Photostability (ICH Q1B option 2)', batch, clientRef: `PHOTO-${batch}`,
      quantity: '30 capsules', container: 'Quartz dish, foil control', methods: ['ATM-0011', 'ATM-0012'], age: 0.3, hot: false, priority: 'Rush', receiver: 'samuel.mensah',
    });
  }

  // API supplier qualification — residual solvents (completed project).
  for (let i = 0; i < 6; i++) {
    planSample({
      at: dayAt(6 + i * 4, 11), client: 'ACME', project: 'solvents', type: 'Drug Substance (API)', storage: 'Ambient (15–25 °C)', location: 'Sample store A — shelf 4',
      description: 'Metformin Hydrochloride API (new supplier)', batch: `MH-API-${2408 + i}`, clientRef: `SQ-${i + 1}`, quantity: '50 g', container: 'Double PE bag in fibre drum sample',
      methods: ['ATM-0003', 'ATM-0008'],
    });
  }
  on(dayAt(62, 16), () => setProjectStatus(as('priya.raman'), P.solvents, 'complete', { reason: 'Final report sent' }));

  // Contoso raw materials, every ~2 weeks.
  const excipients = ['Microcrystalline Cellulose PH-102', 'Lactose Monohydrate', 'Magnesium Stearate', 'Croscarmellose Sodium', 'Colloidal Silicon Dioxide', 'Povidone K30'];
  for (let d = 10, k = 0; d < 150; d += int(9, 14), k++) {
    planSample({
      at: dayAt(d, 14), client: 'CNTS', project: 'raw', type: 'Raw Material', storage: 'Ambient (15–25 °C)', location: 'Sample store A — shelf 5',
      description: excipients[k % excipients.length], batch: `RM-${String(7710 + k)}`, clientRef: `CNTS-IR-${3300 + k}`, quantity: '250 g', container: 'Amber glass jar',
      methods: ['ATM-0006', 'ATM-0008', 'ATM-0002'],
    });
  }

  // Globex elemental impurities — second set waits for the ICP-MS repair.
  for (const [day, set] of [[57, 'A'], [144, 'B']]) {
    ['Talc', 'Titanium Dioxide', 'Calcium Carbonate', 'Iron Oxide Red'].forEach((name, i) => {
      planSample({
        at: dayAt(day, 10, i * 5), client: 'GLBX', project: 'ei', type: 'Excipient', storage: 'Ambient (15–25 °C)', location: 'Sample store A — shelf 6',
        description: `${name} — supplier ${set}${i + 1}`, batch: `GX-${set}${i + 1}-2026`, clientRef: `GLBX-EI-${set}${i + 1}`, quantity: '100 g', container: 'PE bottle',
        methods: ['ATM-0005'],
      });
    });
  }

  // Northwind validation samples.
  [['Ibuprofen 400 mg Tablets — validation batch V1', 108], ['Ibuprofen 400 mg Tablets — validation batch V2', 108], ['Ibuprofen 400 mg Tablets — validation batch V3', 109],
    ['Placebo blend (specificity)', 110], ['Spiked placebo 80 / 100 / 120 % (accuracy)', 128], ['Ibuprofen 400 mg Tablets — robustness set', 147]].forEach(([description, day], i) => {
    planSample({
      at: dayAt(day, 10, i * 7), client: 'NWT', project: 'validation', type: 'Drug Product', storage: 'Ambient (15–25 °C)', location: 'Validation cabinet V-1',
      description, batch: `NWT-IBU-${['V1', 'V2', 'V3', 'PLB', 'ACC', 'ROB'][i]}`, clientRef: `VP-NWT-IBU-01/${i + 1}`, quantity: '100 tablets', container: 'HDPE bottle',
      methods: ['ATM-0010'], analyst: { 'ATM-0010': i % 2 ? 'lucia.fernandez' : 'emily.novak' },
    });
  });

  // Bluestone mAb samples for method development.
  [[44, 'BLX-027 Drug Substance — Development lot DL-03'], [96, 'BLX-027 Drug Substance — Engineering run ER-01'], [146, 'BLX-027 Drug Substance — Forced oxidation (0.02 % H₂O₂, 24 h)']].forEach(([day, description], i) => {
    planSample({
      at: dayAt(day, 11), client: 'BLST', project: 'mab', type: 'Drug Substance (API)', storage: 'Deep frozen (−80 °C)', location: 'Freezer F-03 rack 2',
      description, batch: ['DL-03', 'ER-01', 'ER-01-OX'][i], clientRef: `BLST-MD-${i + 1}`, quantity: '6 × 0.5 mL', container: 'Cryovial', methods: ['ATM-0009'],
      analyst: { 'ATM-0009': 'kenji.watanabe' }, delay: i === 2 ? 0 : 1,
    });
  });

  // This week's arrivals — some still waiting to be assigned.
  [[5.5, 'MF5-2690'], [3.2, 'MF10-0412'], [1.4, 'MF5-2691'], [0.12, 'MF5-2692'], [0.08, 'MF10-0413']].forEach(([daysAgo, batch]) => {
    const t = NOW - daysAgo * DAY;
    planSample({
      at: daysAgo < 1 ? t : work(t), client: 'ACME', project: 'release', type: 'Drug Product', storage: 'Ambient (15–25 °C)', location: 'Sample store A — shelf 2',
      description: batch.startsWith('MF10') ? 'Metformin HCl 1000 mg Film-coated Tablets' : 'Metformin HCl 500 mg Film-coated Tablets', batch, clientRef: `ACME-REL-${batch.slice(-4)}`,
      quantity: '2 × 100 tablets', container: 'HDPE bottle', methods: releaseMethods, priority: daysAgo < 1 ? 'Rush' : 'Standard',
    });
  });
  [[2.6, 'Hypromellose 2910 (5 cP)'], [1.1, 'Sodium Starch Glycolate']].forEach(([daysAgo, description], i) => {
    planSample({
      at: work(NOW - daysAgo * DAY), client: 'CNTS', project: 'raw', type: 'Raw Material', storage: 'Ambient (15–25 °C)', location: 'Sample store A — shelf 5',
      description, batch: `RM-${7790 + i}`, clientRef: `CNTS-IR-${3390 + i}`, quantity: '250 g', container: 'Amber glass jar', methods: ['ATM-0006', 'ATM-0008', 'ATM-0002'],
    });
  });
  ['IP-A', 'IP-B'].forEach((batch, i) => {
    planSample({
      at: work(NOW - (2.2 - i * 0.1) * DAY), client: 'NWT', project: 'validation', type: 'Drug Product', storage: 'Ambient (15–25 °C)', location: 'Validation cabinet V-1',
      description: `Ibuprofen 400 mg Tablets — intermediate precision (analyst ${i + 1}, day 2)`, batch: `NWT-IBU-${batch}`, clientRef: `VP-NWT-IBU-01/IP${i + 1}`,
      quantity: '20 tablets', container: 'HDPE bottle', methods: ['ATM-0010'], analyst: { 'ATM-0010': i ? 'emily.novak' : 'lucia.fernandez' },
    });
  });

  // ---------- Instrument events ----------
  on(dayAt(146, 8, 50), () => logInstrument(as('amara.nwosu'), I['ICPMS-01'], {
    kind: 'Repair', description: 'Plasma failed to ignite repeatedly during startup; RF generator fault suspected. Service engineer booked; instrument tagged OUT OF SERVICE.', outcome: 'Fail',
  }));
  on(dayAt(149, 15, 30), () => logInstrument(as('sarah.lindqvist'), I['DISS-02'], {
    kind: 'Preventive Maintenance', description: 'Vendor annual PM in progress: shaft wobble, vessel centring and temperature mapping. Do not use until released.', outcome: 'n/a', status: 'Maintenance',
  }));

  // ---------- Other investigations ----------
  on(dayAt(79, 8, 40), () => {
    const { id } = createInvestigation(as('samuel.mensah'), {
      type: 'Deviation', title: 'Stability chamber SC-02 temperature excursion (42.1 °C for 2 h 10 min)', severity: 'Major', instrument_id: I['SC-02'], project_id: P.stability,
      owner_id: U['priya.raman'].id, description: 'Monitoring system alarm overnight: SC-02 reached 42.1 °C (limit 40 ± 2 °C) between 02:15 and 04:25. Humidity remained within limits. Samples for CX-114 3M accelerated pull were in the chamber.',
    });
    on(dayAt(82, 15), () => updateInvestigation(as('priya.raman'), id, {
      status: 'CAPA', root_cause: 'Failed solenoid valve in the cooling circuit caused overshoot during a defrost cycle.',
      impact: 'Excursion of 2 h 10 min is within the ICH Q1A allowance for short excursions; client informed and agreed no impact on the study.',
      capa: 'Solenoid valve replaced (work order WO-3381). Preventive replacement every 3 years added to SC PM plan.', conclusion: 'No impact on study — excursion within allowance',
    }));
    on(dayAt(86, 11), () => closeInvestigation(as('daniel.okafor'), id, { comment: 'CAPA effectiveness check scheduled at 3 months.' }));
  });
  on(dayAt(118, 10), () => {
    const { id } = createInvestigation(as('priya.raman'), {
      type: 'Client Complaint', title: 'CoA for ACME batch listed incorrect client reference', severity: 'Minor', owner_id: U['helena.weiss'].id,
      due_date: localDate(new Date(dayAt(130))), project_id: P.release,
      description: 'Client reported that a Certificate of Analysis showed the client reference from the previous batch. Results themselves were correct.',
    });
    on(dayAt(121, 14), () => updateInvestigation(as('helena.weiss'), id, { status: 'Under Investigation', root_cause: 'Client reference transcribed from the paper chain-of-custody form at login; copy-paste from the previous row.' }));
  });
  on(dayAt(148, 8, 40), () => createInvestigation(as('ingrid.larsen'), {
    type: 'Lab Incident', title: 'Balance BAL-02 failed daily performance check (200 g check weight)', severity: 'Minor', instrument_id: I['BAL-02'],
    owner_id: U['priya.raman'].id, description: 'Daily check: 200.0012 g displayed for 200 g E2 weight (limit ± 0.0010 g). Balance tagged; weighings moved to BAL-01. Last passing check the previous morning.',
  }));

  // ---------- Notebook ----------
  // docs: [{ filename, content: () => Buffer }] — Word/Excel files worked on before signing; a second
  // content function adds a later version (as if saved again from Excel).
  const note = (day, author, body, { witness, sign = true, project, method, sample, addendum, docs = [] } = {}) => {
    const t0 = dayAt(day, int(9, 16), int(0, 59));
    const tSign = work(t0 + between(2, 7) * HOUR);
    const tWitness = work(Math.max(tSign + 2 * HOUR, t0 + between(20, 60) * HOUR));
    on(t0, () => {
      const { id } = createEntry(as(author), { ...body, project_id: project ? P[project] : null, method_id: method ? M[method].id : null, sample_id: sample || null });
      for (const [k, d] of docs.entries()) {
        const kind = d.filename.endsWith('.xlsx') ? 'xlsx' : 'docx';
        on(t0 + (k + 1) * 20 * 60_000, () => {
          const created = createDocument(as(author), id, { kind, filename: d.filename, content: d.content(), source: 'template' });
          if (d.revised) on(t0 + (k + 1) * 20 * 60_000 + 50 * 60_000, () => addVersion(as(author), get('SELECT d.*, n.status AS entry_status, n.author_id, n.code AS entry_code FROM notebook_documents d JOIN notebook_entries n ON n.id = d.entry_id WHERE d.id = ?', created.id), d.revised(), 'office'));
        });
      }
      if (sign) on(tSign, () => signEntry(as(author), id, {}));
      if (witness) on(tWitness, () => witnessEntry(as(witness), id, {}));
      if (addendum) on(work(t0 + 5 * DAY), () => insert(as(author), 'notebook_addenda', { entry_id: id, author_id: U[author].id, body: addendum, created_at: new Date(work(t0 + 5 * DAY)).toISOString() }, { summary: 'Addendum added' }));
    });
  };
  // Demo Word/Excel files for a few entries (generated, so they open in real Office and LibreOffice).
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1));
  const linearityBook = (withStats) => {
    const levels = [[50, 0.2, 1012455], [80, 0.32, 1619870], [100, 0.4, 2026112], [120, 0.48, 2430980], [150, 0.6, 3038540]];
    const rows = [
      [{ v: 'Ibuprofen assay validation — linearity', b: true }], ['Method ATM-0010 · protocol VP-0010 · HPLC-01'], [],
      ['Level %', 'Conc. (mg/mL)', 'Area 1', 'Area 2', 'Area 3', 'Mean area', 'RSD %'].map((v) => ({ v, b: true })),
      ...levels.map(([lvl, c, a], i) => {
        const r = i + 5;
        const areas = [a - 2113 + i * 311, a + 1460 - i * 97, a + 653 - i * 214];
        return [lvl, { v: c, dp: 3 }, ...areas, { f: `AVERAGE(C${r}:E${r})`, v: mean(areas), dp: 0 }, { f: `STDEV.S(C${r}:E${r})/F${r}*100`, v: (sd(areas) / mean(areas)) * 100, dp: 2 }];
      }),
    ];
    if (withStats) {
      const x = levels.map((l) => l[1]);
      const y = rows.slice(4).map((r) => r[5].v);
      const sxy = x.reduce((t, xi, i) => t + (xi - mean(x)) * (y[i] - mean(y)), 0);
      const sxx = x.reduce((t, xi) => t + (xi - mean(x)) ** 2, 0);
      const slope = sxy / sxx;
      const icpt = mean(y) - slope * mean(x);
      const r = sxy / Math.sqrt(sxx * y.reduce((t, yi) => t + (yi - mean(y)) ** 2, 0));
      rows.push([], [{ v: 'Slope', b: true }, { f: 'SLOPE(F5:F9,B5:B9)', v: slope, dp: 0 }], [{ v: 'Intercept', b: true }, { f: 'INTERCEPT(F5:F9,B5:B9)', v: icpt, dp: 0 }],
        [{ v: 'r', b: true }, { f: 'CORREL(B5:B9,F5:F9)', v: r, dp: 4 }], [{ v: 'Intercept % of 100 %', b: true }, { f: 'ABS(B12)/F7*100', v: (Math.abs(icpt) / y[2]) * 100, dp: 2 }],
        [{ v: 'Acceptance', b: true }, 'r ≥ 0.999; intercept ≤ 2.0 % of the 100 % response']);
    }
    return makeXlsx({ title: 'Linearity', creator: 'Sarah Lindqvist', sheets: [{ name: 'Linearity', cols: [20, 14, 12, 12, 12, 13, 9], rows }] });
  };
  const accuracyBook = () => {
    const rec = { 80: [99.2, 99.9, 99.7], 100: [100.4, 99.9, 100.3], 120: [100.1, 100.9, 100.5] };
    const acc = [['Level %', 'Prep', 'Added (mg)', 'Found (mg)', 'Recovery %'].map((v) => ({ v, b: true }))];
    let r = 2;
    for (const [lvl, reps] of Object.entries(rec)) {
      reps.forEach((x, i) => {
        const added = Number(lvl) * 4;
        acc.push([Number(lvl), i + 1, { v: added, dp: 1 }, { v: (added * x) / 100, dp: 2 }, { f: `D${r}/C${r}*100`, v: x, dp: 1 }]);
        r++;
      });
    }
    acc.push([], [{ v: 'Mean recovery', b: true }, null, null, null, { f: 'AVERAGE(E2:E10)', v: mean(Object.values(rec).flat()), dp: 1 }]);
    const preps = [100.3, 99.6, 100.4, 99.8, 100.1, 100.4];
    const rep = [['Prep', 'Assay %'].map((v) => ({ v, b: true })), ...preps.map((x, i) => [i + 1, { v: x, dp: 1 }]),
      [], [{ v: 'Mean', b: true }, { f: 'AVERAGE(B2:B7)', v: mean(preps), dp: 2 }], [{ v: 'RSD %', b: true }, { f: 'STDEV.S(B2:B7)/B9*100', v: (sd(preps) / mean(preps)) * 100, dp: 2 }], [{ v: 'Criterion', b: true }, 'RSD ≤ 2.0 %']];
    return makeXlsx({ title: 'Accuracy and repeatability', creator: 'Sarah Lindqvist', sheets: [{ name: 'Accuracy', cols: [10, 6, 11, 11, 12], rows: acc }, { name: 'Repeatability', cols: [10, 10], rows: rep }] });
  };
  const standardBook = () => {
    const preps = [[1, 1503210, 1507730], [2, 1506100, 1507620], [3, 1504480, 1507490], [4, 1501860, 1507880], [5, 1507610, 1507610], [6, 1504320, 1507330]];
    const assay = preps.map(([, a, b]) => (a / b) * 100);
    return makeXlsx({ title: 'WS-2026-03 qualification', creator: 'Tom Fletcher', sheets: [{ name: 'Qualification', cols: [8, 14, 14, 12], rows: [
      [{ v: 'Metformin HCl working standard WS-2026-03 vs USP RS R08840', b: true }], [],
      ['Prep', 'Area WS', 'Area RS', 'Assay %'].map((v) => ({ v, b: true })),
      ...preps.map(([n, a, b], i) => [n, a, b, { f: `B${i + 4}/C${i + 4}*100`, v: assay[i], dp: 1 }]),
      [], [{ v: 'Mean', b: true }, null, null, { f: 'AVERAGE(D4:D9)', v: mean(assay), dp: 1 }], [{ v: 'RSD %', b: true }, null, null, { f: 'STDEV.S(D4:D9)/D11*100', v: (sd(assay) / mean(assay)) * 100, dp: 2 }],
    ] }] });
  };
  const peptideDraft = () => makeDocx({ title: 'BLX-027 peptide mapping — method', creator: 'Marco Bianchi', blocks: [
    { heading: 'BLX-027 peptide mapping by LC-MSᴱ', level: 0 }, { p: 'Draft for review · ATM-0009', muted: true },
    { heading: '1. Scope', level: 1 }, { p: 'Identity testing of BLX-027 drug substance and drug product by tryptic peptide mapping.' },
    { heading: '2. Sample preparation', level: 1 },
    { table: [['Step', 'Conditions'], ['Denature', '6 M GuHCl, 30 min, 37 °C'], ['Reduce', '10 mM DTT, 30 min, 37 °C'], ['Alkylate', '25 mM IAM, 30 min, dark'], ['Buffer exchange', 'Zeba 7K into 50 mM Tris pH 7.8'], ['Digest', 'Trypsin 1:20 (w/w), 4 h ± 1 h, 37 °C']] },
    { heading: '3. System suitability', level: 1 }, { p: 'To be agreed: sequence coverage ≥ 95 %; retention time window for marker peptides HC T21, HC T42, LC T5.' },
  ] });

  note(47, 'kenji.watanabe', { title: 'BLX-027 digestion feasibility — trypsin vs Lys-C', tags: 'peptide map, digestion', body: `## Objective\nCompare trypsin and Lys-C digestion of BLX-027 (lot DL-03) for sequence coverage and missed cleavages.\n\n## Conditions\n- Denaturation: 6 M GuHCl, 30 min, 37 °C\n- Reduction: 10 mM DTT, 30 min, 37 °C · Alkylation: 25 mM IAM, 30 min, dark\n- Buffer exchange: Zeba 7K MWCO into 50 mM Tris pH 7.8\n\n## Results\n| Enzyme | E:S | Time | Coverage HC | Coverage LC | Missed cleavages |\n|---|---|---|---|---|---|\n| Trypsin | 1:20 | 4 h | 96.8 % | 100 % | 4.1 % |\n| Lys-C | 1:20 | 4 h | 88.2 % | 97.4 % | 2.0 % |\n| Trypsin | 1:50 | 16 h | 97.1 % | 100 % | 2.9 % |\n\n## Conclusion\nTrypsin 1:20, 4 h selected — coverage comparable to overnight with less deamidation artefact (N-318 deamidation 1.1 % vs 3.4 %).` }, { witness: 'marco.bianchi', project: 'mab', method: 'ATM-0009' });
  note(68, 'kenji.watanabe', { title: 'Column screening for peptide map: CSH C18 vs BEH C18', tags: 'peptide map, column', body: `## Objective\nSelect the column giving best peak capacity for the BLX-027 tryptic map.\n\n| Column | Peak capacity | Hydrophilic peptide retention (T3) | Comments |\n|---|---|---|---|\n| ACQUITY Peptide CSH C18 1.7 µm 2.1×150 | 312 | k' 1.8 | Sharper basic peptides |\n| ACQUITY BEH C18 1.7 µm 2.1×150 | 281 | k' 1.5 | Tailing on HC T42 |\n\nColumn lot used for CSH C18: **0231**.\n\n## Conclusion\nCSH C18 selected for optimisation.` }, { witness: 'sarah.lindqvist', project: 'mab', method: 'ATM-0009', addendum: 'Correction: the CSH C18 column lot used was **0213**, not 0231 (verified against column log COL-0004). No impact on conclusions.' });
  note(93, 'kenji.watanabe', { title: 'Gradient optimisation — 90 min vs 120 min', tags: 'peptide map, gradient', body: `## Runs\n| Gradient | Peaks detected | Co-elutions | Run time |\n|---|---|---|---|\n| 1–35 % B / 90 min | 74 | 3 | 110 min |\n| 1–35 % B / 120 min | 76 | 2 | 140 min |\n\nThe 90-minute gradient resolves all critical pairs except HC T21/T22 (Rs 1.3) — acceptable for identity purposes.\n\n## Decision\nProceed with 90 min gradient (throughput).` }, { witness: 'marco.bianchi', project: 'mab', method: 'ATM-0009' });
  note(141, 'kenji.watanabe', { title: 'Robustness pre-study: digestion time 2 h / 4 h / overnight', tags: 'peptide map, robustness', body: `## Design\nDigestion time varied at 2 h, 4 h (nominal), 16 h; triplicate digests each.\n\n| Time | Coverage (mean, n=3) | Met-255 ox. | N-318 deamid. |\n|---|---|---|---|\n| 2 h | 95.9 % | 1.6 % | 0.8 % |\n| 4 h | 97.2 % | 1.7 % | 1.1 % |\n| 16 h | 97.4 % | 2.4 % | 3.6 % |\n\n## Observations\nOvernight digestion inflates artefactual deamidation; 4 h ± 1 h proposed as the controlled range.` }, { project: 'mab', method: 'ATM-0009' });
  note(148, 'marco.bianchi', { title: 'BLX-027 peptide mapping — method write-up (draft)', tags: 'peptide map, report', body: `## Draft method summary\n- Sample prep: denature / reduce / alkylate / exchange / trypsin 1:20, 4 h\n- Separation: CSH C18, 90 min gradient\n- Detection: MSᴱ, 50–2000 m/z\n\n_TODO: add system suitability criteria (coverage ≥ 95 %, retention time window for marker peptides)._` }, { sign: false, project: 'mab', method: 'ATM-0009', docs: [{ filename: 'BLX-027 peptide mapping method (draft).docx', content: peptideDraft }] });
  note(106, 'sarah.lindqvist', { title: 'Ibuprofen assay validation — specificity & forced degradation', tags: 'validation, specificity', body: `## Forced degradation\n| Condition | Degradation | Peak purity (assay peak) |\n|---|---|---|\n| 0.1 M HCl, 60 °C, 24 h | 3.2 % | Pass |\n| 0.1 M NaOH, 60 °C, 24 h | 8.9 % | Pass |\n| 3 % H₂O₂, RT, 24 h | 5.6 % | Pass |\n| 105 °C, 72 h | 0.4 % | Pass |\n| ICH Q1B light | 1.1 % | Pass |\n\nNo interference from placebo at the ibuprofen retention time.\n\n**Specificity: meets protocol acceptance criteria.**` }, { witness: 'kenji.watanabe', project: 'validation', method: 'ATM-0010' });
  note(117, 'sarah.lindqvist', { title: 'Ibuprofen assay validation — linearity (50–150 %) and range', tags: 'validation, linearity', body: `## Linearity\n| Level | Conc. (mg/mL) | Mean area |\n|---|---|---|\n| 50 % | 0.200 | 1 012 455 |\n| 80 % | 0.320 | 1 619 870 |\n| 100 % | 0.400 | 2 026 112 |\n| 120 % | 0.480 | 2 430 980 |\n| 150 % | 0.600 | 3 038 540 |\n\nr = 0.99998 · y-intercept 0.3 % of 100 % response · residuals random.\n\n**Range 80–120 % confirmed.**\n\nRaw areas and regression: see *Linearity.xlsx* below.` }, { witness: 'marco.bianchi', project: 'validation', method: 'ATM-0010', docs: [{ filename: 'Linearity.xlsx', content: () => linearityBook(false), revised: () => linearityBook(true) }] });
  note(131, 'sarah.lindqvist', { title: 'Ibuprofen assay validation — accuracy and repeatability', tags: 'validation, accuracy', body: `## Accuracy (spiked placebo, n=3 per level)\n| Level | Mean recovery | RSD |\n|---|---|---|\n| 80 % | 99.6 % | 0.4 % |\n| 100 % | 100.2 % | 0.3 % |\n| 120 % | 100.5 % | 0.5 % |\n\n## Repeatability\n6 preparations at 100 %: mean 100.1 %, RSD 0.42 % (criterion ≤ 2.0 %).` }, { project: 'validation', method: 'ATM-0010', docs: [{ filename: 'Accuracy and repeatability.xlsx', content: accuracyBook }] });
  note(119, 'tom.fletcher', { title: 'Preparation and qualification of Metformin working standard WS-2026-03', tags: 'standards', body: `## Material\nMetformin HCl API lot MH-API-2410, 10.0 g, dried 105 °C / 3 h.\n\n## Qualification vs USP RS R08840 (n=6)\n| Prep | Assay vs RS |\n|---|---|\n| 1 | 99.7 % |\n| 2 | 99.9 % |\n| 3 | 99.8 % |\n| 4 | 99.6 % |\n| 5 | 100.0 % |\n| 6 | 99.8 % |\n\nMean **99.8 %**, RSD 0.14 %. Assigned potency 99.8 %; expiry 6 months.` }, { witness: 'sarah.lindqvist', docs: [{ filename: 'WS-2026-03 qualification.xlsx', content: standardBook }] });
  note(149, 'lucia.fernandez', { title: 'HPLC-02 system suitability failure — notes', tags: 'troubleshooting, HPLC-02', body: `Run 20261001-SEQ014: tailing factor 2.3 for metformin (limit ≤ 2.0).\n\nActions so far:\n1. Replaced guard cartridge — tailing 2.1\n2. Fresh mobile phase prepared (pH re-checked 3.86) — tailing 2.1\n\n_Next: flush column, check for void; consider replacing column COL-0001._` }, { sign: false });

  // ---------- Invoicing: month-end billing of completed work + method-development milestones ----------
  for (let m = 1; m <= 6; m++) {
    const d = new Date(START);
    d.setMonth(d.getMonth() + m, 1);
    d.setHours(10, 0, 0, 0);
    let t = work(+d);
    for (let k = 0; k < 4; k++) t = work(t + DAY);
    if (t > NOW) break;
    on(t, () => {
      const projects = all(`SELECT DISTINCT s.project_id AS id FROM tests t JOIN samples s ON s.id = t.sample_id WHERE t.status = 'Approved' AND t.invoice_id IS NULL AND s.project_id IS NOT NULL`);
      for (const p of projects) {
        const { id } = createInvoice(as('oliver.grant'), { project_id: p.id, include_unbilled: 1 });
        setInvoiceStatus(as('oliver.grant'), id, 'issue');
        const terms = get('SELECT c.payment_terms_days d FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?', id).d;
        const paidAt = work(t + (terms + between(-12, 14)) * DAY);
        if (paidAt < NOW - 2 * DAY) on(paidAt, () => setInvoiceStatus(as('oliver.grant'), id, 'paid'));
      }
    });
  }
  const milestone = (day, description, amount, paidAfter) => on(dayAt(day, 11), () => {
    const { id } = createInvoice(as('oliver.grant'), { project_id: P.mab, include_unbilled: 0 });
    run('INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, sort_order) VALUES (?, ?, 1, ?, 0)', id, description, amount);
    setInvoiceStatus(as('oliver.grant'), id, 'issue');
    if (paidAfter && dayAt(day) + paidAfter * DAY < NOW) on(work(dayAt(day) + paidAfter * DAY), () => setInvoiceStatus(as('oliver.grant'), id, 'paid'));
  });
  milestone(75, 'Milestone 1 — Feasibility: digestion and column screening (protocol DP-BLST-027-01 §6.1)', 14500, 40);
  milestone(128, 'Milestone 2 — Method optimisation: gradient and digestion conditions (§6.2)', 16000, null);

  // ==================== Client portal demo (BEGIN) ====================
  // Three client contacts with portal access (password demo1234), conversations, sample submissions in each
  // state and method-work requests — enough for both the client portal and the staff inbox to look lived-in.
  const PU = {};
  const portalAs = (key) => ({ user: { id: null, username: `portal:${PU[key].email}`, full_name: PU[key].full_name }, ip: '203.0.113.24' });
  const portalUser = (key) => get('SELECT * FROM portal_users WHERE id = ?', PU[key].id);
  const thread = (client, subject, sampleId = null) => createThread({ client_id: C[client], subject, sample_id: sampleId });
  const say = (id, who, body) => postMessage(id, who.startsWith('pu:') ? { portalUser: portalUser(who.slice(3)), body } : { user: U[who], body });
  on(dayAt(40, 11), () => {
    for (const [key, client, email, full_name, job_title] of [
      ['acme', 'ACME', 'customer@example.com', 'Dr. Laura Chen', 'QC Release Manager'],
      ['blst', 'BLST', 'felix.romero@bluestone-bio.example', 'Dr. Felix Romero', 'Director, Analytical Sciences'],
      ['nwt', 'NWT', 'hannah.schultz@northwind-tx.example', 'Hannah Schultz', 'CMC Lead'],
    ]) {
      const { id } = createPortalAccount(as('grace.holloway'), { client_id: C[client], email, full_name, job_title }, 'demo1234');
      PU[key] = { id, email, full_name };
    }
  });
  // A finished conversation and one where the lab has just replied (unread for the client).
  on(dayAt(112, 9, 40), () => {
    const t = thread('ACME', 'Rush slot for batch MF-2611?');
    say(t, 'pu:acme', 'Hi Priya,\nWe have a market shortage on 500 mg and need batch MF-2611 released as fast as possible. Is a rush slot available next week?\n\nThanks, Laura');
    setClock(new Date(work(dayAt(112, 14, 5))));
    say(t, 'priya.raman', 'Hi Laura,\nYes — book it as Rush when you submit and we will run assay, dissolution and water on receipt day. Expect the CoA within 2 working days.\n\nPriya');
    setClock(new Date(work(dayAt(112, 15, 20))));
    say(t, 'pu:acme', 'Perfect, thank you. Shipping tomorrow on priority overnight.');
  });
  on(dayAt(146, 10, 15), () => {
    const t = thread('ACME', 'Updated specification SPEC-MF500-07 rev. 8');
    say(t, 'pu:acme', 'Please note that from next month the related-substances limit for impurity B tightens to NMT 0.15 %. Revised spec attached to our quality agreement portal; can you confirm you will apply rev. 8 to batches received after 1 November?');
    setClock(new Date(work(dayAt(146, 16, 2))));
    say(t, 'daniel.okafor', 'Thank you, Laura. QA has reviewed rev. 8; we will update the specification limits in ATM-0001 under change control CC-2026-019 and apply them to all batches received from 1 November. We will confirm here once the change is effective.');
  });
  // Submission received by the lab — creates real samples through normal receiving.
  on(dayAt(146, 9, 5), () => {
    const sub = submitSamples(portalAs('acme'), portalUser('acme'), {
      project_id: P.release, sample_type: 'Drug Product', priority: 'Standard', storage: 'Ambient (15–25 °C)', courier: 'FedEx Priority Overnight', tracking_no: '7745 2210 9931', ship_date: localDate(new Date(dayAt(146))),
      samples: [
        { description: 'Metformin HCl 500 mg Tablets', batch_no: 'MF-2614', client_ref: 'ACME-REL-2614', quantity: '2 × 100 tablets', container: 'HDPE bottle' },
        { description: 'Metformin HCl 500 mg Tablets', batch_no: 'MF-2615', client_ref: 'ACME-REL-2615', quantity: '2 × 100 tablets', container: 'HDPE bottle' },
      ],
      method_ids: [M['ATM-0001'].id, M['ATM-0004'].id, M['ATM-0002'].id],
    });
    setClock(new Date(work(dayAt(146, 11, 30))));
    acknowledgeSubmission(as('priya.raman'), sub.id, 'Thanks Laura — slot booked for receipt tomorrow morning.');
    setClock(new Date(work(dayAt(147, 9, 10))));
    receiveSubmission(as('nadia.rossi'), sub.id, { condition: 'Acceptable', location: 'Sample store A · Shelf 2', received_at: new Date(work(dayAt(147, 9, 10))).toISOString() });
  });
  // Shipment announced and acknowledged, still in transit.
  on(dayAt(148, 15, 30), () => {
    const sub = submitSamples(portalAs('acme'), portalUser('acme'), {
      project_id: P.release, sample_type: 'Drug Product', priority: 'Rush', storage: 'Ambient (15–25 °C)', courier: 'UPS Next Day Air', tracking_no: '1Z 999 AA1 01 2345 6784', ship_date: localDate(new Date(dayAt(149))),
      notes: 'Batch MF-2618 is needed for a tender — rush please, as agreed with Priya.',
      samples: [{ description: 'Metformin HCl 500 mg Tablets', batch_no: 'MF-2618', client_ref: 'ACME-REL-2618', quantity: '2 × 100 tablets', container: 'HDPE bottle' }],
      method_ids: [M['ATM-0001'].id, M['ATM-0004'].id],
    });
    setClock(new Date(work(dayAt(149, 9, 20))));
    acknowledgeSubmission(as('priya.raman'), sub.id, 'Rush confirmed. We will start testing on receipt.');
  });
  // New this morning — waiting for the lab.
  on(NOW - 3 * HOUR, () => {
    submitSamples(portalAs('nwt'), portalUser('nwt'), {
      project_id: P.validation, sample_type: 'Drug Product', priority: 'Standard', storage: 'Ambient, protect from light', courier: 'DHL Express', tracking_no: 'JD014600006281',
      samples: [
        { description: 'Ibuprofen 400 mg Tablets — forced degradation (acid)', batch_no: 'IBU-V-221', client_ref: 'FD-ACID', quantity: '30 tablets', container: 'Amber glass vial' },
        { description: 'Ibuprofen 400 mg Tablets — forced degradation (oxidative)', batch_no: 'IBU-V-221', client_ref: 'FD-OX', quantity: '30 tablets', container: 'Amber glass vial' },
        { description: 'Ibuprofen 400 mg Tablets — placebo blend', batch_no: 'PLB-0410', client_ref: 'FD-PLB', quantity: '20 g', container: 'Amber glass jar' },
      ],
      notes: 'Forced-degradation samples for the specificity part of the ATM-0010 validation (protocol VP-IBU-01 §5.2). Please test per the protocol.',
      method_ids: [],
    });
  });
  // Method-work requests: one with a proposal, one accepted (project opened earlier), one new.
  on(dayAt(138, 10, 0), () => {
    const req = submitRequest(portalAs('acme'), portalUser('acme'), {
      type: 'Method validation', title: 'Metformin HCl ER 750 mg — dissolution method validation', product: 'Metformin HCl Extended-Release Tablets 750 mg', technique: 'Dissolution',
      parameters: ['Specificity', 'Linearity', 'Accuracy', 'Repeatability', 'Intermediate precision', 'Robustness', 'Solution stability'],
      scope: 'USP Apparatus 1 (baskets), 100 rpm, pH 6.8 phosphate buffer, 1, 3, 6 and 10 h time points with UV finish. Method was developed in-house at ACME; we need a full validation to ICH Q2(R2) to support a site change.',
      regulatory: 'Registration (NDA / MAA)', target_date: localDate(new Date(NOW + 70 * DAY)),
    });
    setClock(new Date(work(dayAt(139, 14, 0))));
    respondToRequest(as('sarah.lindqvist'), req.id, { status: 'Under review', response: 'Thanks Laura. Could you send the development report and the current method SOP? We will also need 3 batches including one at the lower end of the release range.' });
    setClock(new Date(work(dayAt(141, 10, 30))));
    say(get('SELECT id FROM portal_threads WHERE request_id = ?', req.id).id, 'pu:acme', 'Development report DR-ER750-02 and SOP QC-DIS-031 uploaded to our shared folder. Batches ER-0912, ER-0915 and ER-0921 are available.');
    setClock(new Date(work(dayAt(145, 15, 0))));
    respondToRequest(as('grace.holloway'), req.id, { status: 'Proposal sent', response: 'Proposal Q-2026-044 is on its way by email: protocol in 1 week, execution 3 weeks, report 1 week from protocol approval — fits your target date. Fixed price, three milestones.' });
  });
  on(NOW - 26 * HOUR, () => {
    submitRequest(portalAs('blst'), portalUser('blst'), {
      type: 'Method development', title: 'BLX-031 bispecific — charge variant method (icIEF or CEX)', product: 'BLX-031 bispecific antibody', technique: 'Other',
      scope: 'Need a stability-indicating charge variant method for early-phase release and stability. Open to icIEF or CEX-HPLC — recommendation welcome. Approx. 40 mg of reference material available.',
      regulatory: 'Clinical (IND / IMPD)', target_date: localDate(new Date(NOW + 120 * DAY)),
    });
  });
  // ==================== Client portal demo (END) ====================

  // ---------- Run the timeline ----------
  events.sort((a, b) => a.t - b.t || a.seq - b.seq);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.t > NOW) continue;
    if (e.chain && (e.chain.dead || e.chain.parent?.dead)) continue;
    setClock(new Date(e.t));
    const queued = events.length;
    try {
      e.fn();
    } catch (err) {
      if (e.chain) e.chain.dead = true;
      warnings.push(`${new Date(e.t).toISOString()} ${err.message}`);
    }
    // Events may schedule follow-ups; keep the rest of the queue in time order.
    if (events.length > queued) {
      const rest = events.splice(i + 1).sort((a, b) => a.t - b.t || a.seq - b.seq);
      events.push(...rest);
    }
  }
  setClock(null);
  resetSettingsCache();
  if (warnings.length && process.env.ALIQUOT_DEBUG_SEED) console.warn(`Demo data: ${warnings.length} skipped steps\n  ${warnings.join('\n  ')}`);
  return { warnings };
}
