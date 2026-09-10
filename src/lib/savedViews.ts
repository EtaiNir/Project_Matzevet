// טבלאות ייעודיות — שכבת הנתונים (מיגרציות 016, 017).
//
// טבלה ייעודית היא **רשימת תעודות זהות מפורשת**, ולא סינון שמור.
// היא נזרעת מהסינון שהמשתמש עמד עליו, ומאותו רגע החברוּת קבועה: תלמיד
// חדש שמתאים לסינון המקורי אינו מצטרף מעצמו, ותלמיד שיצא ממנו נשאר
// עד שיוסר. זו הדרישה — "את מי שסיננת להוסיף לאחת הטבלאות".
//
// `filters` נשמר כתיעוד של הסינון שממנו נבנתה הרשימה, ואינו מורץ מחדש.

import { supabase } from './supabase'
import type { FilterCondition } from './filters'

const PAGE_SIZE = 1000

export interface SavedView {
  id: string
  authority_code: string
  name: string
  description: string | null
  base_preset: string | null
  /** הסינון שממנו נזרעה הרשימה — תיעוד בלבד */
  filters: FilterCondition[]
  fields: string[]
  visibility: 'private' | 'authority'
  created_by: string | null
  created_at: string
  /** מספר התלמידים ברשימה — נשלף בנפרד */
  member_count?: number
}

function membersTable(authorityCode: string): string {
  return `students_${authorityCode}_view_members`
}

/** כל הטבלאות הייעודיות של הרשות, עם ספירת חברים. */
export async function fetchSavedViews(authorityCode: string): Promise<SavedView[]> {
  const { data, error } = await supabase
    .from('saved_views')
    .select('*')
    .eq('authority_code', authorityCode)
    .order('created_at', { ascending: false })
  if (error) return []

  const views = (data ?? []) as SavedView[]
  if (views.length === 0) return views

  // ספירה בשאילתה אחת ולא אחת לכל רשימה
  const counts = new Map<string, number>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabase
      .from(membersTable(authorityCode))
      .select('view_id')
      .range(from, from + PAGE_SIZE - 1)
    if (page.error) break
    const rows = (page.data ?? []) as { view_id: string }[]
    for (const r of rows) counts.set(r.view_id, (counts.get(r.view_id) ?? 0) + 1)
    if (rows.length < PAGE_SIZE) break
  }

  return views.map((v) => ({ ...v, member_count: counts.get(v.id) ?? 0 }))
}

export async function fetchSavedView(id: string): Promise<SavedView | null> {
  const { data, error } = await supabase.from('saved_views').select('*').eq('id', id).maybeSingle()
  if (error) return null
  return data as SavedView | null
}

/** תעודות הזהות שברשימה. */
export async function fetchViewMembers(
  authorityCode: string,
  viewId: string,
): Promise<Set<string>> {
  const out = new Set<string>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(membersTable(authorityCode))
      .select('MISPAR_ZEHUT')
      .eq('view_id', viewId)
      .range(from, from + PAGE_SIZE - 1)
    if (error) break
    const rows = (data ?? []) as { MISPAR_ZEHUT: string }[]
    for (const r of rows) out.add(r.MISPAR_ZEHUT)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

export async function createSavedView(
  authorityCode: string,
  name: string,
  opts: { filters?: FilterCondition[]; fields?: string[]; basePreset?: string } = {},
): Promise<SavedView> {
  const { data: session } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('saved_views')
    .insert({
      authority_code: authorityCode,
      name: name.trim(),
      filters: opts.filters ?? [],
      fields: opts.fields ?? [],
      base_preset: opts.basePreset ?? null,
      created_by: session.user?.id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as SavedView
}

/**
 * מוסיפה תלמידים לרשימה.
 *
 * עוברת דרך פונקציה במסד ולא דרך insert ישיר: היא מסננת את הת"ז מול
 * הטבלה הראשית (אי אפשר לתחוב לרשימה מישהו שאינו ברשות), מדלגת על מי
 * שכבר ברשימה, ומחזירה כמה **באמת** נוספו.
 */
export async function addStudentsToView(
  viewId: string,
  misparZehut: string[],
): Promise<{ added: number; total: number }> {
  const { data, error } = await supabase.rpc('add_students_to_view', {
    view_uuid: viewId,
    ids: misparZehut,
  })
  if (error) throw new Error(error.message)
  return data as { added: number; total: number }
}

export async function removeStudentFromView(
  authorityCode: string,
  viewId: string,
  misparZehut: string,
): Promise<void> {
  const { error } = await supabase
    .from(membersTable(authorityCode))
    .delete()
    .eq('view_id', viewId)
    .eq('MISPAR_ZEHUT', misparZehut)
  if (error) throw new Error(error.message)
}

export async function renameSavedView(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('saved_views')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** מוחקת את הרשימה. החברוּת נגררת ב-on delete cascade. */
export async function deleteSavedView(id: string): Promise<void> {
  const { error } = await supabase.from('saved_views').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
