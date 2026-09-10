import { useEffect, useState } from 'react'
import {
  addStudentsToView,
  createSavedView,
  fetchSavedViews,
  type SavedView,
} from '@/lib/savedViews'
import type { FilterCondition } from '@/lib/filters'

interface Props {
  code: string
  /** תעודות הזהות שעברו את הסינון הנוכחי */
  ids: string[]
  /** הסינון שממנו נבנית הרשימה — נשמר כתיעוד */
  filters: FilterCondition[]
  /** תמהיל השדות הנוכחי, כדי שהטבלה הייעודית תיפתח באותה תצוגה */
  fields: string[]
  basePreset?: string
  onClose: () => void
  /** נקרא אחרי הצלחה, עם הרשימה שאליה נוספו */
  onSaved?: (view: SavedView | null) => void
}

/**
 * "ייצוא לטבלה ייעודית" — לוקח את מי שסונן ומכניס אותו לרשימה קבועה.
 *
 * שני מסלולים באותו חלון: רשימה חדשה, או הוספה לרשימה שכבר קיימת.
 * השני הוא הסיבה שהחברוּת מפורשת ולא סינון שמור — אי אפשר "להוסיף
 * אנשים" לתנאי.
 */
export default function SaveToViewDialog({
  code,
  ids,
  filters,
  fields,
  basePreset,
  onClose,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('')
  const [views, setViews] = useState<SavedView[]>([])
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ added: number; total: number; name: string } | null>(null)

  useEffect(() => {
    fetchSavedViews(code).then((v) => {
      setViews(v)
      if (v.length > 0) setTarget(v[0].id)
    })
  }, [code])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      let view: SavedView | null = null
      if (mode === 'new') {
        view = await createSavedView(code, name, { filters, fields, basePreset })
      } else {
        view = views.find((v) => v.id === target) ?? null
        if (!view) throw new Error('לא נבחרה טבלה ייעודית')
      }
      const res = await addStudentsToView(view.id, ids)
      setDone({ ...res, name: view.name })
      onSaved?.(view)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300'

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <h2 className="text-lg font-bold text-sky-800">טבלה ייעודית</h2>
          <p className="text-sm text-slate-500">
            {ids.length.toLocaleString('he-IL')} תלמידים מהסינון הנוכחי
          </p>
        </div>

        <div className="space-y-4 p-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">שגיאה: {error}</p>
          )}

          {done ? (
            <>
              <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <strong>{done.added.toLocaleString('he-IL')}</strong> תלמידים נוספו ל«{done.name}».
                {done.added < ids.length && (
                  <span className="block text-emerald-700">
                    {(ids.length - done.added).toLocaleString('he-IL')} כבר היו ברשימה.
                  </span>
                )}
                <span className="mt-1 block">
                  סך הכול ברשימה: {done.total.toLocaleString('he-IL')}
                </span>
              </p>
              <button
                onClick={onClose}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                סגירה
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
                <button
                  onClick={() => setMode('new')}
                  className={
                    'flex-1 rounded-md px-3 py-1.5 transition ' +
                    (mode === 'new' ? 'bg-white font-medium text-sky-800 shadow-sm' : 'text-slate-600')
                  }
                >
                  טבלה חדשה
                </button>
                <button
                  onClick={() => setMode('existing')}
                  disabled={views.length === 0}
                  className={
                    'flex-1 rounded-md px-3 py-1.5 transition disabled:opacity-40 ' +
                    (mode === 'existing'
                      ? 'bg-white font-medium text-sky-800 shadow-sm'
                      : 'text-slate-600')
                  }
                >
                  הוספה לקיימת
                </button>
              </div>

              {mode === 'new' ? (
                <label className="block">
                  <span className="mb-1 block text-sm text-slate-600">שם הטבלה</span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()}
                    placeholder="הסעות — מצר"
                    className={inputClass}
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-sm text-slate-600">לאיזו טבלה להוסיף</span>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className={inputClass}
                  >
                    {views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({(v.member_count ?? 0).toLocaleString('he-IL')})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/*
                הרשימה קבועה מרגע היצירה. זה לא פרט טכני — זו ההתנהגות
                שהמשתמש יופתע ממנה בעוד חודש אם לא תיאמר כאן.
              */}
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
                הרשימה נשמרת כרשימת תלמידים קבועה. תלמיד חדש שיתאים לסינון הזה
                <strong> לא</strong> יצטרף אליה מעצמו, ואפשר יהיה להוסיף ולהסיר ידנית בכל עת.
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={submit}
                  disabled={busy || ids.length === 0 || (mode === 'new' ? !name.trim() : !target)}
                  className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-40"
                >
                  {busy ? 'שומר…' : mode === 'new' ? 'יצירה' : 'הוספה'}
                </button>
                <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
                  ביטול
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
