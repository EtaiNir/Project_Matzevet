import { useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { ID_FIELDS, setHiddenFields } from '@/config/fields'
import { canSeeIds, loadIdVisibility, resetIdVisibility, useIdSettings } from '@/lib/idVisibility'

/**
 * טוען את הגדרות חשיפת ת"ז (040) אחרי הכניסה, ומחיל אותן על רישום שדות
 * המצבת. בבגרות המסכים שואלים בעצמם (canSeeIds). ביציאה — חוזרים לברירת
 * המחדל, כדי שמשתמש הבא לא יירש את ההגדרה. lib/idVisibility.ts.
 */
export default function IdVisibilitySync() {
  const { session, profile } = useAuth()
  const settings = useIdSettings()

  useEffect(() => {
    if (!session) {
      resetIdVisibility()
      return
    }
    void loadIdVisibility()
  }, [session])

  useEffect(() => {
    setHiddenFields(profile && !canSeeIds(profile, 'matzevet', settings) ? ID_FIELDS : [])
  }, [profile, settings])

  return null
}
