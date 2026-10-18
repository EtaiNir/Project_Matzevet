import { useLocation, useNavigate } from 'react-router-dom'
import { useLastStudent } from '@/lib/lastStudent'

/**
 * "התלמיד האחרון: <שם> · <כיתה>" — בכותרת של מסכי הבגרות ובאזור האישי.
 * לחיצה פותחת את הכרטיס באותו סבב ועם אותה רשימת דפדוף. לא מוצג כשאין
 * תלמיד אחרון, או כשכבר עומדים על הכרטיס שלו.
 */
export default function LastStudentLink({ className = '' }: { className?: string }) {
  const last = useLastStudent()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  if (!last || pathname === last.href) return null

  const open = () => {
    try {
      sessionStorage.setItem('bagrut:round', last.roundId)
    } catch {
      /* מצב פרטי — ייפתח הסבב האחרון של בית הספר */
    }
    navigate(last.href, { state: last.nav })
  }

  return (
    <button
      onClick={open}
      title="חזרה לכרטיס של התלמיד האחרון שפתחת"
      className={`flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-3 py-1 text-sm text-violet-900 transition hover:border-violet-300 hover:bg-violet-100 ${className}`}
    >
      <span className="text-xs text-violet-600">התלמיד האחרון:</span>
      <span className="truncate font-semibold">{last.name}</span>
      {last.className && <span className="text-xs text-violet-600">· {last.className}</span>}
    </button>
  )
}
