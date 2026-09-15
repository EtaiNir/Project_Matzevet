import { useCallback, useEffect, useState } from 'react'
import { listShares, shareItem, unshareItem, type ViewShare } from '@/lib/savedViews'

/** הפריט שמשתפים — טבלה ייעודית או תיקייה */
export interface ShareTarget {
  kind: 'view' | 'folder'
  id: string
  name: string
}

interface Props {
  target: ShareTarget
  onClose: () => void
  /** נקרא אחרי כל שינוי, כדי שהסרגל ייטען מחדש */
  onChanged?: () => void
}

/**
 * שיתוף טבלה ייעודית או תיקייה עם משתמש אחר, לפי אימייל.
 *
 * **שיתוף תיקייה גורר את כל מה שבתוכה, לעומק** — תיקיות משנה והטבלאות
 * שבהן. זה נאמר בחלון במפורש, כי ההבדל בין "שיתפתי תיקייה" ל"שיתפתי
 * שמונה רשימות" אינו מובן מאליו ברגע הלחיצה.
 *
 * שתי דרגות בלבד, ושתיהן אינן כוללות מחיקה:
 *
 *   צפייה   רואה את הרשימה.
 *   עריכה   רואה, ומוסיף ומסיר ממנה תלמידים.
 *
 * מחיקה, שינוי שם והעברה בין תיקיות נשארים אצל היוצר. רשימה שכל מי
 * שקיבל אותה יכול למחוק היא מלכודת, לא שיתוף.
 *
 * הרשאת **מילוי הערכים** בעמודות התוספתיות אינה נקבעת כאן אלא
 * ב-`can_edit_extra` שברמת הרשות — העמודות שייכות לרשות, לא לרשימה.
 */
export default function ShareDialog({ target, onClose, onChanged }: Props) {
  const [shares, setShares] = useState<ViewShare[]>([])
  const [email, setEmail] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setShares(await listShares(target))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [target])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    if (!email.trim() || busy) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await shareItem(target, email, canEdit)
      setNote(
        `שותף עם ${res.display_name || res.email} — ${res.can_edit ? 'עריכה' : 'צפייה'}`,
      )
      setEmail('')
      await load()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(share: ViewShare) {
    setError(null)
    setNote(null)
    try {
      await unshareItem(share.id)
      await load()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const kindLabel = target.kind === 'folder' ? 'התיקייה' : 'הטבלה'

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-slate-800">
              שיתוף {kindLabel} «{target.name}»
            </h3>
            {target.kind === 'folder' && (
              <p className="mt-1 text-xs text-slate-500">
                השיתוף חל על <strong>כל מה שבתוכה</strong> — תיקיות המשנה והטבלאות שבהן.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="סגירה"
            className="shrink-0 rounded px-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              האימייל של המשתמש
            </span>
            <input
              autoFocus
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="name@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
            />
          </label>

          <label className="mb-0.5">
            <span className="mb-1 block text-xs font-medium text-slate-500">הרשאה</span>
            <select
              value={canEdit ? 'edit' : 'view'}
              onChange={(e) => setCanEdit(e.target.value === 'edit')}
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="view">צפייה</option>
              <option value="edit">עריכה</option>
            </select>
          </label>

          <button
            onClick={submit}
            disabled={busy || !email.trim()}
            className="mb-0.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? 'משתף…' : 'שיתוף'}
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          {canEdit
            ? 'עריכה: יוכל להוסיף ולהסיר תלמידים מהרשימה. מחיקה ושינוי שם נשארים אצלך.'
            : 'צפייה: יראה את הרשימה בלבד.'}
        </p>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {note && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>
        )}

        <div className="mt-5 border-t border-slate-100 pt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            משותף כרגע עם
          </h4>
          {loading ? (
            <p className="mt-2 text-sm text-slate-400">טוען…</p>
          ) : shares.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              עדיין לא שותף. רק אתה רואה {kindLabel === 'התיקייה' ? 'אותה' : 'אותה'}.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-700">
                      {s.display_name || s.email}
                    </span>
                    {s.display_name && (
                      <span dir="ltr" className="block truncate text-xs text-slate-400">
                        {s.email}
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' +
                      (s.can_edit ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600')
                    }
                  >
                    {s.can_edit ? 'עריכה' : 'צפייה'}
                  </span>
                  <button
                    onClick={() => remove(s)}
                    title="ביטול השיתוף"
                    className="shrink-0 rounded px-2 py-1 text-sm text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
