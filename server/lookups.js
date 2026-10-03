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
  'settings.edit': ['admin'],
  // Client portal: everyone in the lab can read it; replying and progressing requests is for client-facing roles.
  'portal.view': ['admin', 'manager', 'qa', 'scientist', 'analyst', 'business'],
  'portal.respond': ['manager', 'qa', 'scientist', 'business'],
  'portal.manage': ['admin', 'manager', 'business'],
};

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
export const TEST_OPEN = ['Pending', 'In Progress', 'Submitted', 'Reviewed'];

export const INVESTIGATION_TYPES = { OOS: 'OOS', OOT: 'OOT', Deviation: 'DEV', 'Lab Incident': 'INC', 'Client Complaint': 'CC' };
export const INVESTIGATION_STATUSES = ['Open', 'Under Investigation', 'CAPA', 'Closed'];
export const SEVERITIES = ['Minor', 'Major', 'Critical'];
export const OOS_CONCLUSIONS = ['Confirmed OOS — result valid', 'Invalidated — assignable laboratory error', 'Inconclusive — escalated to client', 'Not applicable'];

export const INVOICE_STATUSES = ['Draft', 'Sent', 'Paid', 'Void'];

export const ATTACHABLE = ['samples', 'tests', 'methods', 'notebook_entries', 'investigations', 'instruments', 'inventory', 'projects', 'clients', 'invoices'];

// Who may see a record type's files/history (null = any signed-in user) and who may add files to it; a Withheld `module` hides both.
export const RECORD_ACCESS = {
  samples: { view: null, edit: ['samples.edit'] },
  tests: { view: null, edit: ['tests.perform', 'tests.assign'] },
  methods: { view: null, edit: ['methods.edit'] },
  notebook_entries: { view: null, edit: ['notebook.write'] },
  investigations: { view: null, edit: ['investigations.raise', 'investigations.close'], module: 'investigations' },
  instruments: { view: null, edit: ['instruments.log'] },
  inventory: { view: null, edit: ['inventory.edit'] },
  projects: { view: null, edit: ['projects.edit'] },
  clients: { view: null, edit: ['clients.edit'] },
  invoices: { view: ['billing.view'], edit: ['billing.edit'] },
  users: { view: ['audit.view', 'users.manage'], edit: [] },
  qualifications: { view: ['audit.view', 'qualifications.manage'], edit: [] },
  attachments: { view: null, edit: [] },
};

// Money fields hidden from history for people without billing access.
export const MONEY_FIELDS = ['budget', 'price', 'unit_price', 'lines', 'tax_rate', 'invoice_id'];

export function lookups() {
  return {
    roles: ROLES,
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
  };
}
