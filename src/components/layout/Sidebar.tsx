import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, Tags, Boxes, Truck, Wallet, Settings, X, PackageOpen, ReceiptText,
} from 'lucide-react'
import { cn } from '@/lib/format'

interface Props { open: boolean; onClose: () => void }

interface NavItem {
  to: string
  label: string
  icon: any
  primary?: boolean
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/vendas/nova', label: 'Nova Venda', icon: ShoppingCart, primary: true },
  { to: '/vendas', label: 'Histórico Vendas', icon: ReceiptText },
  { to: '/produtos', label: 'Produtos', icon: Tags },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
  { to: '/compras', label: 'Compras / Entradas', icon: Truck },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
]

export default function Sidebar({ open, onClose }: Props) {
  return (
    <>
      {/* Overlay mobile */}
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-ink-900/40 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-white border-r border-ink-100 shadow-panel transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between h-16 px-5 border-b border-ink-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-900 text-white shadow-sm">
              <PackageOpen className="h-4.5 w-4.5" />
            </div>
            <div className="leading-tight">
              <p className="text-[15px] font-extrabold tracking-tight text-ink-900">Eveline</p>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">Gestão</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="lg:hidden h-9 w-9 grid place-items-center rounded-xl hover:bg-ink-100 text-ink-600"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 grid gap-1 content-start safe-bottom">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                end={item.to === '/dashboard'}
                className={({ isActive }) => cn(
                  'group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition',
                  item.primary
                    ? (isActive
                        ? 'bg-brand-900 text-white shadow-card'
                        : 'bg-brand-50 text-brand-900 hover:bg-brand-100 ring-1 ring-brand-100')
                    : (isActive
                        ? 'bg-ink-100 text-ink-900'
                        : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900')
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-ink-100 p-4">
          <p className="text-[10.5px] leading-5 text-ink-400">
            Sistema oficial de controle operacional e financeiro da loja Eveline.
          </p>
        </div>
      </aside>
    </>
  )
}
