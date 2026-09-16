import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, ShoppingCart, Tags, Truck, Wallet, Plus } from 'lucide-react'
import { cn } from '@/lib/format'

const items = [
  { to: '/dashboard', label: 'Início', icon: LayoutDashboard },
  { to: '/vendas', label: 'Vendas', icon: ShoppingCart },
  { to: '/produtos', label: 'Produtos', icon: Tags },
  { to: '/compras', label: 'Compras', icon: Truck },
  { to: '/financeiro', label: 'Caixa', icon: Wallet },
] as const

export default function BottomNav() {
  const location = useLocation()
  const onNewSale = location.pathname.startsWith('/vendas/nova')

  return (
    <nav className={cn(
      'lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-ink-100 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]',
      onNewSale && 'hidden'
    )}>
      <div className="grid grid-cols-6 h-[72px]">
        {[...items.slice(0, 2), null, ...items.slice(2)].map((it, idx) => (
          it === null ? (
            <div key="fab" className="grid place-items-center -mt-4">
              <NavLink
                to="/vendas/nova"
                className={({ isActive }) => cn(
                  'grid h-14 w-14 place-items-center rounded-2xl text-white shadow-panel transition active:scale-95',
                  isActive ? 'bg-brand-700' : 'bg-brand-900 hover:bg-brand-800'
                )}
                aria-label="Nova venda"
              >
                <Plus className="h-6 w-6" strokeWidth={2.4} />
              </NavLink>
            </div>
          ) : (() => {
            const Icon = it!.icon
            return (
              <NavLink
                key={it!.to}
                to={it!.to}
                end={it!.to === '/dashboard'}
                className={({ isActive }) => cn(
                  'flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition',
                  isActive ? 'text-brand-900' : 'text-ink-500 hover:text-ink-700'
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                <span>{it!.label}</span>
              </NavLink>
            )
          })()
        ))}
      </div>
    </nav>
  )
}
