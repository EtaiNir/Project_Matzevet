// נתוני האזור האישי לפי תפקיד: מה פתוח לטיפול, ואיזה מספרים בפס העליון.
//
// כל טוען מחזיר "משימות" — דבר פתוח שיש מה לעשות איתו, עם קישור לרשימה
// שמאחוריו. משימה מופיעה רק כשבאמת יש משהו: התראת שווא אחת מלמדת להתעלם
// מהרשימה כולה (סבא, על "הכפתור האדום").
//
// כל הקריאות רצות בהרשאות של המשתמש (RLS), ולכן הספירות הן בדיוק מה שהוא
// רשאי לראות. זכאות — ספירה של מה שמנוע הזכאות חישב (041, decisions/021).

import { supabase } from '@/lib/supabase'
import { fetchClients, fetchUsers, type Authority, type MoeUpload } from '@/lib/admin'
import {
  buildIndex,
  classSortKey,
  eligibilityKind,
  fetchRounds,
  isEligible,
  isOnTheEdge,
  loadRound,
  t1Summary,
  type BagrutRound,
  type BagrutUploadReport,
} from '@/lib/bagrut'
import { daysUntil, isFollowupDue } from '@/lib/bagrutCycle'
import { fetchSavedViews, fetchSharedWithMe } from '@/lib/savedViews'

/** רשות שלא עודכנה יותר מזה — "לא עודכנה החודש" */
export const STALE_DAYS = 35
/** העלאה שתקועה ב"ממתין"/"בעיבוד" יותר מזה — הסוכן כנראה לא רץ */
export const STUCK_MINUTES = 60
/** תשלום או חידוש הסכם בטווח הזה — מופיע לטיפול */
export const BILLING_DAYS = 30

export interface Todo {
  key: string
  /** red — משהו נכשל או באיחור · amber — ממתין להחלטה או מתקרב */
  tone: 'red' | 'amber'
  text: string
  detail?: string
  /** הרשות / בית הספר שהמשימה שייכת לו */
  source?: string
  to: string
  /** סבב הבגרות שהקישור צריך לפתוח (המעטפת קוראת אותו מ-sessionStorage) */
  roundId?: string
}

export interface Stat {
  label: string
  sub: string
  value: string | number
}

const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86400000
const ageMinutes = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60000

// ─────────────────────────────── מנהל־על ───────────────────────────────

export interface AdminOverview {
  todos: Todo[]
  users: number
}

/**
 * מה תקוע במערכת: עדכונים שנכשלו או נתקעו, רשויות שלא עודכנו, קליטות
 * שממתינות לאישור, סבבי בגרות עם אזהרות, משתמשים בלי גישה, ומועדי תשלום.
 *
 * `students` — מספר התלמידים לכל רשות (כבר נטען בדף); רשות בלי תלמידים
 * אינה "לא מעודכנת", היא פשוט עוד לא הוקמה.
 */
export async function loadAdminOverview(authorities: Authority[], students: Map<string, number>): Promise<AdminOverview> {
  const name = (code: string) => authorities.find((a) => a.code === code)?.name ?? `רשות ${code}`
  const active = authorities.filter((a) => a.is_active)
  const todos: Todo[] = []

  const [moe, tierB, bagrut, users, clients] = await Promise.all([
    supabase.from('moe_uploads').select('authority_code, status, uploaded_at, processed_at, error_message')
      .order('uploaded_at', { ascending: false }).limit(1000),
    supabase.from('tier_b_uploads').select('authority_code, source_group, status, uploaded_at')
      .in('status', ['awaiting_approval', 'pending', 'mapping', 'processing']),
    supabase.from('bagrut_uploads').select('authority_code, school_code, season, school_year, status, uploaded_at, report, error_message')
      .order('uploaded_at', { ascending: false }).limit(200),
    fetchUsers().then((r) => r.users).catch(() => []),
    fetchClients().catch(() => []),
  ])

  // ── מצב"ת: לכל רשות — ההעלאה האחרונה, והעדכון המוצלח האחרון
  const uploads = (moe.data ?? []) as Pick<MoeUpload, 'authority_code' | 'status' | 'uploaded_at' | 'processed_at' | 'error_message'>[]
  const latest = new Map<string, (typeof uploads)[number]>()
  const lastDone = new Map<string, string>()
  for (const u of uploads) {
    if (!latest.has(u.authority_code)) latest.set(u.authority_code, u)
    if (u.status === 'done' && u.processed_at && !lastDone.has(u.authority_code)) lastDone.set(u.authority_code, u.processed_at)
  }
  for (const [code, u] of latest) {
    const to = `/admin/client/${code}`
    if (u.status === 'failed') {
      todos.push({ key: `moe-failed-${code}`, tone: 'red', source: name(code), to, text: 'עדכון המצב"ת נכשל', detail: u.error_message ?? undefined })
    } else if ((u.status === 'pending' || u.status === 'processing') && ageMinutes(u.uploaded_at) > STUCK_MINUTES) {
      todos.push({
        key: `moe-stuck-${code}`, tone: 'red', source: name(code), to,
        text: `עדכון המצב"ת ${u.status === 'pending' ? 'ממתין' : 'בעיבוד'} יותר משעה`,
        detail: 'סביר שהסוכן אינו רץ — לבדוק את agent.log במחשב שלו',
      })
    }
  }
  for (const a of active) {
    if (!students.get(a.code)) continue
    const done = lastDone.get(a.code)
    if (latest.get(a.code)?.status === 'failed') continue // כבר מופיעה כנכשלת
    if (!done || ageDays(done) > STALE_DAYS) {
      todos.push({
        key: `moe-stale-${a.code}`, tone: 'amber', source: a.name, to: `/admin/client/${a.code}`,
        text: 'המצבת לא עודכנה החודש',
        detail: done ? `עדכון אחרון לפני ${Math.floor(ageDays(done))} ימים` : 'אין עדכון רשום',
      })
    }
  }

  // ── דרג ב' (גנים): ממתין לאישור מיפוי, או תקוע
  for (const t of (tierB.data ?? []) as { authority_code: string; source_group: string; status: string; uploaded_at: string }[]) {
    const to = `/upload-ganim/${t.authority_code}`
    if (t.status === 'awaiting_approval') {
      todos.push({ key: `tierb-${t.authority_code}-${t.source_group}`, tone: 'amber', source: name(t.authority_code), to, text: `קליטת ${t.source_group} ממתינה לאישור המיפוי` })
    } else if (ageMinutes(t.uploaded_at) > STUCK_MINUTES) {
      todos.push({ key: `tierb-stuck-${t.authority_code}-${t.source_group}`, tone: 'red', source: name(t.authority_code), to, text: `קליטת ${t.source_group} תקועה יותר משעה`, detail: 'סביר שהסוכן אינו רץ' })
    }
  }

  // ── בגרות: הקליטה האחרונה של כל בית ספר — נכשלה, או נקלטה עם אזהרות
  const seenSchool = new Set<string>()
  for (const b of (bagrut.data ?? []) as { authority_code: string; school_code: string; season: string; school_year: string; status: string; uploaded_at: string; report: BagrutUploadReport | null; error_message: string | null }[]) {
    const k = `${b.authority_code}:${b.school_code}`
    if (seenSchool.has(k)) continue
    seenSchool.add(k)
    const school = b.report?.school_name ?? b.school_code
    // הקליטה ובית הספר — בכרטיס הלקוח (החלטה 016), שם רואים את ההיסטוריה ומעלים שוב
    const to = `/admin/client/${b.authority_code}?tab=data&product=bagrut&school=${b.school_code}`
    const round = `${b.season} ${b.school_year}`
    if (b.status === 'failed') {
      todos.push({ key: `bagrut-failed-${k}`, tone: 'red', source: school, to, text: `קליטת סבב ${round} נכשלה`, detail: b.error_message ?? undefined })
    } else if ((b.status === 'pending' || b.status === 'processing') && ageMinutes(b.uploaded_at) > STUCK_MINUTES) {
      todos.push({ key: `bagrut-stuck-${k}`, tone: 'red', source: school, to, text: `קליטת סבב ${round} תקועה יותר משעה`, detail: 'סביר שהסוכן אינו רץ' })
    } else if (b.status === 'done' && b.report?.warnings?.length && ageDays(b.uploaded_at) <= 30) {
      todos.push({ key: `bagrut-warn-${k}`, tone: 'amber', source: school, to, text: `סבב ${round} נקלט עם ${b.report.warnings.length} אזהרות`, detail: b.report.warnings[0]?.text })
    }
  }

  // ── משתמשים שנוצרו ולא קיבלו גישה לאף מוצר
  const noAccess = users.filter((u) => u.role !== 'super_admin' && !u.is_suspended && (u.scope_level ?? 'none') === 'none' && !u.bagrut_role)
  if (noAccess.length) {
    const code = noAccess[0].authority_codes[0]
    todos.push({
      key: 'users-no-access', tone: 'amber', to: code ? `/admin/client/${code}` : '/admin',
      text: noAccess.length === 1 ? 'משתמש בלי גישה לאף מוצר' : `${noAccess.length} משתמשים בלי גישה לאף מוצר`,
      detail: noAccess.slice(0, 3).map((u) => u.email).join(', ') + (noAccess.length > 3 ? '…' : ''),
    })
  }

  // ── תשלום וחידוש הסכם — בתוך 30 יום, או שעבר
  for (const c of clients) {
    for (const [field, label] of [['next_payment_date', 'תשלום'], ['contract_renewal', 'חידוש ההסכם']] as const) {
      const d = c[field]
      if (!d) continue
      const days = daysUntil(d)
      if (days > BILLING_DAYS) continue
      todos.push({
        key: `billing-${c.authority_code}-${field}`, tone: days < 0 ? 'red' : 'amber', source: name(c.authority_code), to: `/admin/client/${c.authority_code}`,
        text: days < 0 ? `מועד ה${label} עבר` : `${label} בעוד ${days} ימים`,
        detail: new Date(d).toLocaleDateString('he-IL'),
      })
    }
  }

  return { todos, users: users.filter((u) => u.role !== 'super_admin').length }
}

// ─────────────────────────────── מנהל רשות ───────────────────────────────

export interface ManagerOverview {
  code: string
  placed: number | null
  ganim: number | null
  lastUpdate: string | null
  todos: Todo[]
  views: { id: string; name: string; members: number; shared: boolean }[]
}

/** הנתונים שלו עדכניים? מה ממתין לו? והרשימות שהוא עובד איתן. */
export async function loadManagerOverview(code: string, authorityName: string): Promise<ManagerOverview> {
  const [placed, ganim, moe, tierB, views, shared] = await Promise.all([
    supabase.from(`students_${code}`).select('*', { count: 'exact', head: true }).eq('MATZAV_RISHUM_TEUR', 'משובץ'),
    // טבלת דרג ב' נוצרת רק בקליטה הראשונה — חסרה = אין גנים, לא שגיאה
    supabase.from(`students_${code}_tier_b`).select('*', { count: 'exact', head: true }).eq('source_group', 'גנים'),
    supabase.from('moe_uploads').select('status, uploaded_at, processed_at, error_message')
      .eq('authority_code', code).order('uploaded_at', { ascending: false }).limit(20),
    supabase.from('tier_b_uploads').select('source_group, status').eq('authority_code', code).eq('status', 'awaiting_approval'),
    fetchSavedViews(code),
    fetchSharedWithMe(code),
  ])

  const todos: Todo[] = []
  const uploads = (moe.data ?? []) as Pick<MoeUpload, 'status' | 'uploaded_at' | 'processed_at' | 'error_message'>[]
  const last = uploads[0]
  const lastDone = uploads.find((u) => u.status === 'done' && u.processed_at)?.processed_at ?? null
  const upload = `/upload/${code}`
  if (last?.status === 'failed') {
    todos.push({ key: `m-failed-${code}`, tone: 'red', source: authorityName, to: upload, text: 'עדכון המצב"ת האחרון נכשל', detail: last.error_message ?? 'אפשר להעלות את הקבצים מחדש' })
  } else if (!lastDone || ageDays(lastDone) > STALE_DAYS) {
    // העלאה שעדיין בעיבוד אינה "לא עודכן" — היא בדרך
    if (!(last && (last.status === 'pending' || last.status === 'processing'))) {
      todos.push({
        key: `m-stale-${code}`, tone: 'amber', source: authorityName, to: upload,
        text: 'המצבת לא עודכנה החודש',
        detail: lastDone ? `עדכון אחרון לפני ${Math.floor(ageDays(lastDone))} ימים — להעלות את קובצי המצב"ת החדשים` : 'להעלות את קובצי המצב"ת',
      })
    }
  }
  for (const t of (tierB.data ?? []) as { source_group: string }[]) {
    todos.push({ key: `m-tierb-${code}-${t.source_group}`, tone: 'amber', source: authorityName, to: `/upload-ganim/${code}`, text: `קליטת ${t.source_group} ממתינה לאישור המיפוי שלך` })
  }

  const sharedIds = new Set(shared.filter((s) => s.kind === 'view').map((s) => s.item_id))
  return {
    code,
    placed: placed.error ? null : placed.count ?? 0,
    ganim: ganim.error ? null : ganim.count ?? 0,
    lastUpdate: lastDone,
    todos,
    views: views.slice(0, 6).map((v) => ({ id: v.id, name: v.name, members: v.member_count ?? 0, shared: sharedIds.has(v.id) })),
  }
}

// ─────────────────────────────── בגרות: רכזים ומחנכים ───────────────────────────────

export interface ClassRow {
  cls: string
  n: number
  /** אחוז זכאים (שכבה מסיימת) או אחוז עם ציון מתחת ל-55 (שכבה אחרת) */
  pct: number
  edge: number
  followups: number
}

export interface BagrutOverview {
  round: BagrutRound
  /** graduating — יש ניתוח זכאות (T2); progress — שכבה שאינה מסיימת, לפי הציונים */
  mode: 'graduating' | 'progress'
  /** "הכיתה שלי: יג-2" / "שכבה יג" / "בית הספר" */
  scopeLabel: string
  stats: Stat[]
  todos: Todo[]
  classes: ClassRow[]
  /** הרשימה הראשית — לחיצה אחת אל התלמידים שלו */
  listTo: string
}

/**
 * הסבב האחרון של כל בית ספר שהמשתמש רואה, מצומצם לתלמידים שה-RLS מחזיר לו
 * — מחנך מקבל רק את הכיתה שלו, רכז שכבה רק את השכבה. כך אותו קוד מתאים
 * לשלושת התפקידים.
 */
/**
 * `general` — כשסומנו כיתות או שכבות (bagrutGeneralScope): רק תלמידיהן נספרים
 * כאן, גם אם ה-RLS נותן גם את תלמידי המקצוע (מחנך שהוא גם רכז מקצוע, 037).
 */
export async function loadBagrutOverviews(codes: string[], role: string, general: { grades: string[]; classes: string[] } | null = null): Promise<BagrutOverview[]> {
  const rounds = (await Promise.all(codes.map((c) => fetchRounds(c).catch(() => [] as BagrutRound[])))).flat()
  // הסבב האחרון לכל בית ספר
  const latest = new Map<string, BagrutRound>()
  for (const r of [...rounds].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const k = `${r.authority_code}:${r.school_code}`
    if (!latest.has(k)) latest.set(k, r)
  }

  const out: BagrutOverview[] = []
  for (const round of latest.values()) {
    const data = await loadRound(round).catch(() => null)
    if (!data || !data.students.length) continue
    // בית הספר בכתובת (החלטה 016) — בלעדיו הקישור נוחת במסך הבחירה
    const base = `/bagrut/${round.authority_code}/${round.school_code}`
    const school = round.school_name ?? round.school_code
    const students = general
      ? data.students.filter((s) => (s.grade && general.grades.includes(s.grade)) || (s.class_name && general.classes.includes(s.class_name)))
      : data.students
    const grad = students.filter((s) => s.in_t2)
    const mode = grad.length ? 'graduating' : 'progress'
    const pool = mode === 'graduating' ? grad : students
    const classNames = [...new Set(pool.map((s) => s.class_name).filter(Boolean))] as string[]
    const grades = [...new Set(students.map((s) => s.grade).filter(Boolean))] as string[]

    const scopeLabel =
      role === 'homeroom' && classNames.length === 1 ? `הכיתה שלי: ${classNames[0]}`
        : role === 'homeroom' ? `הכיתות שלי: ${classNames.sort((a, b) => classSortKey(a).localeCompare(classSortKey(b))).join(', ')}`
          : role === 'grade_coordinator' && grades.length === 1 ? `שכבה ${grades[0]}`
            : 'בית הספר'

    const listQ = new URLSearchParams()
    if (mode === 'graduating') listQ.set('view', 'graduating')
    else if (grades.length === 1) listQ.set('grade', grades[0])
    if (classNames.length === 1) listQ.set('class', classNames[0])
    const q = (extra: Record<string, string>) => {
      const p = new URLSearchParams(listQ)
      for (const [k, v] of Object.entries(extra)) p.set(k, v)
      return `${base}/students?${p}`
    }

    const todos: Todo[] = []
    const followupOf = (id: string) => data.tracking.get(id)?.next_followup
    const due = students.filter((s) => isFollowupDue(followupOf(s.student_id)))
    const overdue = due.filter((s) => daysUntil(followupOf(s.student_id)!) < 0).length
    if (due.length) {
      todos.push({
        key: `b-followup-${round.id}`, tone: overdue ? 'red' : 'amber', source: school, roundId: round.id,
        to: `${base}/students?view=followup`,
        text: due.length === 1 ? 'תלמיד אחד למעקב השבוע' : `${due.length} תלמידים למעקב השבוע`,
        detail: overdue ? `מתוכם ${overdue} באיחור` : 'מעקב שמועדו בשבעת הימים הקרובים',
      })
    }
    const hasPlan = (id: string) => {
      const c = data.actionCounts.get(id)
      return Boolean(c && c.active + c.done)
    }
    const edgeNoPlan = grad.filter((s) => isOnTheEdge(s) && !hasPlan(s.student_id)).length
    if (edgeNoPlan) {
      todos.push({
        key: `b-edge-${round.id}`, tone: 'amber', source: school, roundId: round.id,
        to: q({ view: 'edge', noplan: '1' }),
        text: edgeNoPlan === 1 ? 'תלמיד אחד על הסף בלי תוכנית התערבות' : `${edgeNoPlan} תלמידים על הסף בלי תוכנית התערבות`,
        detail: 'ללא זכאות עם חסם אחד בלבד — הכי קרובים לזכאות, ועוד לא התחילו לטפל בהם',
      })
    }

    // ── מספרים ופירוק לפי כיתה
    let stats: Stat[]
    const weakOf = new Map<string, boolean>()
    if (mode === 'graduating') {
      const eligible = grad.filter((s) => isEligible(eligibilityKind(s))).length
      const notEligible = grad.filter((s) => eligibilityKind(s) === 'not_eligible').length
      stats = [
        { label: 'אחוז זכאות', sub: `${eligible} זכאים מתוך ${grad.length}`, value: `${Math.round((eligible / grad.length) * 100)}%` },
        { label: 'ללא זכאות', sub: 'מחושב מהציונים', value: notEligible },
        { label: 'על הסף', sub: 'ללא זכאות, חסם אחד', value: grad.filter(isOnTheEdge).length },
      ]
    } else {
      const index = buildIndex(data)
      for (const s of students) weakOf.set(s.student_id, t1Summary(index, s.student_id).weakGrades > 0)
      const weak = [...weakOf.values()].filter(Boolean).length
      stats = [
        { label: 'תלמידים', sub: grades.length === 1 ? `שכבה ${grades[0]}` : 'בסבב', value: students.length },
        { label: 'עם ציון חלש', sub: 'מתחת ל-55 בשאלון אחד לפחות', value: weak },
      ]
    }

    const classes: ClassRow[] = classNames
      .sort((a, b) => classSortKey(a).localeCompare(classSortKey(b)))
      .map((cls) => {
        const inCls = pool.filter((s) => s.class_name === cls)
        const hit = mode === 'graduating'
          ? inCls.filter((s) => isEligible(eligibilityKind(s))).length
          : inCls.filter((s) => weakOf.get(s.student_id)).length
        return {
          cls,
          n: inCls.length,
          pct: inCls.length ? Math.round((hit / inCls.length) * 100) : 0,
          edge: mode === 'graduating' ? inCls.filter(isOnTheEdge).length : 0,
          followups: inCls.filter((s) => isFollowupDue(followupOf(s.student_id))).length,
        }
      })

    out.push({ round, mode, scopeLabel, stats, todos, classes, listTo: q({}) })
  }
  return out
}

/** המעטפת של הבגרות פותחת את הסבב השמור ב-sessionStorage (BagrutShell, ROUND_KEY) */
export function rememberRound(roundId: string | undefined) {
  if (!roundId) return
  try {
    sessionStorage.setItem('bagrut:round', roundId)
  } catch {
    /* מצב פרטי — ייפתח הסבב האחרון */
  }
}
