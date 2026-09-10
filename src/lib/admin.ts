// שכבת הנתונים של ממשק המנהל — לקוחות, מסמכים, הרשאות והעלאות.
// כל הגישה מוגנת ב-RLS: רק משתמש עם role='super_admin' רואה את הטבלאות האלה.
import { supabase } from './supabase'

export const DOCUMENTS_BUCKET = 'client-documents'
export const UPLOADS_BUCKET = 'moe-uploads'

// ─────────────────────────── טיפוסים ───────────────────────────

export interface Authority {
  code: string
  name: string
  is_active: boolean
  /**
   * קוד הרשות אצל משרד החינוך — אינו בהכרח הקוד שלנו (כפר = 120 אצלנו,
   * 5108 שם). נדרש להשוואת רשות מגורים/מוסד בשדות המחושבים.
   */
  moe_code: string | null
}

export interface Client {
  authority_code: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  last_payment_date: string | null
  next_payment_date: string | null
  contract_renewal: string | null
  annual_fee: number | null
  notes: string | null
}

export interface ClientDocument {
  id: string
  authority_code: string
  title: string
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_at: string
}

/** רמת ההיקף של משתמש בתוך הרשות (מיגרציה 004). */
export type ScopeLevel = 'council' | 'locality' | 'school'

export const SCOPE_LABELS: Record<ScopeLevel, string> = {
  council: 'מועצתי — כל תלמידי הרשות',
  locality: 'יישובי — יישובים נבחרים בלבד',
  school: 'בית-ספרי — מוסדות נבחרים בלבד',
}

export type UserRole = 'viewer' | 'admin' | 'super_admin'

export const ROLE_LABELS: Record<UserRole, string> = {
  viewer: 'צפייה בלבד',
  admin: 'מנהל רשות',
  super_admin: 'מנהל־על',
}

export interface ManagedUser {
  id: string
  email: string
  display_name: string | null
  role: UserRole
  authority_codes: string[]
  scope_level: ScopeLevel
  scope_values: string[]
  /** מושהה — לא יכול להתחבר, ולא רואה נתונים גם עם טוקן ישן */
  is_suspended: boolean
  /**
   * רשאי למלא ערכים בעמודות שהמשתמש הוסיף (מיגרציה 016).
   *
   * רלוונטי ל-`viewer` בלבד: `admin` ו-`super_admin` רשאים ממילא, ולכן
   * הדגל נשמר `false` אצלם — כדי שהורדה בתפקיד לא תשאיר הרשאה תלויה.
   */
  can_edit_extra?: boolean
  /** תיאוריים בלבד; קיימים רק אחרי מיגרציה 010 */
  job_title?: string | null
  institution_name?: string | null
  institution_code?: string | null
}

export interface MoeUpload {
  id: string
  authority_code: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  file_count: number
  storage_prefix: string
  uploaded_at: string
  processed_at: string | null
  rows_loaded: number | null
  error_message: string | null
}

/** ערך אפשרי לבחירת היקף — סמל + שם לתצוגה. */
export interface ScopeOption {
  value: string
  label: string
  count: number
}

// ─────────────────────────── לקוחות ───────────────────────────

export async function fetchAuthorities(): Promise<Authority[]> {
  const { data, error } = await supabase
    .from('authorities')
    .select('code, name, is_active, moe_code')
    .order('name')
  if (error) throw error
  return (data ?? []) as Authority[]
}

/**
 * מוסיפה מועצה חדשה. הפונקציה במסד יוצרת גם את טבלת התלמידים שלה,
 * את ה-RLS ואת האינדקסים — לפי עקרון "רשות = עולם".
 */
export async function createAuthority(code: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_authority', {
    new_code: code.trim(),
    new_name: name.trim(),
  })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * עדכון שם הרשות ומצב הפעילות שלה.
 *
 * הקוד אינו ניתן לשינוי — הוא מזהה את טבלת התלמידים (`students_{code}`),
 * ושינוי שלו היה מנתק את הרשות מהנתונים שלה. נאכף גם בטריגר במסד.
 *
 * דורש [מיגרציה 011](../../supabase/migrations/011_authority_update.sql);
 * עד שתורץ, ה-RLS יחזיר שגיאה והמסך יסביר מה חסר.
 */
export async function updateAuthority(
  code: string,
  patch: { name?: string; is_active?: boolean },
) {
  const { error } = await supabase.from('authorities').update(patch).eq('code', code)
  if (!error) return

  // RLS שדוחה עדכון מחזיר "0 שורות" ולא שגיאה מפורשת — מסבירים מה לעשות
  throw new Error(
    `${error.message} — ייתכן שמיגרציה 011 טרם הורצה על המסד ` +
      '(היא זו שמתירה למנהל־על לערוך פרטי רשות).',
  )
}

/** הרשות שטבלת התלמידים שלה משמשת תבנית — אינה ניתנת למחיקה. */
export const TEMPLATE_AUTHORITY_CODE = '1400000'

export interface DeletedAuthoritySummary {
  code: string
  name: string
  students: number
  users: number
  uploads: number
  documents: number
}

/** מה עומד להימחק — נטען לפני האישור כדי שהמסך יציג מספרים אמיתיים. */
export async function authorityFootprint(code: string) {
  const [students, users, uploads, docs, files] = await Promise.all([
    supabase.from(`students_${code}`).select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true })
      .contains('authority_codes', [code]),
    supabase.from('moe_uploads').select('*', { count: 'exact', head: true })
      .eq('authority_code', code),
    supabase.from('client_documents').select('*', { count: 'exact', head: true })
      .eq('authority_code', code),
    listStoragePaths(UPLOADS_BUCKET, code),
  ])
  return {
    students: students.count ?? 0,
    users: users.count ?? 0,
    uploads: uploads.count ?? 0,
    documents: docs.count ?? 0,
    files: files.length,
  }
}

/**
 * כל הקבצים תחת תיקייה בבאקט, כולל תת-תיקיות.
 *
 * `moe-uploads` בנוי `{code}/{timestamp}/{file}` — שתי רמות, ולכן צריך
 * ירידה רקורסיבית. ב-Supabase Storage אין "תיקייה" אמיתית: רשומה בלי
 * `id` היא תחילית של נתיב ולא קובץ.
 */
async function listStoragePaths(bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !data) return []

  const paths: string[] = []
  for (const entry of data) {
    const full = `${prefix}/${entry.name}`
    if (entry.id) paths.push(full)
    else paths.push(...(await listStoragePaths(bucket, full)))
  }
  return paths
}

/**
 * מוחקת מועצה על כל מה שתלוי בה.
 *
 * הסדר אינו שרירותי: **הקבצים נמחקים לפני הרשומות**. מחיקת
 * `storage.objects` ב-SQL מוחקת את הרשומה ומשאירה את הקובץ עצמו בבאקט,
 * ולכן הניקוי חייב לעבור דרך ה-API של Storage. אם הוא נכשל — עוצרים
 * לפני שנגענו במסד: עדיף רשות שנשארה על קבצי מצב"ת יתומים עם תעודות
 * זהות של קטינים.
 *
 * השאר — טבלת התלמידים, השיוכים והרשומות התלויות — נמחק בטרנזקציה אחת
 * ב-[מיגרציה 013](../../supabase/migrations/013_delete_authority.sql).
 */
export async function deleteAuthority(
  code: string,
  confirmName: string,
): Promise<DeletedAuthoritySummary> {
  if (code === TEMPLATE_AUTHORITY_CODE) {
    throw new Error('אי אפשר למחוק את מועצת התבנית')
  }

  for (const bucket of [UPLOADS_BUCKET, DOCUMENTS_BUCKET]) {
    const paths = await listStoragePaths(bucket, code)
    // 100 בכל פעם — בקשה עם אלפי נתיבים נדחית
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100))
      if (error) {
        throw new Error(
          `מחיקת הקבצים מ-${bucket} נכשלה — ${error.message}. ` +
            'המועצה לא נמחקה; אפשר לנסות שוב.',
        )
      }
    }
  }

  const { data, error } = await supabase.rpc('delete_authority', {
    target_code: code,
    confirm_name: confirmName,
  })
  if (error) {
    throw new Error(
      `${error.message} — ייתכן שמיגרציה 013 טרם הורצה על המסד ` +
        '(היא זו שמגדירה את פונקציית המחיקה).',
    )
  }
  return data as DeletedAuthoritySummary
}

// ─────────────────────────── יומן פעולות ───────────────────────────

export interface AuditEntry {
  id: number
  at: string
  actor_email: string | null
  via: string
  action: 'insert' | 'update' | 'delete'
  entity: 'user' | 'authority'
  entity_id: string | null
  entity_label: string | null
  changes: Record<string, { לפני?: unknown; אחרי?: unknown }> | null
}

/**
 * יומן פעולות הניהול ([מיגרציה 014](../../supabase/migrations/014_audit_and_last_admin.sql)).
 *
 * נכתב בטריגר בלבד; ל-`authenticated` אין מדיניות כתיבה, ולכן גם מנהל-על
 * אינו יכול לשכתב אותו דרך ה-API. יומן שאפשר לערוך אינו יומן.
 */
export async function fetchAuditLog(limit = 50): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('admin_audit')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit)
  if (error) {
    throw new Error(
      `${error.message} — ייתכן שמיגרציה 014 טרם הורצה על המסד.`,
    )
  }
  return (data ?? []) as AuditEntry[]
}

export async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase.from('clients').select('*')
  if (error) throw error
  return (data ?? []) as Client[]
}

export async function fetchClient(code: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('authority_code', code)
    .maybeSingle()
  if (error) throw error
  return data as Client | null
}

export async function saveClient(client: Partial<Client> & { authority_code: string }) {
  const { error } = await supabase
    .from('clients')
    .upsert({ ...client, updated_at: new Date().toISOString() })
  if (error) throw error
}

/** כמה תלמידים בכל רשות — למספר על כרטיס הלקוח. */
export async function countStudents(code: string): Promise<number> {
  const { count, error } = await supabase
    .from(`students_${code}`)
    .select('MISPAR_ZEHUT', { count: 'exact', head: true })
  if (error) return 0 // אין טבלה לרשות הזו עדיין
  return count ?? 0
}

// ─────────────────────────── מסמכים ───────────────────────────

export async function fetchDocuments(code: string): Promise<ClientDocument[]> {
  const { data, error } = await supabase
    .from('client_documents')
    .select('*')
    .eq('authority_code', code)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ClientDocument[]
}

export async function uploadDocument(code: string, file: File, title: string) {
  const path = `${code}/${Date.now()}-${file.name}`
  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file)
  if (upErr) throw upErr

  const { error } = await supabase.from('client_documents').insert({
    authority_code: code,
    title: title || file.name,
    storage_path: path,
    mime_type: file.type,
    size_bytes: file.size,
  })
  if (error) throw error
}

export async function deleteDocument(doc: ClientDocument) {
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path])
  const { error } = await supabase.from('client_documents').delete().eq('id', doc.id)
  if (error) throw error
}

/** קישור זמני לצפייה במסמך (הבאקט פרטי). */
export async function documentUrl(doc: ClientDocument): Promise<string | null> {
  const { data } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, 60 * 10)
  return data?.signedUrl ?? null
}

// ─────────────────────────── הרשאות ───────────────────────────

const USER_BASE_COLUMNS =
  'id, email, display_name, role, authority_codes, scope_level, scope_values, is_suspended'
const USER_PROFILE_COLUMNS =
  'job_title, institution_name, institution_code, can_edit_extra'

/**
 * מחזירה את המשתמשים, ומדווחת אם שדות התפקיד והמוסד קיימים במסד.
 *
 * הם נוספים ב[מיגרציה 010](../../supabase/migrations/010_user_profile_fields.sql).
 * עד שתורץ, הבקשה המורחבת נכשלת והמסך פשוט לא מציג את השדות — במקום
 * להיכשל כולו. מיד אחרי ההרצה הם מופיעים בלי פריסה מחדש.
 */
export async function fetchUsers(): Promise<{
  users: ManagedUser[]
  hasProfileFields: boolean
}> {
  const extended = await supabase
    .from('users')
    .select(`${USER_BASE_COLUMNS}, ${USER_PROFILE_COLUMNS}`)
    .order('email')

  if (!extended.error) {
    return { users: (extended.data ?? []) as ManagedUser[], hasProfileFields: true }
  }

  const { data, error } = await supabase
    .from('users')
    .select(USER_BASE_COLUMNS)
    .order('email')
  if (error) throw error
  return { users: (data ?? []) as ManagedUser[], hasProfileFields: false }
}

/**
 * קורא ל-Edge Function `admin-users`. יצירת משתמש וקביעת סיסמה מחייבות את
 * מפתח ה-service_role, שאסור שיגיע לדפדפן — לכן הן רצות בצד שרת.
 * הפונקציה מאמתת בעצמה שהקורא הוא מנהל־על.
 */
async function callAdminFunction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })

  if (error) {
    // supabase-js מחזיר "non-2xx status code" גנרי ומשאיר את גוף התשובה
    // ב-error.context (אובייקט Response). ההודעה בעברית נמצאת שם.
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const detail = await context
        .clone()
        .json()
        .then((b) => (b as { error?: string })?.error)
        .catch(() => null)
      if (detail) throw new Error(detail)
    }
    throw new Error(error.message)
  }

  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error)
  }
  return data
}

export interface NewUserInput {
  email: string
  password: string
  display_name: string
  role: UserRole
  authority_codes: string[]
  scope_level: ScopeLevel
  scope_values: string[]
}

export async function createUser(input: NewUserInput) {
  return callAdminFunction({ action: 'create', ...input })
}

export async function setUserPassword(id: string, password: string) {
  return callAdminFunction({ action: 'set_password', id, password })
}

export async function deleteUser(id: string) {
  return callAdminFunction({ action: 'delete', id })
}

/**
 * משהה משתמש או מחזיר אותו לפעילות.
 * ההשהיה חוסמת את הכניסה עצמה (ban ב-Auth) ומנטרלת גם טוקן קיים
 * (הדגל is_suspended מנטרל את פונקציות ההרשאה — מיגרציה 007).
 */
export async function setUserSuspended(id: string, suspended: boolean) {
  return callAdminFunction({ action: 'set_suspended', id, suspended })
}

export async function updateUserPermissions(
  id: string,
  patch: Partial<
    Pick<
      ManagedUser,
      | 'role'
      | 'authority_codes'
      | 'scope_level'
      | 'scope_values'
      | 'job_title'
      | 'institution_name'
      | 'institution_code'
      | 'can_edit_extra'
    >
  >,
) {
  const { error } = await supabase.from('users').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * הערכים הזמינים לבחירת היקף — נגזרים מהנתונים עצמם.
 * יישובים: סמל + תיאור. מוסדות: סמל + שם.
 */
export async function fetchScopeOptions(
  code: string,
  level: Exclude<ScopeLevel, 'council'>,
): Promise<ScopeOption[]> {
  const [valueCol, labelCol] =
    level === 'locality'
      ? ['SEMEL_YISHUV1', 'TEUR_YISHUV1']
      : ['SEMEL_MOSAD', 'SHEM_MOSAD']

  // select דינמי — supabase-js לא יכול להסיק את הטיפוס, ולכן unknown ואז המרה
  const { data, error } = await supabase
    .from(`students_${code}`)
    .select(`${valueCol}, ${labelCol}`)
  if (error) throw error

  const map = new Map<string, ScopeOption>()
  for (const row of ((data ?? []) as unknown) as Record<string, unknown>[]) {
    const value = String(row[valueCol] ?? '').trim()
    if (!value) continue
    const existing = map.get(value)
    if (existing) {
      existing.count++
    } else {
      map.set(value, {
        value,
        label: String(row[labelCol] ?? '').trim() || value,
        count: 1,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'))
}

// ─────────────────────── העלאת קבצי מצב"ת ───────────────────────

/** ששת קבצי המצב"ת הנדרשים, לפי הקידומת בשם הקובץ. */
export const MOE_FILE_PREFIXES = [
  'TALMIDIM',
  'PIRTEY_KESHER',
  'GORMEY_KESHER',
  'MEGAMOT',
  'MOSDOT',
  'KITOT',
] as const

/** מזהה לאיזה קובץ מצב"ת שייך קובץ שנבחר, לפי הקידומת. */
export function classifyMoeFile(name: string): string | null {
  const upper = name.toUpperCase()
  return MOE_FILE_PREFIXES.find((p) => upper.startsWith(p)) ?? null
}

export async function fetchUploads(code: string): Promise<MoeUpload[]> {
  const { data, error } = await supabase
    .from('moe_uploads')
    .select('*')
    .eq('authority_code', code)
    .order('uploaded_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []) as MoeUpload[]
}

/**
 * מעלה את קבצי המצב"ת ל-Storage ורושם רשומת המתנה.
 * העיבוד עצמו (pandas) רץ מחוץ לענן — סוכן העיבוד תופס את הרשומה
 * תוך שניות, מוריד, מריץ וטוען. ראה agent/README.md.
 */
/**
 * עוטף שלב בהעלאה כך שהשגיאה תגיד **איפה** זה נפל.
 *
 * בלי זה כל כשל הגיע למסך כהודעה חשופה אחת — למשל
 * `Unexpected token '<'` — בלי לרמוז אם נפל קובץ מסוים, איזה, או שלב
 * הרישום. ההודעה הזו נראית כמו באג באתר, אבל היא בעצם אומרת שמישהו
 * בדרך (פרוקסי, מסנן תוכן, תוספת דפדפן) החזיר דף HTML במקום התשובה.
 */
async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    if (/not valid JSON|Unexpected token/i.test(raw)) {
      throw new Error(
        `${label} — התקבל דף HTML במקום תשובת שרת. ` +
        `זו כמעט תמיד חסימה בדרך: מסנן תוכן ברשת, פרוקסי, או תוספת דפדפן. ` +
        `נסה בחלון סתר או ברשת אחרת. [${raw.slice(0, 60)}]`
      )
    }
    if (/Failed to fetch|NetworkError/i.test(raw)) {
      throw new Error(`${label} — לא הייתה תשובה מהשרת. בדוק חיבור לאינטרנט. [${raw}]`)
    }
    throw new Error(`${label} — ${raw}`)
  }
}

export async function uploadMoeFiles(code: string, files: File[]) {
  const prefix = `${code}/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`

  let index = 0
  for (const file of files) {
    index += 1
    const where = `העלאת קובץ ${index}/${files.length} (${file.name}, ${(file.size / 1e6).toFixed(1)}MB)`
    const { error } = await step(where, async () =>
      await supabase.storage.from(UPLOADS_BUCKET).upload(`${prefix}/${file.name}`, file))
    if (error) throw new Error(`${where} — ${error.message}`)
  }

  const { error } = await step('רישום ההעלאה', async () =>
    await supabase.from('moe_uploads').insert({
      authority_code: code,
      storage_prefix: prefix,
      file_count: files.length,
      status: 'pending',
    }))
  if (error) throw new Error(`רישום ההעלאה — ${error.message}`)
  return prefix
}
