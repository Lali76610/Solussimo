import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth, RequireCompany, RequireLiveAuth } from './auth/RequireAuth'
import { useAuth } from './auth/useAuth'
import { AppLayout } from './layouts/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { FullPageSpinner } from './components/FullPageSpinner'
import { TenantProvider } from './tenant/TenantContext'

// Chargement à la demande : premier affichage plus léger sur mobile.
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })))
const DemoClientsPage = lazy(() => import('./pages/ClientsPage').then((m) => ({ default: m.ClientsPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })))
const LiveDashboardPage = lazy(() => import('./pages/live/LiveDashboardPage').then((m) => ({ default: m.LiveDashboardPage })))
const LiveModulePage = lazy(() => import('./pages/live/LiveModulePage').then((m) => ({ default: m.LiveModulePage })))
const LiveStaffPage = lazy(() => import('./pages/live/LiveStaffPage').then((m) => ({ default: m.LiveStaffPage })))
const StaffDetailPage = lazy(() => import('./pages/live/StaffDetailPage').then((m) => ({ default: m.StaffDetailPage })))
const LivePlanningPage = lazy(() => import('./pages/live/planning/LivePlanningPage').then((m) => ({ default: m.LivePlanningPage })))
const ServicesPage = lazy(() => import('./pages/live/planning/ServicesPage').then((m) => ({ default: m.ServicesPage })))
const ClientsPage = lazy(() => import('./pages/live/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })))
const ClientDetailPage = lazy(() => import('./pages/live/clients/ClientDetailPage').then((m) => ({ default: m.ClientDetailPage })))
const ClientsSettingsPage = lazy(() => import('./pages/live/clients/ClientsSettingsPage').then((m) => ({ default: m.ClientsSettingsPage })))
const InvitationPage = lazy(() => import('./pages/InvitationPage').then((m) => ({ default: m.InvitationPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })))
const PlanningPage = lazy(() => import('./pages/PlanningPage').then((m) => ({ default: m.PlanningPage })))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })))
const SignUpPage = lazy(() => import('./pages/SignUpPage').then((m) => ({ default: m.SignUpPage })))
const StaffPage = lazy(() => import('./pages/StaffPage').then((m) => ({ default: m.StaffPage })))
const StockPage = lazy(() => import('./pages/StockPage').then((m) => ({ default: m.StockPage })))

/**
 * Affiche la version DÉMO (données fictives locales) ou RÉELLE (Supabase)
 * d'un écran. Les deux chemins de données ne se mélangent jamais.
 */
function ByMode({ demo, live }: { demo: ReactNode; live: ReactNode }) {
  const { isDemo } = useAuth()
  return <>{isDemo ? demo : live}</>
}

export default function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        <BrowserRouter>
          <Suspense fallback={<FullPageSpinner />}>
          <Routes>
            {/* Écrans publics */}
            <Route path="/connexion" element={<LoginPage />} />
            <Route path="/inscription" element={<SignUpPage />} />
            <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
            <Route path="/nouveau-mot-de-passe" element={<ResetPasswordPage />} />
            <Route path="/confidentialite" element={<PrivacyPage />} />
            <Route path="/invitation" element={<InvitationPage />} />

            {/* Création du salon (compte réel, sans entreprise) */}
            <Route path="/creer-salon" element={<RequireLiveAuth><OnboardingPage /></RequireLiveAuth>} />

            {/* Application */}
            <Route element={<RequireAuth><RequireCompany><AppLayout /></RequireCompany></RequireAuth>}>
              <Route index element={<ByMode demo={<DashboardPage />} live={<LiveDashboardPage />} />} />
              <Route path="planning" element={<ByMode demo={<PlanningPage />} live={<LivePlanningPage />} />} />
              <Route path="planning/prestations" element={<ByMode demo={<Navigate to="/planning" replace />} live={<ServicesPage />} />} />
              <Route path="clients" element={<ByMode demo={<DemoClientsPage />} live={<ClientsPage />} />} />
              <Route path="clients/reglages" element={<ByMode demo={<Navigate to="/clients" replace />} live={<ClientsSettingsPage />} />} />
              <Route path="clients/:id" element={<ByMode demo={<Navigate to="/clients" replace />} live={<ClientDetailPage />} />} />
              <Route path="personnel" element={<ByMode demo={<StaffPage />} live={<LiveStaffPage />} />} />
              <Route path="personnel/:id" element={<ByMode demo={<Navigate to="/personnel" replace />} live={<StaffDetailPage />} />} />
              <Route path="caisse" element={<ByMode demo={<CheckoutPage />} live={<LiveModulePage titleKey="nav.checkout" />} />} />
              <Route path="stock" element={<ByMode demo={<StockPage />} live={<LiveModulePage titleKey="nav.stock" />} />} />
              <Route path="compte" element={<AccountPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </TenantProvider>
    </AuthProvider>
  )
}
