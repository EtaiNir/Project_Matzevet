import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchAuthorities, type Authority } from '@/lib/admin'
import HomeLink from '@/components/HomeLink'
import BusinessTab from '@/components/admin/BusinessTab'
import PermissionsTab from '@/components/admin/PermissionsTab'
import DataTab from '@/components/admin/DataTab'

const TABS = [
  { id: 'business', label: 'התנהלות עסקית' },
  { id: 'permissions', label: 'ניהול הרשאות' },
  { id: 'data', label: 'נתוני המועצה' },
] as const

type TabId = (typeof TABS)[number]['id']

/** דף לקוח — שלושת המסכים של מועצה אזורית אחת. */
export default function ClientDetail() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('business')
  const [authority, setAuthority] = useState<Authority | null>(null)

  useEffect(() => {
    fetchAuthorities()
      .then((list) => setAuthority(list.find((a) => a.code === code) ?? null))
      .catch(() => setAuthority(null))
  }, [code])

  return (
    <div className="min-h-full bg-slate-100">
      <header className="border-b border-slate-200 bg-white px-6 pt-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/admin"
            className="text-sm text-slate-500 transition hover:text-sky-700"
          >
            → חזרה לרשימת הלקוחות
          </Link>
          <HomeLink />
        </div>

        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-sky-800">
          {authority?.name ?? 'מועצה'}
          <span className="font-mono text-sm font-normal text-slate-400" dir="ltr">
            {code}
          </span>
          {authority && !authority.is_active && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
              לא פעילה
            </span>
          )}
        </h1>

        <nav className="mt-3 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'rounded-t-lg px-4 py-2 text-sm font-medium transition ' +
                (tab === t.id
                  ? 'border-b-2 border-sky-600 bg-sky-600 text-white shadow-sm'
                  : 'border-b-2 border-transparent text-slate-600 hover:bg-sky-50 hover:text-sky-700')
              }
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-6">
        {tab === 'business' && (
          <BusinessTab
            code={code}
            authority={authority}
            // עדכון מקומי מיד אחרי שמירה — הכותרת משתנה בלי טעינה מחדש
            onAuthorityChange={(patch) =>
              setAuthority((a) => (a ? { ...a, ...patch } : a))
            }
            // הדף מצייר מועצה שכבר לא קיימת — יוצאים ממנו מיד, עם הודעה
            onDeleted={(summary) =>
              navigate('/admin', { replace: true, state: { deleted: summary } })
            }
          />
        )}
        {tab === 'permissions' && <PermissionsTab code={code} />}
        {tab === 'data' && <DataTab code={code} />}
      </main>
    </div>
  )
}
