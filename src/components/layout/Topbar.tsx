import { Menu, LogOut, UserRound, Bell } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/format'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { listSales, onInvalidate } from '@/services'

interface Props { onOpenSidebar: () => void }

export default function Topbar({ onOpenSidebar }: Props) {
  const { user, signOut, isDemo } = useAuth()
  const navigate = useNavigate()
  const [todayCount, setTodayCount] = useState<number>(0)

  useEffect(() => {
    const load = () => listSales()
      .then(list => {
        const today = new Date().toISOString().slice(0, 10)
        const n = list.filter(s => s.status === 'CONCLUIDA' && (s.sale_date ?? s.created_at).slice(0,10) === today).length
        setTodayCount(n)
      })
      .catch(() => {})
    load()
    const cleanup = onInvalidate((scope) => {
      if (scope === 'all' || scope === 'sales' || scope === 'dashboard') {
        load()
      }
    })
    return cleanup
  }, [])

  return (
    <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-ink-100 bg-white/90 backdrop-blur">
      <div className="h-full px-4 lg:px-6 flex items-center justify-between gap-3 safe-top">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onOpenSidebar}
            className="lg:hidden h-10 w-10 grid place-items-center rounded-xl hover:bg-ink-100 text-ink-700"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-400 hidden sm:block">
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-bold text-ink-900 truncate">Bem-vinda, Eveline</span>
              {todayCount > 0 && (
                <span className="chip bg-brand-50 text-brand-800 ring-1 ring-brand-200">
                  {String(todayCount)} venda{todayCount !== 1 ? 's' : ''} hoje
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className={cn(
            'hidden sm:grid place-items-center rounded-xl px-2.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wider ring-1',
            isDemo
              ? 'bg-amber-50 text-amber-700 ring-amber-200'
              : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          )}>
            {isDemo ? 'Modo Demo' : 'Online'}
          </div>

          <button
            aria-label="Notificações"
            className="hidden sm:grid h-10 w-10 place-items-center rounded-xl hover:bg-ink-100 text-ink-600"
          >
            <Bell className="h-[18px] w-[18px]" />
          </button>

          <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-white pl-1.5 pr-2.5 py-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-900 text-white">
              <UserRound className="h-3.5 w-3.5" />
            </div>
            <div className="hidden md:block leading-tight">
              <p className="text-xs font-bold text-ink-900 truncate max-w-[160px]">
                {user?.email?.split('@')[0] || 'Admin'}
              </p>
              <p className="text-[10px] text-ink-500">{user?.email || 'admin'}</p>
            </div>
          </div>

          <button
            onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}
            className="h-10 w-10 grid place-items-center rounded-xl hover:bg-rose-50 text-rose-600 ring-1 ring-transparent hover:ring-rose-100"
            aria-label="Sair"
            title="Sair do sistema"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </header>
  )
}
