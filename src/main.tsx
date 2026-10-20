import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import SessionGuard from './components/SessionGuard'
import IdVisibilitySync from './components/IdVisibilitySync'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <SessionGuard />
        <IdVisibilitySync />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
