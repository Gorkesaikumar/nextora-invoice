import { z } from 'zod';
import { isKnownStateCode } from './states.js';

export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') { super(message); this.status = status; this.code = code; }
}
export const assert = (condition, status, message, code) => {
  if (!condition) throw new HttpError(status, message, code);
};

/* ---------------------------------------------------------------- primitives */

export const uuid = z.string().uuid();
const clean = (max = 160) => z.string().trim().max(max)
  .refine(v => !/[\u0000-\u001f\u007f]/u.test(v), 'Control characters are not allowed');
const multiline = (max = 4000) => z.string().trim().max(max)
  .refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v), 'Control characters are not allowed');
const required = (max = 160) => clean(max).refine(v => v.length > 0, 'Required');
const optional = (max = 160) => clean(max).default('');
const email = z.string().trim().toLowerCase().max(254)
  .refine(v => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v), 'Enter a valid email address');
export const password = z.string().min(12).max(128);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '2000-01-01' && v < '2100-01-01';
}, 'Invalid date');

/** Money is always an integer count of minor units (paise). Never a float. */
export const minorUnits = z.number().int().min(0).max(1e13);
export const signedMinorUnits = z.number().int().min(-1e13).max(1e13);
/** Tax rates, percentages and milestone shares are integer basis points (1800 = 18%). */
export const basisPoints = z.number().int().min(0).max(10000);
/** Quantities allow three decimal places, stored as integer thousandths. */
export const quantityMilli = z.number().int().min(0).max(1e12);

export const stateCode = z.string().regex(/^\d{2}$/).refine(isKnownStateCode.bind(null), 'Unknown Indian state code');
export const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN format');
export const hsnSac = z.string().trim().toUpperCase().regex(/^\d{4}(\d{2})?(\d{2})?$/, 'HSN/SAC must be 4, 6 or 8 digits');
export const currency = z.literal('INR');

export const TAX_TREATMENTS = ['TAXABLE', 'EXEMPT', 'NIL_RATED', 'NON_GST', 'OUT_OF_SCOPE'];
export const taxTreatment = z.enum(TAX_TREATMENTS);
export const SUPPLY_TYPES = ['INTRA', 'INTER'];
export const INTERVALS = ['NONE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'];
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'OTHER'];

export const ROUNDING_MODES = ['NEAREST_RUPEE', 'NONE'];

/* -------------------------------------------------------------------- shared */

export const lineItemSchema = z.object({
  product_id: uuid.nullable().default(null),
  description: required(400),
  category: optional(80),
  hsn_sac: z.union([hsnSac, z.literal('')]).default(''),
  unit: required(16).default('NOS'),
  quantity_milli: quantityMilli.refine(v => v > 0, 'Quantity must be greater than zero'),
  unit_price_minor: minorUnits,
  discount_bp: basisPoints.default(0),
  discount_minor: minorUnits.default(0),
  tax_rate_bp: basisPoints.default(1800),
  tax_treatment: taxTreatment.default('TAXABLE'),
}).strict().refine(i => !(i.discount_bp > 0 && i.discount_minor > 0),
  'Use either a percentage discount or a fixed discount, not both')
  .refine(i => i.tax_treatment === 'TAXABLE' || i.tax_rate_bp === 0,
    'Only taxable items may carry a tax rate');

export const additionalChargeSchema = z.object({
  label: required(80),
  amount_minor: minorUnits,
  tax_rate_bp: basisPoints.default(0),
  tax_treatment: taxTreatment.default('TAXABLE'),
}).strict();

export const milestoneSchema = z.object({
  title: required(120),
  description: multiline(1000).default(''),
  share_bp: basisPoints.default(0),
  amount_minor: minorUnits.default(0),
  due_offset_days: z.number().int().min(0).max(3650).default(0),
}).strict();

/* ----------------------------------------------------------------- customers */

export const clientSchema = z.object({
  kind: z.enum(['BUSINESS', 'INDIVIDUAL']),
  name: required(160),
  company_name: optional(160),
  contact_person: optional(120),
  email: z.union([email, z.literal('')]).default(''),
  phone: optional(32),
  billing_address: multiline(600).default(''),
  service_address: multiline(600).default(''),
  gstin: z.union([gstin, z.literal('')]).default(''),
  state_code: z.union([stateCode, z.literal('')]).default(''),
  country: required(80).default('India'),
  notes: multiline(2000).default(''),
  payment_terms_days: z.number().int().min(0).max(365).default(15),
  gst_registered: z.boolean().default(false),
}).strict().refine(c => !c.gst_registered || c.gstin.length > 0,
  'A GST-registered client needs a GSTIN')
  .refine(c => c.gstin.length === 0 || c.state_code.length > 0,
    'Provide the state code that matches the GSTIN');

/* ------------------------------------------------------------------- catalog */

export const productSchema = z.object({
  name: required(160),
  sku: optional(48),
  description: multiline(2000).default(''),
  category: optional(80),
  unit: required(16).default('NOS'),
  unit_price_minor: minorUnits,
  tax_treatment: taxTreatment.default('TAXABLE'),
  tax_rate_bp: basisPoints.default(1800),
  hsn_sac: z.union([hsnSac, z.literal('')]).default(''),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  billing_interval: z.enum(INTERVALS).default('NONE'),
  license_duration_months: z.number().int().min(0).max(600).default(0),
  validity_notes: multiline(500).default(''),
}).strict().refine(p => p.tax_treatment === 'TAXABLE' || p.tax_rate_bp === 0,
  'Only taxable items may carry a tax rate');

/* ---------------------------------------------------------------- quotations */

const draftBody = {
  description: multiline(4000).default(''),
  scope_of_work: multiline(4000).default(''),
  inclusions: multiline(4000).default(''),
  exclusions: multiline(4000).default(''),
  assumptions: multiline(4000).default(''),
  warranty_terms: multiline(2000).default(''),
  delivery_timeline: multiline(1000).default(''),
  notes: multiline(2000).default(''),
  terms: multiline(4000).default(''),
  issue_date: day,
  expiry_date: day.nullable().default(null),
  due_date: day.nullable().default(null),
  place_of_supply_state_code: z.union([stateCode, z.literal('')]).default(''),
  payment_terms_days: z.number().int().min(0).max(365).default(15),
  payment_terms: multiline(1000).default(''),
  po_reference: optional(80),
  project_reference: optional(120),
  invoice_discount_bp: basisPoints.default(0),
  invoice_discount_minor: minorUnits.default(0),
  round_off_enabled: z.boolean().default(true),
  items: z.array(lineItemSchema).max(200).default([]),
  additional_charges: z.array(additionalChargeSchema).max(20).default([]),
  milestones: z.array(milestoneSchema).max(20).default([]),
};

// Refinements are applied to the built object rather than extended afterwards,
// so every rule travels with the schema it belongs to.
const draftRules = schema => schema
  .refine(d => !(d.invoice_discount_bp > 0 && d.invoice_discount_minor > 0),
    'Use either a percentage or a fixed invoice-level discount')
  .refine(d => !d.expiry_date || d.expiry_date >= d.issue_date, 'Expiry cannot precede the issue date')
  .refine(d => !d.due_date || d.due_date >= d.issue_date, 'Due date cannot precede the issue date')
  .refine(d => d.items.length > 0, 'Add at least one line item');

export const quotationDraftSchema = draftRules(z.object({
  ...draftBody, client_id: uuid, title: required(160),
}).strict());

export const invoiceDraftSchema = draftRules(z.object({
  ...draftBody, client_id: uuid, title: optional(160).default(''),
}).strict());

/* -------------------------------------------------------------------- actions */

export const statusActionSchema = z.object({ note: optional(500) }).strict();
export const rejectSchema = z.object({ reason: required(500) }).strict();
export const cancelSchema = z.object({ reason: required(500) }).strict();
export const convertSchema = z.object({
  issue_date: day,
  due_date: day.nullable().default(null),
  items: z.array(lineItemSchema).max(200).optional(),
}).strict();

export const paymentSchema = z.object({
  amount_minor: minorUnits.refine(v => v > 0, 'Enter a payment amount'),
  paid_on: day,
  method: z.enum(PAYMENT_METHODS),
  reference: optional(120),
  notes: multiline(1000).default(''),
}).strict();

export const creditNoteSchema = z.object({
  reason: required(500),
  issue_date: day,
  items: z.array(lineItemSchema).max(200).default([]),
  notes: multiline(1000).default(''),
}).strict();

/* ------------------------------------------------------------------- settings */

export const settingsSchema = z.object({
  business_name: required(160),
  legal_name: optional(160),
  address: multiline(600).default(''),
  email: z.union([email, z.literal('')]).default(''),
  phone: optional(32),
  website: optional(200),
  gstin: z.union([gstin, z.literal('')]).default(''),
  state_code: z.union([stateCode, z.literal('')]).default(''),
  pan: z.union([z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN format'), z.literal('')]).default(''),
  bank_account_name: optional(160),
  bank_account_number: optional(40),
  bank_ifsc: z.union([z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format'), z.literal('')]).default(''),
  bank_name: optional(160),
  bank_branch: optional(160),
  upi_id: optional(120),
  signatory_name: optional(120),
  signatory_title: optional(120),
  default_quotation_validity_days: z.number().int().min(1).max(365).default(30),
  default_payment_terms_days: z.number().int().min(0).max(365).default(15),
  default_currency: currency.default('INR'),
  rounding_mode: z.enum(ROUNDING_MODES).default('NEAREST_RUPEE'),
  default_tax_rate_bp: basisPoints.default(1800),
  reverse_charge: z.boolean().default(false),
  quotation_prefix: required(12).default('NC/QTN'),
  invoice_prefix: required(12).default('NC/INV'),
  receipt_prefix: required(12).default('NC/RCP'),
  credit_note_prefix: required(12).default('NC/CRN'),
  terms: multiline(4000).default(''),
  quotation_terms: multiline(4000).default(''),
  pdf_accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour such as #00AEEF').default('#00AEEF'),
  show_bank_details: z.boolean().default(true),
  show_signatory: z.boolean().default(true),
  show_amount_in_words: z.boolean().default(true),
}).strict().refine(s => !s.gstin || s.state_code.length > 0, 'Provide the business state code alongside the GSTIN');

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
}).strict();

export const registerSchema = z.object({
  display_name: required(120),
  email,
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
  confirm_password: z.string().min(1, 'Confirm your password').max(128),
}).strict().refine(data => data.password === data.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});

export const recoverSchema = z.object({
  email,
  recovery_key: z.string().trim().min(6, 'Enter the recovery key').max(128),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
  confirm_password: z.string().min(1, 'Confirm your password').max(128),
}).strict().refine(data => data.password === data.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  password,
}).strict();

/* ------------------------------------------------------------ pos customers */

export const FIELD_TYPES = ['TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'DROPDOWN',
  'MULTI_SELECT', 'CHECKBOX', 'URL', 'EMAIL', 'PHONE'];
export const fieldType = z.enum(FIELD_TYPES);
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'TRIAL'];
export const ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'];

/**
 * Every tracker column, default or custom, is described by one of these keys.
 * The API, the exports and the public share all build their output from this
 * list, so a column that is not listed can never leak into a payload.
 */
export const DEFAULT_COLUMNS = [
  { key: 'serial', label: 'S.No.', type: 'SERIAL', width: 80, editable: false, required: false },
  { key: 'name', label: 'Customer Name', type: 'TEXT', width: 200, editable: true, required: true },
  { key: 'business_name', label: 'Customer Business Name', type: 'TEXT', width: 200, editable: true, required: false },
  { key: 'address', label: 'Address', type: 'LONG_TEXT', width: 280, editable: true, required: false },
  { key: 'employee_name', label: 'Employee Assigned', type: 'EMPLOYEE', width: 170, editable: true, required: false },
  { key: 'purchase_date', label: 'Date of Purchase', type: 'DATE', width: 150, editable: true, required: false },
  { key: 'product_name', label: 'Product', type: 'PRODUCT', width: 190, editable: true, required: false },
  { key: 'plan_label', label: 'Subscription', type: 'SUBSCRIPTION', width: 160, editable: true, required: false },
  { key: 'expiry_date', label: 'Date of Expiry', type: 'DATE', width: 150, editable: true, required: false },
  { key: 'remarks', label: 'Remarks', type: 'LONG_TEXT', width: 260, editable: true, required: false },
];
export const DEFAULT_COLUMN_KEYS = DEFAULT_COLUMNS.map(column => column.key);
export const columnKey = z.string().regex(/^(custom:[0-9a-f-]{36}|[a-z_]+)$/, 'Unknown column');

const phone = z.string().trim().max(24)
  .refine(v => v.length === 0 || /^[+0-9][0-9\s-()]{5,23}$/.test(v), 'Enter a valid phone number');

export const employeeSchema = z.object({
  name: required(120), email: z.union([email, z.literal('')]).default(''),
  user_id: uuid.nullable().default(null), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
}).strict();

export const planSchema = z.object({
  label: required(80), duration_months: z.number().int().min(0).max(600).default(12),
  is_lifetime: z.boolean().default(false), status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  notes: optional(400), position: z.number().int().min(0).max(999).default(0),
}).strict().refine(p => p.is_lifetime === (p.duration_months === 0), 'A lifetime plan has no duration; a dated plan needs one');

/**
 * The spreadsheet edits one row, which carries the customer's current
 * subscription. Reused by the subscription endpoints so a purchase, a renewal
 * and an inline edit can never disagree about what is valid.
 */
export const subscriptionSchema = z.object({
  product_id: uuid.nullable().default(null), plan_id: uuid.nullable().default(null),
  plan_label: optional(80), purchase_date: day, start_date: day.nullable().default(null),
  expiry_date: day.nullable().default(null), is_lifetime: z.boolean().default(false),
  status: z.enum(SUBSCRIPTION_STATUSES).default('ACTIVE'), amount_minor: minorUnits.nullable().default(null),
  transaction_reference: optional(120), notes: multiline(600).default(''), renews: z.boolean().default(false),
}).strict().refine(s => s.is_lifetime || s.expiry_date, 'Provide an expiry date, or mark the plan as lifetime')
  .refine(s => !s.is_lifetime || !s.expiry_date, 'A lifetime plan cannot have an expiry date');

export const posCustomerSchema = z.object({
  name: required(160), business_name: optional(200), address: multiline(600).default(''),
  employee_id: uuid.nullable().default(null), email: z.union([email, z.literal('')]).default(''),
  phone: phone.default(''), remarks: multiline(2000).default(''), client_id: uuid.nullable().default(null),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  subscription: subscriptionSchema.nullable().default(null),
}).strict();

export const customFieldSchema = z.object({
  label: required(60), field_type: fieldType, description: multiline(400).default(''),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  default_value: optional(200), position: z.number().int().min(0).max(999).default(0),
  visible: z.boolean().default(true), width: z.number().int().min(80).max(600).default(160),
  editor_roles: z.array(z.enum(ROLES)).min(1).max(4).default(['OWNER', 'ADMIN']),
}).strict()
  .refine(f => !['DROPDOWN', 'MULTI_SELECT'].includes(f.field_type) || f.options.length > 0,
    'Add at least one option for a dropdown field')
  .refine(f => !['DROPDOWN', 'MULTI_SELECT'].includes(f.field_type)
    || new Set(f.options.map(o => o.toLowerCase())).size === f.options.length, 'Dropdown options must be unique');

/** Custom values arrive as strings from a spreadsheet grid and are validated by type. */
export const customValuesSchema = z.object({
  values: z.array(z.object({ definition_id: uuid, value: z.string().max(4000) }).strict()).max(200),
}).strict();

export const columnOrderSchema = z.object({
  columns: z.array(z.object({ key: columnKey, width: z.number().int().min(80).max(600).default(160),
    visible: z.boolean().default(true) }).strict()).min(1).max(300),
}).strict();

/* ----------------------------------------------------------------- shares */

const shareBase = {
  title: required(120), scope_all: z.boolean().default(false),
  customer_ids: z.array(uuid).max(5000).default([]),
  columns: z.array(columnKey).min(1).max(300),
  allow_search: z.boolean().default(true), allow_filter: z.boolean().default(true),
  allow_download: z.boolean().default(false),
  expires_at: z.string().datetime({ offset: true }).nullable().default(null),
};

const shareScope = schema => schema.refine(s => s.scope_all || s.customer_ids.length > 0,
  'Choose every customer or select the customers to share')
  .refine(s => s.expires_at === null || new Date(s.expires_at) > new Date(), 'Expiry must be in the future');

export const privateShareSchema = shareScope(z.object({
  ...shareBase,
  recipients: z.array(email).min(1).max(200),
}).strict());

export const publicShareSchema = shareScope(z.object({
  ...shareBase,
  confirm_public: z.literal(true),
  password: z.string().min(8).max(128).nullable().default(null),
}).strict());

export const shareUpdateSchema = z.object({
  title: required(120).optional(), can_view: z.boolean().optional(), can_download: z.boolean().optional(),
  columns: z.array(columnKey).min(1).max(300).optional(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(), revoked: z.boolean().optional(),
}).strict();

export const importApplySchema = z.object({
  filename: required(200), content_base64: z.string().min(1).max(8000000),
  mapping: z.record(z.string().max(200), z.string().max(200)).default({}),
  default_product_id: uuid.nullable().default(null), default_plan_id: uuid.nullable().default(null),
  update_existing: z.boolean().default(false), skip_duplicates: z.boolean().default(true),
}).strict();

export const importPreviewSchema = z.object({
  filename: required(200), content_base64: z.string().min(1).max(8000000),
}).strict();

/* ---------------------------------------------------------------- cleanup */

export const cleanupPreviewSchema = z.object({
  category: z.enum(['QUOTATIONS', 'INVOICES']),
  filter_type: z.enum(['ALL', 'DATE_RANGE', 'IDS']).default('ALL'),
  from_date: day.nullable().default(null),
  to_date: day.nullable().default(null),
  selected_ids: z.array(uuid).default([]),
}).strict();

export const cleanupExportSchema = z.object({
  category: z.enum(['QUOTATIONS', 'INVOICES']),
  ids: z.array(uuid).min(1, 'Select at least one record to export'),
  destination_dir: z.string().trim().max(1024).nullable().default(null),
}).strict();

export const cleanupExecuteSchema = z.object({
  category: z.enum(['QUOTATIONS', 'INVOICES']),
  ids: z.array(uuid).min(1, 'Select at least one record to delete'),
  verification_token: z.string().trim().min(1, 'Verification token is required'),
  confirmation_phrase: z.string().trim().min(1, 'Confirmation phrase is required'),
  backup_dir: z.string().trim().max(1024).nullable().default(null),
}).strict();
