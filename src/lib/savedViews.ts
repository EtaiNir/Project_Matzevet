// טבלאות ייעודיות — שכבת הנתונים (מיגרציות 016, 017).
//
// טבלה ייעודית היא **רשימת תעודות זהות מפורשת**, ולא סינון שמור.
// היא נזרעת מהסינון שהמשתמש עמד עליו, ומאותו רגע החברוּת קבועה: תלמיד
// חדש שמתאים לסינון המקורי אינו מצטרף מעצמו, ותלמיד שיצא ממנו נשאר
// עד שיוסר. זו הדרישה — "את מי שסיננת להוסיף לאחת הטבלאות".
//
// `filters` נשמר כתיעוד של הסינון שממנו נבנתה הרשימה, ואינו מורץ מחדש.
//
// מיגרציה 021: טבלה ייעודית ותיקייה הן **אישיות** — כל משתמש רואה רק
// את מה שהוא עצמו יצר. הסינון הזה אינו כאן אלא ב-RLS, ולכן גם קריאה
// ישירה ל-API לא תחזיר את הרשימות של מישהו אחר.

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
  /** התיקייה שבה היא יושבת בסרגל. null = בשורש */
  folder_id: string | null
  created_by: string | null
  created_at: string
  /** מספר התלמידים ברשימה — נשלף בנפרד */
  member_count?: number
}

/** תיקייה בעץ הסרגל. `parent_id` ריק = תיקייה בשורש. */
export interface ViewFolder {
  id: string
  authority_code: string
  parent_id: string | null
  name: string
  /** מי יצר אותה. שונה מהמשתמש הנוכחי = הגיעה אליו בשיתוף */
  created_by: string | null
  created_at: string
}

/** שורה ברשימת השותפים של פריט — מה שהבעלים רואה */
export interface ViewShare {
  id: string
  email: string
  display_name: string | null
  can_edit: boolean
  created_at: string
}

/** פריט ששותף **איתי**, ועל ידי מי */
export interface SharedWithMe {
  kind: 'view' | 'folder'
  item_id: string
  owner_email: string
  owner_name: string | null
  can_edit: boolean
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

  // ספירה לכל רשימה **במקביל**, בבקשת `head` שמחזירה מספר בלבד בלי שורות.
  //
  // קודם זו הייתה לולאה סדרתית שמשכה את כל טבלת החברוּת דף אחרי דף ומנתה
  // בזיכרון. מספר הסבבים גדל עם סך החברים בכל הרשימות יחד, וכל העברה של
  // טבלה לתיקייה המתינה לה לפני שהסרגל התעדכן. כאן מספר הבקשות הוא מספר
  // הרשימות, והן יוצאות יחד.
  const table = membersTable(authorityCode)
  const counts = await Promise.all(
    views.map(async (v) => {
      const { count, error } = await supabase
        .from(table)
        .select('view_id', { count: 'exact', head: true })
        .eq('view_id', v.id)
      return error ? 0 : (count ?? 0)
    }),
  )

  return views.map((v, i) => ({ ...v, member_count: counts[i] }))
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

/** מעבירה טבלה לתיקייה. `null` מחזיר אותה לשורש. */
export async function moveViewToFolder(id: string, folderId: string | null): Promise<void> {
  const { error } = await supabase
    .from('saved_views')
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─────────────────────────── תיקיות ───────────────────────────

/**
 * כל התיקיות של המשתמש ברשות.
 *
 * נשלפות שטוחות והעץ נבנה בזיכרון: מספר התיקיות של משתמש בודד נמדד
 * בעשרות, ושאילתה רקורסיבית כאן הייתה עלות בלי תמורה.
 *
 * נכשלת בשקט ומחזירה רשימה ריקה — אתר שרץ מול מסד בלי מיגרציה 021
 * ימשיך להציג את הטבלאות בשורש, בדיוק כמו קודם.
 */
export async function fetchViewFolders(authorityCode: string): Promise<ViewFolder[]> {
  const { data, error } = await supabase
    .from('view_folders')
    .select('id, authority_code, parent_id, name, created_by, created_at')
    .eq('authority_code', authorityCode)
    .order('name')
  if (error) return []
  return (data ?? []) as ViewFolder[]
}

export async function createViewFolder(
  authorityCode: string,
  name: string,
  parentId: string | null = null,
): Promise<ViewFolder> {
  const { data: session } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('view_folders')
    .insert({
      authority_code: authorityCode,
      name: name.trim(),
      parent_id: parentId,
      created_by: session.user?.id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ViewFolder
}

export async function renameViewFolder(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('view_folders')
    .update({ name: name.trim() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** מעבירה תיקייה תחת תיקייה אחרת. המסד חוסם מעגלים. */
export async function moveViewFolder(id: string, parentId: string | null): Promise<void> {
  const { error } = await supabase
    .from('view_folders')
    .update({ parent_id: parentId })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * מוחקת תיקייה.
 *
 * תיקיות המשנה נגררות איתה, אבל **הטבלאות שבתוכה אינן נמחקות** — הן
 * חוזרות לשורש (`on delete set null`). תיקייה היא סידור; טבלה ייעודית
 * מחזיקה רשימת תלמידים שמישהו בנה ידנית.
 */
export async function deleteViewFolder(id: string): Promise<void> {
  const { error } = await supabase.from('view_folders').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─────────────────────────── שיתוף ───────────────────────────
//
// כל הפעולות עוברות בפונקציות במסד (מיגרציה 022) ולא בכתיבה ישירה,
// משתי סיבות: `users` סגורה לקריאה — משתמש רואה רק את עצמו, ולכן
// איתור לפי אימייל חייב `security definer`; והבדיקה שהנמען בכלל שייך
// לרשות אינה משהו שכדאי לסמוך עליו שהדפדפן יעשה.

/** מי שותף לפריט. רק הבעלים מקבל תשובה. */
export async function listShares(
  target: { kind: 'view' | 'folder'; id: string },
): Promise<ViewShare[]> {
  const { data, error } = await supabase.rpc('list_shares', {
    p_view: target.kind === 'view' ? target.id : null,
    p_folder: target.kind === 'folder' ? target.id : null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as ViewShare[]
}

/**
 * משתפת פריט עם משתמש לפי אימייל.
 *
 * שיתוף חוזר לאותו אדם **מעדכן** את ההרשאה במקום להיכשל — זו הדרך
 * להעביר מצפייה לעריכה ובחזרה.
 */
export async function shareItem(
  target: { kind: 'view' | 'folder'; id: string },
  email: string,
  canEdit: boolean,
): Promise<{ email: string; display_name: string | null; can_edit: boolean }> {
  const { data, error } = await supabase.rpc('share_item', {
    p_email: email.trim(),
    p_view: target.kind === 'view' ? target.id : null,
    p_folder: target.kind === 'folder' ? target.id : null,
    p_can_edit: canEdit,
  })
  if (error) throw new Error(error.message)
  return data as { email: string; display_name: string | null; can_edit: boolean }
}

export async function unshareItem(shareId: string): Promise<void> {
  const { error } = await supabase.rpc('unshare_item', { p_share_id: shareId })
  if (error) throw new Error(error.message)
}

/**
 * מה שותף איתי ברשות הזו, ועל ידי מי.
 *
 * הסרגל צריך את זה כדי לסמן פריט של מישהו אחר ולהסתיר ממנו את פעולות
 * הבעלוּת. נכשלת בשקט — אתר מול מסד בלי מיגרציה 022 ימשיך להציג את
 * הפריטים של המשתמש עצמו.
 */
export async function fetchSharedWithMe(authorityCode: string): Promise<SharedWithMe[]> {
  const { data, error } = await supabase.rpc('shared_with_me', { p_code: authorityCode })
  if (error) return []
  return (data ?? []) as SharedWithMe[]
}
