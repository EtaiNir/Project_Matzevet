// מחזור ההתערבות — הניתוח שמאחורי לשונית המעקב (docs/bagrut-intervention-design.md).
//
// ⚠️ זכאות נקבעת רק לפי T2 (decisions/014 §8). כאן אין שום החלטת זכאות:
//   - ההצעות לתוכנית הן **פריטי "ההתערבות המומלצת" של T2**, אחד לאחד.
//   - הקוד מוסיף רק חשבון ציונים על מספרי T1 ומשקלי המצפן: אילו שאלונים
//     נשארו במקצוע, ואיזה ציון צריך בהם כדי שהציון הסופי יגיע ל-55.
//   - אין כאן "יהיה זכאי", "יגיע ל-21" או בדיקה של כללי החוקה.

import {
  ELIGIBILITY_META,
  eligibilityKind,
  parseBlockers,
  type BagrutStudent,
  type Blocker,
  type RoundIndex,
  type RoundSubject,
  type SubjectRow,
} from './bagrut'

const PASS = 55

// ─────────────────────────────── ההתערבות של T2 ───────────────────────────────

export type InterventionKind = 'complete' | 'improve' | 'units' | 'core_units' | 'reinforced' | 'internal' | 'other'

export interface InterventionItem {
  /** המפתח הקבוע של הפריט — suggest_key של הפעולה שתיוולד ממנו */
  key: string
  text: string
  kind: InterventionKind
  /** למקצועות: השמות כפי שנכתבו ב-T2 */
  subjects: string[]
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * "להשלים: אנגלית; להוסיף 2 יח"ל" → פריטים. התבניות נלקחו מ-T2 של שלושת בתי
 * הספר (אבו רביע, רמות זבולון, אגיאל). פריט שאינו מוכר נשאר "אחר" עם הטקסט שלו
 * — לא נזרק.
 */
export function parseIntervention(text: string | null): InterventionItem[] {
  if (!text) return []
  return text
    .split(';')
    .map((p) => squash(p).replace(/\.$/, ''))
    .filter(Boolean)
    .map((t): InterventionItem => {
      const key = `t2:${t}`
      let m = t.match(/^להשלים\s*:\s*(.+)$/)
      if (m) return { key, text: t, kind: 'complete', subjects: splitSubjects(m[1]) }
      m = t.match(/^(?:לשפר שלילי|לטפל בשלילי)\s*:\s*(.+)$/)
      // "ערבית לערבים 41" — הציון שבסוף אינו חלק משם המקצוע
      if (m) return { key, text: t, kind: 'improve', subjects: splitSubjects(m[1]).map((s) => s.replace(/\s+\d{1,3}$/, '')) }
      if (/^להשלים\s+\d+\s+יח"?ל\s+מלל/.test(t)) return { key, text: t, kind: 'core_units', subjects: [] }
      if (/^להוסיף\s+\d+\s+יח"?ל/.test(t)) return { key, text: t, kind: 'units', subjects: [] }
      if (/מקצוע מוגבר/.test(t)) return { key, text: t, kind: 'reinforced', subjects: [] }
      // "דרישות פנימיות נוספות" (אגיאל) וגם "הדרישות הפנימיות" (אבו רביע, רמות זבולון)
      if (/ה?דרישות ה?פנימיות/.test(t)) return { key, text: t, kind: 'internal', subjects: [] }
      return { key, text: t, kind: 'other', subjects: [] }
    })
}

function splitSubjects(s: string): string[] {
  return s.split(',').map(squash).filter(Boolean)
}

// ─────────────────────────────── מקצוע לפי שם ───────────────────────────────

const norm = (s: string) => squash(s.replace(/["'״׳]/g, '').replace(/יחל/g, ''))

/**
 * שם מקצוע כפי שנכתב ב-T2 ("מתמטיקה", "אנגלית 3 יח"ל") → מקצוע בסבב. התאמה
 * מדויקת קודם; אחרת מקצוע ששמו מתחיל בשם (מתמטיקה → מתמטיקה 4 יח"ל), ומבין
 * כמה כאלה — זה שהתלמיד לומד.
 */
export function matchSubject(name: string, index: RoundIndex, sid: string): RoundSubject | undefined {
  const n = norm(name)
  const subjects = [...index.subjectByKey.values()]
  const studies = (s: RoundSubject) =>
    index.metrics.get(sid)?.has(s.subject_key) || index.gradesByStudent.get(sid)?.has(s.subject_key)
  const exact = subjects.filter((s) => norm(s.subject_name) === n)
  if (exact.length) return exact.find(studies) ?? exact[0]
  const prefix = subjects.filter((s) => norm(s.subject_name).startsWith(n))
  return prefix.find(studies) ?? (prefix.length === 1 ? prefix[0] : undefined)
}

// ─────────────────────────────── חשבון ציונים במקצוע ───────────────────────────────

export interface SubjectMath {
  subject: RoundSubject
  metrics: SubjectRow | undefined
  final: number | null
  /** ציון מצטבר = סכום המשוקללים בשאלונים שבוצעו */
  cumulative: number | null
  cumWeight: number | null
  /** שאלונים בתוכנית (משקל > 0) שעוד אין להם ציון. שקולים — אחד לקבוצה */
  remaining: { label: string; weight: number }[]
  remainingWeight: number
  /** הציון הממוצע הנדרש בשאלונים שנשארו כדי שהסופי יגיע ל-55 */
  neededToPass: number | null
  /** מקצוע שהושלם מתחת ל-55: השאלון שהכי זול לשפר */
  bestRetake: { code: number; current: number; needed: number } | null
  /** ציוני חסם 1–4 — מחייבים בחינה חוזרת */
  blocked: { code: number; grade: number }[]
}

export function subjectMath(index: RoundIndex, sid: string, subject: RoundSubject): SubjectMath {
  const m = index.metrics.get(sid)?.get(subject.subject_key)
  const grades = index.gradesByStudent.get(sid)?.get(subject.subject_key) ?? []
  const graded = new Set(grades.filter((g) => g.grade != null).map((g) => g.questionnaire_code))
  const program = index.programBySubject.get(subject.subject_key) ?? []

  // שאלונים שנשארו — שאלון שקול נחשב "בוצע" אם אחד מקבוצתו בוצע
  const doneGroups = new Set(program.filter((p) => p.alt_group != null && graded.has(p.questionnaire_code)).map((p) => p.alt_group))
  const remaining: { label: string; weight: number }[] = []
  const seenGroup = new Set<number>()
  for (const p of program) {
    if (!(p.weight ?? 0) || graded.has(p.questionnaire_code)) continue
    if (p.alt_group != null) {
      if (doneGroups.has(p.alt_group) || seenGroup.has(p.alt_group)) continue
      seenGroup.add(p.alt_group)
      const mates = program.filter((x) => x.alt_group === p.alt_group).map((x) => x.questionnaire_code)
      remaining.push({ label: mates.join(' או '), weight: p.weight ?? 0 })
    } else {
      remaining.push({ label: String(p.questionnaire_code), weight: p.weight ?? 0 })
    }
  }

  const final = m?.final_grade ?? null
  const cumulative = m?.cumulative_grade ?? null
  const cumWeight = m?.cumulative_weight ?? null
  // המשקל שנשאר: מה שה-T1 אומר שבוצע, ואם אין — סכום מה שנשאר במצפן
  const remainingWeight = cumWeight != null ? Math.max(0, 1 - cumWeight) : remaining.reduce((s, r) => s + r.weight, 0)
  const neededToPass =
    final == null && cumulative != null && remainingWeight > 0.001 && remaining.length
      ? Math.ceil((PASS - cumulative) / remainingWeight)
      : null

  let bestRetake: SubjectMath['bestRetake'] = null
  if (final != null && final < PASS) {
    for (const g of grades) {
      if (g.grade == null || !(g.weight ?? 0) || g.grade >= 100) continue
      const needed = Math.ceil(g.grade + (PASS - final) / (g.weight as number))
      if (needed <= 100 && (!bestRetake || needed - g.grade < bestRetake.needed - bestRetake.current)) {
        bestRetake = { code: g.questionnaire_code, current: g.grade, needed }
      }
    }
  }

  const blocked = grades
    .filter((g) => g.grade != null && g.grade >= 1 && g.grade <= 4)
    .map((g) => ({ code: g.questionnaire_code, grade: g.grade as number }))

  return { subject, metrics: m, final, cumulative, cumWeight, remaining, remainingWeight, neededToPass, bestRetake, blocked }
}

/** "נדרש 64" / "גם 100 לא יספיק" / "כבר מעל 55" — ניסוח אחד לכל המסכים */
export function neededText(n: number | null): string | null {
  if (n == null) return null
  if (n > 100) return 'גם 100 בשאלונים שנשארו לא יביא ל-55'
  if (n <= 0) return 'הציון המצטבר כבר מבטיח 55 — נשאר להשלים את השאלונים'
  return `נדרש ממוצע ${n} בשאלונים שנשארו כדי לסיים ב-55`
}

// ─────────────────────────────── הצעות לתוכנית ───────────────────────────────

export interface Suggestion {
  key: string
  /** הפריט של T2 שממנו נולדה */
  source: string
  title: string
  detail: string | null
  action_type: string
  subject_key: string | null
  questionnaire_code: number | null
  required_grade: number | null
  /** מאמץ משוער (נקודות להוסיף / ציון נדרש) — ל"מה הכי קרוב לתיקון". נמוך = קרוב */
  effort: number
}

function inProgress(index: RoundIndex, sid: string, filter: (s: RoundSubject) => boolean = () => true): SubjectMath[] {
  return [...index.subjectByKey.values()]
    .filter((s) => s.subject_group !== 'פנימי' && filter(s) && index.metrics.get(sid)?.has(s.subject_key))
    .map((s) => subjectMath(index, sid, s))
    .filter((x) => x.final == null && x.remaining.length > 0)
}

const listInProgress = (xs: SubjectMath[]) =>
  xs.length
    ? 'מקצועות בתהליך: ' + xs.map((x) => `${x.subject.subject_name}${x.neededToPass != null && x.neededToPass <= 100 ? ` (נדרש ${Math.max(0, x.neededToPass)})` : ''}`).join(' · ')
    : null

/**
 * ההצעות — פריט אחד מההתערבות של T2 = הצעה אחת, ולמקצועות — הצעה לכל מקצוע,
 * עם חשבון הציונים. הסדר הוא הסדר של T2.
 */
export function buildSuggestions(student: BagrutStudent, index: RoundIndex): Suggestion[] {
  const sid = student.student_id
  const out: Suggestion[] = []
  for (const item of parseIntervention(student.intervention)) {
    if (item.kind === 'complete' || item.kind === 'improve') {
      for (const name of item.subjects) {
        const sub = matchSubject(name, index, sid)
        const key = `${item.key}|${norm(name)}`
        if (!sub) {
          out.push({ key, source: item.text, title: item.kind === 'complete' ? `להשלים את ${name}` : `לשפר את ${name}`,
            detail: null, action_type: item.kind === 'complete' ? 'השלמת שאלון' : 'שיפור ציון במועד הבא',
            subject_key: null, questionnaire_code: null, required_grade: null, effort: 90 })
          continue
        }
        const x = subjectMath(index, sid, sub)
        if (x.blocked.length) {
          for (const b of x.blocked) {
            out.push({ key: `${key}|retake:${b.code}`, source: item.text,
              title: `בחינה חוזרת בשאלון ${b.code} — ${sub.subject_name}`,
              detail: `ציון חסם ${b.grade}: אינו נספר, ומחייב בחינה חוזרת`,
              action_type: 'בחינה חוזרת', subject_key: sub.subject_key, questionnaire_code: b.code,
              required_grade: null, effort: 60 })
          }
          continue
        }
        if (x.bestRetake) {
          out.push({ key, source: item.text, title: `לשפר את ${sub.subject_name} (סופי ${x.final})`,
            detail: `שיפור שאלון ${x.bestRetake.code} מ-${x.bestRetake.current} ל-${x.bestRetake.needed} לפחות יביא את הציון הסופי ל-55`,
            action_type: 'שיפור ציון במועד הבא', subject_key: sub.subject_key, questionnaire_code: x.bestRetake.code,
            required_grade: x.bestRetake.needed, effort: x.bestRetake.needed - x.bestRetake.current })
          continue
        }
        const remaining = x.remaining.map((r) => `${r.label} (${Math.round(r.weight * 100)}%)`).join(', ')
        const need = x.neededToPass
        out.push({ key, source: item.text,
          title: item.kind === 'complete' ? `להשלים את ${sub.subject_name}` : `לשפר את ${sub.subject_name}`,
          detail: [remaining && `נשארו: ${remaining}`, neededText(need)].filter(Boolean).join('. ') || null,
          action_type: 'השלמת שאלון', subject_key: sub.subject_key, questionnaire_code: null,
          required_grade: need != null && need >= 1 && need <= 100 ? need : null,
          effort: need == null ? 85 : Math.max(0, Math.min(need, 100)) })
      }
      continue
    }
    // פריטים כלליים — הטקסט של T2 כמות שהוא; לצידו מידע בלבד, בלי טענה
    const detail =
      item.kind === 'units' ? listInProgress(inProgress(index, sid))
      : item.kind === 'core_units' ? listInProgress(inProgress(index, sid, (s) => s.subject_group === 'חובה'))
      : item.kind === 'reinforced' ? listInProgress(inProgress(index, sid, (s) => s.units === 5))
      : null
    out.push({
      key: item.key, source: item.text, title: item.text, detail,
      action_type: item.kind === 'internal' ? 'בדיקה מול בית הספר' : item.kind === 'other' ? 'אחר' : 'השלמת שאלון',
      subject_key: null, questionnaire_code: null, required_grade: null,
      effort: item.kind === 'internal' ? 95 : item.kind === 'other' ? 85 : 75,
    })
  }
  return out
}

// ─────────────────────────────── תמונת המצב — שש השאלות ───────────────────────────────

export interface StudentPicture {
  /** 1. איפה הוא עומד — משפט אחד */
  sentence: string
  graduating: boolean
  /** 2. מה מפריד אותו — החסמים של T2, ומקצועות מתחת ל-55 עם הפער */
  blockers: Blocker[]
  failing: { name: string; final: number; gap: number }[]
  /** 3. מה הכי קרוב לתיקון — עד שתי הצעות עם המאמץ הקטן ביותר */
  closest: Suggestion[]
  /** 4. מה בסכנה — מקצועות בתהליך שהממוצע בהם עד כה מתחת ל-55 */
  atRisk: { name: string; average: number; done: number }[]
  /** 5. על מה לבנות — מקצועות שהושלמו בציון גבוה */
  strengths: { name: string; final: number }[]
}

export function studentPicture(student: BagrutStudent, index: RoundIndex, suggestions: Suggestion[]): StudentPicture {
  const sid = student.student_id
  const kind = eligibilityKind(student)
  const graduating = kind !== 'not_graduating'
  const blockers = parseBlockers(student.blockers)
  const sentence = graduating
    ? [ELIGIBILITY_META[kind].label, blockers.map((b) => b.text).join(' · ')].filter(Boolean).join(' — ')
    : 'לא בשכבה המסיימת — אין ניתוח זכאות. התמונה כאן מהתקדמות המקצועות.'

  const rows = [...(index.metrics.get(sid)?.entries() ?? [])]
    .map(([key, m]) => ({ sub: index.subjectByKey.get(key), m }))
    .filter((x): x is { sub: RoundSubject; m: SubjectRow } => Boolean(x.sub) && x.sub!.subject_group !== 'פנימי')

  const failing = rows
    .filter((x) => x.m.final_grade != null && x.m.final_grade < PASS)
    .map((x) => ({ name: x.sub.subject_name, final: x.m.final_grade as number, gap: PASS - (x.m.final_grade as number) }))
    .sort((a, b) => a.gap - b.gap)

  const atRisk = rows
    .filter((x) => x.m.final_grade == null && (x.m.cumulative_weight ?? 0) > 0 && x.m.cumulative_grade != null)
    .map((x) => ({ name: x.sub.subject_name, average: Math.round((x.m.cumulative_grade as number) / (x.m.cumulative_weight as number)), done: Math.round((x.m.cumulative_weight as number) * 100) }))
    .filter((x) => x.average < PASS)
    .sort((a, b) => a.average - b.average)

  const strengths = rows
    .filter((x) => x.m.final_grade != null && x.m.final_grade >= 80)
    .map((x) => ({ name: x.sub.subject_name, final: x.m.final_grade as number }))
    .sort((a, b) => b.final - a.final)
    .slice(0, 3)

  const closest = suggestions
    .filter((s) => s.required_grade != null || s.action_type === 'בחינה חוזרת')
    .sort((a, b) => a.effort - b.effort)
    .slice(0, 2)

  return { sentence, graduating, blockers, failing, closest, atRisk, strengths }
}

// ─────────────────────────────── תאריכים ───────────────────────────────

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)}.${Number(m)}.${y}`
}

/** ימים עד התאריך (שלילי = עבר) */
export function daysUntil(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000)
}

export function todayIso(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** "מעקב השבוע": מעקב שמועדו עבר או שמגיע בשבעת הימים הקרובים */
export function isFollowupDue(iso: string | null | undefined): boolean {
  return Boolean(iso) && daysUntil(iso as string) <= 7
}

/** "בעוד 8 ימים" / "היום" / "באיחור של 3 ימים" */
export function relDays(iso: string): { text: string; tone: 'red' | 'amber' | 'slate' } {
  const n = daysUntil(iso)
  if (n < 0) return { text: `באיחור של ${-n} ימים`, tone: 'red' }
  if (n === 0) return { text: 'היום', tone: 'amber' }
  if (n <= 7) return { text: n === 1 ? 'מחר' : `בעוד ${n} ימים`, tone: 'amber' }
  return { text: `בעוד ${n} ימים`, tone: 'slate' }
}
