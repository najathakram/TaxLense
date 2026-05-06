// Seed data + helpers for the TaxLens prototype.
const fmtUSD = (n, opts = {}) => {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 });
  return `${sign}$${s}`;
};
const fmtNum = (n) => n == null ? '—' : n.toLocaleString('en-US');
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};
const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};
const relTime = (d) => {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms/60000), h = Math.floor(ms/3600000), days = Math.floor(ms/86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
};

// Deterministic initials color
const avatarHue = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
};
const initials = (name) => name.split(/\s+/).slice(0,2).map(p => p[0]).join('').toUpperCase();

// ────────────────────────────────────────────────────────────
// Personas
const ADMIN = {
  id: 'u_admin_01', name: 'Anthropic Operator', email: 'ops@anthropic.com', role: 'SUPER_ADMIN'
};

const CPAS = [
  { id: 'cpa_najath', name: 'Najath Akram', email: 'najath@taxlens.app', firm: 'Akram Tax Co.',
    clients: 12, locked: 7, deductionsYTD: 318420, lastLogin: '2026-05-06T08:14:00Z',
    lastAction: '2026-05-06T11:42:00Z', status: 'active', joined: '2024-11-02' },
  { id: 'cpa_sara_m', name: 'Sara Mendoza', email: 'sara.m@mendozacpa.com', firm: 'Mendoza CPA',
    clients: 24, locked: 18, deductionsYTD: 642100, lastLogin: '2026-05-06T07:01:00Z',
    lastAction: '2026-05-06T10:18:00Z', status: 'active', joined: '2024-08-21' },
  { id: 'cpa_dlee', name: 'Daniel Lee', email: 'dan@leefiduciary.io', firm: 'Lee Fiduciary',
    clients: 8, locked: 5, deductionsYTD: 192340, lastLogin: '2026-05-05T22:33:00Z',
    lastAction: '2026-05-05T23:11:00Z', status: 'active', joined: '2025-01-14' },
  { id: 'cpa_kpark', name: 'K. Park', email: 'k@parkadvisory.com', firm: 'Park Advisory',
    clients: 31, locked: 24, deductionsYTD: 891230, lastLogin: '2026-05-06T09:55:00Z',
    lastAction: '2026-05-06T11:01:00Z', status: 'active', joined: '2024-06-04' },
  { id: 'cpa_rgreen', name: 'R. Green', email: 'rgreen@greenbooks.co', firm: 'Greenbooks',
    clients: 6, locked: 4, deductionsYTD: 122100, lastLogin: '2026-04-12T18:00:00Z',
    lastAction: '2026-04-12T19:21:00Z', status: 'active', joined: '2025-03-30' },
  { id: 'cpa_mlo', name: 'Marisol Lobo', email: 'mlobo@loboaudit.net', firm: 'Lobo Audit',
    clients: 17, locked: 11, deductionsYTD: 432900, lastLogin: '2026-05-06T06:40:00Z',
    lastAction: '2026-05-06T07:55:00Z', status: 'active', joined: '2024-12-12' },
  { id: 'cpa_torres', name: 'J. Torres', email: 'jt@torresfiscal.com', firm: 'Torres Fiscal',
    clients: 0, locked: 0, deductionsYTD: 0, lastLogin: '2026-05-06T10:32:00Z',
    lastAction: '2026-05-06T10:32:00Z', status: 'active', joined: '2026-05-06' },
  { id: 'cpa_anwar', name: 'Z. Anwar', email: 'z@anwartax.com', firm: 'Anwar Tax',
    clients: 3, locked: 0, deductionsYTD: 0, lastLogin: '2026-02-04T14:22:00Z',
    lastAction: '2026-02-05T11:08:00Z', status: 'inactive', joined: '2025-09-10' },
];

// Najath's clients (the impersonation-target CPA)
const CLIENTS_NAJATH = [
  { id: 'cli_atif', name: 'Atif Khan', email: 'atif.khan@example.com',
    naics: '711510', industry: 'Independent Artist', state: 'TX', entity: 'Sole Prop', method: '§471(c) cash',
    blockers: 3, stops: 4 },
  { id: 'cli_sara', name: 'Sara Mendoza', email: 'sara.m.dba@example.com',
    naics: '541330', industry: 'Engineering Consulting', state: 'CA', entity: 'SMLLC', method: 'Cash',
    blockers: 0, stops: 14 },
  { id: 'cli_marcus', name: 'Marcus Liu', email: 'marcus.liu@studio.io',
    naics: '541430', industry: 'Graphic Design', state: 'NY', entity: 'Sole Prop', method: 'Cash',
    blockers: 0, stops: 0 },
  { id: 'cli_priya', name: 'Priya Shah', email: 'priya@shahdental.com',
    naics: '621210', industry: 'Dental Practice', state: 'IL', entity: 'SMLLC', method: 'Accrual',
    blockers: 1, stops: 6 },
  { id: 'cli_devon', name: 'Devon Reyes', email: 'devon@reyesfit.co',
    naics: '713940', industry: 'Personal Training', state: 'FL', entity: 'Sole Prop', method: 'Cash',
    blockers: 0, stops: 2 },
  { id: 'cli_hana', name: 'Hana Yoshida', email: 'hana@yoshidaceramics.com',
    naics: '327110', industry: 'Ceramics Studio', state: 'OR', entity: 'Sole Prop', method: 'Cash',
    blockers: 2, stops: 9 },
  { id: 'cli_omar', name: 'Omar Haddad', email: 'omar@haddadphoto.com',
    naics: '541921', industry: 'Photography', state: 'CO', entity: 'Sole Prop', method: 'Cash',
    blockers: 0, stops: 0 },
  { id: 'cli_jessa', name: 'Jessa Whitman', email: 'jessa@wcontent.studio',
    naics: '711510', industry: 'Content Creator', state: 'WA', entity: 'SMLLC', method: 'Cash',
    blockers: 0, stops: 1 },
];

// year-status matrix per client (2023..2026)
const YEARS_GRID = {
  cli_atif:   { 2023: { status: 'LOCKED', receipts: 74000, deductions: 38200, net: 35800, risk: 9,  lockedAt: '2024-04-14' },
                2024: { status: 'LOCKED', receipts: 86420, deductions: 42310, net: 44110, risk: 12, lockedAt: '2025-03-31' },
                2025: { status: 'REVIEW', receipts: 21797, deductions: 40891, net: -19094, risk: 1, lockedAt: null },
                2026: null },
  cli_sara:   { 2023: { status: 'LOCKED', receipts: 198400, deductions: 71200, net: 127200, risk: 4, lockedAt: '2024-04-02' },
                2024: { status: 'LOCKED', receipts: 221340, deductions: 88940, net: 132400, risk: 7, lockedAt: '2025-03-28' },
                2025: { status: 'REVIEW', receipts: 244210, deductions: 102310, net: 141900, risk: 6, lockedAt: null },
                2026: null },
  cli_marcus: { 2023: { status: 'LOCKED', receipts: 68000, deductions: 22100, net: 45900, risk: 3, lockedAt: '2024-04-09' },
                2024: { status: 'LOCKED', receipts: 91200, deductions: 31200, net: 60000, risk: 5, lockedAt: '2025-04-01' },
                2025: { status: 'REVIEW',   receipts: 104300, deductions: 38400, net: 65900, risk: 2, lockedAt: null },
                2026: null },
  cli_priya:  { 2023: { status: 'LOCKED', receipts: 488200, deductions: 211900, net: 276300, risk: 6, lockedAt: '2024-04-12' },
                2024: { status: 'LOCKED', receipts: 521400, deductions: 232100, net: 289300, risk: 8, lockedAt: '2025-04-04' },
                2025: { status: 'INGESTION', receipts: 0, deductions: 0, net: 0, risk: 0, lockedAt: null },
                2026: null },
  cli_devon:  { 2023: { status: 'LOCKED', receipts: 42000, deductions: 14200, net: 27800, risk: 2, lockedAt: '2024-04-15' },
                2024: { status: 'LOCKED', receipts: 58210, deductions: 19410, net: 38800, risk: 3, lockedAt: '2025-04-09' },
                2025: { status: 'REVIEW', receipts: 72400, deductions: 24800, net: 47600, risk: 4, lockedAt: null },
                2026: null },
  cli_hana:   { 2023: { status: 'LOCKED', receipts: 31200, deductions: 11900, net: 19300, risk: 5, lockedAt: '2024-04-22' },
                2024: { status: 'REVIEW', receipts: 38900, deductions: 15400, net: 23500, risk: 11, lockedAt: null },
                2025: { status: 'INGESTION', receipts: 0, deductions: 0, net: 0, risk: 0, lockedAt: null },
                2026: null },
  cli_omar:   { 2023: { status: 'LOCKED', receipts: 92000, deductions: 41200, net: 50800, risk: 4, lockedAt: '2024-04-08' },
                2024: { status: 'LOCKED', receipts: 110300, deductions: 48800, net: 61500, risk: 6, lockedAt: '2025-04-03' },
                2025: { status: 'CREATED', receipts: 0, deductions: 0, net: 0, risk: 0, lockedAt: null },
                2026: null },
  cli_jessa:  { 2023: { status: 'LOCKED', receipts: 121000, deductions: 32100, net: 88900, risk: 3, lockedAt: '2024-04-11' },
                2024: { status: 'LOCKED', receipts: 188200, deductions: 49100, net: 139100, risk: 5, lockedAt: '2025-04-02' },
                2025: { status: 'REVIEW', receipts: 211800, deductions: 58200, net: 153600, risk: 4, lockedAt: null },
                2026: null },
};

// Inbox items across all clients
const INBOX = [
  { sev: 'BLOCKER', client: 'cli_atif',  year: 2024, kind: 'unclassified-deposits',
    msg: '3 unclassified deposits ($12,340)', target: 'stops', age: '2h ago' },
  { sev: 'BLOCKER', client: 'cli_priya', year: 2025, kind: 'missing-statements',
    msg: '4 statements missing — Q1/Q2 coverage gaps', target: 'coverage', age: '4h ago' },
  { sev: 'BLOCKER', client: 'cli_hana',  year: 2024, kind: 'parse-fail',
    msg: 'PDF parse failed — Wells Fargo 2024-08', target: 'upload', age: '1d ago' },
  { sev: 'PENDING', client: 'cli_sara',  year: 2025, kind: 'stops',
    msg: '14 STOPs awaiting review', target: 'stops', age: '6h ago' },
  { sev: 'PENDING', client: 'cli_atif',  year: 2025, kind: 'stops',
    msg: '4 STOPs awaiting review', target: 'stops', age: '2h ago' },
  { sev: 'PENDING', client: 'cli_hana',  year: 2024, kind: 'stops',
    msg: '9 STOPs awaiting review', target: 'stops', age: '1d ago' },
  { sev: 'PENDING', client: 'cli_devon', year: 2025, kind: 'stops',
    msg: '2 STOPs awaiting review — both gray-zone meals', target: 'stops', age: '3d ago' },
  { sev: 'READY', client: 'cli_marcus',  year: 2024, kind: 'ready-to-lock',
    msg: 'Risk score green (5/100). Ready to lock.', target: 'lock', age: '1d ago' },
  { sev: 'READY', client: 'cli_jessa',   year: 2024, kind: 'ready-to-lock',
    msg: 'Risk green (3/100). 0 STOPs. Ready to lock.', target: 'lock', age: '5h ago' },
  { sev: 'DEADLINE', client: 'cli_sara', year: 2025, kind: 'q3-est',
    msg: 'Q3 estimated tax due in 6 days', target: 'overview', age: 'today' },
  { sev: 'DEADLINE', client: 'cli_priya', year: 2025, kind: 'engagement',
    msg: 'Engagement letter signature pending — 2 days', target: 'documents', age: 'today' },
];

// STOPs for Atif 2025
const STOPS_ATIF_2025 = [
  { id: 'st_1', cat: 'DEPOSIT', state: 'OPEN', acct: 'Chase 4421',
    date: '2025-03-12', amount: 4200.00, payer: 'ACH CREDIT — STRIPE TRANSFER',
    q: 'Is this a customer payment, a refund, or owner contribution?',
    options: ['Receipts (gross sales)', 'Refund/return reversal', 'Owner contribution (not income)'] },
  { id: 'st_2', cat: 'DEPOSIT', state: 'OPEN', acct: 'Chase 4421',
    date: '2025-04-02', amount: 6140.00, payer: 'ZELLE FROM J. WHITMAN',
    q: 'Personal loan repayment, gift, or business income?',
    options: ['Receipts (gross sales)', 'Loan repayment (no income)', 'Gift (not income)'] },
  { id: 'st_3', cat: 'MEAL', state: 'OPEN', acct: 'Chase Sapphire 0091',
    date: '2025-02-19', amount: 184.20, payer: 'IL FORNAIO PALO ALTO',
    q: 'Business meal — who attended and what was discussed?',
    options: ['Client meeting (50% deductible)', 'Solo working meal (not deductible)', 'Internal team meal (50%)'] },
  { id: 'st_4', cat: 'MEAL', state: 'OPEN', acct: 'Chase Sapphire 0091',
    date: '2025-02-28', amount: 92.50, payer: 'BLUE BOTTLE COFFEE — SF',
    q: 'Client meeting or personal? §274(d) attendee documentation needed.',
    options: ['Client meeting (50%)', 'Personal (not deductible)'] },
  { id: 'st_5', cat: 'TRAVEL', state: 'RESOLVED', acct: 'Amex 3007',
    date: '2025-01-14', amount: 412.30, payer: 'UNITED AIRLINES',
    q: 'Business trip purpose for travel deduction?',
    options: ['Resolved — Austin client visit, 2 nights, primary purpose business'] },
  { id: 'st_6', cat: 'PAYROLL', state: 'RESOLVED', acct: 'Chase 4421',
    date: '2025-03-31', amount: 1820.00, payer: 'GUSTO PAYROLL',
    q: 'Contractor or employee compensation?',
    options: ['Resolved — Contractor (1099-NEC issued)'] },
];

// Ledger sample for Atif 2025 (subset)
const LEDGER_ATIF_2025 = [
  { date: '2025-01-04', acct: 'Chase 4421',         memo: 'STRIPE TRANSFER',                debit: 0,    credit: 3120.00, code: '4000', cat: 'Receipts',         deductible: 0,    confidence: 1.0 },
  { date: '2025-01-08', acct: 'Chase Sapphire 0091', memo: 'ADOBE CREATIVE CLOUD',          debit: 89.99,credit: 0,       code: '7140', cat: 'Software/Subs',    deductible: 89.99, confidence: 1.0 },
  { date: '2025-01-12', acct: 'Amex 3007',           memo: 'UBER 2.4 mi PALO ALTO→SFO',     debit: 24.40,credit: 0,       code: '6320', cat: 'Travel',           deductible: 24.40, confidence: 0.94 },
  { date: '2025-01-14', acct: 'Amex 3007',           memo: 'UNITED AIRLINES SFO→AUS',       debit: 412.30,credit: 0,      code: '6310', cat: 'Travel',           deductible: 412.30, confidence: 1.0 },
  { date: '2025-01-22', acct: 'Chase Sapphire 0091', memo: 'COSTCO #491 SUNNYVALE',         debit: 138.22,credit: 0,      code: '????', cat: '— STOP —',         deductible: 0, confidence: 0.42 },
  { date: '2025-02-03', acct: 'Chase 4421',          memo: 'PG&E E-PAY',                    debit: 184.10,credit: 0,      code: '8121', cat: 'Util — home off.', deductible: 55.23, confidence: 0.88 },
  { date: '2025-02-19', acct: 'Chase Sapphire 0091', memo: 'IL FORNAIO PALO ALTO',          debit: 184.20,credit: 0,      code: '????', cat: '— STOP — meal',    deductible: 0, confidence: 0.31 },
  { date: '2025-02-22', acct: 'Chase 4421',          memo: 'STRIPE TRANSFER',                debit: 0,   credit: 5240.00, code: '4000', cat: 'Receipts',         deductible: 0, confidence: 1.0 },
  { date: '2025-03-01', acct: 'Chase 4421',          memo: 'STATE FARM AUTO INS',           debit: 142.00,credit: 0,      code: '6700', cat: 'Vehicle — std mi', deductible: 0, confidence: 1.0, note: 'Std mileage method' },
  { date: '2025-03-12', acct: 'Chase 4421',          memo: 'ACH CREDIT — STRIPE TRANSFER',   debit: 0,  credit: 4200.00, code: '????', cat: '— STOP —',         deductible: 0, confidence: 0.55 },
  { date: '2025-03-15', acct: 'Chase Sapphire 0091', memo: 'B&H PHOTO — STUDIO LIGHTS',     debit: 1240.00,credit: 0,    code: '5500', cat: 'Equipment',        deductible: 1240.00, confidence: 1.0, note: 'De minimis §1.263(a)-1(f)' },
  { date: '2025-03-18', acct: 'Amex 3007',           memo: 'AT&T WIRELESS',                 debit: 92.40,credit: 0,       code: '8120', cat: 'Phone',            deductible: 73.92, confidence: 0.92, note: '80% biz-use' },
  { date: '2025-03-22', acct: 'Chase 4421',          memo: 'OFFICE DEPOT — TONER',          debit: 218.40,credit: 0,      code: '7100', cat: 'Office supplies',  deductible: 218.40, confidence: 1.0 },
  { date: '2025-03-31', acct: 'Chase 4421',          memo: 'GUSTO PAYROLL',                  debit: 1820.00,credit: 0,    code: '6100', cat: 'Contract labor',   deductible: 1820.00, confidence: 1.0 },
  { date: '2025-04-02', acct: 'Chase 4421',          memo: 'ZELLE FROM J. WHITMAN',         debit: 0,   credit: 6140.00, code: '????', cat: '— STOP —',         deductible: 0, confidence: 0.40 },
  { date: '2025-04-08', acct: 'Chase Sapphire 0091', memo: 'CANVA PRO ANNUAL',              debit: 119.99,credit: 0,      code: '7140', cat: 'Software/Subs',    deductible: 119.99, confidence: 1.0 },
  { date: '2025-04-12', acct: 'Chase Sapphire 0091', memo: 'NAMECHEAP DOMAIN',              debit: 14.88,credit: 0,       code: '7140', cat: 'Software/Subs',    deductible: 14.88, confidence: 1.0 },
  { date: '2025-04-19', acct: 'Amex 3007',           memo: 'LYFT — 1.1 mi MISSION→SOMA',     debit: 12.84,credit: 0,      code: '6320', cat: 'Travel',           deductible: 12.84, confidence: 0.94 },
  { date: '2025-04-22', acct: 'Chase 4421',          memo: 'STRIPE TRANSFER',                debit: 0,  credit: 3187.00, code: '4000', cat: 'Receipts',         deductible: 0, confidence: 1.0 },
  { date: '2025-04-30', acct: 'Chase Sapphire 0091', memo: 'BLUE BOTTLE COFFEE — SF',       debit: 92.50,credit: 0,       code: '????', cat: '— STOP — meal',   deductible: 0, confidence: 0.28 },
];

// Documents for Atif
const DOCS_ATIF = [
  { id: 'd1', cat: 'Tax forms issued', title: '1099-NEC issued — Acme LLC',  year: 2025, tags: ['issued','contractor'], by: 'Najath', at: '2026-03-12', size: '184 KB' },
  { id: 'd2', cat: 'Tax forms issued', title: '1099-NEC issued — Park Studios', year: 2025, tags: ['issued','contractor'], by: 'Najath', at: '2026-03-12', size: '162 KB' },
  { id: 'd3', cat: 'Tax forms received', title: '1099-K from Stripe',       year: 2025, tags: ['1099-K','processor'], by: 'Atif',   at: '2026-02-04', size: '94 KB' },
  { id: 'd4', cat: 'Tax forms received', title: '1099-NEC from Galleria SF',year: 2025, tags: ['1099-NEC'],            by: 'Atif',   at: '2026-01-29', size: '88 KB' },
  { id: 'd5', cat: 'Engagement & legal', title: 'Engagement Letter — 2025', year: 2025, tags: ['signed','engagement'], by: 'Najath', at: '2026-02-01', size: '320 KB' },
  { id: 'd6', cat: 'Engagement & legal', title: 'Form 8879 — 2024',         year: 2024, tags: ['e-file','signed'],     by: 'Najath', at: '2025-04-01', size: '124 KB' },
  { id: 'd7', cat: 'Engagement & legal', title: 'Prior year return — 2023', year: 2023, tags: ['return','PDF'],        by: 'Atif',   at: '2024-12-04', size: '2.1 MB' },
  { id: 'd8', cat: 'IRS correspondence', title: 'IRS CP2000 (2023)',         year: 2023, tags: ['notice','sensitive'], by: 'Atif',   at: '2026-01-09', size: '412 KB', sensitive: true },
  { id: 'd9', cat: 'Receipts',         title: 'Il Fornaio receipt — Feb 19', year: 2025, tags: ['§274(d)','meal'],    by: 'Atif',   at: '2025-02-19', size: '74 KB', linkedTxn: 'IL FORNAIO 2/19' },
  { id: 'd10', cat: 'Receipts',        title: 'B&H Photo invoice — Mar 15',  year: 2025, tags: ['equipment'],         by: 'Atif',   at: '2025-03-15', size: '210 KB' },
  { id: 'd11', cat: 'Statements',      title: 'Chase 4421 — 2025-03',        year: 2025, tags: ['bank','PDF'],         by: 'Atif',   at: '2025-04-04', size: '1.4 MB' },
  { id: 'd12', cat: 'Statements',      title: 'Amex 3007 — 2025-03',         year: 2025, tags: ['credit','PDF'],       by: 'Atif',   at: '2025-04-06', size: '880 KB' },
];

// Audit events for Atif 2025
const AUDIT_ATIF_2025 = [
  { ts: '2026-05-06T11:42:00Z', actor: { type: 'USER', cpa: 'Najath Akram', user: 'Atif Khan' }, event: 'STOP_RESOLVED', entity: 'StopItem #st_5', diff: { state: 'OPEN → RESOLVED', resolution: 'Travel — Austin client visit' }, rationale: 'Client confirmed primary purpose business; 2 nights, 3 days; receipts attached.' },
  { ts: '2026-05-06T11:38:00Z', actor: { type: 'USER', cpa: 'Najath Akram', user: 'Atif Khan' }, event: 'CLASSIFICATION_OVERRIDE', entity: 'Txn 2025-03-18 AT&T', diff: { code: '????→8120', deductible: '0→73.92' }, rationale: '80% business-use phone per §262 allocation memo.' },
  { ts: '2026-05-06T10:14:00Z', actor: { type: 'AI',   model: 'sonnet-4.6', cpa: 'Najath Akram' }, event: 'STOP_RAISED', entity: 'Txn 2025-04-02 ZELLE', diff: null, rationale: 'Inbound Zelle from non-customer, ambiguous narration; raised for clarification.' },
  { ts: '2026-05-05T16:02:00Z', actor: { type: 'USER', cpa: 'Najath Akram', user: 'Atif Khan' }, event: 'DOCUMENT_LINKED', entity: 'Receipt d9 → Txn IL FORNAIO 2/19', diff: null, rationale: 'Substantiation linked per §274(d); attendee names captured.' },
  { ts: '2026-05-05T15:48:00Z', actor: { type: 'AI',   model: 'haiku-4.5', cpa: 'Najath Akram' }, event: 'PDF_NORMALIZE', entity: 'Statement Chase 4421 2025-03', diff: { lines: 47 }, rationale: 'Cleanup pass; no fabrications, columns: date, memo, amt.' },
  { ts: '2026-05-04T09:11:00Z', actor: { type: 'USER', cpa: 'Najath Akram', user: 'Atif Khan' }, event: 'STATEMENT_UPLOADED', entity: 'Chase 4421 2025-03', diff: null, rationale: 'Manual upload via /upload.' },
  { ts: '2026-05-03T20:00:00Z', actor: { type: 'SYSTEM' }, event: 'PIPELINE_STARTED', entity: 'TaxYear cli_atif/2025', diff: { steps: 9 }, rationale: 'Triggered by upload event.' },
  { ts: '2026-05-03T20:08:00Z', actor: { type: 'AI', model: 'sonnet-4.6', cpa: 'Najath Akram' }, event: 'CLASSIFICATION_BATCH', entity: '23 transactions', diff: { auto: 19, stop: 4 }, rationale: 'Routine batch — 4 raised to STOPs, 0 fabrications.' },
];

// Recent activity (admin/cross-firm)
const ADMIN_RECENT = [
  { ts: '2026-05-06T11:42:00Z', cpa: 'Najath Akram', event: 'STOP_RESOLVED', detail: 'Atif Khan / 2025 — st_5' },
  { ts: '2026-05-06T10:18:00Z', cpa: 'Sara Mendoza', event: 'YEAR_LOCKED',  detail: 'Vega Cycling / 2024' },
  { ts: '2026-05-06T09:55:00Z', cpa: 'K. Park',      event: 'PIPELINE_STARTED', detail: 'Henley LLC / 2025' },
  { ts: '2026-05-06T08:14:00Z', cpa: 'Najath Akram', event: 'LOGIN', detail: 'IP 73.x.x.x' },
  { ts: '2026-05-06T07:55:00Z', cpa: 'Marisol Lobo', event: 'CLASSIFICATION_BATCH', detail: 'Pereira Studio / 2025 (41)' },
  { ts: '2026-05-06T07:01:00Z', cpa: 'Sara Mendoza', event: 'LOGIN', detail: 'IP 67.x.x.x' },
];

// Admin "needs attention"
const ADMIN_ALERTS = [
  { sev: 'warn', title: 'PARSE_FAIL spike', detail: 'Najath / 2 imports failed in last 24h', target: 'audit' },
  { sev: 'info', title: 'NEW_CPA onboarded', detail: 'J. Torres signed up 1h ago — first onboard not yet started', target: 'cpas' },
  { sev: 'mute', title: 'LOGIN_INACTIVE', detail: '3 CPAs not logged in for 90+ days', target: 'cpas' },
  { sev: 'warn', title: 'Cookie collision', detail: 'taxlens_admin_ctx + taxlens_client_ctx overlap detected (1 session)', target: 'audit' },
];

Object.assign(window, {
  fmtUSD, fmtNum, fmtDate, fmtDateTime, relTime, avatarHue, initials,
  ADMIN, CPAS, CLIENTS_NAJATH, YEARS_GRID,
  INBOX, STOPS_ATIF_2025, LEDGER_ATIF_2025, DOCS_ATIF, AUDIT_ATIF_2025,
  ADMIN_RECENT, ADMIN_ALERTS,
});
