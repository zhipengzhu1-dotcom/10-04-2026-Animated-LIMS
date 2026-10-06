// Controlled vocabularies shared by the API and the UI (served at /api/lookups).


export const ROLES = {
  admin: { label: 'Administrator', description: 'User accounts and system settings. Does not sign lab data.' },
  manager: { label: 'Lab Manager', description: 'Runs the lab: assigns work, reviews and approves, billing.' },
  qa: { label: 'Quality Assurance', description: 'Approves results and methods, closes investigations, issues CoAs.' },
  scientist: { label: 'Senior Scientist', description: 'Method development, testing and peer review.' },
  analyst: { label: 'Analyst', description: 'Receives samples, performs tests, keeps the notebook.' },
  business: { label: 'Business & Finance', description: 'Clients, projects, quotes and invoices.' },
};

// Which roles may do what. Segregation of duties: whoever performs a test can never review or approve it.
export const PERMISSIONS = {
  'samples.receive': ['admin', 'manager', 'scientist', 'analyst'],
  'samples.edit': ['admin', 'manager', 'scientist', 'analyst'],
  'samples.dispose': ['admin', 'manager', 'qa'],
  'tests.assign': ['manager', 'scientist'],
  'tests.perform': ['manager', 'scientist', 'analyst'],
  'tests.review': ['manager', 'scientist', 'qa'],
  'tests.approve': ['manager', 'qa'],
  'tests.cancel': ['manager'],
  'reports.issue': ['manager', 'qa'],
  'methods.edit': ['manager', 'scientist'],
  'methods.approve': ['manager', 'qa'],
  'instruments.edit': ['admin', 'manager', 'scientist'],
  'instruments.log': ['admin', 'manager', 'scientist', 'analyst', 'qa'],
  'inventory.edit': ['admin', 'manager', 'scientist', 'analyst'],
  'inventory.release': ['manager', 'qa'],
  'notebook.write': ['manager', 'scientist', 'analyst', 'qa'],
  'notebook.witness': ['manager', 'scientist', 'qa'],
  'investigations.raise': ['manager', 'scientist', 'analyst', 'qa'],
  'investigations.close': ['manager', 'qa'],
  'clients.edit': ['admin', 'manager', 'business'],
  'projects.edit': ['admin', 'manager', 'business', 'scientist'],
  'billing.view': ['admin', 'manager', 'business'],
  'billing.edit': ['admin', 'manager', 'business'],
  'insights.view': ['admin', 'manager', 'qa', 'business'],
  'users.manage': ['admin'],
  'qualifications.manage': ['admin', 'manager', 'qa'],
  'audit.view': ['admin', 'manager', 'qa'],
  // Removing a file someone else attached; anyone may remove their own while the record allows it.
  'attachments.remove': ['admin', 'manager'],
  'settings.edit': ['admin'],
  // Sees every work queue (Worklist, Reviews & approvals, Workload) without being able to act on it.
  'work.oversee': ['admin'],
  // Client portal: everyone in the lab can read it; replying and progressing requests is for client-facing roles.
  'portal.view': ['admin', 'manager', 'qa', 'scientist', 'analyst', 'business'],
  'portal.respond': ['manager', 'qa', 'scientist', 'business'],
  'portal.manage': ['admin', 'manager', 'business'],
};

export const rolesWith = (perm) => PERMISSIONS[perm] || [];

export const PROJECT_TYPES = ['Method Development', 'Method Validation', 'Method Transfer', 'Routine / Release Testing', 'Stability Study', 'Reference Standard Characterisation', 'Other'];
export const PROJECT_STATUSES = ['Quoted', 'Active', 'On Hold', 'Completed', 'Cancelled'];

export const TECHNIQUES = ['HPLC-UV', 'UPLC-UV', 'LC-MS', 'GC-FID', 'GC-Headspace', 'GC-MS', 'ICP-MS', 'ICP-OES', 'Karl Fischer', 'UV-Vis', 'FTIR', 'Dissolution', 'pH / Potentiometry', 'Titration', 'Gravimetric', 'TOC', 'Particle Size', 'Physical / Visual', 'Other'];
export const METHOD_STATUSES = ['Draft', 'In Development', 'In Validation', 'Effective', 'Retired'];
export const METHOD_USABLE = ['In Development', 'In Validation', 'Effective'];

export const INSTRUMENT_TYPES = ['HPLC', 'UPLC', 'LC-MS', 'GC', 'GC-MS', 'ICP-MS', 'ICP-OES', 'Karl Fischer Titrator', 'Autotitrator', 'UV-Vis Spectrophotometer', 'FTIR Spectrometer', 'Dissolution Bath', 'Analytical Balance', 'pH Meter', 'TOC Analyser', 'Particle Size Analyser', 'Stability Chamber', 'Refrigerator / Freezer', 'Other'];
export const INSTRUMENT_STATUSES = ['Available', 'In Use', 'Maintenance', 'Out of Service', 'Retired'];
export const INSTRUMENT_LOG_KINDS = ['Calibration', 'Preventive Maintenance', 'Repair', 'Qualification (IQ/OQ/PQ)', 'Performance Check', 'Note'];

export const INVENTORY_CATEGORIES = {
  'Reference Standard': 'STD',
  'Working Standard': 'WS',
  Reagent: 'RGT',
  Solvent: 'SOL',
  Column: 'COL',
  Consumable: 'CON',
};
export const INVENTORY_STATUSES = ['Active', 'Quarantine', 'Consumed', 'Disposed'];

export const SAMPLE_TYPES = ['Drug Substance (API)', 'Drug Product', 'Excipient', 'Raw Material', 'In-Process', 'Stability', 'Reference Material', 'Cleaning Swab / Rinse', 'Other'];
export const STORAGE_CONDITIONS = ['Ambient (15–25 °C)', 'Refrigerated (2–8 °C)', 'Frozen (−20 °C)', 'Deep frozen (−80 °C)', 'Ambient, protect from light'];
export const PRIORITIES = ['Standard', 'Rush', 'Urgent'];
export const RECEIPT_CONDITIONS = ['Acceptable', 'Damaged container', 'Temperature excursion', 'Insufficient quantity', 'Labelling discrepancy'];
export const SAMPLE_STATUSES = ['Received', 'In Testing', 'In Review', 'Approved', 'Reported', 'Cancelled', 'Disposed'];
export const SAMPLE_OPEN = ['Received', 'In Testing', 'In Review', 'Approved'];
export const CUSTODY_ACTIONS = ['Moved', 'Removed for testing', 'Returned to storage', 'Aliquoted', 'Returned to client', 'Disposed'];

export const TEST_STATUSES = ['Pending', 'In Progress', 'Submitted', 'Reviewed', 'Approved', 'Cancelled'];

export const INVESTIGATION_TYPES = { OOS: 'OOS', OOT: 'OOT', Deviation: 'DEV', 'Lab Incident': 'INC', 'Client Complaint': 'CC' };
export const INVESTIGATION_STATUSES = ['Open', 'Under Investigation', 'CAPA', 'Closed'];
export const SEVERITIES = ['Minor', 'Major', 'Critical'];
export const OOS_CONCLUSIONS = ['Confirmed OOS — result valid', 'Invalidated — assignable laboratory error', 'Inconclusive — escalated to client', 'Not applicable'];

export const INVOICE_STATUSES = ['Draft', 'Sent', 'Paid', 'Void'];

// Every e-signature's meaning, keyed by the signed action. `meaning` is what the signature row stores (never change
// one: signed records and exact-string queries depend on it); `explanation` is shown beneath it in the signing dialog.
export const SIGNATURE_MEANINGS = {
  'test.submit': { meaning: 'Performed', explanation: 'Results are complete and accurate' },
  'test.review.accept': { meaning: 'Reviewed', explanation: 'Results verified against raw data' },
  'test.review.return': { meaning: 'Returned by reviewer', explanation: 'Results are not accepted and go back to the analyst to correct and resubmit' },
  'test.approve.accept': { meaning: 'Approved', explanation: 'Approved for release' },
  'test.approve.reject': { meaning: 'Rejected at approval', explanation: 'Results are not approved for release and go back to the analyst to correct and resubmit' },
  'sample.coa.issue': { meaning: 'Certificate of Analysis issued', explanation: 'The certificate is released to the client and the sample is locked' },
  'notebook.author': { meaning: 'Authored', explanation: 'Entry is complete and accurate' },
  'notebook.witness': { meaning: 'Witnessed', explanation: 'I have read and understood this entry' },
  'method.approve': { meaning: 'Approved for use', explanation: 'Method approved for GMP use' },
  'method.retire': { meaning: 'Retired', explanation: 'Method retired; it can no longer be used for new tests' },
  'investigation.close.oos': { meaning: 'OOS investigation closed', explanation: 'Investigation reviewed and closed' },
  'investigation.close': { meaning: 'Closed', explanation: 'Investigation reviewed and closed' },
};

// Who may see a record type's files and history (null = any signed-in user). Who may change its files is the record's `attach` rule.
export const RECORD_ACCESS = {
  samples: { view: null },
  tests: { view: null },
  methods: { view: null },
  notebook_entries: { view: null },
  investigations: { view: null },
  instruments: { view: null },
  inventory: { view: null },
  projects: { view: null },
  clients: { view: null },
  invoices: { view: ['billing.view'] },
  users: { view: ['audit.view', 'users.manage'] },
  qualifications: { view: ['audit.view', 'qualifications.manage'] },
  attachments: { view: null },
};

// Money fields hidden from history for people without billing access.
export const MONEY_FIELDS = ['budget', 'price', 'unit_price', 'lines', 'tax_rate', 'invoice_id'];

export function lookups() {
  return {
    roles: ROLES,
    testPerformerRoles: rolesWith('tests.perform'),
    projectTypes: PROJECT_TYPES,
    projectStatuses: PROJECT_STATUSES,
    techniques: TECHNIQUES,
    methodStatuses: METHOD_STATUSES,
    instrumentTypes: INSTRUMENT_TYPES,
    instrumentStatuses: INSTRUMENT_STATUSES,
    instrumentLogKinds: INSTRUMENT_LOG_KINDS,
    inventoryCategories: Object.keys(INVENTORY_CATEGORIES),
    inventoryStatuses: INVENTORY_STATUSES,
    sampleTypes: SAMPLE_TYPES,
    storageConditions: STORAGE_CONDITIONS,
    priorities: PRIORITIES,
    receiptConditions: RECEIPT_CONDITIONS,
    sampleStatuses: SAMPLE_STATUSES,
    custodyActions: CUSTODY_ACTIONS,
    testStatuses: TEST_STATUSES,
    investigationTypes: Object.keys(INVESTIGATION_TYPES),
    investigationStatuses: INVESTIGATION_STATUSES,
    severities: SEVERITIES,
    oosConclusions: OOS_CONCLUSIONS,
    invoiceStatuses: INVOICE_STATUSES,
    signatureMeanings: SIGNATURE_MEANINGS,
  };
}
