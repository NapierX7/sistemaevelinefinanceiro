import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Search, ChevronDown, Calendar, Filter, X, AlertTriangle, Check, ShoppingBag, Trash2, UserCircle, Edit3, Phone, Clock
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, formatDateTime, formatFriendlyNumber, parseBrl, sourceLabel, statusLabel, paymentMethodLabel, pluralize, rangePresets, inRange, cn
} from '@/lib/format'
import type { Sale, SaleItem, SalePayment, UUID, SaleSource, PaymentMethod, SaleStatus } from '@/types/supabase'
import { listSales, cancelSale, listPaymentProviders, listAllProducts, onInvalidate, dispatchInvalidateAll, listSaleItemsBySaleIds, listSalePaymentsBySaleIds } from '@/services'
import type { ProviderWithModalities } from '@/services'

function formatTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

type PresetKey = string

type FilterInstallments = 'TODOS' | '1' | '2' | '3+'

export default function SalesHistoryPage() {
  const navigate = useNavigate()
  const presets = rangePresets()

  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [providers, setProviders] = useState<ProviderWithModalities[]>([])
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [salePayments, setSalePayments] = useState<SalePayment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingJoins, setLoadingJoins] = useState(false)

  const [preset, setPreset] = useState<PresetKey>('ESTE_MES')
  const [from, setFrom] = useState<string>(presets.ESTE_MES.from.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(presets.ESTE_MES.to.toISOString().slice(0, 10))

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [fCustomer, setFCustomer] = useState<string>('')
  const [fProduct, setFProduct] = useState<string>('')
  const [fSource, setFSource] = useState<SaleSource | 'TODOS'>('TODOS')
  const [fProvider, setFProvider] = useState<string>('')
  const [fModality, setFModality] = useState<string>('')
  const [fMethod, setFMethod] = useState<PaymentMethod | 'TODOS'>('TODOS')
  const [fInstallments, setFInstallments] = useState<FilterInstallments>('TODOS')
  const [fStatus, setFStatus] = useState<SaleStatus | 'TODOS'>('TODOS')

  const [cancelModal, setCancelModal] = useState<{ open: boolean; sale: Sale | null }>({ open: false, sale: null })
  const [cancelReason, setCancelReason] = useState('')
  const [canceling, setCanceling] = useState(false)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [s, p, pv] = await Promise.all([listSales(), listAllProducts(), listPaymentProviders()])
      setSales(s); setProducts(p); setProviders(pv)
      const ids = s.map(x => x.id) as UUID[]
      if (ids.length) {
        setLoadingJoins(true)
        try {
          const [items, payments] = await Promise.allSettled([
            listSaleItemsBySaleIds(ids),
            listSalePaymentsBySaleIds(ids),
          ])
          if (items.status === 'fulfilled') setSaleItems(items.value)
          else { console.error('[SalesHist] itens falhou:', items.reason) }
          if (payments.status === 'fulfilled') setSalePayments(payments.value)
          else { console.error('[SalesHist] pagamentos falhou:', payments.reason) }
        } finally { setLoadingJoins(false) }
      } else {
        setSaleItems([]); setSalePayments([])
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    const cleanup = onInvalidate((scope) => {
      if (scope === 'all' || scope === 'sales' || scope === 'dashboard') {
        loadAll()
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (preset !== 'PERSONALIZADO') {
      const p = (presets as any)[preset]
      if (p) {
        setFrom(p.from.toISOString().slice(0, 10))
        setTo(p.to.toISOString().slice(0, 10))
      }
    }
  }, [preset])

  const { fromDate, toDate } = useMemo(() => ({
    fromDate: new Date(from + 'T00:00:00'),
    toDate: new Date(to + 'T23:59:59'),
  }), [from, to])

  const selectedProvider = providers.find(p => p.provider.id === fProvider)
  const modalities = selectedProvider?.modalities ?? []

  const activeFiltersCount = useMemo(() => {
    let c = 0
    if (fCustomer.trim()) c++
    if (fProduct) c++
    if (fSource !== 'TODOS') c++
    if (fProvider) c++
    if (fModality) c++
    if (fMethod !== 'TODOS') c++
    if (fInstallments !== 'TODOS') c++
    if (fStatus !== 'TODOS') c++
    if (preset === 'PERSONALIZADO') c++
    return c
  }, [fCustomer, fProduct, fSource, fProvider, fModality, fMethod, fInstallments, fStatus, preset])

  const joins = useMemo(() => {
    const itemsMap = new Map<string, SaleItem[]>()
    for (const it of saleItems) {
      if (!itemsMap.has(it.sale_id)) itemsMap.set(it.sale_id, [])
      itemsMap.get(it.sale_id)!.push(it)
    }
    const pagsMap = new Map<string, SalePayment[]>()
    for (const p of salePayments) {
      if (!pagsMap.has(p.sale_id)) pagsMap.set(p.sale_id, [])
      pagsMap.get(p.sale_id)!.push(p)
    }
    return { itemsMap, pagsMap }
  }, [saleItems, salePayments])

  function pecasBySale(id: UUID): number {
    const list = joins.itemsMap.get(String(id)) ?? []
    if (!list.length) {
      const fallback = Number((sales.find(x => String(x.id) === String(id)) as any)?.total_items ?? 0)
      return isFinite(fallback) ? fallback : 0
    }
    const sum = list.reduce((s, v) => s + Number(v.quantity ?? 0), 0)
    return isFinite(sum) ? sum : 0
  }

  function pagamentoLabel(sale: Sale): string {
    const list = joins.pagsMap.get(String(sale.id)) ?? []
    if (list.length > 0) {
      const labels: string[] = []
      for (const sp of list) {
        const parts: string[] = []
        const prov = sp.provider_snapshot ?? (sp as any).provider ?? null
        const met = sp.method ?? (sp as any).payment_method_snapshot ?? null
        const mod = (sp as any).modality_snapshot ?? (sp as any).modality ?? null
        if (prov) parts.push(String(prov))
        if (met) parts.push(paymentMethodLabel(String(met)))
        if (mod && String(mod) !== String(met)) parts.push(String(mod))
        const parc = Number((sp as any).installments ?? 1)
        if (parc > 1) parts.push(`${parc}x`)
        labels.push(parts.filter(Boolean).join(' · ') || 'Recebido')
      }
      return labels.filter(Boolean).join(', ')
    }
    const received = Number((sale as any).amount_received ?? (sale as any).valor_recebido ?? 0)
    if (received > 0 || (sale.status === 'CONCLUIDA' && Number(sale.total_customer ?? 0) > 0)) {
      return 'Sem registro de pagamento'
    }
    if (sale.status === 'CANCELADA') return 'Cancelada'
    return 'Pendente'
  }

  const filtered = useMemo(() => {
    return sales.filter(s => {
      if (!inRange(s.sale_date ?? s.created_at, fromDate, toDate)) return false
      if (fSource !== 'TODOS' && s.source !== fSource) return false
      if (fStatus !== 'TODOS' && s.status !== fStatus) return false
      if (fCustomer.trim()) {
        const cname = (s.customer_name ?? '').toLowerCase()
        const q = fCustomer.trim().toLowerCase()
        if (!cname.includes(q)) return false
      }
      if (fProduct) {
        const its = joins.itemsMap.get(String(s.id)) ?? []
        if (its.length > 0) {
          if (!its.some(i => String(i.product_id ?? '') === String(fProduct))) return false
        }
      }
      const snapMethod = (s as any).payment_method_snapshot
      const listPg = joins.pagsMap.get(String(s.id)) ?? []
      const metodos: string[] = listPg.length
        ? listPg.map(p => String(p.method ?? (p as any).payment_method_snapshot ?? ''))
        : [String(snapMethod ?? '')].filter(Boolean)
      if (fMethod !== 'TODOS') {
        if (!metodos.some(m => m === String(fMethod))) return false
      }
      const snapProvider = (s as any).payment_provider_snapshot
      const nomesProviders: string[] = listPg.length
        ? listPg.map(p => String(p.provider_snapshot ?? (p as any).provider ?? ''))
        : [String(snapProvider ?? '')].filter(Boolean)
      if (fProvider) {
        const p = providers.find(pp => pp.provider.id === fProvider)
        if (p && !nomesProviders.some(nome => nome === p.provider.name)) return false
      }
      const snapModality = (s as any).payment_modality_snapshot
      const nomesMods: string[] = listPg.length
        ? listPg.map(p => String((p as any).modality_snapshot ?? (p as any).modality ?? ''))
        : [String(snapModality ?? '')].filter(Boolean)
      if (fModality) {
        const m = modalities.find(mm => mm.id === fModality)
        if (m && !nomesMods.some(nome => nome === m.name)) return false
      }
      const insts: number[] = listPg.length
        ? listPg.map(p => Number((p as any).installments ?? 1))
        : [Number((s as any).installments_snapshot ?? 1)]
      const hasAny = insts.length ? Math.max(...insts.map(n => isFinite(n) ? n : 1)) : 1
      if (fInstallments === '1' && hasAny !== 1) return false
      if (fInstallments === '2' && hasAny !== 2) return false
      if (fInstallments === '3+' && hasAny < 3) return false
      return true
    })
  }, [sales, fromDate, toDate, fCustomer, fProduct, fSource, fStatus, fMethod, fProvider, fModality, fInstallments, providers, modalities, joins])

  const totalCliente = filtered.reduce((s, v) => s + (v.status !== 'CANCELADA' ? Number(v.total_customer ?? 0) : 0), 0)
  const totalLucro = filtered.reduce((s, v) => s + (v.status !== 'CANCELADA' ? Number(v.real_profit ?? 0) : 0), 0)
  const totalPecas = filtered.reduce((s, v) => s + pecasBySale(v.id), 0)

  const openCancel = (sale: Sale) => {
    if (sale.status === 'CANCELADA') { alert('Esta venda já está cancelada.'); return }
    setCancelModal({ open: true, sale })
    setCancelReason('')
  }

  const doCancel = async () => {
    if (!cancelModal.sale) return
    if (!cancelReason.trim()) { alert('Informe o motivo do cancelamento.'); return }
    if (cancelModal.sale.status === 'CANCELADA') { alert('Venda já cancelada.'); return }
    try {
      setCanceling(true)
      await cancelSale(cancelModal.sale.id, cancelReason.trim())
      alert('Venda cancelada com sucesso!')
      dispatchInvalidateAll()
      setSales(prev => prev.map(s => s.id === cancelModal.sale!.id
        ? { ...s, status: 'CANCELADA' as SaleStatus, cancel_reason: cancelReason.trim(), cancelled_at: new Date().toISOString() }
        : s))
      setCancelModal({ open: false, sale: null })
    } catch (e: any) {
      console.error(e)
      alert('Erro ao cancelar: ' + (e?.message ?? String(e)))
    } finally {
      setCanceling(false)
    }
  }

  const clearFilters = () => {
    setPreset('ESTE_MES')
    setFCustomer(''); setFProduct(''); setFSource('TODOS'); setFProvider(''); setFModality('')
    setFMethod('TODOS'); setFInstallments('TODOS'); setFStatus('TODOS')
  }

  return (
    <div className="pb-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900 flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-brand-800" />
            Histórico de vendas
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">
            {loading ? 'Carregando…' : pluralize(filtered.length, 'venda encontrada')} ·
            Período de {formatDate(from)} à {formatDate(to)}
          </p>
        </div>
        <Link to="/vendas/nova" className="btn-primary">
          <Plus className="w-4 h-4" /> Nova venda
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kpi-card">
          <span className="kpi-label">Vendas no período</span>
          <div className="kpi-value num">{filtered.length}</div>
          <div className="kpi-sub">{pluralize(totalPecas, 'peça')}</div>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Faturamento (cliente)</span>
          <div className="kpi-value num">{formatCurrency(totalCliente)}</div>
          <div className="kpi-sub">líquido de descontos</div>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Lucro real</span>
          <div className={cn('kpi-value num', totalLucro >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{formatCurrency(totalLucro)}</div>
          <div className="kpi-sub">{formatPercent(totalCliente ? (totalLucro / totalCliente) * 100 : 0, 1)} margem</div>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Ticket médio</span>
          <div className="kpi-value num">{formatCurrency(filtered.length ? totalCliente / filtered.length : 0)}</div>
          <div className="kpi-sub">por venda concluída</div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 w-full lg:w-auto">
            <div className="relative w-full lg:w-[240px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                value={fCustomer}
                onChange={e => setFCustomer(e.target.value)}
                placeholder="Buscar por nome do cliente…"
                className="input pl-9 !py-2 !text-sm"
              />
            </div>
            <div className="relative">
              <select
                value={preset}
                onChange={e => setPreset(e.target.value as PresetKey)}
                className="select pr-10 min-w-[160px]"
              >
                {Object.entries(presets).map(([k, v]: [string, any]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
                <option value="PERSONALIZADO">Personalizado</option>
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            </div>
            <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-ink-200 min-w-0">
                <Calendar className="w-4 h-4 text-ink-500 flex-shrink-0" />
                <input
                  type="date"
                  value={from}
                  onChange={e => { setFrom(e.target.value); setPreset('PERSONALIZADO') }}
                  className="bg-transparent text-sm outline-none w-[110px]"
                />
              </div>
              <span className="text-ink-400 text-sm">à</span>
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-ink-200 min-w-0">
                <Calendar className="w-4 h-4 text-ink-500 flex-shrink-0" />
                <input
                  type="date"
                  value={to}
                  onChange={e => { setTo(e.target.value); setPreset('PERSONALIZADO') }}
                  className="bg-transparent text-sm outline-none w-[110px]"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            {activeFiltersCount > 0 && (
              <button onClick={clearFilters} className="btn-ghost text-xs !py-2">
                <X className="w-3.5 h-3.5" /> Limpar filtros ({activeFiltersCount})
              </button>
            )}
            <button onClick={() => setFiltersOpen(o => !o)} className={cn('btn-secondary', filtersOpen && '!bg-brand-50 !border-brand-300 !text-brand-800')}>
              <Filter className="w-4 h-4" /> Filtros avançados
              {activeFiltersCount > 0 && <span className="chip !py-0.5 !px-2 bg-brand-900 text-white">{activeFiltersCount}</span>}
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div className="pt-3 border-t border-ink-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <label className="label">Produto (opcional)</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <select
                  value={fProduct}
                  onChange={e => setFProduct(e.target.value)}
                  className="select pl-9 w-full"
                >
                  <option value="">Todos os produtos</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Origem</label>
              <div className="relative">
                <select value={fSource} onChange={e => setFSource(e.target.value as any)} className="select w-full">
                  <option value="TODOS">Todas as origens</option>
                  <option value="SITE">Site</option>
                  <option value="PRESENCIAL">Presencial</option>
                  <option value="DISTANCIA">WhatsApp / Distância</option>
                  <option value="OUTRO">Outro</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Provider de pagamento</label>
              <div className="relative">
                <select
                  value={fProvider}
                  onChange={e => { setFProvider(e.target.value); setFModality('') }}
                  className="select w-full"
                >
                  <option value="">Todos providers</option>
                  {providers.map(p => <option key={p.provider.id} value={p.provider.id}>{p.provider.name}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Modalidade</label>
              <div className="relative">
                <select value={fModality} onChange={e => setFModality(e.target.value)} disabled={!fProvider} className="select w-full">
                  <option value="">Todas modalidades</option>
                  {modalities.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Método</label>
              <div className="relative">
                <select value={fMethod} onChange={e => setFMethod(e.target.value as any)} className="select w-full">
                  <option value="TODOS">Todos métodos</option>
                  <option value="PIX">Pix</option>
                  <option value="CREDITO">Crédito</option>
                  <option value="DEBITO">Débito</option>
                  <option value="BOLETO">Boleto</option>
                  <option value="DINHEIRO">Dinheiro</option>
                  <option value="OUTRO">Outro</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Parcelamento</label>
              <div className="relative">
                <select value={fInstallments} onChange={e => setFInstallments(e.target.value as any)} className="select w-full">
                  <option value="TODOS">Todos</option>
                  <option value="1">1x (à vista)</option>
                  <option value="2">2x</option>
                  <option value="3+">3x ou mais</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Status</label>
              <div className="flex flex-wrap gap-2">
                {(['TODOS', 'CONCLUIDA', 'PENDENTE', 'PARCIAL', 'CANCELADA'] as const).map(st => {
                  const active = fStatus === st
                  const meta = st === 'TODOS' ? { label: 'Todos', cls: '' } : statusLabel(st)
                  return (
                    <button
                      key={st}
                      onClick={() => setFStatus(st as any)}
                      className={cn(
                        'px-3.5 py-2 rounded-lg border text-sm font-bold transition min-h-[40px]',
                        active
                          ? st === 'TODOS' ? 'border-brand-900 bg-brand-900 text-white' : (meta as any).class.replace('bg-', 'border-').replace('text-', '!bg- !text-') + ' border-inherit'
                          : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50'
                      )}
                    >
                      {meta.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <div className="text-ink-500 text-sm">Carregando vendas…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-center px-4">
            <ShoppingBag className="w-14 h-14 text-ink-200 mb-3" />
            <div className="text-base font-bold text-ink-800">Sem vendas no período</div>
            <div className="text-sm text-ink-500 mt-1 max-w-sm">
              Tente ajustar os filtros, ampliar o período ou comece uma nova venda agora mesmo.
            </div>
            <Link to="/vendas/nova" className="btn-primary mt-5">
              <Plus className="w-4 h-4" /> Começar nova venda
            </Link>
          </div>
        ) : (
          <>
            {/*
              Desktop: tabela compacta (Largura útil >= 1366px não deve ter scroll horiz).
              Estratégia:
              - # + Data em uma coluna só;
              - valores monetários com whitespace-nowrap + alinhado à direita;
              - Cliente com max-w ellipsis + tooltip (title);
              - padding células 10px-14px (horizontal);
              - NENHUM min-width: max-content;
              - actions com botões compactos (sem "Ver detalhe" enorme).
            */}
            <div className="hidden sm:block min-w-0">
              <div className="table-wrap overflow-x-auto w-full">
                <table className="table-base w-full border-collapse min-w-0" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '120px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: 'auto', minWidth: '180px' }} />
                    <col style={{ width: '140px' }} />
                    <col style={{ width: '72px' }} />
                    <col style={{ width: '108px' }} />
                    <col style={{ width: '108px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '150px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="!px-3 !py-2.5">Venda / Data</th>
                      <th className="!px-3 !py-2.5">Origem</th>
                      <th className="!px-3 !py-2.5">Cliente</th>
                      <th className="!px-3 !py-2.5">Pagamento</th>
                      <th className="text-center !px-3 !py-2.5">Peças</th>
                      <th className="text-right !px-3 !py-2.5">Total</th>
                      <th className="text-right !px-3 !py-2.5">Lucro</th>
                      <th className="!px-3 !py-2.5">Status</th>
                      <th className="text-right !px-3 !py-2.5">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(s => {
                      const st = statusLabel(s.status)
                      return (
                        <tr
                          key={s.id}
                          className="hover:bg-ink-50/50 transition cursor-pointer"
                          onClick={(e) => {
                            // Clique na linha (exceto botões) abre o detalhe
                            const tgt = (e.target as HTMLElement | null)
                            if (tgt && (tgt.closest('button') || tgt.closest('a'))) return
                            navigate(`/vendas/${s.id}`)
                          }}
                        >
                          <td className="!px-3 !py-2.5 align-top align-middle">
                            <div className="flex flex-col items-start gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`/vendas/${s.id}`) }}
                                className="text-brand-800 hover:underline font-black num text-sm whitespace-nowrap"
                              >
                                #{String(s.friendly_number ?? '')}
                              </button>
                              <div className="num text-[11px] text-ink-500 whitespace-nowrap leading-tight">
                                {formatDate(s.sale_date ?? s.created_at)}
                              </div>
                              <div className="num text-[11px] text-ink-400 whitespace-nowrap leading-tight">
                                {formatTime(s.sale_date ?? s.created_at)}
                              </div>
                            </div>
                          </td>
                          <td className="!px-3 !py-2.5 align-top align-middle">
                            <span className="chip bg-ink-100 text-ink-700 !text-[11px] !py-0 leading-tight">
                              {sourceLabel(s.source)}
                            </span>
                          </td>
                          <td className="!px-3 !py-2.5 align-top align-middle min-w-0">
                            {s.customer_name ? (
                              <div className="flex items-start gap-2 min-w-0">
                                <UserCircle className="w-4 h-4 text-ink-400 mt-0.5 flex-shrink-0" />
                                <div className="min-w-0">
                                  <div
                                    className="font-semibold text-ink-900 truncate text-sm leading-tight"
                                    title={s.customer_name}
                                  >
                                    {s.customer_name}
                                  </div>
                                  {s.customer_phone && (
                                    <div
                                      className="text-xs text-ink-500 num truncate"
                                      title={s.customer_phone}
                                    >
                                      {s.customer_phone}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-ink-400 text-sm italic">Não identificado</span>
                            )}
                          </td>
                          <td className="!px-3 !py-2.5 align-top align-middle">
                            <span className="text-ink-700 text-xs whitespace-nowrap leading-tight">
                              {pagamentoLabel(s) || '-'}
                            </span>
                          </td>
                          <td className="text-center num font-semibold !px-3 !py-2.5 align-top align-middle">
                            {String(pecasBySale(s.id))}
                          </td>
                          <td className="text-right num font-bold text-ink-900 whitespace-nowrap !px-3 !py-2.5 align-top align-middle">
                            {formatCurrency(s.total_customer)}
                          </td>
                          <td className={cn(
                            'text-right num font-bold whitespace-nowrap !px-3 !py-2.5 align-top align-middle',
                            s.status === 'CANCELADA' ? 'text-ink-400 line-through' :
                            Number(s.real_profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}
                          >
                            {s.status === 'CANCELADA' ? formatCurrency(0) : formatCurrency(s.real_profit)}
                          </td>
                          <td className="!px-3 !py-2.5 align-top align-middle">
                            <span className={st.class + ' !text-[11px] !py-0.5 whitespace-nowrap'}>
                              {st.label}
                            </span>
                          </td>
                          <td className="text-right !px-3 !py-2.5 align-top align-middle">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`/vendas/${s.id}#editar`) }}
                                className="btn-secondary !py-1 !px-2 text-[11px] whitespace-nowrap min-h-[32px] font-bold"
                                title="Editar venda"
                              >
                                Editar
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`/vendas/${s.id}`) }}
                                className="btn-secondary !py-1 !px-2 text-[11px] whitespace-nowrap min-h-[32px] font-bold"
                                title="Ver detalhe"
                              >
                                Detalhes
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openCancel(s) }}
                                disabled={s.status === 'CANCELADA'}
                                className={cn(
                                  '!py-1 !px-2 text-[11px] whitespace-nowrap min-h-[32px] rounded-lg border transition inline-flex items-center gap-1 font-bold',
                                  s.status === 'CANCELADA'
                                    ? 'border-ink-100 bg-ink-50 text-ink-400 cursor-not-allowed'
                                    : 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                                )}
                                title="Cancelar venda"
                              >
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="block sm:hidden">
              <ul className="divide-y divide-ink-100">
                {filtered.map(s => {
                  const st = statusLabel(s.status)
                  const snapProvider = (s as any).payment_provider_snapshot
                  const snapMethod = (s as any).payment_method_snapshot
                  const snapInstallments = Number((s as any).installments_snapshot ?? 1)
                  return (
                    <li key={s.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => navigate(`/vendas/${s.id}`)}
                              className="text-brand-800 hover:underline font-black num text-base"
                            >
                              #{String(s.friendly_number ?? '')}
                            </button>
                            <span className={st.class + ' !py-0.5'}>{st.label}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-ink-500">
                            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="num">{formatDateTime(s.sale_date ?? s.created_at)}</span>
                            <span className="text-ink-300">·</span>
                            <span className="chip bg-ink-100 text-ink-600 !py-0 !text-[10px]">{sourceLabel(s.source)}</span>
                          </div>
                        </div>
                        <div className="text-right min-w-[110px]">
                          <div className={cn('font-black text-lg num',
                            s.status === 'CANCELADA' ? 'text-ink-400 line-through' : 'text-ink-900')}>
                            {formatCurrency(s.total_customer)}
                          </div>
                          {s.status !== 'CANCELADA' && (
                            <div className={cn('text-xs font-semibold num mt-0.5',
                              Number(s.real_profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                              Lucro {formatCurrency(s.real_profit ?? 0)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3 space-y-1.5">
                        {s.customer_name ? (
                          <div className="flex items-start gap-2">
                            <UserCircle className="w-4 h-4 text-brand-700 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-ink-900 break-words">{s.customer_name}</div>
                              {s.customer_phone && (
                                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-ink-600">
                                  <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span className="num">{s.customer_phone}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-ink-500 italic">Cliente não identificado</div>
                        )}
                        <div className="flex items-center justify-between gap-2 pt-1 text-xs text-ink-600 border-t border-ink-200/70 mt-1.5">
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span className="chip bg-white text-ink-600 !py-0 border border-ink-200">
                              {pagamentoLabel(s) || 'Sem pagamento'}
                            </span>
                          </span>
                          <span className="font-bold num text-ink-700 flex-shrink-0">
                            {pluralize(pecasBySale(s.id), 'peça')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <button
                          onClick={() => navigate(`/vendas/${s.id}#editar`)}
                          className="btn-secondary !py-2.5 text-sm min-h-[44px]"
                        >
                          <Edit3 className="w-4 h-4" /> Editar
                        </button>
                        <button
                          onClick={() => navigate(`/vendas/${s.id}`)}
                          className="btn-primary !py-2.5 text-sm min-h-[44px]"
                        >
                          Ver detalhe
                        </button>
                      </div>
                      {s.status !== 'CANCELADA' && (
                        <button
                          onClick={() => openCancel(s)}
                          className={cn(
                            'w-full text-sm rounded-lg border transition inline-flex items-center justify-center gap-1.5 font-semibold min-h-[40px]',
                            'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                          )}
                        >
                          <Trash2 className="w-4 h-4" /> Cancelar venda
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </div>

      {cancelModal.open && cancelModal.sale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/50 backdrop-blur-sm">
          <div className="w-full max-w-md card p-5 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 flex-shrink-0">
                <AlertTriangle className="w-5.5 h-5.5" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-black text-ink-900">
                  Cancelar venda #{formatFriendlyNumber(cancelModal.sale.friendly_number)}
                </h3>
                {cancelModal.sale.customer_name && (
                  <div className="text-sm text-ink-600 mt-0.5">
                    Cliente: <strong>{cancelModal.sale.customer_name}</strong>
                  </div>
                )}
                <p className="text-sm text-ink-600 mt-1">
                  Esta ação é <strong>irreversível</strong>. O estoque será devolvido e os valores ajustados.
                </p>
              </div>
              <button
                onClick={() => setCancelModal({ open: false, sale: null })}
                className="btn-ghost !p-2"
                disabled={canceling}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-100">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-rose-700/70">Data:</span>{' '}
                  <span className="font-semibold text-rose-900 num">{formatDateTime(cancelModal.sale.sale_date ?? cancelModal.sale.created_at)}</span>
                </div>
                <div>
                  <span className="text-rose-700/70">Total:</span>{' '}
                  <span className="font-black text-rose-900 num">{formatCurrency(cancelModal.sale.total_customer)}</span>
                </div>
                <div>
                  <span className="text-rose-700/70">Origem:</span>{' '}
                  <span className="font-semibold text-rose-900">{sourceLabel(cancelModal.sale.source)}</span>
                </div>
                <div>
                  <span className="text-rose-700/70">Status atual:</span>{' '}
                  <span className="font-semibold text-rose-900">{statusLabel(cancelModal.sale.status).label}</span>
                </div>
              </div>
            </div>
            <div className="mb-5">
              <label className="label">Motivo do cancelamento <span className="text-rose-600">*</span></label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Informe por que esta venda está sendo cancelada… (ex: cliente desistiu, produto com defeito, duplicata)"
                rows={4}
                className="input resize-none"
                disabled={canceling}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCancelModal({ open: false, sale: null })}
                disabled={canceling}
                className="btn-secondary flex-1 min-h-[44px]"
              >
                Voltar
              </button>
              <button
                onClick={doCancel}
                disabled={canceling || !cancelReason.trim()}
                className="btn-danger flex-1 min-h-[44px]"
              >
                {canceling ? (
                  <>Cancelando…</>
                ) : (
                  <><Trash2 className="w-4 h-4" /> Sim, cancelar venda</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
