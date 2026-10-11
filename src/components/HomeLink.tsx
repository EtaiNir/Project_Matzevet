import { Link } from 'react-router-dom'
import { IconHome } from '@/components/brand/Icons'

/**
 * כפתור "האזור שלי" — אותו כפתור בכל מסך (מצבת, זכאות לבגרות, ניהול לקוחות,
 * מסך לקוח), כדי שתמיד תהיה דרך גלויה לאזור האישי ולמוצרים האחרים.
 * הלוגו מוביל לשם גם הוא, אבל לוגו אינו כפתור שמחפשים.
 */
export default function HomeLink({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/home"
      title="לאזור האישי — כל המוצרים שלך"
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-800 transition hover:border-sky-300 hover:bg-sky-100 ${className}`}
    >
      <IconHome className="h-4 w-4" />
      האזור שלי
    </Link>
  )
}
