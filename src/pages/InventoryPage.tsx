import { useEffect, useMemo, useState } from 'react'
import {
  Package, DollarSign, TrendingUp, Box, AlertTriangle, Filter,
  ArrowUpRight, ArrowDownRight, SlidersHorizontal, AlertCircle, RefreshCw
} from 'lucide-react'
import {
  formatCurrency, formatDate, formatDateTime, cn, formatFriendlyNumber, pluralize
} from '@/lib/format'
import {
  listCategories, listInventoryMovements, listInventoryBatches,
  dashboardStockSummary, dashboardStock,
  onInvalidate
} from '@/services'
import type {
  Category, InventoryMovement, InventoryBatch, DashboardStockSummary, DashboardStockRow
} from '@/types/supabase'

type TabKey = 'produtos' | 'movimentacoes' | 'lotes'
type StockFilter = 'all' | 'sem' | 'baixo'

export default function InventoryPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [batches, setBatches] = useState<InventoryBatch[]>([])

  const [summary, setSummary] = useState<DashboardStockSummary | null>(null)
  const [stockRows, setStockRows] = useState<DashboardStockRow[]>([])

  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMovements, setLoadingMovements] = useState(true)
  const [loadingBatches, setLoadingBatches] = useState(true)

  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [movementsError, setMovementsError] = useState<string | null>(null)
  const [batchesError, setBatchesError] = useState<string | null>(null)

  const [tab, setTab] = useState<TabKey>('produtos')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [tick, setTick] = useState(0)

  const load = async () => {
    setSummaryError(null); setListError(null)
    setMovementsError(null); setBatchesError(null)

    setLoadingSummary(true); setLoadingList(true)
    setLoadingMovements(true); setLoadingBatches(true)

    const p1 = dashboardStockSummary()
      .then(d => { setSummary(d); setSummaryError(null) })
      .catch(err => {
        console.error('[Estoque] erro carregar resumo (v_dashboard_stock_summary):', err)
        setSummaryError(err?.message ?? String(err))
      })
      .finally(() => setLoadingSummary(false))

    const p2 = dashboardStock()
      .then(d => { setStockRows(d); setListError(null) })
      .catch(err => {
        console.error('[Estoque] erro carregar lista (v_dashboard_stock):', err)
        setListError(err?.message ?? String(err))
        setStockRows([])
      })
      .finally(() => setLoadingList(false))

    const p3 = listCategories()
      .then(c => setCategories(c))
      .catch(e => { console.error('[Estoque] categorias erro:', e); setCategories([]) })

    const p4 = listInventoryMovements()
      .then(m => { setMovements(m); setMovementsError(null) })
      .catch(err => {
        console.error('[Estoque] erro carregar movimentacoes:', err)
        setMovementsError(err?.message ?? String(err))
        setMovements([])
      })
      .finally(() => setLoadingMovements(false))

    const p5 = listInventoryBatches()
      .then(b => { setBatches(b); setBatchesError(null) })
      .catch(err => {
        console.error('[Estoque] erro carregar lotes:', err)
        setBatchesError(err?.message ?? String(err))
        setBatches([])
      })
      .finally(() => setLoadingBatches(false))

    await Promise.allSettled([p1, p2, p3, p4, p5])
  }

  useEffect(() => { load() }, [tick])

  useEffect(() => {
    const cleanup = onInvalidate((scope) => {
      if (scope === 'all' || scope === 'inventory' || scope === 'products' || scope === 'purchases' || scope === 'sales') {
        setTick(t => t + 1)
      }
    })
    return cleanup
  }, [])

  const kpis = useMemo(() => {
    const pecas = summary ? summary.total_units : 0
    const investido = summary ? summary.total_stock_cost : 0
    const potencial = summary ? summary.total_sales_potential : 0
    return { pecas, investido, potencial }
  }, [summary])

  const produtosFiltrados = useMemo(() => {
    let list = stockRows.filter(p => p.active !== false)
    if (stockFilter === 'sem') list = list.filter(p => Number(p.units_available ?? 0) === 0)
    else if (stockFilter === 'baixo') list = list.filter(p => {
      const q = Number(p.units_available ?? 0)
      const min = Number(p.min_stock ?? 0)
      return q > 0 && (min > 0 ? q <= min : q <= 2)
    })
    return list
  }, [stockRows, stockFilter])

  const semEstoqueCount = stockRows.filter(p => p.active !== false && Number(p.units_available ?? 0) === 0).length
  const baixoCount = stockRows.filter(p => {
    if (p.active === false) return false
    const q = Number(p.units_available ?? 0)
    const min = Number(p.min_stock ?? 0)
    return q > 0 && (min > 0 ? q <= min : q <= 2)
  }).length

  const loadingAnyTabProdutos = loadingSummary || loadingList
  const anyErrorProdutos = summaryError || listError

  return (
    <div className="page-wrap pb-4 sm:pb-6">
      <header className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Estoque</h1>
            <p className="page-subtitle">Produtos disponíveis, movimentações e lotes FIFO.</p>
          </div>
          <button
            onClick={() => setTick(t => t + 1)}
            className="btn-secondary inline-flex items-center gap-1.5 w-full sm:w-auto justify-center"
          >
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
        </div>
      </header>

      {(summaryError || listError) && (
        <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-bold">Não foi possível carregar um ou mais dados de estoque</div>
                <div className="text-xs mt-1 opacity-90 break-words">
                  Tente novamente. Se o problema persistir, contate o suporte.
                </div>
              </div>
            </div>
            <button
              onClick={() => setTick(t => t + 1)}
              className="btn-danger !py-2 !px-3 text-xs whitespace-nowrap min-w-fit"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      {summaryError && !summary ? null : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiCard
            label="Peças disponíveis"
            value={loadingSummary ? '…' : String(kpis.pecas)}
            icon={<Package className="w-5 h-5" />}
            tone={summaryError ? 'rose' : 'brand'}
            sub={loadingSummary ? 'Carregando…' : summaryError ? 'Erro ao carregar. Clique em Atualizar.' : pluralize(Number(summary?.total_skus ?? 0), 'SKU')}
          />
          <KpiCard
            label="Custo do estoque"
            value={loadingSummary ? '…' : formatCurrency(kpis.investido)}
            icon={<DollarSign className="w-5 h-5" />}
            tone="violet"
            sub={loadingSummary ? 'Carregando…' : 'lotes FIFO (unit cost + rateio)'}
          />
          <KpiCard
            label="Potencial de venda"
            value={loadingSummary ? '…' : formatCurrency(kpis.potencial)}
            icon={<TrendingUp className="w-5 h-5" />}
            tone="emerald"
            sub={loadingSummary ? 'Carregando…' : 'preço atual × disponível'}
          />
          <KpiCard
            label="SKUs cadastrados"
            value={loadingSummary ? '…' : String(summary?.total_skus ?? 0)}
            icon={<Box className="w-5 h-5" />}
            tone="ink"
            sub={loadingSummary ? 'Carregando…' : (
              <>
                {Number(summary?.in_stock_skus ?? 0)} com estoque ·{' '}
                {Number(summary?.out_of_stock_skus ?? 0)} sem
              </>
            )}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStockFilter('all')}
          className={cn('chip ring-1 cursor-pointer transition',
            stockFilter === 'all'
              ? 'bg-brand-900 text-white ring-brand-900'
              : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50')}
        >
          <SlidersHorizontal className="w-3 h-3" /> Todos os produtos
        </button>
        <button
          onClick={() => setStockFilter('sem')}
          className={cn('chip ring-1 cursor-pointer transition',
            stockFilter === 'sem'
              ? 'bg-rose-600 text-white ring-rose-600'
              : 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100')}
        >
          <AlertTriangle className="w-3 h-3" /> {semEstoqueCount} sem estoque
        </button>
        <button
          onClick={() => setStockFilter('baixo')}
          className={cn('chip ring-1 cursor-pointer transition',
            stockFilter === 'baixo'
              ? 'bg-amber-600 text-white ring-amber-600'
              : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100')}
        >
          <AlertTriangle className="w-3 h-3" /> {baixoCount} estoque baixo
        </button>
      </div>

      <div className="card">
        <div className="px-4 sm:px-5 pt-4 flex overflow-x-auto hide-scroll gap-1 border-b border-ink-100">
          {([
            { k: 'produtos', label: 'Produtos', count: produtosFiltrados.length },
            { k: 'movimentacoes', label: 'Movimentações recentes', count: movements.length },
            { k: 'lotes', label: 'Lotes FIFO', count: batches.length },
          ] as const).map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={cn(
                'px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition',
                tab === t.k
                  ? 'border-brand-900 text-brand-900'
                  : 'border-transparent text-ink-500 hover:text-ink-800'
              )}
            >
              {t.label} <span className="ml-1 text-xs opacity-70">({t.count})</span>
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-5">
          {tab === 'produtos' && (
            <>
              {loadingAnyTabProdutos ? (
                <div className="py-10">
                  <SkeletonTable cols={7} rows={5} />
                </div>
              ) : listError ? (
                <div className="py-10">
                  <div className="text-center max-w-lg mx-auto">
                    <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-2" />
                    <div className="font-bold text-rose-700">Não foi possível carregar os produtos.</div>
                    <div className="text-xs text-rose-600 mt-1 break-words">Tente novamente em instantes.</div>
                    <button
                      onClick={() => setTick(t => t + 1)}
                      className="btn-secondary mt-3 !py-2 text-xs"
                    >
                      Tentar novamente
                    </button>
                  </div>
                </div>
              ) : produtosFiltrados.length === 0 ? (
                <EmptyState text="Nenhum produto para o filtro selecionado." />
              ) : (
                <>
                  <div className="hidden sm:block">
                    <div className="table-wrap">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th className="w-16">Img</th>
                            <th>Produto / SKU</th>
                            <th>Categoria</th>
                            <th className="text-right">Qtd disponível</th>
                            <th className="text-right">Custo (lote)</th>
                            <th className="text-right">Potencial</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {produtosFiltrados.map(p => {
                            const qty = Number(p.units_available ?? 0)
                            const min = Number(p.min_stock ?? 0)
                            const custo = Number(p.stock_cost ?? 0)
                            const venda = Number(p.sales_potential ?? 0)
                            let statusChip = <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Normal</span>
                            if (qty === 0) statusChip = <span className="chip bg-rose-50 text-rose-700 ring-1 ring-rose-200">Sem estoque</span>
                            else if (min > 0 ? qty <= min : qty <= 2) statusChip = <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200">Baixo</span>
                            return (
                              <tr key={String(p.product_id)} className="hover:bg-ink-50/50 transition">
                                <td>
                                  {p.image_url ? (
                                    <img src={p.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-ink-100" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                  ) : (
                                    <div className="w-10 h-10 rounded-lg bg-ink-100 flex items-center justify-center text-ink-400">
                                      <Package className="w-5 h-5" />
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <div className="font-semibold text-ink-900">{p.product_name || 'Produto'}</div>
                                  <div className="text-xs text-ink-500 num">{p.sku || 'Sem SKU'}</div>
                                </td>
                                <td>{p.category_name || <span className="text-ink-400">—</span>}</td>
                                <td className="text-right num font-bold">{String(qty)}</td>
                                <td className="text-right num">{formatCurrency(custo)}</td>
                                <td className="text-right num">{formatCurrency(venda)}</td>
                                <td>{statusChip}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="sm:hidden flex flex-col gap-3">
                    {produtosFiltrados.map(p => {
                      const qty = Number(p.units_available ?? 0)
                      const min = Number(p.min_stock ?? 0)
                      const custo = Number(p.stock_cost ?? 0)
                      const venda = Number(p.sales_potential ?? 0)
                      const stockBadge = qty === 0
                        ? <span className="stock-out">{qty} un · Sem estoque</span>
                        : min > 0 ? qty <= min : qty <= 2
                        ? <span className="stock-low">{qty} un · Baixo estoque</span>
                        : <span className="stock-ok">{qty} un · Em estoque</span>
                      return (
                        <div key={String(p.product_id)} className="mcard">
                          <div className="mcard-head">
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              {p.image_url ? (
                                <img src={p.image_url} alt="" className="w-12 h-12 rounded-xl object-cover border border-ink-100 flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                              ) : (
                                <div className="w-12 h-12 rounded-xl bg-ink-100 flex items-center justify-center text-ink-400 flex-shrink-0">
                                  <Package className="w-6 h-6" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="mcard-title truncate" title={p.product_name || ''}>{p.product_name || 'Produto'}</div>
                                {p.sku && <div className="mcard-sub num">SKU: {p.sku}</div>}
                                {p.category_name && <div className="mcard-sub">{p.category_name}</div>}
                              </div>
                            </div>
                          </div>
                          <div className="mcard-meta">{stockBadge}</div>
                          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-ink-100">
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Qtd</div>
                              <div className="num font-black text-ink-900 mt-0.5">{String(qty)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Custo</div>
                              <div className="num font-semibold text-ink-700 mt-0.5 truncate">{formatCurrency(custo)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Potencial</div>
                              <div className="num font-bold text-brand-800 mt-0.5 truncate">{formatCurrency(venda)}</div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'movimentacoes' && (
            <>
              {loadingMovements ? (
                <div className="py-10"><SkeletonTable cols={5} rows={6} /></div>
              ) : movementsError ? (
                <div className="py-10">
                  <div className="text-center max-w-lg mx-auto">
                    <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-2" />
                    <div className="font-bold text-rose-700">Não foi possível carregar movimentações.</div>
                    <div className="text-xs text-rose-600 mt-1 break-words">Tente novamente em instantes.</div>
                    <button
                      onClick={() => setTick(t => t + 1)}
                      className="btn-secondary mt-3 !py-2 text-xs"
                    >
                      Tentar novamente
                    </button>
                  </div>
                </div>
              ) : movements.length === 0 ? (
                <EmptyState text="Sem movimentações recentes." />
              ) : (
                <>
                  <div className="hidden sm:block">
                    <div className="table-wrap">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Tipo</th>
                            <th>Produto</th>
                            <th className="text-right">Qtd</th>
                            <th>Responsável / Observação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movements.map(m => {
                            const isEntrada = m.movement_type === 'ENTRADA' || m.movement_type === 'AJUSTE_POS'
                            const tipoLabel: Record<string, string> = {
                              ENTRADA: 'Entrada', SAIDA: 'Saída', AJUSTE_POS: 'Ajuste +',
                              AJUSTE_NEG: 'Ajuste -', PERDA: 'Perda', DEVOLUCAO: 'Devolução'
                            }
                            const produtoNome = (m as any).product_name ?? null
                            return (
                              <tr key={m.id} className="hover:bg-ink-50/50 transition">
                                <td className="num text-ink-700 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                                <td>
                                  <span className={cn('chip ring-1 flex w-fit items-center gap-1',
                                    isEntrada
                                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                      : 'bg-rose-50 text-rose-700 ring-rose-200')}>
                                    {isEntrada ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                    {tipoLabel[m.movement_type] || m.movement_type}
                                  </span>
                                </td>
                                <td className="font-medium text-ink-800">
                                  {produtoNome || (
                                    <span className="text-ink-400 italic">Produto #…{String(m.product_id).slice(-4)}</span>
                                  )}
                                </td>
                                <td className={cn('text-right num font-bold whitespace-nowrap', isEntrada ? 'text-emerald-700' : 'text-rose-700')}>
                                  {isEntrada ? '+' : '-'}{Number(m.quantity ?? 0)}
                                </td>
                                <td className="text-sm text-ink-600">
                                  <div className="font-medium">{m.reason || 'Sem motivo'}</div>
                                  {m.notes && <div className="text-xs text-ink-400 mt-0.5">{m.notes}</div>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="sm:hidden flex flex-col gap-3 px-4 py-4">
                    {movements.map(m => {
                      const isEntrada = m.movement_type === 'ENTRADA' || m.movement_type === 'AJUSTE_POS'
                      const tipoLabel: Record<string, string> = {
                        ENTRADA: 'Entrada', SAIDA: 'Saída', AJUSTE_POS: 'Ajuste +',
                        AJUSTE_NEG: 'Ajuste -', PERDA: 'Perda', DEVOLUCAO: 'Devolução'
                      }
                      const produtoNome = (m as any).product_name ?? null
                      return (
                        <div key={m.id} className="mcard">
                          <div className="mcard-head">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn('chip ring-1 flex items-center gap-1',
                                  isEntrada
                                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                    : 'bg-rose-50 text-rose-700 ring-rose-200')}>
                                  {isEntrada ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                  {tipoLabel[m.movement_type] || m.movement_type}
                                </span>
                              </div>
                              <div className="mcard-sub num mt-1.5">{formatDateTime(m.created_at)}</div>
                            </div>
                            <div className={cn(
                              'text-right num font-black text-lg leading-tight',
                              isEntrada ? 'text-emerald-700' : 'text-rose-700'
                            )}>
                              {isEntrada ? '+' : '-'}{Number(m.quantity ?? 0)}
                            </div>
                          </div>
                          <div className="space-y-1 pt-1">
                            <div className="text-sm font-semibold text-ink-900">
                              {produtoNome || (
                                <span className="text-ink-400 italic">Produto #…{String(m.product_id).slice(-4)}</span>
                              )}
                            </div>
                            <div className="text-sm text-ink-700 font-medium">{m.reason || 'Sem motivo'}</div>
                            {m.notes && <div className="text-xs text-ink-500 break-words">{m.notes}</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'lotes' && (
            <>
              {loadingBatches ? (
                <div className="py-10"><SkeletonTable cols={7} rows={5} /></div>
              ) : batchesError ? (
                <div className="py-10">
                  <div className="text-center max-w-lg mx-auto">
                    <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-2" />
                    <div className="font-bold text-rose-700">Não foi possível carregar lotes.</div>
                    <div className="text-xs text-rose-600 mt-1 break-words">Tente novamente em instantes.</div>
                    <button
                      onClick={() => setTick(t => t + 1)}
                      className="btn-secondary mt-3 !py-2 text-xs"
                    >
                      Tentar novamente
                    </button>
                  </div>
                </div>
              ) : batches.length === 0 ? (
                <EmptyState text="Nenhum lote registrado." />
              ) : (
                <>
                  <div className="hidden sm:block">
                    <div className="table-wrap">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th>Lote</th>
                            <th className="whitespace-nowrap">Recebido em</th>
                            <th className="text-right">Qtd recebida</th>
                            <th className="text-right">Disponível</th>
                            <th className="text-right">Custo unitário</th>
                            <th className="text-right">Valor total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batches.map(b => {
                            const disponivel = Number(b.quantity_available ?? 0)
                            const original = Number(b.quantity_received ?? 0)
                            const custo = Number(b.unit_cost ?? 0) + Number((b as any).allocated_purchase_cost ?? 0)
                            const total = disponivel * custo
                            const pctDisp = original > 0 ? (disponivel / original) * 100 : 0
                            const produtoNome = stockRows.find(r => r.product_id === b.product_id)?.product_name
                              ?? (b as any).product_name ?? null
                            return (
                              <tr key={b.id} className="hover:bg-ink-50/50 transition">
                                <td className="font-semibold text-ink-900">
                                  {produtoNome ||
                                    <span className="text-ink-400 italic">Produto #{String(b.product_id).slice(-4)}</span>}
                                </td>
                                <td className="text-ink-700 num whitespace-nowrap">
                                  Lote #{formatFriendlyNumber(parseInt(b.id.slice(-4), 16) || 0, 4)}
                                  <div className="mt-1 h-1.5 w-20 rounded-full bg-ink-100 overflow-hidden">
                                    <div
                                      className={cn('h-full rounded-full',
                                        pctDisp > 50 ? 'bg-emerald-500' : pctDisp > 10 ? 'bg-amber-500' : 'bg-rose-500')}
                                      style={{ width: `${pctDisp}%` }}
                                    />
                                  </div>
                                </td>
                                <td className="num text-ink-600 whitespace-nowrap">{formatDate(b.received_at, true)}</td>
                                <td className="text-right num">{String(original)}</td>
                                <td className="text-right num font-bold text-ink-900">{String(disponivel)}</td>
                                <td className="text-right num">{formatCurrency(custo)}</td>
                                <td className="text-right num font-bold text-brand-900">{formatCurrency(total)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="sm:hidden flex flex-col gap-3 px-4 py-4">
                    {batches.map(b => {
                      const disponivel = Number(b.quantity_available ?? 0)
                      const original = Number(b.quantity_received ?? 0)
                      const custo = Number(b.unit_cost ?? 0) + Number((b as any).allocated_purchase_cost ?? 0)
                      const total = disponivel * custo
                      const pctDisp = original > 0 ? (disponivel / original) * 100 : 0
                      const produtoNome = stockRows.find(r => r.product_id === b.product_id)?.product_name
                        ?? (b as any).product_name ?? null
                      return (
                        <div key={b.id} className="mcard">
                          <div className="mcard-head">
                            <div className="min-w-0 flex-1">
                              <div className="mcard-title truncate">
                                {produtoNome ||
                                  <span className="text-ink-400 italic">Produto #{String(b.product_id).slice(-4)}</span>}
                              </div>
                              <div className="mcard-meta mt-1">
                                <span className="chip bg-ink-100 text-ink-700">
                                  Lote #{formatFriendlyNumber(parseInt(b.id.slice(-4), 16) || 0, 4)}
                                </span>
                              </div>
                            </div>
                            <div className="text-right num font-black text-brand-900 leading-tight">
                              {formatCurrency(total)}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <div className="h-2 w-full rounded-full bg-ink-100 overflow-hidden">
                                <div
                                  className={cn('h-full rounded-full transition-all',
                                    pctDisp > 50 ? 'bg-emerald-500' : pctDisp > 10 ? 'bg-amber-500' : 'bg-rose-500')}
                                  style={{ width: `${pctDisp}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[11px] text-ink-500 mt-1">
                                <span>{disponivel} un. disponíveis</span>
                                <span>{pctDisp.toFixed(0)}%</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-ink-100">
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Recebido</div>
                                <div className="num text-sm font-semibold text-ink-800 mt-0.5">{formatDate(b.received_at, true)}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Qtd total</div>
                                <div className="num text-sm font-bold text-ink-900 mt-0.5">{original} un.</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Custo un.</div>
                                <div className="num text-sm font-bold text-ink-900 mt-0.5">{formatCurrency(custo)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, icon, tone }:
  { label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode;
    tone: 'brand' | 'emerald' | 'violet' | 'ink' | 'rose' }) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    ink: 'bg-ink-100 text-ink-700 ring-ink-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  }
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <span className="kpi-label min-w-0">{label}</span>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center ring-1 flex-shrink-0', tones[tone])}>{icon}</div>
      </div>
      <div className="kpi-value num whitespace-nowrap overflow-hidden text-ellipsis">{value}</div>
      {sub !== undefined && <div className="kpi-sub min-w-0">{sub}</div>}
    </div>
  )
}

function EmptyState({ text = 'Sem dados.' }: { text?: string }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center text-center">
      <Filter className="w-8 h-8 text-ink-300 mb-2" />
      <p className="text-sm text-ink-500">{text}</p>
    </div>
  )
}

function SkeletonTable({ cols, rows }: { cols: number; rows: number }) {
  return (
    <div className="table-wrap">
      <table className="table-base">
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: cols }).map((__, j) => (
                <td key={j}>
                  <div className="h-4 bg-ink-100 rounded animate-pulse w-full" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
