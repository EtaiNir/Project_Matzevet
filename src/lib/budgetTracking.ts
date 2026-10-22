// מעקב ותכנון תקציב — הגישה לטבלאות של מיגרציה 049 (decisions/025): תמונות
// מצב, היסטוריית הצפי, "בדקתי" על חריגות, ואישור התכנית לשנה הבאה. כל קריאה
// כאן נכשלת "ברכות" לפני שהמיגרציה הוחלה — המסכים הקיימים אינם תלויים בה.
import { supabase } from './supabase'
import type { Period } from './budgetCalc'

const missing = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|Could not find/i.test(e.message ?? '')))

// ─────────────────────────────── תמונות מצב ───────────────────────────────

export interface Snapshot {
  id: number
  as_of: string | null
  taken_at: string
  from_date: string | null
  to_date: string | null
}

export interface SnapshotMonth {
  card_code: string
  month: string
  debit: number
  credit: number
  n: number
}

/** התמונה האחרונה שיש בה תנועות — מצב הנתונים לפני הקליטה האחרונה. null — אין עדיין */
export async function fetchLatestSnapshot(code: string): Promise<{ snapshot: Snapshot; months: SnapshotMonth[] } | null> {
  const { data, error } = await supabase.from('budget_snapshots').select('id, as_of, taken_at, from_date, to_date')
    .eq('authority_code', code).not('from_date', 'is', null).order('id', { ascending: false }).limit(1)
  if (error) {
    if (missing(error)) return null
    throw new Error(`טעינת תמונת המצב נכשלה: ${error.message}`)
  }
  const snap = (data ?? [])[0] as Snapshot | undefined
  if (!snap) return null
  const months: SnapshotMonth[] = []
  for (let from = 0; ; from += 1000) {
    const r = await supabase.from('budget_snapshot_monthly').select('card_code, month, debit, credit, n')
      .eq('snapshot_id', snap.id).order('card_code').order('month').range(from, from + 999)
    if (r.error) throw new Error(`טעינת תמונת המצב נכשלה: ${r.error.message}`)
    months.push(...((r.data ?? []) as SnapshotMonth[]).map((x) => ({ ...x, debit: Number(x.debit), credit: Number(x.credit) })))
    if ((r.data ?? []).length < 1000) break
  }
  return { snapshot: snap, months }
}

// ─────────────────────────────── היסטוריית הצפי ───────────────────────────────

export type PlanField = 'forecast_income' | 'forecast_expense' | 'next_income' | 'next_expense'
export const PLAN_FIELD_LABELS: Record<PlanField, string> = {
  forecast_income: 'צפי הכנסות', forecast_expense: 'צפי הוצאות', next_income: 'תכנית הכנסות', next_expense: 'תכנית הוצאות',
}

export interface PlanChange {
  card_code: string
  field: PlanField
  old_value: number | null
  new_value: number | null
  changed_email: string | null
  /** ריק = מהקובץ (התוספתיים); מזהה בלי מייל = מנהל־על */
  changed_by: string | null
  changed_at: string
}

export async function fetchPlanHistory(code: string, year: number, since: string | null): Promise<PlanChange[]> {
  let q = supabase.from('budget_plan_history').select('card_code, field, old_value, new_value, changed_email, changed_by, changed_at')
    .eq('authority_code', code).eq('fiscal_year', year)
  if (since) q = q.gte('changed_at', since)
  const { data, error } = await q.order('changed_at', { ascending: false }).limit(2000)
  if (error) {
    if (missing(error)) return []
    throw new Error(`טעינת היסטוריית הצפי נכשלה: ${error.message}`)
  }
  return ((data ?? []) as PlanChange[]).map((r) => ({
    ...r, old_value: r.old_value == null ? null : Number(r.old_value), new_value: r.new_value == null ? null : Number(r.new_value),
  }))
}

export function changedByText(c: { changed_email: string | null; changed_by: string | null }): string {
  if (c.changed_email) return c.changed_email
  return c.changed_by ? 'מנהל על' : 'מהקובץ'
}

// ─────────────────────────────── חריגות — "בדקתי" ───────────────────────────────

export interface ExceptionReview {
  card_code: string
  kind: string
  value_at_review: number | null
  note: string | null
  reviewed_email: string | null
  reviewed_by: string | null
  reviewed_at: string
}

export const reviewKey = (card: string, kind: string) => `${card}|${kind}`

export async function fetchExceptionReviews(code: string, year: number, period: Period): Promise<Map<string, ExceptionReview>> {
  const { data, error } = await supabase.from('budget_exception_reviews')
    .select('card_code, kind, value_at_review, note, reviewed_email, reviewed_by, reviewed_at')
    .eq('authority_code', code).eq('fiscal_year', year).eq('period', period)
  if (error) {
    if (missing(error)) return new Map()
    throw new Error(`טעינת החריגות שנבדקו נכשלה: ${error.message}`)
  }
  return new Map(((data ?? []) as ExceptionReview[]).map((r) => [reviewKey(r.card_code, r.kind), { ...r, value_at_review: r.value_at_review == null ? null : Number(r.value_at_review) }]))
}

/** "בדקתי" — מי ומתי נקבעים במסד (טריגר). מחזיר את השורה כפי שנשמרה (מלכודת 26) */
export async function saveExceptionReview(code: string, year: number, period: Period, card: string, kind: string, value: number, note: string): Promise<ExceptionReview> {
  const { data, error } = await supabase.from('budget_exception_reviews')
    .upsert({ authority_code: code, fiscal_year: year, period, card_code: card, kind, value_at_review: value, note: note.trim() || null },
      { onConflict: 'authority_code,fiscal_year,period,card_code,kind' })
    .select('card_code, kind, value_at_review, note, reviewed_email, reviewed_by, reviewed_at').maybeSingle()
  if (error) {
    if (missing(error)) throw new Error('החריגות עדיין לא הופעלו במסד (מיגרציה 049)')
    throw new Error(`השמירה נכשלה: ${error.message}`)
  }
  if (!data) throw new Error('השמירה נחסמה — אין לך הרשאה לכרטיס הזה')
  return { ...(data as ExceptionReview), value_at_review: Number((data as ExceptionReview).value_at_review) }
}

export async function deleteExceptionReview(code: string, year: number, period: Period, card: string, kind: string): Promise<void> {
  const { error } = await supabase.from('budget_exception_reviews').delete()
    .eq('authority_code', code).eq('fiscal_year', year).eq('period', period).eq('card_code', card).eq('kind', kind)
  if (error) throw new Error(`הפעולה נכשלה: ${error.message}`)
}

// ─────────────────────────────── אישור תכנית ───────────────────────────────

export type PlanStatus = 'draft' | 'submitted' | 'approved' | 'returned'
export const PLAN_STATUS_META: Record<PlanStatus, { label: string; tone: string }> = {
  draft: { label: 'בעבודה', tone: 'bg-slate-100 text-slate-600' },
  submitted: { label: 'הוגש', tone: 'bg-sky-100 text-sky-800' },
  approved: { label: 'אושר', tone: 'bg-emerald-100 text-emerald-800' },
  returned: { label: 'הוחזר', tone: 'bg-amber-100 text-amber-800' },
}

export interface PlanReview {
  card_code: string
  status: Exclude<PlanStatus, 'draft'>
  comment: string | null
  submitted_email: string | null
  submitted_at: string | null
  decided_email: string | null
  decided_at: string | null
}

export async function fetchPlanReviews(code: string, year: number): Promise<Map<string, PlanReview>> {
  const { data, error } = await supabase.from('budget_plan_reviews')
    .select('card_code, status, comment, submitted_email, submitted_at, decided_email, decided_at')
    .eq('authority_code', code).eq('fiscal_year', year)
  if (error) {
    if (missing(error)) return new Map()
    throw new Error(`טעינת מצב התכניות נכשלה: ${error.message}`)
  }
  return new Map(((data ?? []) as PlanReview[]).map((r) => [r.card_code, r]))
}

async function rpc(name: string, args: Record<string, unknown>): Promise<PlanReview> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (missing(error)) throw new Error('אישור התכנית עדיין לא הופעל במסד (מיגרציה 049)')
    throw new Error(error.message)
  }
  return data as PlanReview
}

export function submitPlan(code: string, card: string, year: number, comment: string): Promise<PlanReview> {
  return rpc('budget_plan_submit', { p_code: code, p_card: card, p_year: year, p_comment: comment })
}

export function decidePlan(code: string, card: string, year: number, approve: boolean, comment: string): Promise<PlanReview> {
  return rpc('budget_plan_decide', { p_code: code, p_card: card, p_year: year, p_approve: approve, p_comment: comment })
}

// ─────────────────────────────── פרטיות ───────────────────────────────

/**
 * כרטיס שכר — כרטיס הוצאה שסוג ההוצאה שלו (שלוש הספרות האחרונות) 100–199.
 * אותו כלל כמו budget_is_salary במסד (049): אחראי תקציב רואה בו סיכומים בלבד.
 */
export function isSalaryCard(code: string): boolean {
  return /^\d{10}$/.test(code) && Number(code[1]) > 5 && Number(code.slice(7)) >= 100 && Number(code.slice(7)) <= 199
}
