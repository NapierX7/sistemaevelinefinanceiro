import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ProtectedRoute from './components/auth/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ProductsPage from './pages/ProductsPage'
import InventoryPage from './pages/InventoryPage'
import PurchasesPage from './pages/PurchasesPage'
import SalesHistoryPage from './pages/SalesHistoryPage'
import SaleDetailPage from './pages/SaleDetailPage'
import NewSalePage from './pages/NewSalePage'
import FinancePage from './pages/FinancePage'
import SettingsPage from './pages/SettingsPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShellWrapper />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/produtos" element={<ProductsPage />} />
        <Route path="/estoque" element={<InventoryPage />} />
        <Route path="/compras" element={<PurchasesPage />} />
        <Route path="/vendas" element={<SalesHistoryPage />} />
        <Route path="/vendas/nova" element={<NewSalePage />} />
        <Route path="/vendas/:id" element={<SaleDetailPage />} />
        <Route path="/financeiro" element={<FinancePage />} />
        <Route path="/configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

// componente vazio: AppShell já recebe children via Route element
function AppShellWrapper() {
  return (
    <AppShell>
      <RoutesWrapper />
    </AppShell>
  )
}

import { Outlet } from 'react-router-dom'
function RoutesWrapper() {
  return <Outlet />
}
