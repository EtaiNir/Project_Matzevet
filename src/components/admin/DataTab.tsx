import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BagrutData from '@/components/admin/BagrutData'
import BudgetUploadPanel from '@/components/budget/BudgetUploadPanel'
import { PRODUCTS, type ProductKey } from '@/config/products'
import {
  countStudents,
  fetchUploads,
  uploadMoeFiles,
  classifyMoeFile,
  MOE_FILE_PREFIXES,
  type MoeUpload,
} from '@/lib/admin'

interface Props {
  code: string
}

const STATUS_LABELS: Record<MoeUpload['status'], { text: string; tone: string }> = {
  pending: { text: 'ממתין לעיבוד', tone: 'bg-amber-100 text-amber-800' },
  processing: { text: 'בעיבוד', tone: 'bg-sky-100 text-sky-800' },
  done: { text: 'הושלם', tone: 'bg-emerald-100 text-emerald-800' },
  failed: { text: 'נכשל', tone: 'bg-red-100 text-red-800' },
}

type Product = ProductKey

/**
 * מסך 3 — נתוני הלקוח, מוצר מוצר. המצבת היא ברמת הרשות; הבגרות — ברמת בית
 * הספר (החלטה 016): בוחרים בית ספר, ורואים ומעלים רק לו.
 *
 * המוצר ובית הספר נשמרים בכתובת (`?product=bagrut&school=…`), כך שאפשר לקשר
 * לכאן ישר ממסכי הבגרות.
 */
export default function DataTab({ code }: Props) {
  const [params, setParams] = useSearchParams()
  const [hasMatzevet, setHasMatzevet] = useState<boolean | null>(null)
  useEffect(() => {
    // טבלה נוצרת לכל לקוח, גם לבית ספר בלי מצבת — לכן לפי מספר התלמידים
    countStudents(code).then((n) => setHasMatzevet(n > 0)).catch(() => setHasMatzevet(true))
  }, [code])

  // ברירת המחדל: מצבת — אלא אם ללקוח אין מצבת (בית ספר שקנה רק בגרות)
  const product: Product | null =
    (params.get('product') as Product | null) ?? (hasMatzevet == null ? null : hasMatzevet ? 'matzevet' : 'bagrut')

  const select = (p: Product) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('product', p)
      next.delete('school')
      return next
    }, { replace: true })

  return (
    <div className="space-y-6">
      <div className="flex w-fit items-center gap-0.5 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {PRODUCTS.map(({ key: p, label }) => (
          <button key={p} onClick={() => select(p)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${product === p ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-500 hover:text-sky-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {product === 'matzevet' && (
        <>
          {hasMatzevet === false && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ללקוח הזה עוד אין נתוני מצבת. אם הוא לא רכש את המצבת — אין צורך להעלות כאן דבר.
            </p>
          )}
          <MatzevetData code={code} />
        </>
      )}
      {product === 'bagrut' && <BagrutData code={code} />}
      {/* התקציב ברמת הרשות, כמו המצבת (022) */}
      {product === 'budget' && <BudgetUploadPanel code={code} />}
    </div>
  )
}

/** המצבת — צפייה בנתוני המועצה והעלאת קבצי מצב"ת חדשים. */
function MatzevetData({ code }: Props) {
  const [uploads, setUploads] = useState<MoeUpload[]>([])
  const [selected, setSelected] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetchUploads(code)
      .then(setUploads)
      // מסמנים שזו טעינת ההיסטוריה ולא ההעלאה — שתי שגיאות שנראו זהות
      .catch((e: Error) => setError(`טעינת היסטוריית העדכונים — ${e.message}`))
  }, [code])

  // מיפוי בין הקידומות הנדרשות לקבצים שנבחרו בפועל
  const matched = new Map<string, File>()
  for (const file of selected) {
    const prefix = classifyMoeFile(file.name)
    if (prefix) matched.set(prefix, file)
  }
  const missing = MOE_FILE_PREFIXES.filter((p) => !matched.has(p))
  const unrecognized = selected.filter((f) => !classifyMoeFile(f.name))

  async function handleUpload() {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await uploadMoeFiles(code, [...matched.values()])
      setUploads(await fetchUploads(code))
      setSelected([])
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="whitespace-pre-wrap rounded-lg bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
          שגיאה: {error}
        </p>
      )}

      {/* צפייה בנתונים */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sky-800">צפייה בנתוני המועצה</h3>
            <p className="text-sm text-slate-500">
              הטבלה המלאה עם כל התצורות, הסינון והייצוא לאקסל.
            </p>
          </div>
          <Link
            to={`/students/${code}`}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700"
          >
            פתיחת הטבלה ←
          </Link>
        </div>
      </section>

      {/* העלאת קבצי מצב"ת */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 font-bold text-sky-800">עדכון קבצי מצב"ת</h3>
        <p className="mb-4 text-sm text-slate-500">
          בחר את ששת הקבצים שהתקבלו ממשרד החינוך. סוכן העיבוד קולט אותם
          תוך שניות, מריץ את ה-pipeline וטוען את התוצאה — אין צורך להריץ
          שום דבר ידנית. ההתקדמות מוצגת כאן למטה, ועדכון שלם אורך כדקה וחצי.
        </p>

        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-sky-300 p-8 text-center transition hover:border-sky-500 hover:bg-sky-50">
          <div className="text-3xl">📁</div>
          <p className="mt-2 font-medium text-sky-700">בחירת קבצים</p>
          <p className="text-xs text-slate-500">אפשר לבחור את כל ששת הקבצים יחד</p>
          <input
            type="file"
            multiple
            accept=".csv"
            hidden
            onChange={(e) => {
              setSelected(Array.from(e.target.files ?? []))
              setDone(false)
            }}
          />
        </label>

        {selected.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MOE_FILE_PREFIXES.map((prefix) => {
                const file = matched.get(prefix)
                return (
                  <div
                    key={prefix}
                    className={
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ' +
                      (file
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-slate-50 text-slate-400')
                    }
                  >
                    <span>{file ? '✓' : '○'}</span>
                    <span className="font-mono text-xs" dir="ltr">
                      {prefix}
                    </span>
                    {file && (
                      <span className="mr-auto text-xs">
                        {(file.size / 1024 / 1024).toFixed(1)}MB
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {unrecognized.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠ קבצים שלא זוהו ולא יועלו: {unrecognized.map((f) => f.name).join(', ')}
              </p>
            )}

            <button
              onClick={handleUpload}
              disabled={busy || missing.length > 0}
              className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-50"
            >
              {busy
                ? 'מעלה…'
                : missing.length > 0
                  ? `חסרים ${missing.length} קבצים`
                  : `העלאת ${matched.size} קבצים`}
            </button>
          </div>
        )}

        {done && (
          <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-medium">הקבצים הועלו — הסוכן מטפל בהם.</p>
            <p className="mt-1">
              אפשר לעקוב אחרי ההתקדמות ב״היסטוריית עדכונים״ למטה. העדכון
              נמשך כדקה וחצי, והטבלה מתעדכנת בסיומו.
            </p>
          </div>
        )}
      </section>

      {/* היסטוריית העלאות */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-bold text-sky-800">היסטוריית עדכונים</h3>
        {uploads.length === 0 ? (
          <p className="text-sm text-slate-400">עדיין לא הועלו קבצים דרך האתר.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-right text-sky-700">
                <th className="pb-2 font-semibold">תאריך</th>
                <th className="pb-2 font-semibold">קבצים</th>
                <th className="pb-2 font-semibold">סטטוס</th>
                <th className="pb-2 font-semibold">שורות שנטענו</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => {
                const s = STATUS_LABELS[u.status]
                return (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2">
                      {new Date(u.uploaded_at).toLocaleString('he-IL')}
                    </td>
                    <td className="py-2">{u.file_count}</td>
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
