import { useEffect, useMemo, useState } from 'react'
import {
  Calendar, DollarSign, TrendingUp, Package, ShoppingCart, Receipt,
  ArrowUpRight, ArrowDownRight, Filter, AlertTriangle, ChevronDown
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, rangePresets, inRange,
  statusLabel, sourceLabel, paymentMethodLabel, pluralize, cn
} from '@/lib/format'
import {
  listSales, listProducts, listInventoryBatches, listFinancialTransactions,
  listInventoryMovements
} from '@/services'
import type { Sale, Product, InventoryBatch, FinancialTransaction, InventoryMovement } from '@/types/supabase'
import { Link } from 'react-router-dom'

type PresetKey = keyof ReturnType<typeof rangePresets> | 'PERSONALIZADO'

export default function DashboardPage() {
  const presets = rangePresets()
  const [preset, setPreset] = useState<PresetKey>('ESTE_MES')
  const [from, setFrom] = useState<string>(presets.ESTE_MES.from.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(presets.ESTE_MES.to.toISOString().slice(0, 10))

  const [sales, setSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<InventoryBatch[]>([])
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadTick, setLoadTick] = useState(0)

  const reloadDashboard = () => setLoadTick(t => t + 1)
  ;(window as any).__reloadDashboard = reloadDashboard

  useEffect(() => {
    if (preset !== 'PERSONALIZADO') {
      const p = presets[preset as Exclude<PresetKey, 'PERSONALIZADO'>]
      setFrom(p.from.toISOString().slice(0, 10))
      setTo(p.to.toISOString().slice(0, 10))
    }
  }, [preset])

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    Promise.all([
      listSales(), listProducts(), listInventoryBatches(),
      listFinancialTransactions(), listInventoryMovements()
    ]).then(([s, p, b, t, m]) => {
      setSales(s); setProducts(p); setBatches(b); setTransactions(t); setMovements(m)
    }).catch(err => {
      console.error('[Dashboard] Falha ao carregar dados:', err)
      setLoadError(err?.message ?? 'Erro desconhecido')
    }).finally(() => setLoading(false))
  }, [loadTick])

  const { fromDate, toDate } = useMemo(() => ({
    fromDate: new Date(from + 'T00:00:00'),
    toDate: new Date(to + 'T23:59:59'),
  }), [from, to])

  const periodSales = useMemo(
    () => sales.filter(s => inRange(s.sale_date ?? s.created_at, fromDate, toDate) && s.status !== 'CANCELADA'),
    [sales, fromDate, toDate]
  )
  const periodTrans = useMemo(
    () => transactions.filter(t => inRange(t.trans_date, fromDate, toDate)),
    [transactions, fromDate, toDate]
  )

  const kpis = useMemo(() => {
    const faturamento = periodSales.reduce((s, v) => s + Number(v.total_customer ?? 0), 0)
    const lucro = periodSales.reduce((s, v) => s + Number(v.real_profit ?? 0), 0)
    const pedidos = periodSales.length
    const pecas = periodSales.reduce((s, v) => s + Number(v.total_items ?? 0), 0)
    const ticketMedio = pedidos ? faturamento / pedidos : 0
    const margem = faturamento ? (lucro / faturamento) * 100 : 0

    const custoMerc = periodSales.reduce((s, v) => s + Number(v.cogs_total ?? 0), 0)
    const custoFrete = periodSales.reduce((s, v) => s + (Number(v.shipping_cost_snapshot ?? 0) + Number(v.extra_costs_total ?? 0)), 0)
    const custoTaxas = periodSales.reduce((s, v) => s + Number(v.fee_actual_total ?? 0), 0)
    const custoEmbalagens = periodSales.reduce((s, v) => s + Number(v.packaging_cost_actual ?? 0), 0)
    const descontos = periodSales.reduce((s, v) => s + Number(v.total_discounts ?? 0), 0)

    return { faturamento, lucro, margem, pedidos, pecas, ticketMedio, custoMerc, custoFrete, custoTaxas, custoEmbalagens, descontos }
  }, [periodSales])

  const estoque = useMemo(() => {
    type ProdStock = { quantity: number; cost: number }
    const stockByProduct = new Map<string, ProdStock>()

    for (const batch of batches ?? []) {
      const current = stockByProduct.get(batch.product_id) ?? { quantity: 0, cost: 0 }
      const qty = Number(batch.quantity_available ?? 0)
      const uc = Number(batch.unit_cost ?? 0)
      current.quantity += qty
      current.cost += qty * uc
      stockByProduct.set(batch.product_id, current)
    }

    let pecasDisp = 0
    let valorInvestido = 0
    let potencialVenda = 0
    const baixo: Product[] = []
    const semEstoque: Product[] = []

    for (const p of products) {
      const qty = stockByProduct.get(p.id)?.quantity ?? 0
      const custoLote = stockByProduct.get(p.id)?.cost ?? 0
      const venda = Number(p.sale_price ?? 0)
      pecasDisp += qty
      valorInvestido += custoLote
      potencialVenda += qty * venda
      if (qty <= 0) semEstoque.push(p)
      else if (qty <= Number(p.min_stock ?? 0)) baixo.push(p)
    }

    return { pecasDisp, valorInvestido, potencialVenda, baixo, semEstoque, stockByProduct }
  }, [products, batches])

  const pagamentos = useMemo(() => {
    const groups: Record<string, { label: string; count: number; total: number }> = {}
    periodSales.forEach(s => {
      const key = [s.payment_provider_snapshot, s.payment_method_snapshot].filter(Boolean).join(' · ') || 'Sem pagamento'
      if (!groups[key]) groups[key] = { label: key, count: 0, total: 0 }
      groups[key].count += 1
      groups[key].total += Number(s.total_customer ?? 0)
    })
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }, [periodSales])

  const descontosAna = useMemo(() => {
    const cupom = periodSales.reduce((s, v) => s + Number(v.coupon_discount_snapshot ?? 0), 0)
    const pix = periodSales.reduce((s, v) => s + Number(v.pix_discount_total ?? 0), 0)
    const geral = periodSales.reduce((s, v) => s + Number(v.general_discount ?? 0), 0)
    const prod = Math.max(0, kpis.descontos - cupom - pix - geral)
    const total = cupom + pix + geral + prod
    return { cupom, pix, geral, prod, total }
  }, [periodSales, kpis])

  const receitas = periodTrans.filter(t => Number(t.amount ?? 0) > 0).reduce((s, v) => s + Number(v.amount ?? 0), 0)
  const despesas = periodTrans.filter(t => Number(t.amount ?? 0) < 0).reduce((s, v) => s + Math.abs(Number(v.amount ?? 0)), 0)
  const saldoCaixa = receitas - despesas

  const recentSales = [...periodSales].sort((a, b) =>
    new Date(b.sale_date ?? b.created_at).getTime() - new Date(a.sale_date ?? a.created_at).getTime()
  ).slice(0, 8)

  return (
    <div className="space-y-5 pb-4 sm:pb-6">
      {/* Cabeçalho + filtro período */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900">Dashboard</h1>
          <p className="text-sm text-ink-500 mt-0.5">Visão geral de vendas, estoque e financeiro.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative">
            <select
              value={preset}
              onChange={e => setPreset(e.target.value as PresetKey)}
              className="select pr-10"
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
              <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset('PERSONALIZADO') }} className="bg-transparent text-sm outline-none w-[110px]" />
            </div>
            <span className="text-ink-400 text-sm">à</span>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-ink-200">
              <Calendar className="w-4 h-4 text-ink-500" />
              <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset('PERSONALIZADO') }} className="bg-transparent text-sm outline-none w-[110px]" />
            </div>
          </div>
        </div>
      </div>

      {/* KPIs primários */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Faturamento" value={formatCurrency(kpis.faturamento)}
          icon={<DollarSign className="w-5 h-5" />} tone="brand"
          sub={pluralize(kpis.pedidos, 'pedido')} />
        <KpiCard label="Lucro real" value={formatCurrency(kpis.lucro)}
          icon={<TrendingUp className="w-5 h-5" />} tone={kpis.lucro >= 0 ? 'emerald' : 'rose'}
          sub={formatPercent(kpis.margem) + ' margem'} />
        <KpiCard label="Margem %" value={formatPercent(kpis.margem, 1)}
          icon={<Receipt className="w-5 h-5" />} tone="violet"
          sub={kpis.faturamento ? `sobre ${formatCurrency(kpis.faturamento)}` : 'sem vendas'} />
        <KpiCard label="Pedidos" value={String(kpis.pedidos)}
          icon={<ShoppingCart className="w-5 h-5" />} tone="ink"
          sub={`${kpis.pecas} ${pluralize(kpis.pecas, 'peça', 'peças')}`} />
        <KpiCard label="Peças vendidas" value={String(kpis.pecas)}
          icon={<Package className="w-5 h-5" />} tone="blue"
          sub={kpis.pedidos ? `média ${(kpis.pecas / kpis.pedidos).toFixed(1)}/pedido` : '-'} />
        <KpiCard label="Ticket médio" value={formatCurrency(kpis.ticketMedio)}
          icon={<ArrowUpRight className="w-5 h-5" />} tone="amber"
          sub={pluralize(kpis.pedidos, 'pedido considerados')} />
      </div>

      {/* Custos detalhados + Caixa */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-ink-800">Composição dos custos no período</h3>
            <span className="chip bg-ink-100 text-ink-600">
              {loading ? 'Carregando…' : pluralize(periodSales.length, 'venda')}
            </span>
          </div>
          {kpis.faturamento === 0 ? (
            <EmptyStateSmall />
          ) : (
            <div className="space-y-3">
              <CostBar rows={[
                { label: 'Receita (total cliente)', value: kpis.faturamento, tone: 'bg-brand-600', showPercent: true, total: kpis.faturamento },
                { label: 'Custo das mercadorias (FIFO)', value: kpis.custoMerc, tone: 'bg-rose-500', total: kpis.faturamento },
                { label: 'Taxas de pagamento (real)', value: kpis.custoTaxas, tone: 'bg-orange-500', total: kpis.faturamento },
                { label: 'Embalagens (real)', value: kpis.custoEmbalagens, tone: 'bg-violet-500', total: kpis.faturamento },
                { label: 'Frete / custos extras', value: kpis.custoFrete, tone: 'bg-sky-500', total: kpis.faturamento },
                { label: 'Descontos concedidos', value: kpis.descontos, tone: 'bg-amber-500', total: kpis.faturamento },
                { label: 'Lucro real', value: kpis.lucro, tone: kpis.lucro >= 0 ? 'bg-emerald-500' : 'bg-rose-700', total: kpis.faturamento, strong: true },
              ]} />
            </div>
          )}
        </div>

        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-ink-800">Caixa no período</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-700">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs text-emerald-700 font-semibold">Entradas</div>
                  <div className="text-xs text-emerald-600/80">recebimentos</div>
                </div>
              </div>
              <div className="text-lg font-black text-emerald-800 num">{formatCurrency(receitas)}</div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-rose-50 border border-rose-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-700">
                  <ArrowDownRight className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs text-rose-700 font-semibold">Saídas</div>
                  <div className="text-xs text-rose-600/80">pagamentos, compras</div>
                </div>
              </div>
              <div className="text-lg font-black text-rose-800 num">{formatCurrency(despesas)}</div>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-ink-900 to-brand-900 text-white">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">Saldo do período</div>
                <div className="text-[11px] text-white/50 mt-0.5">movimento de caixa</div>
              </div>
              <div className="text-2xl font-black num">{formatCurrency(saldoCaixa)}</div>
            </div>
            <p className="text-[11px] text-ink-500 leading-relaxed">
              Obs: saldo de caixa ≠ lucro. Compras de mercadoria são saída hoje, mas só viram custo na venda.
            </p>
          </div>
        </div>
      </div>

      {/* Pagamentos + Descontos + Estoque */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card p-5">
          <h3 className="font-bold text-ink-800 mb-3">Vendas por pagamento</h3>
          {pagamentos.length === 0 ? <EmptyStateSmall /> : (
            <div className="space-y-2.5">
              {pagamentos.map(pg => {
                const pct = kpis.faturamento ? (pg.total / kpis.faturamento) * 100 : 0
                return (
                  <div key={pg.label}>
                    <div className="flex justify-between items-baseline text-sm mb-1">
                      <span className="font-semibold text-ink-800 truncate">{pg.label}</span>
                      <span className="num text-xs text-ink-500">{pg.count}x · {formatPercent(pct, 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 h-2 rounded-full bg-ink-100 overflow-hidden">
                        <div className="h-full bg-brand-700 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-sm font-bold text-ink-900 num min-w-[80px] text-right">{formatCurrency(pg.total)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-ink-800 mb-3">Descontos concedidos</h3>
          {kpis.descontos === 0 ? <EmptyStateSmall /> : (
            <div className="space-y-3">
              {[
                { k: 'Produto (individual)', v: descontosAna.prod, c: 'bg-amber-500' },
                { k: 'Desconto geral', v: descontosAna.geral, c: 'bg-orange-500' },
                { k: 'Cupom', v: descontosAna.cupom, c: 'bg-violet-500' },
                { k: 'Desconto Pix', v: descontosAna.pix, c: 'bg-sky-500' },
                { k: 'Total descontos', v: descontosAna.total, c: 'bg-rose-600', strong: true },
              ].map(r => (
                <div key={r.k} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={cn('w-2.5 h-2.5 rounded-full', r.c)} />
                    <span className={cn('text-sm', r.strong ? 'font-bold text-ink-900' : 'text-ink-700')}>{r.k}</span>
                  </div>
                  <span className={cn('num', r.strong ? 'text-sm font-black text-rose-700' : 'text-sm font-semibold text-ink-800')}>
                    {formatCurrency(r.v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-ink-800">Resumo de estoque</h3>
              {loading && (
                <span className="chip bg-ink-100 text-ink-500 animate-pulse">Atualizando…</span>
              )}
            </div>
            <Link to="/estoque" className="text-xs font-semibold text-brand-700 hover:underline">Ver tudo →</Link>
          </div>

          {loadError && !loading && (
            <div className="mb-4 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold">Erro ao carregar estoque</div>
              <div className="mt-0.5 opacity-90 break-words">{loadError}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <MiniKpi label="Peças disponíveis" value={String(estoque.pecasDisp)} />
            <MiniKpi label="Custo do estoque" value={formatCurrency(estoque.valorInvestido)} />
            <MiniKpi label="Potencial de venda" value={formatCurrency(estoque.potencialVenda)} />
            <MiniKpi label="SKUs cadastrados" value={String(products.length)} />
          </div>

          {!loading && !loadError ? (
            <>
              {(estoque.baixo.length || estoque.semEstoque.length) ? (
                <div className="space-y-2.5">
                  {estoque.semEstoque.length > 0 && (
                    <AlertBlock
                      icon={<AlertTriangle className="w-4 h-4" />}
                      tone="rose"
                      title={`${estoque.semEstoque.length} ${pluralize(estoque.semEstoque.length, 'produto', 'produtos')} sem estoque`}
                      items={estoque.semEstoque.slice(0, 3).map(p => ({ t: p.name, s: 'Estoque: 0' }))}
                    />
                  )}
                  {estoque.baixo.length > 0 && (
                    <AlertBlock
                      icon={<AlertTriangle className="w-4 h-4" />}
                      tone="amber"
                      title={`${estoque.baixo.length} ${pluralize(estoque.baixo.length, 'produto', 'produtos')} com estoque baixo`}
                      items={estoque.baixo.slice(0, 3).map(p => {
                        const qty = estoque.stockByProduct.get(p.id)?.quantity ?? 0
                        return { t: p.name, s: `${qty} un. · min ${Number(p.min_stock ?? 0)}` }
                      })}
                    />
                  )}
                </div>
              ) : <EmptyStateSmall text="Estoque saudável, sem alertas." />}
            </>
          ) : loading && (
            <div className="space-y-2">
              <div className="h-10 rounded-lg bg-ink-100 animate-pulse" />
              <div className="h-8 rounded-lg bg-ink-100 animate-pulse w-3/4" />
            </div>
          )}
        </div>
      </div>

      {/* Vendas recentes */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-ink-800">Vendas recentes</h3>
            <p className="text-xs text-ink-500 mt-0.5">Últimas vendas concluídas no período selecionado.</p>
          </div>
          <Link to="/vendas" className="btn-secondary !py-2 text-xs">
            Histórico completo
          </Link>
        </div>
        {recentSales.length === 0 ? (
          <EmptyStateSmall text="Sem vendas no período. Clique em Nova Venda para começar." />
        ) : (
          <div className="table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Data</th>
                  <th>Origem</th>
                  <th>Pagamento</th>
                  <th className="text-right">Peças</th>
                  <th className="text-right">Total cliente</th>
                  <th className="text-right">Lucro</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map(s => {
                  const st = statusLabel(s.status)
                  return (
                    <tr key={s.id} className="hover:bg-ink-50/50 transition">
                      <td className="font-bold num">
                        <Link to={`/vendas/${s.id}`} className="text-brand-800 hover:underline">
                          #{String(s.friendly_number ?? '')}
                        </Link>
                      </td>
                      <td className="text-ink-700 num">{formatDate(s.sale_date ?? s.created_at, true)}</td>
                      <td>
                        <span className="chip bg-ink-100 text-ink-700">{sourceLabel(s.source_snapshot)}</span>
                      </td>
                      <td className="text-ink-700 text-sm">
                        {[s.payment_provider_snapshot, paymentMethodLabel(s.payment_method_snapshot),
                          (s.installments_snapshot ?? 1) > 1 ? `${s.installments_snapshot}x` : null]
                          .filter(Boolean).join(' · ') || '-'}
                      </td>
                      <td className="text-right num font-semibold">{String(Number(s.total_items ?? 0))}</td>
                      <td className="text-right num font-bold text-ink-900">{formatCurrency(s.total_customer)}</td>
                      <td className={cn('text-right num font-bold', Number(s.real_profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                        {formatCurrency(s.real_profit)}
                      </td>
                      <td className="text-right"><span className={st.class}>{st.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ============ Componentes internos ============ */
function KpiCard({ label, value, sub, icon, tone }:
  { label: string; value: string; sub?: string; icon: React.ReactNode; tone: 'brand' | 'emerald' | 'rose' | 'violet' | 'ink' | 'blue' | 'amber' }) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    ink: 'bg-ink-100 text-ink-700 ring-ink-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
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

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-ink-50 border border-ink-100">
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-base font-black text-ink-900 num mt-0.5">{value}</div>
    </div>
  )
}

function CostBar({ rows }: { rows: Array<{ label: string; value: number; tone: string; total: number; showPercent?: boolean; strong?: boolean }> }) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const pct = r.total ? Math.min(100, Math.abs(r.value) / r.total * 100) : 0
        return (
          <div key={i}>
            <div className={cn('flex justify-between items-baseline mb-1', r.strong && 'pt-2 border-t border-ink-100 mt-2')}>
              <span className={cn(r.strong ? 'font-bold text-ink-900' : 'text-sm font-semibold text-ink-700')}>{r.label}</span>
              <div className="flex items-baseline gap-2">
                {r.showPercent && <span className="text-xs text-ink-400 num">{formatPercent(100, 0)}</span>}
                <span className={cn('num', r.strong ? 'text-base font-black text-ink-900' : 'text-sm font-bold text-ink-900')}>
                  {formatCurrency(r.value)}
                </span>
                {r.showPercent ? null : <span className="text-[11px] num text-ink-500">{formatPercent(pct, 0)}</span>}
              </div>
            </div>
            <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', r.tone)} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EmptyStateSmall({ text = 'Sem dados para o período.' }: { text?: string }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center text-center">
      <Filter className="w-8 h-8 text-ink-300 mb-2" />
      <p className="text-sm text-ink-500">{text}</p>
    </div>
  )
}

function AlertBlock({ icon, title, items, tone }:
  { icon: React.ReactNode; title: string; items: { t: string; s: string }[]; tone: 'rose' | 'amber' }) {
  const cls = tone === 'rose'
    ? 'bg-rose-50 border-rose-100 text-rose-800'
    : 'bg-amber-50 border-amber-100 text-amber-800'
  const icn = tone === 'rose' ? 'text-rose-600' : 'text-amber-600'
  return (
    <div className={cn('p-3 rounded-lg border', cls)}>
      <div className="flex items-start gap-2.5">
        <div className={cn('mt-0.5', icn)}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold mb-1.5">{title}</div>
          <ul className="space-y-1">
            {items.map((it, i) => (
              <li key={i} className="text-[11px]">
                <span className="font-semibold truncate inline-block align-bottom max-w-[60%]">{it.t}</span>
                <span className="opacity-70 mx-1">·</span>
                <span className="opacity-80 num">{it.s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
