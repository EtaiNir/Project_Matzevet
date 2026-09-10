import { useEffect, useMemo, useState } from 'react'
import {
  fetchUsers,
  fetchScopeOptions,
  updateUserPermissions,
  setUserPassword,
  setUserSuspended,
  deleteUser,
  ROLE_LABELS,
  SCOPE_LABELS,
  type ManagedUser,
  type ScopeLevel,
  type ScopeOption,
  type UserRole,
} from '@/lib/admin'
import NewUserForm, { suggestPassword } from './NewUserForm'

interface Props {
  code: string
}

/** מסך 2 — ניהול הרשאות: תפקיד + היקף (מועצתי / יישובי / בית-ספרי). */
export default function PermissionsTab({ code }: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  // שדות התפקיד והמוסד קיימים רק אחרי מיגרציה 010
  const [hasProfileFields, setHasProfileFields] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<ManagedUser | null>(null)
  const [options, setOptions] = useState<ScopeOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [scopeQuery, setScopeQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  // רמת ההיקף שנבחרה בטופס המשתמש החדש — קובעת אילו אפשרויות לטעון
  const [newUserLevel, setNewUserLevel] = useState<ScopeLevel>('council')
  const [notice, setNotice] = useState<string | null>(null)
  // שדה הסיסמה שבתוך טופס העריכה — ריק פירושו "לא לשנות"
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    fetchUsers()
      .then(({ users, hasProfileFields }) => {
        setUsers(users)
        setHasProfileFields(hasProfileFields)
      })
      .catch((e) => setError(e.message))
  }, [])

  // טוענים את רשימת היישובים/המוסדות רק כשבאמת צריך אותה
  const activeLevel: ScopeLevel = adding ? newUserLevel : (draft?.scope_level ?? 'council')
  useEffect(() => {
    if (activeLevel === 'council') {
      setOptions([])
      return
    }
    setOptionsLoading(true)
    fetchScopeOptions(code, activeLevel)
      .then(setOptions)
      .catch((e) => setError(e.message))
      .finally(() => setOptionsLoading(false))
  }, [activeLevel, code])

  async function reload() {
    const { users, hasProfileFields } = await fetchUsers()
    setUsers(users)
    setHasProfileFields(hasProfileFields)
  }

  async function toggleSuspended(user: ManagedUser) {
    const next = !user.is_suspended
    if (next && !confirm(`להשהות את ${user.email}? הוא לא יוכל להתחבר עד לביטול.`)) return
    try {
      await setUserSuspended(user.id, next)
      await reload()
      setNotice(next ? `${user.email} הושהה` : `${user.email} הוחזר לפעילות`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function removeUser(user: ManagedUser) {
    if (!confirm(`למחוק לצמיתות את ${user.email}?`)) return
    try {
      await deleteUser(user.id)
      await reload()
      setNotice(`${user.email} נמחק`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const filteredOptions = useMemo(() => {
    const q = scopeQuery.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.includes(q),
    )
  }, [options, scopeQuery])

  function startEdit(user: ManagedUser) {
    setEditing(user.id)
    setDraft({ ...user })
    setScopeQuery('')
    setNewPassword('')
    setError(null)
  }

  function toggleScopeValue(value: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            scope_values: d.scope_values.includes(value)
              ? d.scope_values.filter((v) => v !== value)
              : [...d.scope_values, value],
          }
        : d,
    )
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await updateUserPermissions(draft.id, {
        role: draft.role,
        authority_codes: draft.authority_codes,
        scope_level: draft.scope_level,
        // ברמה מועצתית אין ערכי היקף — מנקים כדי שלא יישארו שאריות
        scope_values: draft.scope_level === 'council' ? [] : draft.scope_values,
        // נשלחים רק אם העמודות קיימות, אחרת העדכון כולו נכשל
        ...(hasProfileFields
          ? {
              // מאופס למי שאינו צופה: הורדה בתפקיד לא תשאיר הרשאה
              // תלויה שאיש אינו רואה במסך.
              can_edit_extra: draft.role === 'viewer' ? Boolean(draft.can_edit_extra) : false,
              job_title: draft.job_title?.trim() || null,
              institution_name: draft.institution_name?.trim() || null,
              institution_code: draft.institution_code?.trim() || null,
            }
          : {}),
      })
      if (newPassword) {
        await setUserPassword(draft.id, newPassword)
      }
      await reload()
      setEditing(null)
      setDraft(null)
      setNotice(newPassword ? 'ההרשאות והסיסמה עודכנו' : 'ההרשאות עודכנו')
      setNewPassword('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inRashut = users.filter((u) => u.authority_codes.includes(code))
  const others = users.filter((u) => !u.authority_codes.includes(code))

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">שגיאה: {error}</p>
      )}

      {notice && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="font-bold text-sky-800">משתמשים ברשות זו</h3>
          {!adding && (
            <button
              onClick={() => {
                setAdding(true)
                setEditing(null)
                setDraft(null)
                setNotice(null)
              }}
              className="rounded-lg border border-dashed border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
            >
              + משתמש חדש
            </button>
          )}
        </div>
        <p className="mb-4 text-sm text-slate-500">
          התפקיד קובע מה מותר לעשות; ההיקף קובע <strong>אילו תלמידים</strong> נראים.
          ההיקף אוכף במסד הנתונים (RLS) — לא רק בתצוגה.
        </p>

        {adding && (
          <div className="mb-4">
            <NewUserForm
              authorityCode={code}
              options={options}
              optionsLoading={optionsLoading}
              onScopeLevelChange={setNewUserLevel}
              onCreated={async () => {
                setAdding(false)
                setNewUserLevel('council')
                await reload()
                setNotice('המשתמש נוצר. מסור לו את הסיסמה שרשמת.')
              }}
              onCancel={() => {
                setAdding(false)
                setNewUserLevel('council')
              }}
            />
          </div>
        )}

        {inRashut.length === 0 && !adding && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
            אין משתמשים משויכים לרשות זו.
          </p>
        )}

        <div className="space-y-3">
          {inRashut.map((user) => {
            const isEditing = editing === user.id && draft
            return (
              <div
                key={user.id}
                className="rounded-xl border border-slate-200 p-4 transition hover:border-sky-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium text-slate-800">
                      {user.display_name || user.email}
                      {user.is_suspended && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-800">
                          מושהה — אינו יכול להתחבר
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-slate-400" dir="ltr">
                      {user.email}
                    </div>
                    {(user.job_title || user.institution_name) && (
                      <div className="text-xs text-slate-500">
                        {[
                          user.job_title,
                          user.institution_name,
                          user.institution_code,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                        {ROLE_LABELS[user.role]}
                      </span>
                      {user.role === 'viewer' && user.can_edit_extra && (
                        <span
                          title="רשאי למלא ערכים בעמודות שהמשתמש הוסיף"
                          className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                        >
                          עריכת עמודות
                        </span>
                      )}
                      {user.role !== 'super_admin' && (
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">
                          {user.scope_level === 'council'
                            ? 'מועצתי'
                            : `${user.scope_level === 'locality' ? 'יישובי' : 'בית-ספרי'} · ${user.scope_values.length}`}
                        </span>
                      )}
                      <button
                        onClick={() => startEdit(user)}
                        className="rounded-lg border border-slate-300 px-3 py-1 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
                      >
                        עריכה
                      </button>
                      <button
                        onClick={() => toggleSuspended(user)}
                        title={user.is_suspended ? 'החזרה לפעילות' : 'חסימת כניסה למערכת'}
                        className={
                          'rounded-lg border px-3 py-1 transition ' +
                          (user.is_suspended
                            ? 'border-amber-400 bg-amber-100 font-medium text-amber-800 hover:bg-amber-200'
                            : 'border-slate-300 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700')
                        }
                      >
                        {user.is_suspended ? 'מושהה' : 'השהייה'}
                      </button>
                      <button
                        onClick={() => removeUser(user)}
                        title="מחיקת משתמש"
                        className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {isEditing && draft && (
                  <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-sky-800">עריכת הרשאות</span>
                      <button
                        onClick={() => {
                          setEditing(null)
                          setDraft(null)
                        }}
                        title="סגירת העריכה"
                        className="rounded-lg px-2 py-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        ▲
                      </button>
                    </div>
                    {/* תפקיד ומוסד — תיאוריים בלבד, לתצוגה בכותרת המסך
                        (הערות 1 ו-4). אינם משפיעים על ההרשאות. */}
                    {hasProfileFields && (
                      <div className="grid gap-4 sm:grid-cols-3">
                        <label className="block">
                          <span className="mb-1 block text-sm text-slate-600">
                            תפקיד <span className="text-xs text-slate-400">(לתצוגה)</span>
                          </span>
                          <input
                            value={draft.job_title ?? ''}
                            onChange={(e) => setDraft({ ...draft, job_title: e.target.value })}
                            placeholder="מזכירת בית ספר"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm text-slate-600">שם מוסד</span>
                          <input
                            value={draft.institution_name ?? ''}
                            onChange={(e) =>
                              setDraft({ ...draft, institution_name: e.target.value })
                            }
                            placeholder="מקיף גוונים"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm text-slate-600">סמל מוסד</span>
                          <input
                            dir="ltr"
                            value={draft.institution_code ?? ''}
                            onChange={(e) =>
                              setDraft({ ...draft, institution_code: e.target.value })
                            }
                            placeholder="440386"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-sky-400 focus:outline-none"
                          />
                        </label>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-sm text-slate-600">תפקיד במערכת</span>
                        <select
                          value={draft.role}
                          onChange={(e) =>
                            setDraft({ ...draft, role: e.target.value as UserRole })
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                        >
                          {Object.entries(ROLE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>

                      {draft.role === 'super_admin' ? (
                        <div className="flex items-end">
                          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
                            מנהל־על רואה את כל המועצות — אין מה להגביל.
                          </p>
                        </div>
                      ) : (
                        <label className="block">
                          <span className="mb-1 block text-sm text-slate-600">היקף הצפייה</span>
                          <select
                            value={draft.scope_level}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                scope_level: e.target.value as ScopeLevel,
                                scope_values: [],
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                          >
                            {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>

                    {/*
                      רלוונטי ל-viewer בלבד. מנהל רשות ומעלה רשאי ממילא
                      (may_edit_extra), ולכן תיבה אצלו הייתה מבלבלת —
                      נראית כאילו אפשר לשלול ממנו משהו.
                    */}
                    {hasProfileFields && draft.role === 'viewer' && (
                      <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.can_edit_extra)}
                          onChange={(e) =>
                            setDraft({ ...draft, can_edit_extra: e.target.checked })
                          }
                          className="mt-0.5 accent-sky-600"
                        />
                        <span className="text-sm">
                          <span className="font-medium text-slate-700">
                            עריכת עמודות שהמשתמש הוסיף
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                            מאפשר למלא ערכים בעמודות התוספתיות — לסמן תיבות ולכתוב
                            הערות. <strong>אינו</strong> מאפשר ליצור או למחוק עמודות,
                            ואינו משנה אילו תלמידים המשתמש רואה.
                          </span>
                        </span>
                      </label>
                    )}

                    {draft.role !== 'super_admin' && draft.scope_level !== 'council' && (
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm text-slate-600">
                            {draft.scope_level === 'locality' ? 'יישובים מותרים' : 'מוסדות מותרים'}
                            {draft.scope_values.length > 0 && (
                              <strong className="mr-1 text-sky-700">
                                ({draft.scope_values.length} נבחרו)
                              </strong>
                            )}
                          </span>
                          <input
                            value={scopeQuery}
                            onChange={(e) => setScopeQuery(e.target.value)}
                            placeholder="חיפוש…"
                            className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-sky-400 focus:outline-none"
                          />
                        </div>

                        {optionsLoading ? (
                          <p className="text-sm text-slate-400">טוען רשימה…</p>
                        ) : (
                          <div className="thin-scrollbar max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                            {filteredOptions.map((o) => (
                              <label
                                key={o.value}
                                className="flex cursor-pointer items-center gap-2 border-b border-slate-50 px-3 py-1.5 text-sm last:border-0 hover:bg-sky-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={draft.scope_values.includes(o.value)}
                                  onChange={() => toggleScopeValue(o.value)}
                                  className="accent-sky-600"
                                />
                                <span className="flex-1 truncate">{o.label}</span>
                                <span className="font-mono text-xs text-slate-400" dir="ltr">
                                  {o.value}
                                </span>
                                <span className="w-12 text-left text-xs text-slate-400">
                                  {o.count}
                                </span>
                              </label>
                            ))}
                            {filteredOptions.length === 0 && (
                              <p className="p-4 text-center text-sm text-slate-400">
                                לא נמצאו תוצאות
                              </p>
                            )}
                          </div>
                        )}

                        {draft.scope_values.length === 0 && (
                          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            ⚠ לא נבחר אף ערך — המשתמש לא יראה אף תלמיד.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-4">
                      <label
                        htmlFor={`pw-${draft.id}`}
                        className="mb-1 block text-sm text-slate-600"
                      >
                        סיסמה חדשה{' '}
                        <span className="text-xs text-slate-400">
                          (השאר ריק כדי לא לשנות · 8 תווים לפחות)
                        </span>
                      </label>
                      <div className="flex max-w-sm gap-2">
                        <input
                          id={`pw-${draft.id}`}
                          dir="ltr"
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="ללא שינוי"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                        <button
                          type="button"
                          onClick={() => setNewPassword(suggestPassword())}
                          title="הצע סיסמה"
                          className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm transition hover:bg-slate-50"
                        >
                          🎲
                        </button>
                      </div>
                      {newPassword.length > 0 && newPassword.length < 8 && (
                        <p className="mt-1 text-xs text-amber-700">
                          עוד {8 - newPassword.length} תווים לפחות
                        </p>
                      )}
                      {newPassword.length >= 8 && (
                        <p className="mt-1 text-xs text-emerald-700">
                          הסיסמה תוחלף בשמירה — רשום אותה למסירה למשתמש
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={save}
                        disabled={busy || (newPassword.length > 0 && newPassword.length < 8)}
                        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
                      >
                        {busy ? 'שומר…' : 'שמירה'}
                      </button>
                      <button
                        onClick={() => {
                          setEditing(null)
                          setDraft(null)
                        }}
                        className="rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {others.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-bold text-slate-600">משתמשים אחרים במערכת</h3>
          <ul className="space-y-1 text-sm text-slate-500">
            {others.map((u) => (
              <li key={u.id} className="flex justify-between gap-2">
                <span dir="ltr" className="font-mono text-xs">
                  {u.email}
                </span>
                <span>{ROLE_LABELS[u.role]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
