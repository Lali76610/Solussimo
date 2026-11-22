import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './layouts/AppLayout'
import { CheckoutPage } from './pages/CheckoutPage'
import { ClientsPage } from './pages/ClientsPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { PlanningPage } from './pages/PlanningPage'
import { StaffPage } from './pages/StaffPage'
import { StockPage } from './pages/StockPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="personnel" element={<StaffPage />} />
            <Route path="caisse" element={<CheckoutPage />} />
            <Route path="stock" element={<StockPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
