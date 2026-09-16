import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, Search, ChevronDown, Calendar, Filter, X, AlertTriangle, Check, ShoppingBag, Trash2
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, formatDateTime, formatFriendlyNumber, parseBrl, sourceLabel, statusLabel, paymentMethodLabel, pluralize, rangePresets, inRange, cn
} from '@/lib/format'
import type { Sale, UUID, SaleSource, PaymentMethod, SaleStatus } from '@/types/supabase'
import { listSales, cancelSale, listPaymentProviders, listAllProducts } from '@/services'
import type { ProviderWithModalities } from '@/services'

type PresetKey = keyof ReturnType<typeof rangePresets> | 'PERSONALIZADO'

type FilterInstallments = 'TODOS' | '1' | '2' | '3+'

export default function SalesHistoryPage() {
  const navigate = useNavigate()
  const presets = rangePresets()

  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [providers, setProviders] = useState<ProviderWithModalities[]>([])
  const [loading, setLoading] = useState(true)

  const [preset, setPreset] = useState<PresetKey>('ESTE_MES')
  const [from, setFrom] = useState<string>(presets.ESTE_MES.from.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(presets.ESTE_MES.to.toISOString().slice(0, 10))

  const [filtersOpen, setFiltersOpen] = useState(false)
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

  useEffect(() => {
    setLoading(true)
    Promise.all([listSales(), listAllProducts(), listPaymentProviders()])
      .then(([s, p, pv]) => {
        setSales(s); setProducts(p); setProviders(pv)
      }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (preset !== 'PERSONALIZADO') {
      const p = presets[preset as Exclude<PresetKey, 'PERSONALIZADO'>]
      setFrom(p.from.toISOString().slice(0, 10))
      setTo(p.to.toISOString().slice(0, 10))
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
    if (fProduct) c++
    if (fSource !== 'TODOS') c++
    if (fProvider) c++
    if (fModality) c++
    if (fMethod !== 'TODOS') c++
    if (fInstallments !== 'TODOS') c++
    if (fStatus !== 'TODOS') c++
    if (preset === 'PERSONALIZADO') c++
    return c
  }, [fProduct, fSource, fProvider, fModality, fMethod, fInstallments, fStatus, preset])

  const filtered = useMemo(() => {
    return sales.filter(s => {
      if (!inRange(s.sale_date ?? s.created_at, fromDate, toDate)) return false
      if (fSource !== 'TODOS' && s.source !== fSource) return false
      if (fStatus !== 'TODOS' && s.status !== fStatus) return false
      const snapMethod = (s as any).payment_method_snapshot
      if (fMethod !== 'TODOS' && snapMethod !== fMethod) return false
      const snapProvider = (s as any).payment_provider_snapshot
      if (fProvider) {
        const p = providers.find(pp => pp.provider.id === fProvider)
        if (p && snapProvider !== p.provider.name) return false
      }
      const snapModality = (s as any).payment_modality_snapshot
      if (fModality) {
        const m = modalities.find(mm => mm.id === fModality)
        if (m && snapModality !== m.name) return false
      }
      const inst = Number((s as any).installments_snapshot ?? 1)
      if (fInstallments === '1' && inst !== 1) return false
      if (fInstallments === '2' && inst !== 2) return false
      if (fInstallments === '3+' && inst < 3) return false
      return true
    })
  }, [sales, fromDate, toDate, fSource, fStatus, fMethod, fProvider, fModality, fInstallments, providers, modalities])

  const totalCliente = filtered.reduce((s, v) => s + (v.status !== 'CANCELADA' ? Number(v.total_customer ?? 0) : 0), 0)
  const totalLucro = filtered.reduce((s, v) => s + (v.status !== 'CANCELADA' ? Number(v.real_profit ?? 0) : 0), 0)
  const totalPecas = filtered.reduce((s, v) => s + Number((v as any).total_items ?? 0), 0)

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
    setFProduct(''); setFSource('TODOS'); setFProvider(''); setFModality('')
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
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                value={preset}
                onChange={e => setPreset(e.target.value as PresetKey)}
                className="select pr-10 min-w-[160px]"
              >
                {Object.entries(presets).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
                <option value="PERSONALIZADO">Personalizado</option>
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            </div>
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-ink-200">
                <Calendar className="w-4 h-4 text-ink-500" />
                <input
                  type="date"
                  value={from}
                  onChange={e => { setFrom(e.target.value); setPreset('PERSONALIZADO') }}
                  className="bg-transparent text-sm outline-none w-[110px]"
                />
              </div>
              <span className="text-ink-400 text-sm">à</span>
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-ink-200">
                <Calendar className="w-4 h-4 text-ink-500" />
                <input
                  type="date"
                  value={to}
                  onChange={e => { setTo(e.target.value); setPreset('PERSONALIZADO') }}
                  className="bg-transparent text-sm outline-none w-[110px]"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                {(['TODOS', 'CONCLUIDA', 'PENDENTE', 'CANCELADA'] as const).map(st => {
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
          <div className="table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Data e hora</th>
                  <th>Origem</th>
                  <th>Pagamento</th>
                  <th className="text-right">Peças</th>
                  <th className="text-right">Total cliente</th>
                  <th className="text-right">Lucro real</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const st = statusLabel(s.status)
                  const snapProvider = (s as any).payment_provider_snapshot
                  const snapMethod = (s as any).payment_method_snapshot
                  const snapInstallments = Number((s as any).installments_snapshot ?? 1)
                  return (
                    <tr key={s.id} className="hover:bg-ink-50/50 transition">
                      <td className="font-bold num">
                        <button
                          onClick={() => navigate(`/vendas/${s.id}`)}
                          className="text-brand-800 hover:underline text-left"
                        >
                          #{formatFriendlyNumber(s.friendly_number)}
                        </button>
                      </td>
                      <td className="text-ink-700 num whitespace-nowrap">{formatDateTime(s.sale_date ?? s.created_at)}</td>
                      <td>
                        <span className="chip bg-ink-100 text-ink-700">{sourceLabel(s.source)}</span>
                      </td>
                      <td className="text-ink-700 text-sm whitespace-nowrap">
                        {[snapProvider, paymentMethodLabel(snapMethod), snapInstallments > 1 ? `${snapInstallments}x` : null]
                          .filter(Boolean).join(' · ') || '-'}
                      </td>
                      <td className="text-right num font-semibold">{formatFriendlyNumber(Number((s as any).total_items ?? 0))}</td>
                      <td className="text-right num font-bold text-ink-900">{formatCurrency(s.total_customer)}</td>
                      <td className={cn('text-right num font-bold',
                        s.status === 'CANCELADA' ? 'text-ink-400 line-through' :
                        Number(s.real_profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                        {s.status === 'CANCELADA' ? formatCurrency(0) : formatCurrency(s.real_profit)}
                      </td>
                      <td><span className={st.class}>{st.label}</span></td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => navigate(`/vendas/${s.id}`)}
                            className="btn-secondary !py-1.5 !px-2.5 text-xs whitespace-nowrap min-h-[36px]"
                            title="Ver detalhe"
                          >
                            Ver detalhe
                          </button>
                          <button
                            onClick={() => openCancel(s)}
                            disabled={s.status === 'CANCELADA'}
                            className={cn(
                              '!py-1.5 !px-2.5 text-xs whitespace-nowrap min-h-[36px] rounded-lg border transition inline-flex items-center gap-1.5 font-semibold',
                              s.status === 'CANCELADA'
                                ? 'border-ink-100 bg-ink-50 text-ink-400 cursor-not-allowed'
                                : 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                            )}
                            title="Cancelar venda"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
                <h3 className="text-lg font-black text-ink-900">Cancelar venda #{formatFriendlyNumber(cancelModal.sale.friendly_number)}</h3>
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
