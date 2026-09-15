import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { fetchAuthorities, type Authority } from '@/lib/admin'
import {
  deleteSavedView,
  fetchSavedViews,
  fetchViewFolders,
  renameSavedView,
  type SavedView,
  type ViewFolder,
} from '@/lib/savedViews'
import { fieldLabel } from '@/config/fields'
import { operatorLabel } from '@/lib/filters'
import { IconSearch } from '@/components/brand/Icons'

/** תיאור קצר של הסינון שממנו נזרעה הרשימה — תיעוד, לא תנאי פעיל. */
function describeSeed(view: SavedView): string {
  if (!view.filters?.length) return 'נבנתה ידנית'
  return view.filters
    .map((f) => {
      const value =
        f.values?.length
          ? f.values.slice(0, 2).join(', ') + (f.values.length > 2 ? '…' : '')
          : (f.value ?? '')
      return `${fieldLabel(f.field)} ${operatorLabel(f.operator)}${value ? ' ' + value : ''}`
    })
    .join(' · ')
}

/** מסך הטבלאות הייעודיות של הרשות. */
export default function SavedViews() {
  const { profile } = useAuth()
  const { code = '' } = useParams()
  const [authorities, setAuthorities] = useState<Authority[]>([])
  const [views, setViews] = useState<SavedView[]>([])
  const [folders, setFolders] = useState<ViewFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<SavedView | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    const [v, f] = await Promise.all([fetchSavedViews(code), fetchViewFolders(code)])
    setViews(v)
    setFolders(f)
  }, [code])

  useEffect(() => {
    fetchAuthorities().then(setAuthorities).catch(() => setAuthorities([]))
    load()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [load])

  const authority = authorities.find((a) => a.code === code)

  // חיפוש לפי שם בלבד — זה מה שהמשתמש זוכר מהרשימה בסרגל
  const needle = query.trim().toLowerCase()
  const shown = needle ? views.filter((v) => v.name.toLowerCase().includes(needle)) : views

  /** הנתיב המלא לתיקייה, כדי שהכרטיס יגיד איפה הטבלה יושבת בסרגל */
  function pathOf(folderId: string | null): string {
    const parts: string[] = []
    let cur = folderId
    for (let guard = 0; cur && guard < 20; guard++) {
      const f = folders.find((x) => x.id === cur)
      if (!f) break
      parts.unshift(f.name)
      cur = f.parent_id
    }
    return parts.join(' / ')
  }

  async function rename(id: string) {
    try {
      await renameSavedView(id, draft)
      setEditing(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove(view: SavedView) {
    try {
      await deleteSavedView(view.id)
      setConfirming(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-sky-800">
            טבלאות ייעודיות
            <span className="mr-2 text-base font-normal text-slate-500">
              {authority?.name ?? `רשות ${code}`}
            </span>
          </h1>
          <p className="text-sm text-slate-500">
            רשימות תלמידים קבועות, שנבנו מסינון ואפשר להוסיף ולהסיר מהן ידנית.
            כל משתמש רואה את הרשימות שהוא יצר, ואת אלה ששותפו איתו.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {views.length > 0 && (
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1 transition focus-within:border-sky-400">
              <IconSearch className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder="חיפוש טבלה…"
                className="w-40 bg-transparent text-sm text-slate-700 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="ניקוי החיפוש"
                  className="shrink-0 text-slate-400 transition hover:text-slate-700"
                >
                  ✕
                </button>
              )}
            </label>
          )}
          <Link
            to={`/students/${code}`}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-sky-50 hover:text-sky-700"
          >
            → חזרה לטבלה
          </Link>
        </div>
      </header>

      <main className="p-6">
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">שגיאה: {error}</p>
        )}
        {loading && <p className="text-slate-400">טוען…</p>}

        {!loading && views.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
            <div className="text-3xl">▦</div>
            <p className="mt-2">עדיין אין טבלאות ייעודיות.</p>
            <p className="mt-1 text-sm">
              סנן בטבלה הראשית, ולחץ על <strong>«טבלה ייעודית»</strong> בסרגל הכלים.
            </p>
          </div>
        )}

        {needle && views.length > 0 && (
          <p className="mb-3 text-sm text-slate-500">
            {shown.length.toLocaleString('he-IL')} מתוך {views.length.toLocaleString('he-IL')}{' '}
            טבלאות תואמות ל«{query.trim()}»
          </p>
        )}

        {!loading && views.length > 0 && shown.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
            אין טבלה שהשם שלה מכיל «{query.trim()}».
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((v) => (
            <div
              key={v.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-sky-300 hover:shadow-md"
            >
              <div className="h-1.5 bg-gradient-to-l from-sky-400 to-sky-600" />
              <div className="flex flex-1 flex-col p-5">
                {editing === v.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(v.id)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    onBlur={() => rename(v.id)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-lg font-bold focus:border-sky-400 focus:outline-none"
                  />
                ) : (
                  <h2 className="text-lg font-bold text-slate-800">{v.name}</h2>
                )}

                <p className="mt-1 text-xs text-slate-400" title={describeSeed(v)}>
                  {describeSeed(v)}
                </p>

                <div className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-sky-700">
                    {(v.member_count ?? 0).toLocaleString('he-IL')}
                  </div>
                  <div className="text-xs text-sky-600">תלמידים ברשימה</div>
                </div>

                <p className="mt-3 text-xs text-slate-400">
                  נוצרה {new Date(v.created_at).toLocaleDateString('he-IL')}
                  {v.folder_id ? ` · 📁 ${pathOf(v.folder_id)}` : ''}
                </p>

                <div className="mt-auto flex items-center gap-2 pt-4">
                  <Link
                    to={`/views/${code}/${v.id}`}
                    className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700"
                  >
                    פתיחה ←
                  </Link>
                  {/*
                    שינוי שם ומחיקה — ליוצר בלבד. טבלה ששותפה איתך נחסמת
                    לשתי הפעולות ב-RLS; הכפתורים פשוט אינם מוצעים.
                  */}
                  {v.created_by === profile?.id ? (
                    <>
                      <button
                        onClick={() => {
                          setEditing(v.id)
                          setDraft(v.name)
                        }}
                        title="שינוי שם"
                        className="rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-sky-50 hover:text-sky-700"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => setConfirming(v)}
                        title="מחיקת הטבלה"
                        className="mr-auto rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        🗑
                      </button>
                    </>
                  ) : (
                    <span
                      title="הטבלה שותפה איתך. מחיקה ושינוי שם שמורים למי שיצר אותה."
                      className="mr-auto rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                    >
                      שותפה איתך
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {confirming && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div dir="rtl" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <h3 className="font-bold text-red-800">מחיקת «{confirming.name}»</h3>
              <p className="mt-2 text-sm text-slate-700">
                הרשימה תימחק על {(confirming.member_count ?? 0).toLocaleString('he-IL')} התלמידים
                שבה. <strong>נתוני התלמידים עצמם אינם נמחקים</strong> — רק הרשימה.
              </p>
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={() => remove(confirming)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  מחיקה
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  className="text-sm text-slate-500 hover:text-slate-800"
                >
                  ביטול
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
