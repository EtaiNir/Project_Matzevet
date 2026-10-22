import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Landing from './pages/Landing'
import About from './pages/About'
import Contact from './pages/Contact'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Pivot from './pages/Pivot'
import Charts from './pages/Charts'
import SavedViews from './pages/SavedViews'
import UpdateData from './pages/UpdateData'
import UpdateGanim from './pages/UpdateGanim'
import Admin from './pages/Admin'
import ClientDetail from './pages/ClientDetail'
import BagrutShell from './pages/bagrut/BagrutShell'
import BagrutHome from './pages/bagrut/BagrutHome'
import BagrutStudents from './pages/bagrut/BagrutStudents'
import BagrutSubject from './pages/bagrut/BagrutSubject'
import BagrutStudent from './pages/bagrut/BagrutStudent'
import BagrutProgram from './pages/bagrut/BagrutProgram'
import BagrutUpload from './pages/bagrut/BagrutUpload'
import BagrutHonors from './pages/bagrut/BagrutHonors'
import BudgetShell from './pages/budget/BudgetShell'
import BudgetHome from './pages/budget/BudgetHome'
import BudgetCards from './pages/budget/BudgetCards'
import BudgetCard from './pages/budget/BudgetCard'
import BudgetActions from './pages/budget/BudgetActions'
import MeitarShell from './pages/budget/meitar/MeitarShell'
import MeitarOverview from './pages/budget/meitar/MeitarOverview'
import MeitarTopics from './pages/budget/meitar/MeitarTopics'
import MeitarTopic from './pages/budget/meitar/MeitarTopic'
import MeitarInstitutions from './pages/budget/meitar/MeitarInstitutions'
import MeitarInvoice from './pages/budget/meitar/MeitarInvoice'
import MeitarDownloads from './pages/budget/meitar/MeitarDownloads'
import BudgetOrders from './pages/budget/BudgetOrders'
import BudgetUpload from './pages/budget/BudgetUpload'
import Home from './pages/Home'
import RequireProduct from './components/RequireProduct'

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
  // כל משתמש פוגש קודם את האזור האישי — "שלום, <שם>" — וממנו עובר למוצרים
  // שלו (אייל, 11.10). כל מוצר עטוף ב-RequireProduct: מי שמגיע בלי גישה
  // מקבל הסבר במקום מסך ריק. ההרשאות עצמן נאכפות ב-RLS ולא בניתוב.
  const isSuperAdmin = profile?.role === 'super_admin'
  const home = '/home'
  const matzevet = (el: JSX.Element) => <RequireProduct product="matzevet">{el}</RequireProduct>
  const bagrut = (el: JSX.Element) => <RequireProduct product="bagrut">{el}</RequireProduct>
  const budget = (el: JSX.Element) => <RequireProduct product="budget">{el}</RequireProduct>

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/login" element={<Navigate to={home} replace />} />
      {/* הדפים הציבוריים נשארים נגישים גם אחרי כניסה */}
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />

      <Route path="/home" element={<Home />} />

      <Route path="/students" element={matzevet(<Dashboard />)} />
      <Route path="/students/:code" element={matzevet(<Dashboard />)} />
      <Route path="/pivot" element={matzevet(<Pivot />)} />
      <Route path="/pivot/:code" element={matzevet(<Pivot />)} />
      <Route path="/charts" element={matzevet(<Charts />)} />
      <Route path="/charts/:code" element={matzevet(<Charts />)} />
      {/* רשימת הטבלאות הייעודיות, ופתיחת אחת מהן בטבלה הראשית */}
      <Route path="/views/:code" element={matzevet(<SavedViews />)} />
      <Route path="/views/:code/:viewId" element={matzevet(<Dashboard />)} />
      {/* עדכון מצב"ת — מנהל רשות וגם מנהל־על; ההרשאה נאכפת ב-RLS */}
      <Route path="/upload/:code" element={matzevet(<UpdateData />)} />
      {/* קליטת דרג ב' (גנים) — אותה הרשאה, טבלה אחרת לגמרי */}
      <Route path="/upload-ganim/:code" element={matzevet(<UpdateGanim />)} />

      {/* מודול זכאות לבגרות — המעטפת טוענת את הסבב פעם אחת לכל המסכים */}
      <Route path="/bagrut" element={bagrut(<BagrutShell />)} />
      {/* כל בית ספר בנפרד (החלטה 016): /bagrut/:code — בחירת בית ספר, או כניסה
          ישירה כשיש רק אחד; /bagrut/:code/:school — המסכים של בית הספר */}
      <Route path="/bagrut/:code" element={bagrut(<BagrutShell />)}>
        <Route path=":school">
          <Route index element={<BagrutHome />} />
          <Route path="students" element={<BagrutStudents />} />
          <Route path="subject/:key" element={<BagrutSubject />} />
          <Route path="student/:id" element={<BagrutStudent />} />
          <Route path="program" element={<BagrutProgram />} />
          <Route path="honors" element={<BagrutHonors />} />
          <Route path="upload" element={<BagrutUpload />} />
        </Route>
      </Route>

      {/* ניהול תקציב (החלטה 023) — ברמת הרשות; המעטפת טוענת את הכרטסת פעם אחת */}
      <Route path="/budget" element={budget(<BudgetShell />)} />
      <Route path="/budget/:code" element={budget(<BudgetShell />)}>
        <Route index element={<BudgetHome />} />
        <Route path="cards" element={<BudgetCards />} />
        <Route path="card/:card" element={<BudgetCard />} />
        <Route path="actions" element={<BudgetActions />} />
        <Route path="meitar" element={<MeitarShell />}>
          <Route index element={<MeitarOverview />} />
          <Route path="topics" element={<MeitarTopics />} />
          <Route path="topic/:topic" element={<MeitarTopic />} />
          <Route path="institutions" element={<MeitarInstitutions />} />
          <Route path="invoice" element={<MeitarInvoice />} />
          <Route path="downloads" element={<MeitarDownloads />} />
        </Route>
        <Route path="orders" element={<BudgetOrders />} />
        <Route path="upload" element={<BudgetUpload />} />
      </Route>

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
