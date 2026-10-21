// שכבת הנתונים של מודול התקציב (החלטה 023, מיגרציה 044).
//
// שתי שכבות:
//   קבצים  — budget_cards, budget_transactions, budget_orders, meitar_*: קריאה בלבד;
//            רק הסוכן כותב אותן.
//   משתמש  — budget_card_meta, budget_card_plans, budget_order_notes,
//            meitar_topic_plans, budget_card_files: נשמרות מכאן ואינן נדרסות.
//
// כל שמירה מחזירה את השורה מהשרת, והמסך מציג **אותה** (מלכודת 26). שורה
// שלא חזרה = ה-RLS חסם (מלכודת 21) — זורקים שגיאה ולא מעמידים פנים.
import { supabase } from './supabase'
import { fetchAll } from './bagrut'
import { step, storageSafeName, type ScopeOption } from './admin'

export const BUDGET_UPLOADS_BUCKET = 'budget-uploads'
export const BUDGET_FILES_BUCKET = 'budget-files'

// ─────────────────────────── טיפוסים ───────────────────────────

/** שורה מדוח "ברמת הכרטיס" — הסימנים כמו בקובץ: הוצאות שליליות */
export interface BudgetCard {
  authority_code: string
  fiscal_year: number
  card_code: string
  card_name: string | null
  /** התקציב המאושר — "תכנית שנה נוכחית" באקסס היא אותו מספר (023 §4, אומת 405/405) */
  budget_expense: number | null
  budget_income: number | null
  budget_period: number | null
  executed: number | null
  reserved: number | null
  balance: number | null
  demand: number | null
  loaded_at: string
}

export interface CardMeta {
  authority_code: string
  card_code: string
  category1: string | null
  category2: string | null
  category3: string | null
  category_note: string | null
  owner_name: string | null
  money_source: string | null
  meitar_topic: string | null
  gefen: boolean
  updated_at: string
}

export interface CardPlan {
  authority_code: string
  card_code: string
  fiscal_year: number
  forecast_income: number | null
  forecast_expense: number | null
  next_income: number | null
  next_expense: number | null
  notes: string | null
  updated_at: string
}

export interface BudgetTransaction {
  id: number
  card_code: string
  card_name: string | null
  year_field: number | null
  event_date: string | null
  due_date: string | null
  is_opening: boolean
  voucher: string | null
  counter_account: string | null
  counter_name: string | null
  details: string | null
  debit: number | null
  credit: number | null
  balance: number | null
  ref1: string | null
  ref2: string | null
  cost_center: string | null
  document: string | null
  /** נושא המיתר של תקבול ממשרד החינוך — נגזר בקליטה מ"פרטים" (null = לא מהמיתר) */
  meitar_topic: string | null
}

export interface MonthlyRow {
  card_code: string
  month: string
  debit: number
  credit: number
}

export interface BudgetOrder {
  authority_code: string
  order_no: string
  order_date: string | null
  supplier_no: string | null
  supplier_name: string | null
  amount: number | null
  not_supplied: number | null
  status: string | null
  next_approver: string | null
  details: string | null
  department: string | null
  card_code: string | null
  card_name: string | null
  cost_center1: string | null
  cost_center2: string | null
  contract: string | null
  extra: Record<string, string> | null
}

export interface OrderNote {
  authority_code: string
  order_no: string
  invoice_received: boolean
  invoice_no: string | null
  invoice_amount: number | null
  in_gefen: boolean
  in_tabar: boolean
  notes: string | null
  updated_at: string
}

export interface MeitarRun {
  id: string
  authority_code: string
  calc_month: string
  beneficiary: string | null
  file_count: number | null
  loaded_at: string
}

export interface MeitarInvoiceRow {
  id: number
  topic_code: string
  topic_name: string | null
  chashavut: string | null
  effect_month: string | null
  due: number | null
  paid: number | null
  to_pay: number | null
  debt: number | null
  month_balance: number | null
  notes: string | null
}

export interface MeitarRow {
  id: number
  source_file: string
  topic_code: string | null
  topic_name: string | null
  institution_code: string | null
  institution_name: string | null
  settlement_code: string | null
  settlement_name: string | null
  effect_month: string | null
  units: number | null
  cost: number | null
  pct: number | null
  computed: number | null
  computed_prev: number | null
  diff: number | null
  extra: Record<string, string> | null
}

export interface TopicPlan {
  authority_code: string
  topic_code: string
  school_year: number
  budget: number | null
  forecast: number | null
  next_year: number | null
  category: string | null
  notes: string | null
  updated_at: string
}

export interface CardFile {
  id: string
  authority_code: string
  card_code: string
  storage_path: string
  file_name: string
  size_bytes: number | null
  mime_type: string | null
  uploaded_at: string
}

// ── קליטה ──

export type BudgetKind = 'cards' | 'actions' | 'orders' | 'meitar' | 'unknown'

export const BUDGET_KIND_LABELS: Record<BudgetKind, string> = {
  cards: 'דוח ברמת הכרטיס',
  actions: 'דוח ברמת הפעולה',
  orders: 'דוח הזמנות רכש',
  meitar: 'קובצי מיתר (ZIP)',
  unknown: 'לא זוהה',
}

/**
 * השדות לכל סוג דוח — המקבילה של FIELDS ב-scripts/budget_fields.py.
 * ⚠️ המפתחות חייבים להיות זהים לשם.
 */
export const BUDGET_FIELDS: Record<'cards' | 'actions' | 'orders', { key: string; label: string; required?: boolean }[]> = {
  cards: [
    { key: 'card_code', label: 'מספר כרטיס', required: true },
    { key: 'card_name', label: 'שם הכרטיס' },
    { key: 'budget_expense', label: 'תקציב הוצאות', required: true },
    { key: 'budget_income', label: 'תקציב הכנסות', required: true },
    { key: 'budget_period', label: 'תקציב תקופתי' },
    { key: 'executed', label: 'ביצוע', required: true },
    { key: 'reserved', label: 'שריון' },
    { key: 'balance', label: 'יתרה' },
    { key: 'demand', label: 'דרישה' },
  ],
  actions: [
    { key: 'card_code', label: 'מספר כרטיס', required: true },
    { key: 'card_name', label: 'שם הכרטיס' },
    { key: 'year_field', label: 'שנה' },
    { key: 'event_date', label: 'תאריך אירוע', required: true },
    { key: 'due_date', label: 'תאריך פירעון' },
    { key: 'voucher', label: 'מספר פקודה' },
    { key: 'counter_account', label: 'חשבון נגדי' },
    { key: 'counter_name', label: 'שם חשבון נגדי' },
    { key: 'details', label: 'פרטים' },
    { key: 'debit', label: 'חובה', required: true },
    { key: 'credit', label: 'זכות', required: true },
    { key: 'balance', label: 'יתרה' },
    { key: 'ref1', label: 'אסמכתא 1' },
    { key: 'ref2', label: 'אסמכתא 2' },
    { key: 'cost_center', label: 'תמחיר' },
    { key: 'document', label: 'מסמך' },
  ],
  orders: [
    { key: 'order_no', label: 'מספר הזמנה', required: true },
    { key: 'order_date', label: 'תאריך' },
    { key: 'supplier_no', label: 'מספר ספק' },
    { key: 'supplier_name', label: 'שם ספק' },
    { key: 'amount', label: 'סכום כולל מע"מ', required: true },
    { key: 'not_supplied', label: 'לא סופק' },
    { key: 'status', label: 'מצב נוכחי' },
    { key: 'next_approver', label: 'מאשר הבא' },
    { key: 'details', label: 'פרטים' },
    { key: 'department', label: 'מחלקה' },
    { key: 'card_code', label: 'סעיף תקציבי' },
    { key: 'card_name', label: 'שם סעיף' },
    { key: 'cost_center1', label: 'תמחיר 1' },
    { key: 'cost_center2', label: 'תמחיר 2' },
    { key: 'contract', label: 'חוזה' },
  ],
}

export interface ProposedFile {
  kind: BudgetKind
  headers: string[]
  mapping: Record<string, string | null> | null
  meta: Record<string, { confidence: string }>
  source: 'dictionary' | 'saved' | null
  rows: number | null
  missing: string[]
}

export interface BudgetReport {
  errors?: string[]
  warnings?: { kind: string; text: string }[]
  fiscal_year?: number
  counts?: Record<string, number>
  date_range?: [string, string] | null
  crosscheck?: { checked: number; matched: number; mismatches: { card: string; executed: number; actions: number }[] }
  meitar?: { file: string; calc_month: string; reconcile: { matched: number; total: number; mismatches: { topic: string; name: string | null; invoice: number; detail: number | null }[] } }[]
}

export interface BudgetUpload {
  id: string
  authority_code: string
  fiscal_year: number
  status: 'pending' | 'awaiting_approval' | 'processing' | 'done' | 'failed'
  storage_prefix: string
  files: { path: string; name: string }[]
  proposed_mapping: Record<string, ProposedFile> | null
  approved_mapping: Record<string, { kind: BudgetKind; mapping: Record<string, string | null> | null }> | null
  mapping_source: 'dictionary' | 'saved' | 'manual' | null
  report: BudgetReport | null
  rows_loaded: number | null
  error_message: string | null
  uploaded_at: string
  processed_at: string | null
}

// ─────────────────────────── עזר ───────────────────────────

/** שגיאת מסד שאומרת "הטבלה/הפונקציה לא קיימת" — מיגרציה 044 טרם הוחלה */
function explain(e: { message: string; code?: string } | null, what: string): Error {
  if (!e) return new Error(what)
  if (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|schema cache/i.test(e.message)) {
    return new Error(`${what} — מודול התקציב עוד לא הותקן במסד (מיגרציה 044)`)
  }
  return new Error(`${what} — ${e.message}`)
}

/** ריק → null, אחרת מספר. "תא ריק נשאר ריק" גם בשדה שהמשתמש מקליד */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[,₪\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ─────────────────────────── קריאה ───────────────────────────

export async function fetchBudgetYears(code: string): Promise<number[]> {
  const { data, error } = await supabase.from('budget_cards').select('fiscal_year').eq('authority_code', code).limit(5000)
  if (error) throw explain(error, 'טעינת שנות התקציב')
  return [...new Set((data ?? []).map((r) => r.fiscal_year as number))].sort((a, b) => b - a)
}

export async function fetchCards(code: string, year: number): Promise<BudgetCard[]> {
  return fetchAll<BudgetCard>((from, to) =>
    supabase.from('budget_cards').select('*').eq('authority_code', code).eq('fiscal_year', year)
      .order('card_code').range(from, to),
  ).catch((e) => { throw explain(e, 'טעינת הכרטסת') })
}

export async function fetchMeta(code: string): Promise<CardMeta[]> {
  return fetchAll<CardMeta>((from, to) =>
    supabase.from('budget_card_meta').select('*').eq('authority_code', code).order('card_code').range(from, to),
  ).catch((e) => { throw explain(e, 'טעינת הקטגוריות') })
}

export async function fetchPlans(code: string, year: number): Promise<CardPlan[]> {
  return fetchAll<CardPlan>((from, to) =>
    supabase.from('budget_card_plans').select('*').eq('authority_code', code).eq('fiscal_year', year)
      .order('card_code').range(from, to),
  ).catch((e) => { throw explain(e, 'טעינת הצפי והתכנון') })
}

/** ביצוע חודשי לכל כרטיס — מסוכם במסד (budget_monthly), לא 10,000 שורות לדפדפן */
export async function fetchMonthly(code: string, from: string, to: string): Promise<MonthlyRow[]> {
  const { data, error } = await supabase.rpc('budget_monthly', { p_code: code, p_from: from, p_to: to })
  if (error) throw explain(error, 'טעינת הביצוע החודשי')
  return ((data ?? []) as MonthlyRow[]).map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }))
}

/** כמה נרשם בכרטסת לכל נושא מיתר בתקופה — הגשר בין המיתר להנהלת החשבונות */
export async function fetchTopicTotals(code: string, from: string, to: string): Promise<Map<string, { booked: number; count: number }>> {
  const { data, error } = await supabase.rpc('budget_topic_totals', { p_code: code, p_from: from, p_to: to })
  if (error) throw explain(error, 'טעינת ההכנסות לפי נושא')
  return new Map(((data ?? []) as { meitar_topic: string; booked: number; tx_count: number }[])
    .map((r) => [r.meitar_topic, { booked: Number(r.booked), count: Number(r.tx_count) }]))
}

export async function fetchTransactions(code: string, card: string): Promise<BudgetTransaction[]> {
  return fetchAll<BudgetTransaction>((from, to) =>
    supabase.from('budget_transactions').select('*').eq('authority_code', code).eq('card_code', card)
      .order('event_date', { ascending: true, nullsFirst: true }).order('id').range(from, to),
  ).catch((e) => { throw explain(e, 'טעינת תנועות הכרטיס') })
}

/** ערכי "קטגוריה 1" שבכרטסת — לבחירת ההיקף של אחראי תקציב */
export async function fetchBudgetCategories(code: string): Promise<ScopeOption[]> {
  const { data, error } = await supabase.from('budget_card_meta').select('category1').eq('authority_code', code).limit(5000)
  if (error) throw explain(error, 'טעינת הקטגוריות')
  const counts = new Map<string, number>()
  for (const r of data ?? []) {
    const c = (r.category1 as string | null)?.trim()
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'he')).map(([value, count]) => ({ value, label: value, count }))
}

export async function fetchOrders(code: string): Promise<BudgetOrder[]> {
  return fetchAll<BudgetOrder>((from, to) =>
    supabase.from('budget_orders').select('*').eq('authority_code', code).order('order_date', { ascending: false }).range(from, to),
  ).catch((e) => { throw explain(e, 'טעינת ההזמנות') })
}

export async function fetchOrderNotes(code: string): Promise<OrderNote[]> {
  return fetchAll<OrderNote>((from, to) =>
    supabase.from('budget_order_notes').select('*').eq('authority_code', code).range(from, to),
  ).catch((e) => { throw explain(e, 'טעינת הערות ההזמנות') })
}

export async function fetchMeitarRuns(code: string): Promise<MeitarRun[]> {
  const { data, error } = await supabase.from('meitar_runs').select('*').eq('authority_code', code)
    .order('calc_month', { ascending: false })
  if (error) throw explain(error, 'טעינת חודשי המיתר')
  return (data ?? []) as MeitarRun[]
}

export async function fetchMeitarInvoice(runId: string): Promise<MeitarInvoiceRow[]> {
  const { data, error } = await supabase.from('meitar_invoice').select('*').eq('run_id', runId).order('topic_code').limit(2000)
  if (error) throw explain(error, 'טעינת חשבונית המיתר')
  return (data ?? []) as MeitarInvoiceRow[]
}

export async function fetchMeitarRows(runId: string, topic?: string): Promise<MeitarRow[]> {
  return fetchAll<MeitarRow>((from, to) => {
    let q = supabase.from('meitar_rows').select('*').eq('run_id', runId)
    if (topic) q = q.eq('topic_code', topic)
    return q.order('id').range(from, to)
  }).catch((e) => { throw explain(e, 'טעינת פירוט המיתר') })
}

export async function fetchTopicPlans(code: string, schoolYear: number): Promise<TopicPlan[]> {
  const { data, error } = await supabase.from('meitar_topic_plans').select('*').eq('authority_code', code)
    .eq('school_year', schoolYear).limit(2000)
  if (error) throw explain(error, 'טעינת תכנון המיתר')
  return (data ?? []) as TopicPlan[]
}

// ─────────────────────────── שמירה ───────────────────────────
// upsert מלא של השורה: current (מה שעל המסך) + patch. בלי זה upsert חלקי
// היה מאפס עמודות שלא נשלחו.

type MetaFields = Omit<CardMeta, 'authority_code' | 'card_code' | 'updated_at'>
type PlanFields = Omit<CardPlan, 'authority_code' | 'card_code' | 'fiscal_year' | 'updated_at'>

const EMPTY_META: MetaFields = {
  category1: null, category2: null, category3: null, category_note: null,
  owner_name: null, money_source: null, meitar_topic: null, gefen: false,
}
const EMPTY_PLAN: PlanFields = {
  forecast_income: null, forecast_expense: null, next_income: null, next_expense: null, notes: null,
}

function pick<T extends object>(base: T, src: Partial<T> | null | undefined): T {
  const out = { ...base }
  for (const k of Object.keys(base) as (keyof T)[]) if (src && src[k] !== undefined) out[k] = src[k] as T[keyof T]
  return out
}

export async function saveMeta(code: string, card: string, patch: Partial<MetaFields>, current: CardMeta | null): Promise<CardMeta> {
  const row = { authority_code: code, card_code: card, ...pick(EMPTY_META, current), ...patch }
  const { data, error } = await supabase.from('budget_card_meta')
    .upsert(row, { onConflict: 'authority_code,card_code' }).select('*').maybeSingle()
  if (error) throw explain(error, 'שמירת פרטי הכרטיס')
  if (!data) throw new Error('שמירת פרטי הכרטיס נחסמה — קטגוריות ואחראי נערכים רק ע"י מנהל התקציב')
  return data as CardMeta
}

export async function savePlan(code: string, card: string, year: number, patch: Partial<PlanFields>, current: CardPlan | null): Promise<CardPlan> {
  const row = { authority_code: code, card_code: card, fiscal_year: year, ...pick(EMPTY_PLAN, current), ...patch }
  const { data, error } = await supabase.from('budget_card_plans')
    .upsert(row, { onConflict: 'authority_code,card_code,fiscal_year' }).select('*').maybeSingle()
  if (error) throw explain(error, 'שמירת הצפי והתכנון')
  if (!data) throw new Error('השמירה נחסמה — אין הרשאת עריכה לכרטיס הזה')
  return data as CardPlan
}

type NoteFields = Omit<OrderNote, 'authority_code' | 'order_no' | 'updated_at'>
const EMPTY_NOTE: NoteFields = { invoice_received: false, invoice_no: null, invoice_amount: null, in_gefen: false, in_tabar: false, notes: null }

export async function saveOrderNote(code: string, orderNo: string, patch: Partial<NoteFields>, current: OrderNote | null): Promise<OrderNote> {
  const row = { authority_code: code, order_no: orderNo, ...pick(EMPTY_NOTE, current), ...patch }
  const { data, error } = await supabase.from('budget_order_notes')
    .upsert(row, { onConflict: 'authority_code,order_no' }).select('*').maybeSingle()
  if (error) throw explain(error, 'שמירת פרטי ההזמנה')
  if (!data) throw new Error('השמירה נחסמה — רק מנהל התקציב עורך פרטי הזמנה')
  return data as OrderNote
}

type TopicFields = Omit<TopicPlan, 'authority_code' | 'topic_code' | 'school_year' | 'updated_at'>
const EMPTY_TOPIC: TopicFields = { budget: null, forecast: null, next_year: null, category: null, notes: null }

export async function saveTopicPlan(code: string, topic: string, schoolYear: number, patch: Partial<TopicFields>, current: TopicPlan | null): Promise<TopicPlan> {
  const row = { authority_code: code, topic_code: topic, school_year: schoolYear, ...pick(EMPTY_TOPIC, current), ...patch }
  const { data, error } = await supabase.from('meitar_topic_plans')
    .upsert(row, { onConflict: 'authority_code,topic_code,school_year' }).select('*').maybeSingle()
  if (error) throw explain(error, 'שמירת תכנון הנושא')
  if (!data) throw new Error('השמירה נחסמה — רק מנהל התקציב עורך את תכנון המיתר')
  return data as TopicPlan
}

// ─────────────────────────── קבצים מצורפים לכרטיס ───────────────────────────

export async function fetchCardFiles(code: string, card: string): Promise<CardFile[]> {
  const { data, error } = await supabase.from('budget_card_files').select('*').eq('authority_code', code)
    .eq('card_code', card).order('uploaded_at', { ascending: false })
  if (error) throw explain(error, 'טעינת הקבצים')
  return (data ?? []) as CardFile[]
}

export async function uploadCardFile(code: string, card: string, file: File): Promise<CardFile> {
  // Storage פוסל עברית במפתח (מלכודת 31) — השם המקורי נשמר בטבלה
  const path = `${code}/${card}/${Date.now()}-${storageSafeName(file.name)}`
  await step(`העלאת «${file.name}»`, async () => {
    const { error } = await supabase.storage.from(BUDGET_FILES_BUCKET).upload(path, file)
    if (error) throw error
  })
  return step(`רישום «${file.name}»`, async () => {
    const { data, error } = await supabase.from('budget_card_files').insert({
      authority_code: code, card_code: card, storage_path: path, file_name: file.name,
      size_bytes: file.size, mime_type: file.type || null,
    }).select('*').maybeSingle()
    if (error) throw error
    if (!data) throw new Error('הרישום נחסם')
    return data as CardFile
  })
}

export async function deleteCardFile(f: CardFile): Promise<void> {
  const { data, error } = await supabase.from('budget_card_files').delete().eq('id', f.id).select('id')
  if (error) throw explain(error, 'מחיקת הקובץ')
  if (!data?.length) throw new Error('המחיקה נחסמה — אין הרשאת עריכה לכרטיס הזה')
  await supabase.storage.from(BUDGET_FILES_BUCKET).remove([f.storage_path])
}

export async function cardFileUrl(f: CardFile): Promise<string | null> {
  const { data } = await supabase.storage.from(BUDGET_FILES_BUCKET).createSignedUrl(f.storage_path, 600)
  return data?.signedUrl ?? null
}

// ─────────────────────────── קליטה ───────────────────────────

export async function fetchBudgetUploads(code: string): Promise<BudgetUpload[]> {
  const { data, error } = await supabase.from('budget_uploads').select('*').eq('authority_code', code)
    .order('uploaded_at', { ascending: false }).limit(20)
  if (error) throw explain(error, 'טעינת היסטוריית הקליטות')
  return (data ?? []) as BudgetUpload[]
}

/** מזהה קובץ לפי הסיומת — דוחות EPR (xls/xlsx) או ZIP מיתר */
export function acceptsBudgetFile(name: string): boolean {
  return /\.(xls|xlsx|zip)$/i.test(name)
}

export async function uploadBudgetFiles(code: string, year: number, files: File[]): Promise<BudgetUpload> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const prefix = `${code}/${stamp}`
  const names = new Set<string>()
  const stored: { path: string; name: string }[] = []
  for (const [i, file] of files.entries()) {
    if (names.has(file.name)) throw new Error(`הקובץ «${file.name}» נבחר פעמיים`)
    names.add(file.name)
    const path = `${prefix}/${i + 1}-${storageSafeName(file.name)}`
    await step(`העלאת קובץ ${i + 1}/${files.length} («${file.name}», ${(file.size / 1e6).toFixed(1)}MB)`, async () => {
      const { error } = await supabase.storage.from(BUDGET_UPLOADS_BUCKET).upload(path, file)
      if (error) throw error
    })
    stored.push({ path, name: file.name })
  }
  return step('רישום הקליטה', async () => {
    const { data, error } = await supabase.from('budget_uploads').insert({
      authority_code: code, fiscal_year: year, storage_prefix: prefix, files: stored, status: 'pending',
    }).select('*').maybeSingle()
    if (error) throw error
    if (!data) throw new Error('הרישום נחסם — נדרשת הרשאת מנהל תקציב')
    return data as BudgetUpload
  })
}

/**
 * אישור ההתאמה. ⚠️ המיפוי **המלא** של כל קובץ — לא רק השורות שהמשתמש שינה
 * (אותה תקלה שתוקנה בקליטת הגנים: `{}` נקרא "טרם אושר" והמסך קפץ בלולאה).
 */
export async function approveBudgetMapping(id: string, approved: NonNullable<BudgetUpload['approved_mapping']>): Promise<BudgetUpload> {
  const { data, error } = await supabase.from('budget_uploads')
    .update({ approved_mapping: approved, status: 'pending' }).eq('id', id).select('*').maybeSingle()
  if (error) throw explain(error, 'אישור ההתאמה')
  if (!data) throw new Error('האישור נחסם — נדרשת הרשאת מנהל תקציב')
  return data as BudgetUpload
}
