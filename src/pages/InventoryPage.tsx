import { useEffect, useMemo, useState } from 'react'
import {
  Package, DollarSign, TrendingUp, Box, AlertTriangle, Filter,
  ArrowUpRight, ArrowDownRight, SlidersHorizontal
} from 'lucide-react'
import {
  formatCurrency, formatDate, formatDateTime, cn, formatFriendlyNumber, pluralize
} from '@/lib/format'
import {
  listAllProducts, listCategories, listInventoryMovements, listInventoryBatches
} from '@/services'
import type { Product, Category, InventoryMovement, InventoryBatch } from '@/types/supabase'

type TabKey = 'produtos' | 'movimentacoes' | 'lotes'
type StockFilter = 'all' | 'sem' | 'baixo'

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [batches, setBatches] = useState<InventoryBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('produtos')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')

  const load = async () => {
    setLoading(true)
    try {
      const [p, c, m, b] = await Promise.all([
        listAllProducts(true), listCategories(), listInventoryMovements(), listInventoryBatches()
      ])
      setProducts(p)
      setCategories(c)
      setMovements(m)
      setBatches(b)
    } catch (e) {
      console.error(e)
      alert('Erro ao carregar estoque.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const kpis = useMemo(() => {
    let pecas = 0
    let investido = 0
    let potencial = 0
    const sem: Product[] = []
    const baixo: Product[] = []
    products.forEach(p => {
      const qty = Number(p.total_stock ?? 0)
      const custo = Number(p.weighted_cost ?? p.current_cost ?? 0)
      const venda = Number(p.sale_price ?? 0)
      pecas += qty
      investido += qty * custo
      potencial += qty * venda
      if (qty === 0 && p.active) sem.push(p)
      else if (qty > 0 && qty <= Number(p.min_stock ?? 0) && p.active) baixo.push(p)
    })
    return { pecas, investido, potencial, sem, baixo }
  }, [products])

  const produtosFiltrados = useMemo(() => {
    let list = products.filter(p => p.active)
    if (stockFilter === 'sem') list = kpis.sem
    else if (stockFilter === 'baixo') list = kpis.baixo
    return list
  }, [products, stockFilter, kpis.sem, kpis.baixo])

  return (
    <div className="space-y-5 pb-4 sm:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900">Estoque</h1>
        <p className="text-sm text-ink-500 mt-0.5">Produtos disponíveis, movimentações e lotes FIFO.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Peças disponíveis" value={formatFriendlyNumber(kpis.pecas)}
          icon={<Package className="w-5 h-5" />} tone="brand"
          sub={pluralize(products.filter(p => p.active).length, 'SKU ativo', 'SKUs ativos')} />
        <KpiCard label="Valor investido" value={formatCurrency(kpis.investido)}
          icon={<DollarSign className="w-5 h-5" />} tone="violet"
          sub="custo médio ponderado" />
        <KpiCard label="Potencial de venda" value={formatCurrency(kpis.potencial)}
          icon={<TrendingUp className="w-5 h-5" />} tone="emerald"
          sub="preço de venda atual" />
        <KpiCard label="SKUs cadastrados" value={formatFriendlyNumber(products.length)}
          icon={<Box className="w-5 h-5" />} tone="ink"
          sub={pluralize(categories.length, 'categoria')} />
      </div>

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
          <AlertTriangle className="w-3 h-3" /> {kpis.sem.length} sem estoque
        </button>
        <button
          onClick={() => setStockFilter('baixo')}
          className={cn('chip ring-1 cursor-pointer transition',
            stockFilter === 'baixo'
              ? 'bg-amber-600 text-white ring-amber-600'
              : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100')}
        >
          <AlertTriangle className="w-3 h-3" /> {kpis.baixo.length} estoque baixo
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
            loading ? <EmptyState text="Carregando..." /> : (
              <div className="table-wrap">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-16">Img</th>
                      <th>Produto / SKU</th>
                      <th>Categoria</th>
                      <th className="text-right">Qtd disponível</th>
                      <th className="text-right">Custo médio</th>
                      <th className="text-right">Preço</th>
                      <th className="text-right">Valor total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtosFiltrados.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-10 text-ink-500">
                        <Filter className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                        Nenhum produto para o filtro selecionado.
                      </td></tr>
                    ) : produtosFiltrados.map(p => {
                      const qty = Number(p.total_stock ?? 0)
                      const min = Number(p.min_stock ?? 0)
                      const custo = Number(p.weighted_cost ?? p.current_cost ?? 0)
                      const venda = Number(p.sale_price ?? 0)
                      const total = qty * venda
                      let statusChip = <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Normal</span>
                      if (qty === 0) statusChip = <span className="chip bg-rose-50 text-rose-700 ring-1 ring-rose-200">Sem estoque</span>
                      else if (qty <= min) statusChip = <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200">Baixo</span>
                      const cat = categories.find(c => c.id === p.category_id)
                      return (
                        <tr key={p.id} className="hover:bg-ink-50/50 transition">
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
                            <div className="font-semibold text-ink-900">{p.name}</div>
                            <div className="text-xs text-ink-500 num">{p.sku || 'Sem SKU'}</div>
                          </td>
                          <td>{cat?.name || <span className="text-ink-400">—</span>}</td>
                          <td className="text-right num font-bold">{formatFriendlyNumber(qty)}</td>
                          <td className="text-right num">{formatCurrency(custo)}</td>
                          <td className="text-right num">{formatCurrency(venda)}</td>
                          <td className="text-right num font-bold text-ink-900">{formatCurrency(total)}</td>
                          <td>{statusChip}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'movimentacoes' && (
            loading ? <EmptyState text="Carregando..." /> : (
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
                    {movements.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-ink-500">
                        <Filter className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                        Sem movimentações recentes.
                      </td></tr>
                    ) : movements.map(m => {
                      const isEntrada = m.movement_type === 'ENTRADA' || m.movement_type === 'AJUSTE_POS'
                      const tipoLabel: Record<string, string> = {
                        ENTRADA: 'Entrada', SAIDA: 'Saída', AJUSTE_POS: 'Ajuste +',
                        AJUSTE_NEG: 'Ajuste -', PERDA: 'Perda', DEVOLUCAO: 'Devolução'
                      }
                      const prod = products.find(p => p.id === m.product_id)
                      return (
                        <tr key={m.id} className="hover:bg-ink-50/50 transition">
                          <td className="num text-ink-700">{formatDateTime(m.created_at)}</td>
                          <td>
                            <span className={cn('chip ring-1 flex w-fit items-center gap-1',
                              isEntrada
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                : 'bg-rose-50 text-rose-700 ring-rose-200')}>
                              {isEntrada ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                              {tipoLabel[m.movement_type] || m.movement_type}
                            </span>
                          </td>
                          <td className="font-medium text-ink-800">{prod?.name || '—'}</td>
                          <td className={cn('text-right num font-bold', isEntrada ? 'text-emerald-700' : 'text-rose-700')}>
                            {isEntrada ? '+' : '-'}{m.quantity}
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
            )
          )}

          {tab === 'lotes' && (
            loading ? <EmptyState text="Carregando..." /> : (
              <div className="table-wrap">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Lote recebido em</th>
                      <th>Data entrada</th>
                      <th className="text-right">Qtd original</th>
                      <th className="text-right">Qtd disponível</th>
                      <th className="text-right">Custo unitário</th>
                      <th className="text-right">Valor total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-10 text-ink-500">
                        <Filter className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                        Nenhum lote registrado.
                      </td></tr>
                    ) : batches.map(b => {
                      const prod = products.find(p => p.id === b.product_id)
                      const disponivel = Number(b.quantity_available ?? 0)
                      const original = Number(b.quantity_received ?? 0)
                      const custo = Number(b.unit_cost ?? 0)
                      const total = disponivel * custo
                      const pctDisp = original > 0 ? (disponivel / original) * 100 : 0
                      return (
                        <tr key={b.id} className="hover:bg-ink-50/50 transition">
                          <td className="font-semibold text-ink-900">{prod?.name || '—'}</td>
                          <td className="text-ink-700 num">
                            Lote #{formatFriendlyNumber(parseInt(b.id.slice(-4), 16) || 0, 4)}
                            <div className="mt-1 h-1.5 w-20 rounded-full bg-ink-100 overflow-hidden">
                              <div
                                className={cn('h-full rounded-full',
                                  pctDisp > 50 ? 'bg-emerald-500' : pctDisp > 10 ? 'bg-amber-500' : 'bg-rose-500')}
                                style={{ width: `${pctDisp}%` }}
                              />
                            </div>
                          </td>
                          <td className="num text-ink-600">{formatDate(b.received_at)}</td>
                          <td className="text-right num">{formatFriendlyNumber(original)}</td>
                          <td className="text-right num font-bold text-ink-900">{formatFriendlyNumber(disponivel)}</td>
                          <td className="text-right num">{formatCurrency(custo)}</td>
                          <td className="text-right num font-bold text-brand-900">{formatCurrency(total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, icon, tone }:
  { label: string; value: string; sub?: string; icon: React.ReactNode; tone: 'brand' | 'emerald' | 'violet' | 'ink' }) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    ink: 'bg-ink-100 text-ink-700 ring-ink-200',
  }
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between gap-2">
        <span className="kpi-label">{label}</span>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center ring-1', tones[tone])}>{icon}</div>
      </div>
      <div className="kpi-value num">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
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
