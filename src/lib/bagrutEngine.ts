// מנוע זכאות לבגרות — מחשב זכאות מהציונים, מחוקת הזכאות וממבנה הבגרות של
// בית הספר (20.10, בקשת אייל). מחליף את ניתוח הזכאות של סבא כמקור, ונבדק מולו
// כל הזמן: אי־התאמה בנתון שלא נערך באתר = "דגל אדום".
//
// ⚠️ זה מהפך בכלל של 014 §8 ("זכאות רק לפי T2"). ההחלטה — decisions/021.
//
// מודול טהור: בלי מסד, בלי React. אותו קוד רץ באתר ובבדיקה מול הנתונים.
//
// שתי שכבות:
//   1. computeSubject — מציוני השאלונים ומשקלי המצפן: ציון מצטבר, ציון סופי,
//      מצב השלמה. נחוץ כשציון שאלון נערך.
//   2. computeEligibility — מהציונים הסופיים: יח"ל, מלל, מוגבר, חובה, שליליים,
//      ומהם הסטטוס, החסמים והאפשרות לשלילי אחד.
//
// הכללים — docs/bagrut-eligibility-rules.md (Z-1…Z-18). מה שאינו מהדף הרשמי
// אלא מהפרוצדורה של סבא (סף "מלל", מורחב בלי יח"ל = 5) — מסומן "מהניתוח של סבא".
// המקצועות הפנימיים — מחוץ לחישוב (החלטה 20.10), כמו בניתוח של סבא.

export const PASS = 55
/** Z-7 — נכשל מותר אחד */
export const ALLOWED_FAIL_MIN = 45
/** Z-9 — טווח השיפוי */
export const COMPENSATION_MIN = 5
export const UNITS_REQUIRED = 21

export type Group = 'חובה' | 'אנגלית ומתמטיקה' | 'מורחב' | 'פנימי'

export interface EngineSubject {
  key: string
  name: string
  group: Group
  /** יח"ל לפי המקצוע בסבב; null — לא ידוע */
  units: number | null
}

export interface EngineSubjectResult {
  key: string
  final: number | null
  cumulative: number | null
  /** יח"ל שנרשמו לתלמיד במקצוע (גובר על יח"ל המקצוע) */
  units: number | null
  completion: 'done' | 'progress' | 'not_started' | 'unknown'
}

// ─────────────────────────────── 1. מקצוע מציוני השאלונים ───────────────────────────────

export interface EngineGrade {
  code: number
  grade: number | null
  weight: number | null
}

/** שורת מצפן: שאלון במקצוע, משקל, וקבוצת שקולים (אחד מהם נספר) */
export interface EngineProgramRow {
  code: number
  weight: number | null
  altGroup: string | null
}

const EPS = 1e-6

/**
 * ציון מצטבר וסופי של מקצוע, כמו בעיבוד הציונים. ציון 1–4 נספר כמספר רגיל
 * (4×0.2 + 30×0.5 + 85×0.3 = 41) — הוא שמוריד את המקצוע לשלילי.
 *
 * המשקלים של התלמיד עצמו (מעיבוד הציונים) גוברים על המצפן: המצפן מסמן שקולים
 * בצורה שונה בכל בית ספר, ובחלקם שגוי (עברית לערבים ברמות זבולון — 230%).
 * המצפן — רק כשאין לשורות משקל.
 *
 * כשהשאלונים של התלמיד מסתכמים מעל 100% (נבחן בשתי חלופות) — נבחרת קבוצה אחת:
 * הכי קרובה ל-100% בלי לעבור אותו, ואז זו עם יותר שאלונים (הרכב 14371+14383+14386
 * גובר על 14183 לבד), ואז הציון הגבוה (16385 / 16387). כך בעיבוד הציונים.
 */
export function computeSubject(grades: EngineGrade[], program: EngineProgramRow[]): Pick<EngineSubjectResult, 'final' | 'cumulative' | 'completion'> {
  const taken = grades.filter((g) => g.grade != null)
  const ownWeights = taken.length > 0 && taken.every((g) => g.weight != null)
  if (ownWeights || !program.length) {
    if (!taken.length) return { final: null, cumulative: null, completion: grades.length ? 'not_started' : 'unknown' }
    const rows = taken.filter((g) => (g.weight ?? 0) > 0).slice(0, 16)
    // שקולים לפי המצפן (14331 / 14383) — לכל היותר אחד מכל קבוצה
    const alt = new Map(program.filter((r) => r.altGroup != null).map((r) => [r.code, String(r.altGroup)]))
    let best = { w: 0, n: 0, sum: 0 }
    for (let mask = 1; mask < 1 << rows.length; mask++) {
      let w = 0
      let n = 0
      let sum = 0
      const groups = new Set<string>()
      let clash = false
      for (let i = 0; i < rows.length; i++) {
        if (!(mask & (1 << i))) continue
        const gname = alt.get(rows[i].code)
        if (gname != null) {
          if (groups.has(gname)) clash = true
          groups.add(gname)
        }
        w += rows[i].weight as number
        n++
        sum += (rows[i].grade as number) * (rows[i].weight as number)
      }
      if (clash || w > 1 + EPS) continue
      const better = w > best.w + EPS || (Math.abs(w - best.w) <= EPS && (n > best.n || (n === best.n && sum > best.sum)))
      if (better) best = { w, n, sum }
    }
    // נבחן רק בשאלונים במשקל 0 — בעיבוד הציונים: מצטבר 0, בתהליך
    if (best.n === 0) return { final: null, cumulative: 0, completion: 'progress' }
    const done = best.w >= 1 - 0.01
    return { cumulative: Math.round(best.sum), final: done ? Math.round(best.sum) : null, completion: done ? 'done' : 'progress' }
  }

  // לפי המצפן: קבוצת שקולים = יחידה אחת, משקלה פעם אחת, הציון הטוב בה נספר
  const byCode = new Map(taken.map((g) => [g.code, g]))
  const units = new Map<string, EngineProgramRow[]>()
  for (const r of program) units.set(r.altGroup ?? `q${r.code}`, [...(units.get(r.altGroup ?? `q${r.code}`) ?? []), r])
  let weightTotal = 0
  let weightDone = 0
  let sum = 0
  for (const members of units.values()) {
    const w = members[0].weight ?? 0
    weightTotal += w
    const got = members.map((m) => byCode.get(m.code)).filter((g): g is EngineGrade => g != null)
    if (!got.length) continue
    weightDone += w
    sum += Math.max(...got.map((g) => g.grade as number)) * w
  }
  if (weightDone === 0) return { final: null, cumulative: null, completion: grades.length ? 'not_started' : 'unknown' }
  const done = weightTotal > 0 && weightDone >= weightTotal - EPS
  // הציון המצטבר = סכום הנקודות המשוקללות (30.8 + 16.4 = 47), לא ממוצע — כמו בעיבוד הציונים
  return { cumulative: Math.round(sum), final: done ? Math.round(sum) : null, completion: done ? 'done' : 'progress' }
}

// ─────────────────────────────── 2. זכאות ───────────────────────────────

export type EligibilityKind = 'eligible' | 'one_negative' | 'not_eligible'

export type BlockerKind = 'units' | 'core_units' | 'no_reinforced' | 'missing_required' | 'negatives'

export interface EngineBlocker {
  kind: BlockerKind
  text: string
  subjects?: string[]
}

export interface EligibilityResult {
  kind: EligibilityKind
  /** "זכאי" / "זכאי במסלול שלילי אחד" / "אין זכאות" — לתצוגה */
  status: string
  totalUnits: number
  coreUnits: number
  coreRequired: number
  negatives: { name: string; grade: number; units: number | null }[]
  /** מקצועות 5 יח"ל שעברו, לא אנגלית (Z-2) */
  reinforced: string[]
  missingRequired: string[]
  /** תיאור השלילי המותר / הסיבה שאינו מותר — כמו בניתוח של סבא */
  oneNegativeOption: string
  compensationPair: string | null
  motherTongue: { name: string; status: string } | null
  blockers: EngineBlocker[]
}

/** Z-11 — סף השיפוי לפי רמות שני המקצועות */
const COMPENSATION_THRESHOLD: Record<string, number> = { '5+5': 140, '5+4': 144, '4+5': 144, '5+3': 146, '3+5': 146, '4+4': 146, '4+3': 148, '3+4': 148, '3+3': 150 }

const norm = (s: string) => s.replace(/["״׳']/g, '').replace(/\s+/g, ' ').trim()
/** "אנגלית 4 יח"ל" / "Anglit4" → "אנגלית" — משפחת רמות של אותו מקצוע */
function family(name: string): string {
  const n = norm(name)
  if (n.startsWith('אנגלית')) return 'אנגלית'
  if (n.startsWith('מתמטיקה')) return 'מתמטיקה'
  return n.replace(/\s*\d\s*(יחל)?$/, '').trim()
}
/** "עברית מורחב לערבים" → "עברית לערבים": המורחב שמכיל מקצוע חובה (מהניתוח של סבא + Z-2) */
// ⚠️ לא \b: ב-JavaScript גבול מילה אינו מכיר אותיות עבריות, והמילה לא הוסרה
const baseOfExtended = (s: string) => norm(s).replace(/מורחב/g, '').replace(/\s+/g, ' ').trim()
const unitsOf = (r: EngineSubjectResult | undefined, s: EngineSubject) => r?.units ?? s.units

export interface EligibilityInput {
  subjects: EngineSubject[]
  /** תוצאות המקצועות של התלמיד, לפי מפתח */
  results: Map<string, EngineSubjectResult>
}

export function computeEligibility({ subjects, results }: EligibilityInput): EligibilityResult {
  const external = subjects.filter((s) => s.group !== 'פנימי')
  const required = external.filter((s) => s.group === 'חובה')
  // המורחב של מקצוע חובה: לפי השם או המפתח, אחרי הסרת "מורחב"
  const extendedOf = new Map<string, EngineSubject>()
  for (const s of external.filter((x) => x.group === 'מורחב' && /מורחב/.test(x.name + x.key))) {
    const base = required.find((r) => [r.name, r.key].some((v) => norm(v) === baseOfExtended(s.name) || norm(v) === baseOfExtended(s.key)))
    if (base) extendedOf.set(base.key, s)
  }
  const extendedKeys = new Set([...extendedOf.values()].map((s) => s.key))
  const isArabSector = external.some((s) => norm(s.name) === 'ערבית לערבים')
  const motherKey = isArabSector
    ? external.find((s) => norm(s.name) === 'ערבית לערבים')?.key
    : required.find((s) => norm(s.name) === 'עברית')?.key

  const final = (key: string) => results.get(key)?.final ?? null
  const passed = (key: string) => (final(key) ?? -1) >= PASS
  // מורחב בלי יח"ל ידועות — 5 (מהניתוח של סבא)
  const units = (s: EngineSubject) => unitsOf(results.get(s.key), s) ?? (s.group === 'מורחב' ? 5 : 0)

  // ── שליליים: כל ציון סופי מתחת ל-55, גם חסם 1–4 (כך בניתוח של סבא). מקצוע
  // חובה שהמורחב שלו עבר — לא שלילי: המורחב מחליף אותו (עברית 52, עברית מורחב 56)
  const negatives = external
    .filter((s) => final(s.key) != null && (final(s.key) as number) < PASS)
    .filter((s) => !(extendedOf.has(s.key) && passed(extendedOf.get(s.key)!.key)))
    .map((s) => ({ key: s.key, name: s.name, grade: final(s.key) as number, units: unitsOf(results.get(s.key), s) }))

  // ── יח"ל: מקצוע שעבר; משפחת רמות — הגבוהה; מורחב מחליף את מקצוע החובה שבו
  const famBest = new Map<string, number>()
  for (const s of external) {
    if (!passed(s.key)) continue
    // מקצוע חובה שעבר גם את המורחב שלו — נספר דרך המורחב בלבד
    const ext = extendedOf.get(s.key)
    if (ext && passed(ext.key)) continue
    const f = extendedKeys.has(s.key) ? s.key : family(s.name)
    famBest.set(f, Math.max(famBest.get(f) ?? 0, units(s)))
  }
  const totalUnits = [...famBest.values()].reduce((a, b) => a + b, 0)

  // ── מלל: יח"ל מקצועות החובה (קבוצת "חובה") שעברו — ישירות או דרך המורחב. הסף =
  // סכום יח"ל מקצועות החובה של בית הספר (מהניתוח של סבא: 11 במגזר הערבי)
  const coreRequired = required.reduce((a, s) => a + (s.units ?? 0), 0)
  // מורחב שעבר נספר ביח"ל שלו במקום החובה (עברית מורחב → 5, לא 3) — כך בניתוח של סבא
  const coreUnits = required.reduce((a, s) => {
    const ext = extendedOf.get(s.key)
    if (ext && passed(ext.key)) return a + units(ext)
    return a + (passed(s.key) ? (s.units ?? 0) : 0)
  }, 0)

  // ── מוגבר (Z-2): 5 יח"ל שעבר, לא אנגלית (Z-5)
  const reinforced = external
    .filter((s) => passed(s.key) && units(s) >= 5 && family(s.name) !== 'אנגלית')
    .map((s) => `${s.name} ${final(s.key)}`)

  // ── מקצועות חובה (Z-1): קבוצת "חובה" + אנגלית + מתמטיקה. "חסר" = לא נבחן בכלל
  // (אין ציון סופי בשום רמה ובמורחב). מי שנבחן ונכשל — הוא ב"שליליים", לא כאן.
  // כך מבחין ניתוח הזכאות של סבא.
  const examined = (key: string) => final(key) != null
  const famExamined = (f: string) => external.some((s) => family(s.name) === f && examined(s.key))
  const missingRequired: string[] = []
  for (const s of required) {
    const ext = extendedOf.get(s.key)
    if (!examined(s.key) && !(ext && examined(ext.key))) missingRequired.push(s.name)
  }
  for (const f of ['אנגלית', 'מתמטיקה']) if (external.some((s) => family(s.name) === f) && !famExamined(f)) missingRequired.push(f)

  // ── שלילי אחד (Z-7) או שיפוי (Z-9…Z-11)
  let oneNegativeOption = 'אין ציון שלילי'
  let compensationPair: string | null = null
  let negativeAllowed = false
  if (negatives.length === 1) {
    const n = negatives[0]
    const label = `${n.name} ${n.grade}`
    if (n.key === motherKey) {
      oneNegativeOption = `לא — ${label}, שפת אם אינה יכולה להיות שלילית`
    } else if (n.grade >= ALLOWED_FAIL_MIN) {
      negativeAllowed = true
      oneNegativeOption = `כן — ${label}, שלילי יחיד בטווח 45–54`
    } else if (n.grade >= COMPENSATION_MIN) {
      // שני מקצועות אחרים שעברו, 3 יח"ל ומעלה, שסכומם מגיע לסף
      const cands = external
        .filter((s) => s.key !== n.key && passed(s.key) && units(s) >= 3)
        .map((s) => ({ s, g: final(s.key) as number, u: Math.min(5, units(s)) }))
      let best: { a: (typeof cands)[number]; b: (typeof cands)[number]; sum: number; need: number } | null = null
      for (let i = 0; i < cands.length; i++) {
        for (let j = i + 1; j < cands.length; j++) {
          const need = COMPENSATION_THRESHOLD[`${cands[i].u}+${cands[j].u}`]
          const sum = cands[i].g + cands[j].g
          if (need && sum >= need && (!best || sum - need > best.sum - best.need)) best = { a: cands[i], b: cands[j], sum, need }
        }
      }
      if (best) {
        negativeAllowed = true
        compensationPair = `${best.a.s.name} ${best.a.g} + ${best.b.s.name} ${best.b.g}`
        oneNegativeOption = `כן — ${label}, קומפנסציה ${best.sum}/${best.need}`
      } else {
        oneNegativeOption = `לא — ${label}, חסרות נקודות קומפנסציה`
      }
    } else {
      oneNegativeOption = `לא — ${label}, הציון נמוך מטווח השלילי המותר`
    }
  } else if (negatives.length > 1) {
    oneNegativeOption = 'לא עומד בתנאי שלילי אחד'
  }

  // שלילי מותר: מקצוע החובה שבו נחשב "נבחן" (Z-1), אבל יח"ל שלו אינן נספרות
  const allowedNeg = negativeAllowed ? negatives[0] : null
  const stillMissing = missingRequired.filter((m) => !allowedNeg || (m !== allowedNeg.name && m !== family(allowedNeg.name)))

  const blockers: EngineBlocker[] = []
  if (stillMissing.length) blockers.push({ kind: 'missing_required', text: `חסרים מקצועות חובה: ${stillMissing.join(', ')}`, subjects: stillMissing })
  if (totalUnits < UNITS_REQUIRED) blockers.push({ kind: 'units', text: `חסרות ${UNITS_REQUIRED - totalUnits} יח"ל לסף ${UNITS_REQUIRED}` })
  if (coreUnits < coreRequired && !(allowedNeg && required.some((s) => s.key === allowedNeg.key) && coreUnits + (allowedNeg.units ?? 0) >= coreRequired)) {
    blockers.push({ kind: 'core_units', text: `חסרות ${coreRequired - coreUnits} יח"ל מלל לסף ${coreRequired}` })
  }
  if (!reinforced.length) blockers.push({ kind: 'no_reinforced', text: 'לא אותר מקצוע מוגבר שעבר' })
  if (negatives.length > 1 || (negatives.length === 1 && !negativeAllowed)) {
    blockers.push({ kind: 'negatives', text: `ציונים שליליים: ${negatives.map((n) => `${n.name} ${n.grade}`).join(', ')}` })
  }

  const kind: EligibilityKind = blockers.length ? 'not_eligible' : negativeAllowed ? 'one_negative' : 'eligible'
  const mother = motherKey ? external.find((s) => s.key === motherKey) : undefined
  return {
    kind,
    status: kind === 'eligible' ? 'זכאי' : kind === 'one_negative' ? 'זכאי במסלול שלילי אחד' : 'אין זכאות',
    totalUnits,
    coreUnits,
    coreRequired,
    negatives: negatives.map(({ name, grade, units: u }) => ({ name, grade, units: u })),
    reinforced,
    missingRequired: stillMissing,
    oneNegativeOption,
    compensationPair,
    motherTongue: mother
      ? { name: mother.name, status: final(mother.key) == null ? 'חסר ציון סופי' : passed(mother.key) ? `עבר (${final(mother.key)})` : `לא עבר (${final(mother.key)})` }
      : null,
    blockers,
  }
}
