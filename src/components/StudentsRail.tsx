import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { IconSearch } from '@/components/brand/Icons'
import type { Preset } from '@/config/presets'
import type { SavedView } from '@/lib/savedViews'

interface Props {
  authorityCode: string
  presets: Preset[]
  activePreset: string
  onPresetChange: (id: string) => void
  /** כמה תלמידים בכל תצורה, לפי הסינון שנפתח איתה */
  presetCounts: Record<string, number>
  views: SavedView[]
  /** הטבלה הייעודית הפתוחה כרגע, אם יש */
  activeViewId?: string | null
  /** יצירת טבלה ייעודית מהסינון הנוכחי */
  onSaveToView: () => void
  canSaveToView: boolean
  /** מחיקת טבלה ייעודית. האישור עצמו נעשה במסך שמעל. */
  onDeleteView?: (view: SavedView) => void
  /** מי רשאי למחוק אותה — בלי זה סל האשפה אינו מוצג */
  canDeleteView?: (view: SavedView) => boolean
}

const WIDTH_KEY = 'matzevet:rail-width'
const MIN_WIDTH = 150
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 192

function readWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH) return raw
  } catch {
    /* אחסון חסום — ברירת המחדל */
  }
  return DEFAULT_WIDTH
}

/**
 * סרגל המסכים — יושב בצד ימין, לצד הטבלה.
 *
 * תצורה וטבלה ייעודית עונות על אותה שאלה: "על איזו קבוצת תלמידים אני
 * מסתכל". קודם הן ישבו בשני מקומות שאין ביניהם קשר — הראשונה בטאבים,
 * השנייה בקישור שנבלע בסרגל הכלים. כאן הן משפחה אחת, וכל אחת עם
 * הספירה שלה.
 *
 * הרוחב נגרר ונשמר בדפדפן: שם של טבלה ייעודית יכול להיות ארוך, ואין
 * רוחב אחד שמתאים לכל המועצות.
 */
export default function StudentsRail({
  authorityCode,
  presets,
  activePreset,
  onPresetChange,
  presetCounts,
  views,
  activeViewId,
  onSaveToView,
  canSaveToView,
  onDeleteView,
  canDeleteView,
}: Props) {
  const [width, setWidth] = useState(readWidth)
  /** תיבת החיפוש נפתחת בלחיצה על הזכוכית — היא אינה תופסת מקום כשלא צריך אותה */
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  /** הרוחב העדכני, כדי שסיום הגרירה לא יתלה ב-state שנסגר עליו */
  const widthRef = useRef(width)
  widthRef.current = width

  function startResize(e: ReactMouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current

    function onMove(ev: MouseEvent) {
      // הסרגל בצד ימין: גרירה שמאלה מרחיבה אותו
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW - (ev.clientX - startX))))
    }
    function onUp() {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(widthRef.current)))
      } catch {
        /* אחסון חסום — הרוחב יחזיק עד לרענון */
      }
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function closeSearch() {
    setSearching(false)
    setQuery('')
  }

  const needle = query.trim().toLowerCase()
  const shownViews = needle
    ? views.filter((v) => v.name.toLowerCase().includes(needle))
    : views

  const item =
    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-right text-sm transition'

  return (
    <aside
      style={{ width }}
      className="thin-scrollbar relative shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50/70 py-2"
    >
      {/* ידית שינוי רוחב — על הגבול שפונה לטבלה */}
      <div
        onMouseDown={startResize}
        title="גרירה לשינוי רוחב הסרגל"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize bg-transparent transition hover:bg-sky-400"
      />

      <h2 className="flex items-center gap-2 px-3 pb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">
        <span className="h-3.5 w-1 rounded-full bg-sky-500" aria-hidden />
        מסכים
      </h2>

      {presets.map((p) => {
        const on = !activeViewId && activePreset === p.id
        return (
          <button
            key={p.id}
            onClick={() => onPresetChange(p.id)}
            title={p.description}
            className={
              item +
              (on
                ? ' bg-sky-600 font-bold text-white'
                : ' text-slate-600 hover:bg-sky-50 hover:text-sky-800')
            }
          >
            <span className="truncate">{p.name}</span>
            {presetCounts[p.id] !== undefined && (
              <span
                className={
                  'shrink-0 text-xs tabular-nums ' + (on ? 'text-sky-100' : 'text-slate-400')
                }
              >
                {presetCounts[p.id].toLocaleString('he-IL')}
              </span>
            )}
          </button>
        )
      })}

      {/* הכותרת עצמה היא הקישור לדף הטבלאות — הגלגל שישב כאן הוביל לאותו מקום */}
      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-2.5">
        <h2 className="min-w-0">
          <Link
            to={`/views/${authorityCode}`}
            title="לדף כל הטבלאות הייעודיות"
            className="flex items-center gap-2 px-3 pb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500 transition hover:text-emerald-700"
          >
            <span className="h-3.5 w-1 rounded-full bg-emerald-500" aria-hidden />
            <span className="truncate">טבלאות ייעודיות</span>
          </Link>
        </h2>
        {views.length > 0 && (
          <button
            onClick={() => (searching ? closeSearch() : setSearching(true))}
            title="חיפוש טבלה לפי שם"
            aria-label="חיפוש טבלה לפי שם"
            className={
              'shrink-0 px-3 pb-1.5 transition ' +
              (searching ? 'text-sky-700' : 'text-slate-400 hover:text-sky-700')
            }
          >
            <IconSearch className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {searching && (
        <div className="px-3 pb-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch()
            }}
            placeholder="חיפוש טבלה…"
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 transition focus:border-sky-400 focus:outline-none"
          />
        </div>
      )}

      {views.length === 0 ? (
        <p className="px-3 pb-1 text-xs leading-relaxed text-slate-400">
          סנן בטבלה ושמור את התוצאה כרשימה קבועה.
        </p>
      ) : shownViews.length === 0 ? (
        <p className="px-3 pb-1 text-xs leading-relaxed text-slate-400">
          אין טבלה בשם «{query.trim()}».
        </p>
      ) : (
        shownViews.map((v) => {
          const on = activeViewId === v.id
          const deletable = Boolean(onDeleteView) && (canDeleteView?.(v) ?? true)
          return (
            <div
              key={v.id}
              className={
                'group flex items-center ' +
                (on ? 'bg-sky-600' : 'transition hover:bg-sky-50')
              }
            >
              <Link
                to={`/views/${authorityCode}/${v.id}`}
                title={v.description ?? v.name}
                className={
                  item +
                  ' min-w-0 flex-1 ' +
                  (on ? 'font-bold text-white' : 'text-slate-600 group-hover:text-sky-800')
                }
              >
                <span className="truncate">{v.name}</span>
                <span
                  className={
                    'shrink-0 text-xs tabular-nums ' + (on ? 'text-sky-100' : 'text-slate-400')
                  }
                >
                  {(v.member_count ?? 0).toLocaleString('he-IL')}
                </span>
              </Link>
              {deletable && (
                <button
                  onClick={() => onDeleteView?.(v)}
                  title={`מחיקת «${v.name}»`}
                  aria-label={`מחיקת «${v.name}»`}
                  className={
                    'shrink-0 px-2 py-1.5 text-xs opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 ' +
                    (on ? 'text-sky-100 hover:text-white' : 'text-slate-400 hover:text-red-600')
                  }
                >
                  🗑
                </button>
              )}
            </div>
          )
        })
      )}

      {/* הפעולה יושבת מתחת לתוצאותיה — ולא מתחרה בשם עם קישור הניווט */}
      {canSaveToView && (
        <button
          onClick={onSaveToView}
          title="שמירת מי שסונן כרגע כרשימה קבועה"
          className="mt-1 w-full px-3 py-1.5 text-right text-sm font-medium text-sky-700 transition hover:bg-sky-50"
        >
          + מהסינון הנוכחי
        </button>
      )}
    </aside>
  )
}
