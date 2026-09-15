import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  IconChevron,
  IconFolder,
  IconFolderPlus,
  IconSearch,
} from '@/components/brand/Icons'
import type { Preset } from '@/config/presets'
import type { SavedView, ViewFolder } from '@/lib/savedViews'

interface Props {
  authorityCode: string
  presets: Preset[]
  activePreset: string
  onPresetChange: (id: string) => void
  /** כמה תלמידים בכל תצורה, לפי הסינון שנפתח איתה */
  presetCounts: Record<string, number>
  views: SavedView[]
  /** התיקיות של המשתמש, שטוחות. העץ נבנה כאן */
  folders: ViewFolder[]
  /** הטבלה הייעודית הפתוחה כרגע, אם יש */
  activeViewId?: string | null
  /** יצירת טבלה ייעודית מהסינון הנוכחי */
  onSaveToView: () => void
  canSaveToView: boolean
  /** מחיקת טבלה ייעודית. האישור עצמו נעשה במסך שמעל. */
  onDeleteView?: (view: SavedView) => void

  onCreateFolder?: (name: string, parentId: string | null) => void
  onRenameFolder?: (id: string, name: string) => void
  onDeleteFolder?: (folder: ViewFolder) => void
  onMoveView?: (viewId: string, folderId: string | null) => void
  onMoveFolder?: (folderId: string, parentId: string | null) => void
}

const WIDTH_KEY = 'matzevet:rail-width'
const OPEN_KEY = 'matzevet:view-folders-open'
const MIN_WIDTH = 150
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 192
/** הזחה לכל רמה בעץ, בפיקסלים */
const INDENT = 14

function readWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH) return raw
  } catch {
    /* אחסון חסום — ברירת המחדל */
  }
  return DEFAULT_WIDTH
}

function readOpen(code: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${OPEN_KEY}:${code}`)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* אחסון חסום או JSON פגום — מתחילים סגור */
  }
  return new Set()
}

/** מה נגרר כרגע. הקידומת מפרידה בין תיקייה לטבלה באותו dataTransfer. */
type DragPayload = { kind: 'view' | 'folder'; id: string }

function encodeDrag(p: DragPayload): string {
  return `${p.kind}:${p.id}`
}

function decodeDrag(raw: string): DragPayload | null {
  const [kind, id] = raw.split(':')
  if ((kind === 'view' || kind === 'folder') && id) return { kind, id }
  return null
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'he')

/**
 * סרגל המסכים — יושב בצד ימין, לצד הטבלה.
 *
 * תצורה וטבלה ייעודית עונות על אותה שאלה: "על איזו קבוצת תלמידים אני
 * מסתכל". קודם הן ישבו בשני מקומות שאין ביניהם קשר — הראשונה בטאבים,
 * השנייה בקישור שנבלע בסרגל הכלים. כאן הן משפחה אחת, וכל אחת עם
 * הספירה שלה.
 *
 * ## עץ התיקיות
 *
 * הטבלאות הייעודיות מסודרות בעץ, בהתנהגות של סייר הקבצים:
 *
 *   לחיצה בודדת   בוחרת תיקייה — והיא היעד של כפתור "תיקייה חדשה"
 *   לחיצה כפולה   פותחת וסוגרת
 *   לחיצה על החץ  פותחת וסוגרת
 *   לחיצה ימנית   תפריט: שינוי שם · תיקייה בתוכה · מחיקה
 *   גרירה         טבלה או תיקייה אל תוך תיקייה, או אל שטח ריק = שורש
 *
 * לכל מחווה יש תפקיד. לחיצה בודדת שאינה עושה דבר הייתה נראית כתקלה,
 * ולחיצה בודדת שפותחת הייתה מבטלת את הלחיצה הכפולה שנתבקשה.
 *
 * בחיפוש העץ **מתמוטט לרשימה שטוחה**, עם נתיב התיקייה מתחת לכל שם —
 * כמו שסייר הקבצים מתנהג בחיפוש. מי שמחפש אינו יודע איפה זה יושב; אם
 * היה יודע, לא היה מחפש.
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
  folders,
  activeViewId,
  onSaveToView,
  canSaveToView,
  onDeleteView,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveView,
  onMoveFolder,
}: Props) {
  const [width, setWidth] = useState(readWidth)
  /** הרוחב העדכני, כדי שסיום הגרירה לא יתלה ב-state שנסגר עליו */
  const widthRef = useRef(width)
  widthRef.current = width

  /** תיבת החיפוש נפתחת בלחיצה על הזכוכית — היא אינה תופסת מקום כשלא צריך אותה */
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

  const [open, setOpen] = useState<Set<string>>(() => readOpen(authorityCode))
  const [selected, setSelected] = useState<string | null>(null)
  /** תיבת שם לתיקייה חדשה, תחת ההורה הזה */
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ folder: ViewFolder; x: number; y: number } | null>(null)
  /** מה מסומן כיעד נפילה כרגע: מזהה תיקייה, או 'root' */
  const [dropOn, setDropOn] = useState<string | null>(null)

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      try {
        localStorage.setItem(`${OPEN_KEY}:${authorityCode}`, JSON.stringify([...next]))
      } catch {
        /* אחסון חסום — הפתיחה תחזיק עד לרענון */
      }
      return next
    })
  }

  /**
   * טבלה שנפתחה מחוץ לסרגל (קישור, דף הטבלאות) חייבת להיראות בו.
   * בלי זה היא הייתה מסומנת כפעילה בתוך תיקייה סגורה — כלומר בלתי
   * נראית, והסרגל היה נראה כאילו איבד אותה.
   */
  useEffect(() => {
    const v = activeViewId ? views.find((x) => x.id === activeViewId) : undefined
    if (!v?.folder_id) return
    const chain: string[] = []
    let cur: string | null = v.folder_id
    for (let guard = 0; cur && guard < 20; guard++) {
      chain.push(cur)
      cur = folders.find((f) => f.id === cur)?.parent_id ?? null
    }
    setOpen((prev) => {
      // החזרת אותו Set מונעת רינדור חוזר אינסופי
      if (chain.every((id) => prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of chain) next.add(id)
      try {
        localStorage.setItem(`${OPEN_KEY}:${authorityCode}`, JSON.stringify([...next]))
      } catch {
        /* אחסון חסום */
      }
      return next
    })
  }, [activeViewId, views, folders, authorityCode])

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
  const matching = needle ? views.filter((v) => v.name.toLowerCase().includes(needle)) : views

  /** הנתיב המלא לתיקייה, לתצוגה מתחת לתוצאת חיפוש */
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

  const foldersIn = (parent: string | null) =>
    folders.filter((f) => (f.parent_id ?? null) === parent).sort(byName)
  const viewsIn = (parent: string | null) =>
    matching.filter((v) => (v.folder_id ?? null) === parent).sort(byName)

  // ─────────────────────────── גרירה ───────────────────────────

  function onDragStartItem(e: ReactDragEvent, payload: DragPayload) {
    e.dataTransfer.setData('text/plain', encodeDrag(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  function allowDrop(e: ReactDragEvent, target: string) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropOn(target)
  }

  /** `folderId` ריק = השורש */
  function handleDrop(e: ReactDragEvent, folderId: string | null) {
    e.preventDefault()
    e.stopPropagation()
    setDropOn(null)
    const p = decodeDrag(e.dataTransfer.getData('text/plain'))
    if (!p) return
    if (p.kind === 'view') {
      onMoveView?.(p.id, folderId)
    } else if (p.id !== folderId) {
      // מעגלים נחסמים במסד; כאן רק מונעים את המקרה הגלוי לעין
      onMoveFolder?.(p.id, folderId)
    }
  }

  // ─────────────────────────── שורות ───────────────────────────

  const rowBase = 'group flex w-full items-center gap-1.5 py-1.5 pl-2 text-right text-sm transition'

  function nameInput(onCommit: (value: string) => void, onCancel: () => void, placeholder?: string) {
    return (
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          const name = draft.trim()
          if (name) onCommit(name)
          setDraft('')
          onCancel()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft('')
            onCancel()
          }
        }}
        className="w-full rounded border border-sky-400 bg-white px-1 py-0.5 text-sm focus:outline-none"
      />
    )
  }

  function folderRow(f: ViewFolder, depth: number): ReactNode {
    const pad = { paddingInlineStart: 8 + depth * INDENT }

    if (renaming === f.id) {
      return (
        <div key={`f-${f.id}`} style={pad} className={rowBase}>
          <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
          {nameInput(
            (name) => onRenameFolder?.(f.id, name),
            () => setRenaming(null),
          )}
        </div>
      )
    }

    const isOpen = open.has(f.id)
    const isSelected = selected === f.id
    const isDropTarget = dropOn === f.id

    return (
      <div
        key={`f-${f.id}`}
        draggable
        onDragStart={(e) => onDragStartItem(e, { kind: 'folder', id: f.id })}
        onDragOver={(e) => allowDrop(e, f.id)}
        onDragLeave={() => setDropOn((d) => (d === f.id ? null : d))}
        onDrop={(e) => handleDrop(e, f.id)}
        onClick={(e) => {
          e.stopPropagation()
          setSelected(isSelected ? null : f.id)
        }}
        onDoubleClick={() => toggleOpen(f.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelected(f.id)
          setMenu({ folder: f, x: e.clientX, y: e.clientY })
        }}
        title={f.name}
        style={pad}
        className={
          rowBase +
          ' cursor-pointer select-none text-slate-700 ' +
          (isDropTarget
            ? 'bg-emerald-100 ring-1 ring-inset ring-emerald-400'
            : isSelected
              ? 'bg-sky-100'
              : 'hover:bg-sky-50')
        }
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleOpen(f.id)
          }}
          aria-label={isOpen ? 'סגירת התיקייה' : 'פתיחת התיקייה'}
          className="shrink-0 text-slate-400 transition hover:text-sky-700"
        >
          <IconChevron className={'h-3 w-3 transition-transform ' + (isOpen ? '-rotate-90' : '')} />
        </button>
        <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="truncate">{f.name}</span>
      </div>
    )
  }

  function viewRow(v: SavedView, depth: number, path?: string): ReactNode {
    const on = activeViewId === v.id
    return (
      <div
        key={`v-${v.id}`}
        draggable
        onDragStart={(e) => onDragStartItem(e, { kind: 'view', id: v.id })}
        className={'group flex items-center ' + (on ? 'bg-sky-600' : 'transition hover:bg-sky-50')}
      >
        <Link
          to={`/views/${authorityCode}/${v.id}`}
          title={v.description ?? v.name}
          style={{ paddingInlineStart: 8 + depth * INDENT }}
          className={
            'flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pl-2 text-right text-sm transition ' +
            (on ? 'font-bold text-white' : 'text-slate-600 group-hover:text-sky-800')
          }
        >
          <span className="min-w-0">
            <span className="block truncate">{v.name}</span>
            {path && (
              <span
                className={'block truncate text-[11px] ' + (on ? 'text-sky-100' : 'text-slate-400')}
              >
                {path}
              </span>
            )}
          </span>
          <span
            className={'shrink-0 text-xs tabular-nums ' + (on ? 'text-sky-100' : 'text-slate-400')}
          >
            {(v.member_count ?? 0).toLocaleString('he-IL')}
          </span>
        </Link>
        {onDeleteView && (
          <button
            onClick={() => onDeleteView(v)}
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
  }

  /** תיבת השם לתיקייה חדשה, מוצגת במקום שבו התיקייה תיווצר */
  function newFolderRow(depth: number): ReactNode {
    const parentId = creating?.parentId ?? null
    return (
      <div
        key="new-folder"
        style={{ paddingInlineStart: 8 + depth * INDENT }}
        className={rowBase}
      >
        <IconFolder className="h-4 w-4 shrink-0 text-emerald-600" />
        {nameInput(
          (name) => {
            onCreateFolder?.(name, parentId)
            if (parentId && !open.has(parentId)) toggleOpen(parentId)
          },
          () => setCreating(null),
          'שם התיקייה',
        )}
      </div>
    )
  }

  function renderTree(parentId: string | null, depth: number): ReactNode[] {
    const out: ReactNode[] = []
    for (const f of foldersIn(parentId)) {
      out.push(folderRow(f, depth))
      if (creating && creating.parentId === f.id) out.push(newFolderRow(depth + 1))
      if (open.has(f.id)) out.push(...renderTree(f.id, depth + 1))
    }
    for (const v of viewsIn(parentId)) out.push(viewRow(v, depth))
    return out
  }

  const item =
    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-right text-sm transition'

  return (
    <aside
      style={{ width }}
      // נפילה בכל מקום בסרגל שאינו תיקייה = העברה לשורש. קודם זה היה
      // רצועה בגובה קבוע, ומי שגרר אל השטח הריק שמתחתיה לא קיבל דבר.
      onDragOver={(e) => allowDrop(e, 'root')}
      onDragLeave={() => setDropOn((d) => (d === 'root' ? null : d))}
      onDrop={(e) => handleDrop(e, null)}
      className={
        'thin-scrollbar relative shrink-0 overflow-y-scroll border-l border-slate-200 bg-slate-50/70 py-2 ' +
        (dropOn === 'root' ? 'ring-2 ring-inset ring-emerald-400' : '')
      }
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
        <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1.5">
          {onCreateFolder && (
            <button
              onClick={() => {
                setDraft('')
                setCreating({ parentId: selected })
                if (selected && !open.has(selected)) toggleOpen(selected)
              }}
              title={
                selected
                  ? 'תיקייה חדשה בתוך התיקייה המסומנת'
                  : 'תיקייה חדשה. לסימון תיקייה — לחיצה עליה, והחדשה תיווצר בתוכה'
              }
              aria-label="תיקייה חדשה"
              className="text-slate-400 transition hover:text-emerald-700"
            >
              <IconFolderPlus className="h-4 w-4" />
            </button>
          )}
          {views.length > 0 && (
            <button
              onClick={() => (searching ? closeSearch() : setSearching(true))}
              title="חיפוש טבלה לפי שם"
              aria-label="חיפוש טבלה לפי שם"
              className={
                'transition ' + (searching ? 'text-sky-700' : 'text-slate-400 hover:text-sky-700')
              }
            >
              <IconSearch className="h-4 w-4" />
            </button>
          )}
        </div>
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

      {/* לחיצה על שטח ריק מבטלת את הסימון, כמו בסייר הקבצים */}
      <div onClick={() => setSelected(null)} className="min-h-[3rem] pb-1">
        {needle ? (
          matching.length === 0 ? (
            <p className="px-3 pb-1 text-xs leading-relaxed text-slate-400">
              אין טבלה בשם «{query.trim()}».
            </p>
          ) : (
            matching
              .slice()
              .sort(byName)
              .map((v) => viewRow(v, 0, pathOf(v.folder_id)))
          )
        ) : (
          <>
            {creating && creating.parentId === null && newFolderRow(0)}
            {folders.length === 0 && views.length === 0 ? (
              <p className="px-3 pb-1 text-xs leading-relaxed text-slate-400">
                סנן בטבלה ושמור את התוצאה כרשימה קבועה.
              </p>
            ) : (
              renderTree(null, 0)
            )}
          </>
        )}
      </div>

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

      {menu &&
        createPortal(
          <>
            {/* שכבה שקופה שסוגרת בלחיצה בחוץ, בלי מאזין על document */}
            <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
            <div
              dir="rtl"
              style={{
                position: 'fixed',
                top: Math.min(menu.y, window.innerHeight - 150),
                left: Math.min(Math.max(8, menu.x), window.innerWidth - 188),
                width: 180,
              }}
              className="z-50 overflow-hidden rounded-xl border border-slate-300 bg-white py-1 shadow-2xl"
            >
              <div className="truncate border-b border-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
                {menu.folder.name}
              </div>
              <button
                onClick={() => {
                  setDraft(menu.folder.name)
                  setRenaming(menu.folder.id)
                  setMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-sky-50 hover:text-sky-800"
              >
                <span>✎</span>
                <span>שינוי שם</span>
              </button>
              <button
                onClick={() => {
                  setDraft('')
                  setCreating({ parentId: menu.folder.id })
                  if (!open.has(menu.folder.id)) toggleOpen(menu.folder.id)
                  setMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-sky-50 hover:text-sky-800"
              >
                <IconFolderPlus className="h-4 w-4" />
                <span>תיקייה בתוכה</span>
              </button>
              <button
                onClick={() => {
                  onDeleteFolder?.(menu.folder)
                  setMenu(null)
                }}
                title="הטבלאות שבתוכה יחזרו לשורש ולא יימחקו"
                className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-red-50 hover:text-red-700"
              >
                <span>🗑</span>
                <span>מחיקת התיקייה</span>
              </button>
            </div>
          </>,
          document.body,
        )}
    </aside>
  )
}
