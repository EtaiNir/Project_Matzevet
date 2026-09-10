import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Landing from './pages/Landing'
import About from './pages/About'
import Contact from './pages/Contact'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Pivot from './pages/Pivot'
import SavedViews from './pages/SavedViews'
import UpdateData from './pages/UpdateData'
import Admin from './pages/Admin'
import ClientDetail from './pages/ClientDetail'

export default function App() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-slate-500">
        טוען…
      </div>
    )
  }

  // ───────────── לפני כניסה: הדפים הציבוריים ─────────────
  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }

  // ───────────── אחרי כניסה ─────────────
  // מנהל־על מגיע ישירות לניהול הלקוחות, משתמש רגיל ישירות לנתוני התלמידים.
  // אין מסך ביניים: סבא ביקש שהכניסה תוביל למקום העבודה עצמו.
  // ההרשאות נאכפות ב-RLS ולא בניתוב.
  const isSuperAdmin = profile?.role === 'super_admin'
  const home = isSuperAdmin ? '/admin' : '/students'

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/login" element={<Navigate to={home} replace />} />
      {/* הדפים הציבוריים נשארים נגישים גם אחרי כניסה */}
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />

      <Route path="/students" element={<Dashboard />} />
      <Route path="/students/:code" element={<Dashboard />} />
      <Route path="/pivot" element={<Pivot />} />
      <Route path="/pivot/:code" element={<Pivot />} />
      {/* רשימת הטבלאות הייעודיות, ופתיחת אחת מהן בטבלה הראשית */}
      <Route path="/views/:code" element={<SavedViews />} />
      <Route path="/views/:code/:viewId" element={<Dashboard />} />
      {/* עדכון מצב"ת — מנהל רשות וגם מנהל־על; ההרשאה נאכפת ב-RLS */}
      <Route path="/upload/:code" element={<UpdateData />} />

      <Route
        path="/admin"
        element={isSuperAdmin ? <Admin /> : <Navigate to={home} replace />}
      />
      <Route
        path="/admin/client/:code"
        element={isSuperAdmin ? <ClientDetail /> : <Navigate to={home} replace />}
      />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}
