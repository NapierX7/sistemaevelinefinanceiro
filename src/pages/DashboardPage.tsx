import { useEffect, useMemo, useState } from 'react'
import {
  Calendar, DollarSign, TrendingUp, Package, ShoppingCart, Receipt,
  ArrowUpRight, ArrowDownRight, Filter, AlertTriangle, ChevronDown, AlertCircle,
  CreditCard, Wallet, Clock
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, rangePresets,
  statusLabel, sourceLabel, paymentMethodLabel, pluralize, cn
} from '@/lib/format'
import {
  dashboardStockSummary, dashboardSales, dashboardFinancial,
  listSalePaymentsBySaleIds
} from '@/services'
import type {
  DashboardStockSummary, DashboardSaleRow, DashboardFinancialRow,
  SalePayment, UUID
} from '@/types/supabase'
import { Link } from 'react-router-dom'

type PresetKey = keyof ReturnType<typeof rangePresets> | 'PERSONALIZADO'

export default function DashboardPage() {
  const presets = rangePresets()
  const [preset, setPreset] = useState<PresetKey>('ESTE_MES')
  const [from, setFrom] = useState<string>(presets.ESTE_MES.from.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(presets.ESTE_MES.to.toISOString().slice(0, 10))

  const [stock, setStock] = useState<DashboardStockSummary | null>(null)
  const [salesRows, setSalesRows] = useState<DashboardSaleRow[]>([])
  const [finRows, setFinRows] = useState<DashboardFinancialRow[]>([])
  const [salePayments, setSalePayments] = useState<SalePayment[]>([])

  const [loadingStock, setLoadingStock] = useState(true)
  const [loadingSales, setLoadingSales] = useState(true)
  const [loadingFin, setLoadingFin] = useState(true)
  const [loadingPayments, setLoadingPayments] = useState(false)

  const [stockError, setStockError] = useState<string | null>(null)
  const [salesError, setSalesError] = useState<string | null>(null)
  const [finError, setFinError] = useState<string | null>(null)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)

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
    let cancelled = false
    setLoadingStock(true); setStockError(null)
    dashboardStockSummary()
      .then(d => { if (!cancelled) setStock(d) })
      .catch(err => {
        console.error('[Dashboard] estoque view falhou:', err)
        if (!cancelled) setStockError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingStock(false) })
    return () => { cancelled = true }
  }, [loadTick])

  useEffect(() => {
    let cancelled = false
    setLoadingSales(true); setSalesError(null)
    dashboardSales({ startInclusive: from, endInclusive: to })
      .then(d => { if (!cancelled) setSalesRows(d) })
      .catch(err => {
        console.error('[Dashboard] vendas view falhou:', err)
        if (!cancelled) setSalesError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingSales(false) })
    return () => { cancelled = true }
  }, [from, to, loadTick])

  useEffect(() => {
    let cancelled = false
    setLoadingFin(true); setFinError(null)
    dashboardFinancial({ startInclusive: from, endInclusive: to })
      .then(d => { if (!cancelled) setFinRows(d) })
      .catch(err => {
        console.error('[Dashboard] financeiro view falhou:', err)
        if (!cancelled) setFinError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingFin(false) })
    return () => { cancelled = true }
  }, [from, to, loadTick])

  useEffect(() => {
    let cancelled = false
    const ids: UUID[] = salesRows
      .map(r => (r as any).sale_id ?? (r as any).id)
      .filter(Boolean) as UUID[]
    if (ids.length === 0) {
      setSalePayments([])
      setPaymentsError(null)
      setLoadingPayments(false)
      return
    }
    setLoadingPayments(true)
    setPaymentsError(null)
    listSalePaymentsBySaleIds(ids)
      .then(arr => { if (!cancelled) setSalePayments(arr) })
      .catch(err => {
        console.error('[Dashboard] sale_payments por ids falhou:', err)
        if (!cancelled) setPaymentsError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingPayments(false) })
    return () => { cancelled = true }
  }, [salesRows])

  const kpis = useMemo(() => {
    const rows = salesRows
    const faturamento = rows.reduce((s, v) => s + Number(v.revenue ?? 0), 0)
    const recebido = rows.reduce((s, v) => s + Number(v.amount_received ?? 0), 0)
    const aReceber = rows.reduce((s, v) => s + Number(v.amount_receivable ?? 0), 0)

    const custoMerc = rows.reduce((s, v) => s + Number(v.items_cost ?? 0), 0)
    const custoAlloc = rows.reduce((s, v) => s + Number(v.allocated_purchase_cost ?? 0), 0)
    const custoFrete = rows.reduce((s, v) => s + Number(v.extra_costs ?? 0), 0)
    const custoTaxas = rows.reduce((s, v) => s + Number(v.payment_fees ?? 0), 0)
    const custoEmbalagens = rows.reduce((s, v) => s + Number(v.packaging_cost ?? 0), 0)
    const descontos = rows.reduce((s, v) => s + Number(v.total_discounts ?? 0), 0)

    const saidasVenda = custoMerc + custoAlloc + custoFrete + custoTaxas + custoEmbalagens + descontos
    const lucro = faturamento - saidasVenda
    const pedidos = rows.length
    const pecas = rows.reduce((s, v) => s + Number(v.pieces_sold ?? 0), 0)
    const ticketMedio = pedidos ? faturamento / pedidos : 0
    const margem = faturamento ? (lucro / faturamento) * 100 : 0

    return {
      faturamento, recebido, aReceber,
      lucro, margem, pedidos, pecas, ticketMedio,
      custoMerc, custoAlloc, custoFrete, custoTaxas, custoEmbalagens, descontos
    }
  }, [salesRows])

  const pagamentos = useMemo(() => {
    const paymentsBySale = new Map<string, SalePayment[]>()
    for (const p of salePayments) {
      if (!paymentsBySale.has(p.sale_id)) paymentsBySale.set(p.sale_id, [])
      paymentsBySale.get(p.sale_id)!.push(p)
    }
    const groups: Record<string, { label: string; count: number; total: number }> = {}

    for (const r of salesRows) {
      const saleId: string | undefined = (r as any).sale_id ?? (r as any).id
      const received = Number(r.amount_received ?? 0)
      const list = saleId ? paymentsBySale.get(saleId) ?? [] : []
      if (list.length === 0) {
        let key = 'Sem pagamento'
        if (received > 0) key = 'Recebido (outros)'
        if (!groups[key]) groups[key] = { label: key, count: 0, total: 0 }
        groups[key].count += 1
        groups[key].total += received > 0 ? received : Number(r.revenue ?? 0)
        continue
      }
      for (const sp of list) {
        const methodParts: string[] = []
        const prov = sp.provider_snapshot ?? (sp as any).provider ?? null
        const met = sp.method ?? (sp as any).payment_method_snapshot ?? null
        if (prov) methodParts.push(String(prov))
        if (met) methodParts.push(paymentMethodLabel(String(met)))
        const mod: any = (sp as any).modality_snapshot ?? (sp as any).modality
        if (mod && (!met || String(mod) !== String(met))) methodParts.push(String(mod))
        const parc = Number((sp as any).installments ?? 1)
        if (parc > 1) methodParts.push(`${parc}x`)
        const key = methodParts.length ? methodParts.join(' · ') : 'Outro'
        if (!groups[key]) groups[key] = { label: key, count: 0, total: 0 }
        groups[key].count += 1
        groups[key].total += Number(sp.amount ?? 0)
      }
    }
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }, [salesRows, salePayments])

  const { receitas, despesas, saldoCaixa } = useMemo(() => {
    let r = 0, d = 0
    for (const t of finRows) {
      if (t.status !== 'CONFIRMADO') continue
      const amt = Number(t.amount ?? 0)
      if (t.trans_type === 'ENTRADA' && amt > 0) r += amt
      if (t.trans_type === 'SAIDA') d += Math.max(0, Math.abs(amt))
    }
    return { receitas: r, despesas: d, saldoCaixa: r - d }
  }, [finRows])

  const recentSales = [...salesRows].slice(0, 8)
  const loadingAny = loadingStock || loadingSales || loadingFin || loadingPayments

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
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard label="Faturamento" value={salesError ? 'Erro' : formatCurrency(kpis.faturamento)}
          icon={<DollarSign className="w-5 h-5" />} tone={salesError ? 'rose' : 'brand'}
          sub={salesError ? salesError.slice(0, 30) : pluralize(kpis.pedidos, 'pedido')} />
        <KpiCard label="Recebido" value={salesError ? 'Erro' : formatCurrency(kpis.recebido)}
          icon={<Wallet className="w-5 h-5" />} tone={salesError ? 'rose' : 'emerald'}
          sub={salesError ? '-' : 'confirmado nas vendas'} />
        <KpiCard label="A receber" value={salesError ? 'Erro' : formatCurrency(kpis.aReceber)}
          icon={<Clock className="w-5 h-5" />} tone={salesError ? 'rose' : 'amber'}
          sub={salesError ? '-' : (kpis.aReceber > 0 ? 'pendente de entrada' : 'em dia')} />
        <KpiCard label="Lucro real" value={salesError ? 'Erro' : formatCurrency(kpis.lucro)}
          icon={<TrendingUp className="w-5 h-5" />} tone={salesError ? 'rose' : (kpis.lucro >= 0 ? 'emerald' : 'rose')}
          sub={salesError ? 'Consulte o log' : formatPercent(kpis.margem) + ' margem'} />
        <KpiCard label="Margem %" value={salesError ? 'Erro' : formatPercent(kpis.margem, 1)}
          icon={<Receipt className="w-5 h-5" />} tone={salesError ? 'rose' : 'violet'}
          sub={salesError ? '-' : (kpis.faturamento ? `sobre ${formatCurrency(kpis.faturamento)}` : 'sem vendas')} />
        <KpiCard label="Pedidos" value={salesError ? 'Erro' : String(kpis.pedidos)}
          icon={<ShoppingCart className="w-5 h-5" />} tone={salesError ? 'rose' : 'ink'}
          sub={salesError ? '-' : `${kpis.pecas} ${pluralize(kpis.pecas, 'peça', 'peças')}`} />
        <KpiCard label="Peças vendidas" value={salesError ? 'Erro' : String(kpis.pecas)}
          icon={<Package className="w-5 h-5" />} tone={salesError ? 'rose' : 'blue'}
          sub={salesError ? '-' : (kpis.pedidos ? `média ${(kpis.pecas / kpis.pedidos).toFixed(1)}/pedido` : '-')} />
        <KpiCard label="Ticket médio" value={salesError ? 'Erro' : formatCurrency(kpis.ticketMedio)}
          icon={<ArrowUpRight className="w-5 h-5" />} tone={salesError ? 'rose' : 'amber'}
          sub={salesError ? '-' : pluralize(kpis.pedidos, 'pedido considerados')} />
      </div>

      {/* Custos detalhados + Caixa */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-ink-800">Composição dos custos no período</h3>
            <span className="chip bg-ink-100 text-ink-600">
              {loadingSales ? 'Carregando…' : pluralize(salesRows.length, 'venda')}
            </span>
          </div>

          {salesError && (
            <div className="mb-3 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Erro ao carregar vendas</div>
              <div className="mt-0.5 opacity-90 break-words">{salesError}</div>
            </div>
          )}

          {loadingSales ? (
            <div className="space-y-3 pt-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i}>
                  <div className="flex justify-between mb-1">
                    <div className="h-3.5 w-40 bg-ink-100 rounded animate-pulse" />
                    <div className="h-3.5 w-20 bg-ink-100 rounded animate-pulse" />
                  </div>
                  <div className="h-2 rounded-full bg-ink-100 animate-pulse" />
                </div>
              ))}
            </div>
          ) : kpis.faturamento === 0 ? (
            <EmptyStateSmall />
          ) : (
            <div className="space-y-3">
              <CostBar rows={[
                { label: 'Receita (total cliente)', value: kpis.faturamento, tone: 'bg-brand-600', showPercent: true, total: kpis.faturamento },
                { label: 'Custo das mercadorias (FIFO)', value: kpis.custoMerc, tone: 'bg-rose-500', total: kpis.faturamento },
                kpis.custoAlloc > 0
                  ? { label: 'Rateio compras (impostos/frete)', value: kpis.custoAlloc, tone: 'bg-rose-400', total: kpis.faturamento }
                  : null,
                { label: 'Taxas de pagamento (real)', value: kpis.custoTaxas, tone: 'bg-orange-500', total: kpis.faturamento },
                { label: 'Embalagens (real)', value: kpis.custoEmbalagens, tone: 'bg-violet-500', total: kpis.faturamento },
                { label: 'Frete / custos extras', value: kpis.custoFrete, tone: 'bg-sky-500', total: kpis.faturamento },
                { label: 'Descontos concedidos', value: kpis.descontos, tone: 'bg-amber-500', total: kpis.faturamento },
                { label: 'Lucro real', value: kpis.lucro, tone: kpis.lucro >= 0 ? 'bg-emerald-500' : 'bg-rose-700', total: kpis.faturamento, strong: true },
              ].filter(Boolean) as any} />
            </div>
          )}
        </div>

        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-ink-800">Caixa no período</h3>
          {finError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Erro ao carregar caixa</div>
              <div className="mt-0.5 opacity-90 break-words">{finError}</div>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-700">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs text-emerald-700 font-semibold">Entradas</div>
                  <div className="text-xs text-emerald-600/80">recebimentos confirmados</div>
                </div>
              </div>
              <div className="text-lg font-black text-emerald-800 num">
                {finError ? '—' : formatCurrency(receitas)}
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-rose-50 border border-rose-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-700">
                  <ArrowDownRight className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs text-rose-700 font-semibold">Saídas</div>
                  <div className="text-xs text-rose-600/80">pagamentos, compras, despesas</div>
                </div>
              </div>
              <div className="text-lg font-black text-rose-800 num">
                {finError ? '—' : formatCurrency(despesas)}
              </div>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-ink-900 to-brand-900 text-white">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">Saldo do período</div>
                <div className="text-[11px] text-white/50 mt-0.5">apenas confirmados</div>
              </div>
              <div className="text-2xl font-black num">{finError ? '—' : formatCurrency(saldoCaixa)}</div>
            </div>
            <p className="text-[11px] text-ink-500 leading-relaxed">
              Obs: saldo de caixa ≠ lucro. Compras de mercadoria são saída hoje, mas só viram custo na venda.
              Movimentações PENDENTES não entram no caixa.
            </p>
          </div>
        </div>
      </div>

      {/* Pagamentos + Descontos + Estoque */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-ink-800">Vendas por pagamento</h3>
              {loadingPayments && (
                <span className="chip bg-ink-100 text-ink-500 animate-pulse">Atualizando…</span>
              )}
            </div>
          </div>
          {paymentsError && (
            <div className="mb-3 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Erro ao detalhar pagamentos</div>
              <div className="mt-0.5 opacity-90 break-words">{paymentsError}</div>
            </div>
          )}
          {loadingSales || (loadingPayments && salePayments.length === 0 && !paymentsError) ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <div className="flex justify-between mb-1">
                    <div className="h-3.5 w-40 bg-ink-100 rounded animate-pulse" />
                    <div className="h-3.5 w-16 bg-ink-100 rounded animate-pulse" />
                  </div>
                  <div className="h-2 rounded-full bg-ink-100 animate-pulse" />
                </div>
              ))}
            </div>
          ) : pagamentos.length === 0 ? (
            <EmptyStateSmall />
          ) : (
            <div className="space-y-2.5">
              {pagamentos.map(pg => {
                const denom = kpis.recebido > 0 ? kpis.recebido : kpis.faturamento
                const pct = denom ? (pg.total / denom) * 100 : 0
                return (
                  <div key={pg.label}>
                    <div className="flex justify-between items-baseline text-sm mb-1">
                      <span className="font-semibold text-ink-800 truncate flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-ink-400" />{pg.label}
                      </span>
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
          <h3 className="font-bold text-ink-800 mb-3">Descontos & Taxas</h3>
          {loadingSales ? (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-4 bg-ink-100 rounded animate-pulse w-full" />
              ))}
            </div>
          ) : kpis.descontos === 0 && kpis.custoTaxas === 0 && kpis.custoEmbalagens === 0 && kpis.custoFrete === 0 ? (
            <EmptyStateSmall />
          ) : (
            <div className="space-y-3">
              {[
                kpis.descontos > 0 ? { k: 'Descontos concedidos', v: kpis.descontos, c: 'bg-rose-600', strong: true } : null,
                kpis.custoTaxas > 0 ? { k: 'Taxas de pagamento', v: kpis.custoTaxas, c: 'bg-orange-600', strong: false } : null,
                kpis.custoEmbalagens > 0 ? { k: 'Embalagens (rateadas)', v: kpis.custoEmbalagens, c: 'bg-violet-600', strong: false } : null,
                kpis.custoFrete > 0 ? { k: 'Frete / extras', v: kpis.custoFrete, c: 'bg-sky-600', strong: false } : null,
              ].filter(Boolean).map((r: any) => (
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
              {loadingStock && (
                <span className="chip bg-ink-100 text-ink-500 animate-pulse">Atualizando…</span>
              )}
            </div>
            <Link to="/estoque" className="text-xs font-semibold text-brand-700 hover:underline">Ver tudo →</Link>
          </div>

          {stockError && (
            <div className="mb-4 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Erro ao carregar estoque</div>
              <div className="mt-0.5 opacity-90 break-words">{stockError}</div>
            </div>
          )}

          {loadingStock ? (
            <div className="space-y-2.5 mb-4">
              <div className="grid grid-cols-2 gap-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="p-3 rounded-lg bg-ink-50 border border-ink-100">
                    <div className="h-2.5 w-24 bg-ink-200 rounded animate-pulse" />
                    <div className="h-5 w-16 bg-ink-200 rounded mt-1 animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ) : stockError ? null : (
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <MiniKpi label="Peças disponíveis" value={String(stock?.total_units ?? 0)} />
              <MiniKpi label="Custo do estoque" value={formatCurrency(stock?.total_stock_cost ?? 0)} />
              <MiniKpi label="Potencial de venda" value={formatCurrency(stock?.total_sales_potential ?? 0)} />
              <MiniKpi label="SKUs cadastrados" value={String(stock?.total_skus ?? 0)} />
              <MiniKpi label="Com estoque" value={String(stock?.in_stock_skus ?? 0)} />
              <MiniKpi label="Sem estoque" value={String(stock?.out_of_stock_skus ?? 0)} />
            </div>
          )}

          {!loadingStock && !stockError && stock && (
            <>
              {stock.out_of_stock_skus > 0 ? (
                <div className="space-y-2.5">
                  <AlertBlock
                    icon={<AlertTriangle className="w-4 h-4" />}
                    tone="rose"
                    title={`${stock.out_of_stock_skus} ${pluralize(stock.out_of_stock_skus, 'produto', 'produtos')} sem estoque · ${stock.in_stock_skus ?? 0} ${pluralize(Number(stock.in_stock_skus ?? 0), 'com', 'com')}`}
                    items={[]}
                  />
                </div>
              ) : <EmptyStateSmall text="Estoque saudável, sem alertas." />}
            </>
          )}
        </div>
      </div>

      {/* Vendas recentes */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-ink-800">Vendas recentes</h3>
            <p className="text-xs text-ink-500 mt-0.5">Últimas vendas no período selecionado.</p>
          </div>
          <Link to="/vendas" className="btn-secondary !py-2 text-xs">
            Histórico completo
          </Link>
        </div>

        {salesError && (
          <div className="mb-3 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
            <div className="font-bold">Erro ao carregar histórico de vendas</div>
            <div className="mt-0.5 opacity-90 break-words">{salesError}</div>
          </div>
        )}

        {loadingSales ? (
          <div className="table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Nº</th><th>Data</th><th>Origem</th><th>Cliente</th><th>Pagamento</th>
                  <th className="text-right">Peças</th><th className="text-right">Total</th>
                  <th className="text-right">Recebido</th><th className="text-right">A receber</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j}>
                        <div className="h-4 bg-ink-100 rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : recentSales.length === 0 ? (
          <EmptyStateSmall text="Sem vendas no período. Clique em Nova Venda para começar." />
        ) : (
          <div className="table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Data</th>
                  <th>Origem</th>
                  <th>Cliente</th>
                  <th>Pagamento</th>
                  <th className="text-right">Peças</th>
                  <th className="text-right">Total cliente</th>
                  <th className="text-right">Recebido</th>
                  <th className="text-right">A receber</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map(r => {
                  const st = statusLabel(r.status ?? 'PENDENTE')
                  return (
                    <tr key={r.sale_id ?? (r as any).id} className="hover:bg-ink-50/50 transition">
                      <td className="font-bold num">
                        {r.sale_id
                          ? <Link to={`/vendas/${r.sale_id}`} className="text-brand-800 hover:underline">#{String(r.friendly_number ?? '')}</Link>
                          : <span className="text-brand-800">#{String(r.friendly_number ?? '')}</span>
                        }
                      </td>
                      <td className="text-ink-700 num">{formatDate(r.sale_date, true)}</td>
                      <td>
                        <span className="chip bg-ink-100 text-ink-700">{sourceLabel(r.source_snapshot)}</span>
                      </td>
                      <td className="text-ink-700 text-sm max-w-[160px] truncate">{r.customer_name || <span className="italic text-ink-400">Não identificado</span>}</td>
                      <td className="text-ink-700 text-sm">
                        {[r.payment_provider_snapshot, paymentMethodLabel(r.payment_method_snapshot),
                          (Number(r.installments_snapshot ?? 1) > 1) ? `${r.installments_snapshot}x` : null]
                          .filter(Boolean).join(' · ') || (Number(r.amount_received ?? 0) > 0 ? 'Recebido' : '-')}
                      </td>
                      <td className="text-right num font-semibold">{String(Number(r.pieces_sold ?? 0))}</td>
                      <td className="text-right num font-bold text-ink-900">{formatCurrency(r.revenue)}</td>
                      <td className="text-right num text-emerald-700 font-semibold">{formatCurrency(r.amount_received)}</td>
                      <td className={cn('text-right num font-semibold', Number(r.amount_receivable ?? 0) > 0 ? 'text-amber-700' : 'text-ink-400')}>
                        {formatCurrency(r.amount_receivable ?? 0)}
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
