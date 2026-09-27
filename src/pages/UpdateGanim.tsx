import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  fetchAuthorities,
  fetchTierBUploads,
  uploadTierBFile,
  approveTierBMapping,
  TIER_B_GROUPS,
  NEW_COLUMN,
  type Authority,
  type TierBGroup,
  type TierBUpload,
} from '@/lib/admin'
import { ALL_FIELDS } from '@/config/fields'
import { BROWSER_COMPUTED_FIELDS } from '@/lib/computed'
import FieldCombobox from '@/components/FieldCombobox'

/**
 * קליטת דרג ב' — גנים והאוכלוסיות המשלימות.
 *
 * ⚠️ **שתי הבטחות שהמסך הזה נשען עליהן, ושאסור שיישברו:**
 *
 * 1. הנתונים נכתבים לטבלה נפרדת (`students_{code}_tier_b`) שאינה נדרסת
 *    בעדכון המצב"ת החודשי. קליטת גנים אינה נוגעת בנתוני משרד החינוך,
 *    וה-TRUNCATE החודשי אינו נוגע בגנים.
 * 2. **אין מסלול אוטומטי.** קובץ נקלט רק דרך המסך הזה. סורק התיקייה
 *    של הסוכן קורא `.csv` בלבד, דורש את ששת קידומות המצב"ת, ומדלג על
 *    מנה חלקית — ולכן קובץ גנים אינו נראה לו כלל.
 */

/**
 * שדות שהטעינה כותבת בעצמה — מיפוי אליהם היה נדרס. זהה ל-`RESERVED`
 * ב-`scripts/tier_b_fields.py`, שגם דוחה אותם בצד השרת.
 */
const LOADER_DERIVED = ['source_group', 'MATZAV_RISHUM_TEUR']

/**
 * שדות היעד שמוצעים בבורר: **כל** עמודות הטבלה שיש להן תווית, חוץ
 * משלושה סוגים שמיפוי אליהם היה נעלם בשקט —
 *   • שדות שהדפדפן מחשב (נדרסים בכל טעינה),
 *   • שדות שהטעינה עצמה כותבת,
 *   • עמודות תוספתיות (יושבות בטבלה אחרת, לא בדרג ב').
 *
 * ה-AI **מציע** מתוך רשימה מצומצמת של שדות מוכרים (`tier_b_fields.py`),
 * שבהם ההמרות מיוחדות — ריפוד ת"ז, ספרת ביקורת של סמל ישוב. כאן המשתמש
 * יכול לבחור כל עמודה; הסקריפט מקבל כל עמודה שקיימת בטבלה וממיר לפי סוגה.
 */
function mappableFields() {
  return ALL_FIELDS.filter(
    (f) =>
      !f.extra &&
      !BROWSER_COMPUTED_FIELDS.includes(f.key) &&
      !LOADER_DERIVED.includes(f.key),
  )
}

const STATUS: Record<TierBUpload['status'], { text: string; tone: string }> = {
  pending:           { text: 'ממתין לעיבוד', tone: 'bg-amber-100 text-amber-800' },
  mapping:           { text: 'מזהה שדות',    tone: 'bg-sky-100 text-sky-800' },
  awaiting_approval: { text: 'ממתין לאישור', tone: 'bg-violet-100 text-violet-800' },
  processing:        { text: 'בעיבוד',       tone: 'bg-sky-100 text-sky-800' },
  done:              { text: 'הושלם',        tone: 'bg-emerald-100 text-emerald-800' },
  failed:            { text: 'נכשל',         tone: 'bg-red-100 text-red-800' },
}

const MAPPING_SOURCE: Record<string, string> = {
  ai: 'זוהה אוטומטית',
  saved: 'מיפוי שמור מקליטה קודמת',
  manual: 'הוגדר ידנית',
}

export default function UpdateGanim() {
  const { profile } = useAuth()
  const { code = '' } = useParams()
  const [authorities, setAuthorities] = useState<Authority[]>([])
  const [uploads, setUploads] = useState<TierBUpload[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [group, setGroup] = useState<TierBGroup>('גנים')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  /** המיפוי שנערך במסך האישור, לפני שנשלח */
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  /** כל העמודות שאפשר למפות אליהן — מחושב פעם אחת, לפני כל return מוקדם */
  const targetFields = useMemo(mappableFields, [])

  useEffect(() => {
    fetchAuthorities().then(setAuthorities).catch(() => setAuthorities([]))
  }, [])

  const reload = () =>
    fetchTierBUploads(code)
      .then(setUploads)
      .catch((e: Error) => setError(`טעינת היסטוריית הקליטות — ${e.message}`))

  useEffect(() => {
    reload()
    // קליטה עוברת כמה מצבים אצל הסוכן — רענון עדין עד שהיא נחה
    const timer = setInterval(reload, 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const isSuperAdmin = profile?.role === 'super_admin'
  const mayUpdate =
    isSuperAdmin ||
    (profile?.role === 'admin' && (profile.authority_codes ?? []).includes(code))
  if (profile && !mayUpdate) return <Navigate to="/" replace />

  const authority = authorities.find((a) => a.code === code)
  const awaiting = uploads.find((u) => u.status === 'awaiting_approval')

  async function handleUpload() {
    if (!file) return
    setBusy(true); setError(null); setDone(false)
    try {
      await uploadTierBFile(code, file, group)
      await reload()
      setFile(null)
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleApprove(upload: TierBUpload) {
    setBusy(true); setError(null)
    try {
      // ⚠️ המיפוי המלא, לא `draft`. `draft` מחזיק רק את השורות שהמשתמש
      // *שינה* — ומי שאישר בלי לשנות דבר שלח `{}`. הסוכן קרא `{}` כ"טרם
      // אושר" וזיהה את השדות מחדש, והמסך קפץ חזרה בלולאה אחרי כל אישור.
      // וגם מי ששינה שורה אחת היה שולח רק אותה, וכל השאר לא היו נטענים.
      // מה שנשלח כאן הוא בדיוק מה שמוצג על המסך.
      const full = { ...(upload.proposed_mapping ?? {}), ...draft }
      await approveTierBMapping(upload.id, full)
      setDraft({})
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const proposed = awaiting?.proposed_mapping ?? {}
  const current = (header: string) =>
    draft[header] !== undefined ? draft[header] : proposed[header] ?? null

  // שדה יעד שנבחר ליותר מעמודה אחת. הסקריפט היה שומר רק את הראשונה
  // ומדלג על השנייה — לכן מסמנים כאן באדום וחוסמים את האישור, במקום
  // לגלות אחרי הטעינה שעמודה שלמה לא נכנסה.
  const targetCount = new Map<string, number>()
  for (const header of Object.keys(proposed)) {
    const t = current(header)
    // «עמודה חדשה» אינה שדה בטבלה, ולכן כמה כותרות יכולות לבקש אותה
    if (t && t !== NEW_COLUMN) targetCount.set(t, (targetCount.get(t) ?? 0) + 1)
  }
  const duplicateTargets = new Set(
    [...targetCount].filter(([, n]) => n > 1).map(([t]) => t),
  )

  /**
   * הערכה לכל שורה — כדי שתשומת הלב תלך לשורות שצריכות אותה.
   *
   * אישור של עשרים שורות נכונות מלמד ללחוץ «אשר» בלי לקרוא. לכן ודאי
   * מסומן בשקט, ומה שכדאי לבדוק — בצהוב: הצעה מהרשימה המורחבת (שבה יש
   * הרבה שדות דומים), או הצעה שה-AI עצמו לא היה בטוח בה.
   */
  function assessment(header: string): { text: string; tone: string; review: boolean } | null {
    if (current(header) === NEW_COLUMN) {
      return { text: 'עמודה חדשה', tone: 'bg-sky-100 text-sky-800', review: false }
    }
    if (draft[header] !== undefined) {
      return { text: 'שונה ידנית', tone: 'bg-slate-100 text-slate-600', review: false }
    }
    if (!current(header)) return null
    const meta = awaiting?.mapping_meta?.[header]
    if (!meta) {
      return awaiting?.mapping_source === 'saved'
        ? { text: 'מיפוי שמור', tone: 'bg-slate-100 text-slate-600', review: false }
        : null
    }
    if (meta.tier === 'core' && meta.confidence === 'high') {
      return { text: 'ודאי', tone: 'bg-emerald-50 text-emerald-700', review: false }
    }
    return {
      text: meta.tier === 'extended' ? 'כדאי לבדוק — שדה נוסף' : 'כדאי לבדוק',
      tone: 'bg-amber-100 text-amber-800',
      review: true,
    }
  }
  const reviewCount = Object.keys(proposed).filter((h) => assessment(h)?.review).length

  return (
    <div className="min-h-full bg-slate-100">
      <header className="border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-sky-800">
              קליטת גנים ואוכלוסיות משלימות
              <span className="mr-2 text-base font-normal text-slate-500">
                {authority?.name ?? `רשות ${code}`}
              </span>
            </h1>
            <p className="text-sm text-slate-500">
              קובץ אקסל שהרשות מפיקה בעצמה — גנים, לידה עד 3, קידום נוער וחינוך ביתי.
            </p>
          </div>
          <Link
            to={`/students/${code}`}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-sky-50 hover:text-sky-700"
          >
            → חזרה לטבלה
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>הקליטה הזו אינה נוגעת בנתוני משרד החינוך.</strong> ילדי הגן
          נשמרים בטבלה נפרדת, ולכן העדכון החודשי אינו מוחק אותם — והקליטה
          הזו אינה משנה אף תלמיד בית ספר. קליטה חוזרת דורסת רק את אותה
          קבוצה, ורק ברשות הזו, אחרי גיבוי.
        </div>

        {error && (
          <p className="mb-4 whitespace-pre-wrap rounded-lg bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
            שגיאה: {error}
          </p>
        )}

        {/* ── אישור המיפוי ── */}
        {awaiting && (
          <section className="mb-6 rounded-2xl border-2 border-violet-300 bg-white p-5 shadow-sm">
            <h3 className="mb-1 font-bold text-violet-800">אישור זיהוי השדות</h3>
            <p className="mb-4 text-sm text-slate-600">
              {MAPPING_SOURCE[awaiting.mapping_source ?? ''] ?? 'הוצע'} עבור
              <strong className="mx-1">{awaiting.file_name}</strong>.
              כדאי לעבור על הרשימה לפני הטעינה — עמודה שממופה לשדה הלא נכון
              תיכנס בשקט. מה שמסומן «לא לייבא» פשוט לא ייטען.
              <br />
              לעמודה שאין לה שדה מתאים אפשר לבחור <strong>«עמודה חדשה»</strong>:
              היא תיווצר כעמודה תוספתית של הרשות, ותופיע בטבלה ככל עמודה אחרת.
              העדכון החודשי ממשרד החינוך אינו נוגע בה.
            </p>

            {reviewCount > 0 && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>{reviewCount}</strong> הצעות מסומנות בצהוב — כדאי לעבור עליהן
                לפני האישור. השאר זוהו בוודאות.
              </p>
            )}

            {/* בלי overflow על העוטף: הוא היה חותך את הרשימה הנפתחת של הבורר */}
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-right text-violet-700">
                    <th className="pb-2 font-semibold">העמודה בקובץ</th>
                    <th className="pb-2 font-semibold">תיכנס לשדה</th>
                    <th className="pb-2 font-semibold">הערכה</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(proposed).map((header) => (
                    <tr
                      key={header}
                      className={
                        'border-b border-slate-50 last:border-0 ' +
                        (assessment(header)?.review ? 'bg-amber-50/60' : '')
                      }
                    >
                      <td className="py-2 font-medium text-slate-700">{header}</td>
                      <td className="py-2">
                        <FieldCombobox
                          wide
                          fields={targetFields}
                          noneLabel="— לא לייבא —"
                          specialOption={{
                            key: NEW_COLUMN,
                            label: `➕ עמודה חדשה בשם «${header}»`,
                          }}
                          value={current(header) ?? ''}
                          invalid={duplicateTargets.has(current(header) ?? '')}
                          onChange={(key) => setDraft({ ...draft, [header]: key || null })}
                        />
                      </td>
                      <td className="py-2">
                        {assessment(header) && (
                          <span
                            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${assessment(header)!.tone}`}
                          >
                            {assessment(header)!.text}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {duplicateTargets.size > 0 && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                אותו שדה נבחר ליותר מעמודה אחת (מסומן באדום). כל שדה יכול לקבל
                עמודה אחת בלבד — אחרת אחת מהן לא תיטען.
              </p>
            )}

            <button
              onClick={() => handleApprove(awaiting)}
              disabled={busy || duplicateTargets.size > 0}
              className="mt-4 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? 'מאשר…' : 'אישור וטעינה'}
            </button>
          </section>
        )}

        {/* ── העלאה ── */}
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-1 font-bold text-sky-800">קליטת קובץ חדש</h3>
          <p className="mb-4 text-sm text-slate-500">
            קובץ אחד, בכל מבנה עמודות. המערכת מזהה את השדות בעצמה ומציגה
            אותם לאישור לפני הטעינה.
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-600">הקבוצה:</label>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value as TierBGroup)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            >
              {TIER_B_GROUPS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <span className="text-xs text-slate-400">
              כל קבוצה נדרסת בנפרד — קליטת גנים אינה נוגעת בקידום נוער
            </span>
          </div>

          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-sky-300 p-8 text-center transition hover:border-sky-500 hover:bg-sky-50">
            <div className="text-3xl">📗</div>
            <p className="mt-2 font-medium text-sky-700">
              {file ? file.name : 'בחירת קובץ אקסל'}
            </p>
            <p className="text-xs text-slate-500">‎.xls או ‎.xlsx</p>
            <input
              type="file"
              accept=".xls,.xlsx"
              hidden
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setDone(false) }}
            />
          </label>

          {file && (
            <button
              onClick={handleUpload}
              disabled={busy}
              className="mt-4 rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-50"
            >
              {busy ? 'מעלה…' : `העלאת ${file.name} (${(file.size / 1e6).toFixed(1)}MB)`}
            </button>
          )}

          {done && (
            <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              הקובץ הועלה. המערכת מזהה כעת את השדות ותציג אותם לאישור כאן למעלה.
            </div>
          )}
        </section>

        {/* ── היסטוריה ── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-bold text-sky-800">היסטוריית קליטות</h3>
          {uploads.length === 0 ? (
            <p className="text-sm text-slate-400">עדיין לא נקלטו קבצים.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-right text-sky-700">
                  <th className="pb-2 font-semibold">תאריך</th>
                  <th className="pb-2 font-semibold">קובץ</th>
                  <th className="pb-2 font-semibold">קבוצה</th>
                  <th className="pb-2 font-semibold">סטטוס</th>
                  <th className="pb-2 font-semibold">נטענו</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => {
                  const s = STATUS[u.status]
                  return (
                    <tr key={u.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2">
                        {new Date(u.uploaded_at).toLocaleString('he-IL')}
                      </td>
                      <td className="py-2 text-slate-600">{u.file_name ?? '—'}</td>
                      <td className="py-2">{u.source_group}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${s.tone}`}>
                          {s.text}
                        </span>
                        {u.error_message && (
                          <span className="mr-2 text-xs text-red-600">{u.error_message}</span>
                        )}
                      </td>
                      <td className="py-2">
                        {u.rows_loaded?.toLocaleString('he-IL') ?? '—'}
                        {!!u.rows_rejected && (
                          <span className="mr-1 text-xs text-amber-700">
                            ({u.rows_rejected} נדחו)
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}
