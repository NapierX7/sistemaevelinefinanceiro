import { useEffect, useMemo, useState } from 'react'
import {
  DollarSign, TrendingUp, Wallet, ArrowUpRight, ArrowDownRight,
  Calendar, ChevronDown, Filter, Plus, X, Trash2, AlertCircle,
  ShoppingBag, Gift, Tag, ScrollText, Sparkles, Wrench, Truck, Megaphone, MoreHorizontal,
  CreditCard, Clock
} from 'lucide-react'
import {
  formatCurrency, formatDate, rangePresets, inRange,
  cn, pluralize, paymentMethodLabel, parseBrl, toInputDate
} from '@/lib/format'
import {
  dashboardSales, dashboardFinancial, registrarDespesa,
  onInvalidate, dispatchInvalidate
} from '@/services'
import type { DashboardSaleRow, DashboardFinancialRow } from '@/types/supabase'
import type { RegistrarDespesaParams } from '@/services'

type PresetKey = keyof ReturnType<typeof rangePresets> | 'PERSONALIZADO'

export default function FinancePage() {
  const presets = rangePresets()
  const [preset, setPreset] = useState<PresetKey>('ESTE_MES')
  const [from, setFrom] = useState<string>(presets.ESTE_MES.from.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(presets.ESTE_MES.to.toISOString().slice(0, 10))
  const [transactions, setTransactions] = useState<DashboardFinancialRow[]>([])
  const [salesRows, setSalesRows] = useState<DashboardSaleRow[]>([])
  const [loadingSales, setLoadingSales] = useState(true)
  const [loadingFin, setLoadingFin] = useState(true)
  const [salesError, setSalesError] = useState<string | null>(null)
  const [finError, setFinError] = useState<string | null>(null)
  const [modalDespesaOpen, setModalDespesaOpen] = useState(false)

  useEffect(() => {
    if (preset !== 'PERSONALIZADO') {
      const p = presets[preset as Exclude<PresetKey, 'PERSONALIZADO'>]
      setFrom(p.from.toISOString().slice(0, 10))
      setTo(p.to.toISOString().slice(0, 10))
    }
  }, [preset])

  const load = async () => {
    setLoadingSales(true); setLoadingFin(true); setSalesError(null); setFinError(null)
    try {
      const [fin, sales] = await Promise.all([
        dashboardFinancial({ startInclusive: from, endInclusive: to }),
        dashboardSales({ startInclusive: from, endInclusive: to })
      ])
      setTransactions(fin); setSalesRows(sales)
    } catch (e) { /* each individual service set its own errors via throw - capture per call below */ }
    finally { setLoadingSales(false); setLoadingFin(false) }
  }

  useEffect(() => {
    let cancelled = false
    setLoadingSales(true); setSalesError(null)
    dashboardSales({ startInclusive: from, endInclusive: to })
      .then(d => { if (!cancelled) setSalesRows(d) })
      .catch(err => {
        console.error('[Finance] vendas view falhou:', err)
        if (!cancelled) setSalesError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingSales(false) })
    return () => { cancelled = true }
  }, [from, to])

  useEffect(() => {
    let cancelled = false
    setLoadingFin(true); setFinError(null)
    dashboardFinancial({ startInclusive: from, endInclusive: to })
      .then(d => { if (!cancelled) setTransactions(d) })
      .catch(err => {
        console.error('[Finance] financeiro view falhou:', err)
        if (!cancelled) setFinError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingFin(false) })
    return () => { cancelled = true }
  }, [from, to])

  // Hook refresh global (quando usuário finaliza venda em NovaVenda, ou cancela em outra página)
  useEffect(() => {
    const cleanup = onInvalidate((scope) => {
      if (scope === 'all' || scope === 'financial' || scope === 'sales' || scope === 'dashboard') {
        setSalesError(null); setFinError(null)
        setLoadingSales(true); setLoadingFin(true)
        Promise.allSettled([
          dashboardSales({ startInclusive: from, endInclusive: to }),
          dashboardFinancial({ startInclusive: from, endInclusive: to })
        ]).then(([salesRes, finRes]) => {
          if (salesRes.status === 'fulfilled') setSalesRows(salesRes.value)
          else { setSalesError(String(salesRes.reason?.message ?? salesRes.reason)) ; console.error(salesRes.reason) }
          if (finRes.status === 'fulfilled') setTransactions(finRes.value)
          else { setFinError(String(finRes.reason?.message ?? finRes.reason)) ; console.error('[fin error]') }
        }).finally(() => { setLoadingSales(false); setLoadingFin(false) })
      }
    })
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const periodSales = salesRows // já vem filtrado pela view no período
  const periodTrans = transactions // já vem filtrado pela view no período

  const kpis = useMemo(() => {
    const faturamento = periodSales.reduce((s, v) => s + Number(v.revenue ?? 0), 0)
    const recebido = periodSales.reduce((s, v) => s + Number(v.amount_received ?? 0), 0)
    const aReceber = periodSales.reduce((s, v) => s + Number(v.amount_receivable ?? 0), 0)

    const custoMerc = periodSales.reduce((s, v) => s + Number(v.items_cost ?? 0), 0)
    const custoAlloc = periodSales.reduce((s, v) => s + Number(v.allocated_purchase_cost ?? 0), 0)
    const custoEmbalagens = periodSales.reduce((s, v) => s + Number(v.packaging_cost ?? 0), 0)
    const custoFrete = periodSales.reduce((s, v) => s + Number(v.extra_costs ?? 0), 0)
    const custoTaxas = periodSales.reduce((s, v) => s + Number(v.payment_fees ?? 0), 0)
    const descontos = periodSales.reduce((s, v) => s + Number(v.total_discounts ?? 0), 0)
    const lucro = faturamento - (custoMerc + custoAlloc + custoEmbalagens + custoFrete + custoTaxas + descontos)

    const entradas = periodTrans
      .filter(t => t.status === 'CONFIRMADO' && t.trans_type === 'ENTRADA')
      .reduce((s, v) => s + (Number(v.amount ?? 0) > 0 ? Number(v.amount ?? 0) : 0), 0)
    const saidas = periodTrans
      .filter(t => t.status === 'CONFIRMADO' && t.trans_type === 'SAIDA')
      .reduce((s, v) => s + Math.abs(Number(v.amount ?? 0)), 0)
    const saldo = entradas - saidas
    return { faturamento, recebido, aReceber, lucro, entradas, saidas, saldo }
  }, [periodSales, periodTrans])

  const catLabel = (c: string | null) => {
    if (!c) return 'Outros'
    const map: Record<string, string> = {
      VENDA: 'Venda',
      COMPRA_ESTOQUE: 'Compra estoque',
      FRETE: 'Frete',
      TAXA: 'Taxa',
      EMBALAGEM: 'Embalagem',
      ENTREGA: 'Entrega',
      OUTRA_RECEITA: 'Outra receita',
      OUTRA_DESPESA: 'Outra despesa',
      SACOLAS: 'Sacolas',
      ETIQUETAS: 'Etiquetas',
      PAPEL_SEDA: 'Papel seda',
      PERFUMARIA: 'Perfumaria / Cheirinho',
      MATERIAL: 'Material',
      MARKETING: 'Marketing',
      OUTROS: 'Outros',
    }
    return map[c] || c
  }

  const loadingAny = loadingSales || loadingFin

  return (
    <div className="page-wrap pb-4 sm:pb-6">
      <header className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Financeiro</h1>
            <p className="page-subtitle">Faturamento, lucro e fluxo de caixa — usando as views oficiais.</p>
          </div>
          <button onClick={() => setModalDespesaOpen(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Lançar despesa
          </button>
        </div>
        <div className="filter-row">
          <div className="relative w-full sm:w-auto sm:flex-shrink-0">
            <select
              value={preset}
              onChange={e => setPreset(e.target.value as PresetKey)}
              className="select pr-10 w-full sm:min-w-[160px]"
            >
              {Object.entries(presets).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
              <option value="PERSONALIZADO">Personalizado</option>
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          </div>
          <div className="flex gap-2 items-center flex-wrap w-full sm:w-auto sm:flex-shrink-0">
            <div className="flex items-center gap-1.5 px-3 rounded-card bg-white border border-ink-200 min-w-0 flex-1 sm:flex-shrink-0" style={{ minHeight: 44 }}>
              <Calendar className="w-4 h-4 text-ink-500 flex-shrink-0" />
              <input type="date" value={from}
                onChange={e => { setFrom(e.target.value); setPreset('PERSONALIZADO') }}
                className="bg-transparent text-sm outline-none w-full sm:w-[110px]" />
            </div>
            <span className="text-ink-400 text-sm hidden sm:inline">à</span>
            <div className="flex items-center gap-1.5 px-3 rounded-card bg-white border border-ink-200 min-w-0 flex-1 sm:flex-shrink-0" style={{ minHeight: 44 }}>
              <Calendar className="w-4 h-4 text-ink-500 flex-shrink-0" />
              <input type="date" value={to}
                onChange={e => { setTo(e.target.value); setPreset('PERSONALIZADO') }}
                className="bg-transparent text-sm outline-none w-full sm:w-[110px]" />
            </div>
          </div>
        </div>
      </header>

      {(salesError || finError) && (
        <div className="space-y-2">
          {salesError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold">Erro ao carregar vendas do período (view v_dashboard_sales)</div>
                <div className="mt-0.5 opacity-90 break-words">{salesError}</div>
              </div>
            </div>
          )}
          {finError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold">Erro ao carregar financeiro do período (view v_dashboard_financial)</div>
                <div className="mt-0.5 opacity-90 break-words">{finError}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <div className="kpi-card border-t-4 !border-t-emerald-500">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">FATURAMENTO</div>
              <div className="text-[11px] text-ink-400 mt-0.5">receita bruta das vendas</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="kpi-value num text-emerald-800">
            {salesError ? '—' : formatCurrency(kpis.faturamento)}
          </div>
          <div className="kpi-sub mt-0.5">
            {salesError ? 'Verifique a view v_dashboard_sales' : pluralize(periodSales.length, 'venda', 'vendas')} · {kpis.recebido > 0 || kpis.aReceber > 0
              ? <>recebido <strong className="text-emerald-700">{formatCurrency(kpis.recebido)}</strong> · a receber <strong className="text-amber-700">{formatCurrency(kpis.aReceber)}</strong></>
              : ''}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-brand-700">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">LUCRO REAL</div>
              <div className="text-[11px] text-ink-400 mt-0.5">receita − custos e taxas reais</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-brand-50 ring-1 ring-brand-100 flex items-center justify-center text-brand-700 flex-shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className={cn(
            'kpi-value num',
            salesError ? 'text-rose-700' : kpis.lucro >= 0 ? 'text-brand-900' : 'text-rose-700'
          )}>
            {salesError ? '—' : (kpis.lucro >= 0 ? '' : '− ')}{formatCurrency(Math.abs(kpis.lucro))}
          </div>
          <div className="kpi-sub mt-0.5">
            {salesError ? '—' : (
              <>Margem: {kpis.faturamento > 0 ? `${((kpis.lucro / kpis.faturamento) * 100).toFixed(1)}%` : 'sem vendas'}</>
            )}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-emerald-600">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">RECEBIDO</div>
              <div className="text-[11px] text-ink-400 mt-0.5">pagamentos já confirmados</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div className="kpi-value num text-emerald-900">
            {salesError ? '—' : formatCurrency(kpis.recebido)}
          </div>
          <div className="kpi-sub mt-0.5">
            {salesError ? '—' : (kpis.faturamento > 0 ? `${((kpis.recebido / kpis.faturamento) * 100).toFixed(0)}% recebido` : '')}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-amber-500">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">A RECEBER</div>
              <div className="text-[11px] text-ink-400 mt-0.5">valores pendentes</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-50 ring-1 ring-amber-100 flex items-center justify-center text-amber-700 flex-shrink-0">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="kpi-value num text-amber-800">
            {salesError ? '—' : formatCurrency(kpis.aReceber)}
          </div>
          <div className="kpi-sub mt-0.5">
            {salesError ? '—' : (kpis.aReceber === 0 ? 'tudo em dia' : 'contas a receber')}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-violet-500">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">SALDO EM CAIXA</div>
              <div className="text-[11px] text-ink-400 mt-0.5">entradas − saídas (CONFIRMADO)</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-violet-50 ring-1 ring-violet-100 flex items-center justify-center text-violet-700 flex-shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className={cn(
            'kpi-value num',
            finError ? 'text-rose-700' : kpis.saldo >= 0 ? 'text-violet-900' : 'text-rose-700'
          )}>
            {finError ? '—' : (kpis.saldo >= 0 ? '' : '− ')}{formatCurrency(Math.abs(kpis.saldo))}
          </div>
          <div className="kpi-sub mt-0.5">
            {finError ? 'Ver view v_dashboard_financial' : pluralize(periodTrans.length, 'lançamento', 'lançamentos')}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-ink-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-ink-800">Movimentações do período</h3>
            <p className="text-xs text-ink-500 mt-0.5">
              Todas entradas/saídas. Fonte: <span className="font-semibold">view v_dashboard_financial</span>.
              Apenas <span className="font-semibold text-ink-700">status CONFIRMADO</span> movimenta o caixa.
            </p>
          </div>
          <span className="chip bg-ink-100 text-ink-700 self-start sm:self-auto">
            {loadingAny ? 'Carregando…' : pluralize(periodTrans.length, 'lançamento', 'lançamentos')}
          </span>
        </div>

        <div className="hidden sm:block">
          <div className="table-wrap">
            <table className="table-base min-w-[640px]">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo / Status</th>
                  <th>Categoria</th>
                  <th>Descrição</th>
                  <th className="text-right">Valor R$</th>
                </tr>
              </thead>
              <tbody>
                {loadingFin ? (
                  <tr><td colSpan={5} className="text-center py-10 text-ink-500">Carregando...</td></tr>
                ) : finError ? (
                  <tr><td colSpan={5} className="text-center py-10 text-rose-600 text-xs">
                    Erro ao carregar financeiro: {finError}
                  </td></tr>
                ) : periodTrans.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-10 text-ink-500">
                    <Filter className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                    Nenhuma movimentação no período.
                  </td></tr>
                ) : periodTrans.map(t => {
                  const isEntrada = t.trans_type === 'ENTRADA'
                  const confirmado = t.status === 'CONFIRMADO'
                  const valorAbs = Math.abs(Number(t.amount ?? 0))
                  return (
                    <tr key={t.financial_transaction_id ?? (t as any).id} className={cn('transition', !confirmado && 'opacity-70 bg-amber-50/30')}>
                      <td className="num text-ink-700 whitespace-nowrap">{formatDate(t.trans_date)}</td>
                      <td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn(
                            'chip ring-1 flex w-fit items-center gap-1',
                            isEntrada
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                              : 'bg-rose-50 text-rose-700 ring-rose-200'
                          )}>
                            {isEntrada ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {isEntrada ? 'Entrada' : 'Saída'}
                          </span>
                          {!confirmado && (
                            <span className="chip ring-1 bg-amber-50 text-amber-700 ring-amber-200 text-[10px] font-bold uppercase tracking-wider">
                              {t.status}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="chip bg-ink-100 text-ink-700">
                          {catLabel(t.category ?? null)}
                        </span>
                      </td>
                      <td>
                        <div className="text-sm text-ink-800 font-medium">{t.description}</div>
                        {(t.payment_method || t.status !== 'CONFIRMADO') && (
                          <div className="text-[11px] text-ink-400 mt-0.5 flex items-center gap-2 flex-wrap">
                            {t.payment_method && <span>{paymentMethodLabel(t.payment_method)}</span>}
                            {!confirmado && <span className="text-amber-600">· Pendente — não entra no caixa</span>}
                          </div>
                        )}
                      </td>
                      <td className={cn(
                        'text-right num font-bold whitespace-nowrap',
                        isEntrada ? 'text-emerald-700' : 'text-rose-700'
                      )}>
                        {isEntrada ? '+' : '−'} {formatCurrency(valorAbs)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ink-50/80 sticky bottom-0">
                  <td colSpan={3} className="font-bold text-ink-800 text-sm border-t-2 border-ink-200 py-4">
                    Totalizador do período
                  </td>
                  <td className="text-sm text-ink-500 border-t-2 border-ink-200 py-4">
                    {pluralize(periodTrans.length, 'lançamento')}
                  </td>
                  <td className="border-t-2 border-ink-200 py-4">
                    <div className="space-y-1.5 text-right">
                      <div className="flex items-center justify-end gap-2 text-sm">
                        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-ink-600">Entradas confirmadas:</span>
                        <span className="num font-bold text-emerald-700">{formatCurrency(kpis.entradas)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-2 text-sm">
                        <ArrowDownRight className="w-3.5 h-3.5 text-rose-600" />
                        <span className="text-ink-600">Saídas confirmadas:</span>
                        <span className="num font-bold text-rose-700">{formatCurrency(kpis.saidas)}</span>
                      </div>
                      <div className="pt-2 mt-1 border-t border-ink-200 flex items-center justify-end gap-2">
                        <span className="font-bold text-ink-800 text-sm">Saldo:</span>
                        <span className={cn(
                          'num font-black text-lg',
                          kpis.saldo >= 0 ? 'text-violet-800' : 'text-rose-700'
                        )}>
                          {kpis.saldo >= 0 ? '+' : '−'} {formatCurrency(Math.abs(kpis.saldo))}
                        </span>
                      </div>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="sm:hidden flex flex-col gap-3 px-4 py-4">
          {loadingFin ? (
            <div className="mcard justify-center items-center py-8 text-ink-500">Carregando...</div>
          ) : finError ? (
            <div className="mcard justify-center items-center py-8 text-rose-600 text-center text-sm">
              Erro ao carregar financeiro.
            </div>
          ) : periodTrans.length === 0 ? (
            <div className="mcard justify-center items-center py-8 text-center">
              <Filter className="w-10 h-10 text-ink-300 mb-2" />
              <div className="text-ink-500 font-medium">Nenhuma movimentação no período.</div>
            </div>
          ) : periodTrans.map(t => {
            const isEntrada = t.trans_type === 'ENTRADA'
            const confirmado = t.status === 'CONFIRMADO'
            const valorAbs = Math.abs(Number(t.amount ?? 0))
            return (
              <div key={t.financial_transaction_id ?? (t as any).id} className={cn('mcard', !confirmado && '!bg-amber-50/50')}>
                <div className="mcard-head">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        'chip ring-1 flex items-center gap-1',
                        isEntrada
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : 'bg-rose-50 text-rose-700 ring-rose-200'
                      )}>
                        {isEntrada ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {isEntrada ? 'Entrada' : 'Saída'}
                      </span>
                      {!confirmado && (
                        <span className="chip ring-1 bg-amber-50 text-amber-700 ring-amber-200 text-[10px] font-bold uppercase tracking-wider">
                          {t.status}
                        </span>
                      )}
                    </div>
                    <div className="mcard-sub num mt-1.5">{formatDate(t.trans_date)}</div>
                  </div>
                  <div className={cn(
                    'text-right num font-black text-lg leading-tight',
                    isEntrada ? 'text-emerald-700' : 'text-rose-700'
                  )}>
                    {isEntrada ? '+' : '−'} {formatCurrency(valorAbs)}
                  </div>
                </div>
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-start gap-2">
                    <span className="chip bg-ink-100 text-ink-700 !py-0.5 flex-shrink-0">
                      {catLabel(t.category ?? null)}
                    </span>
                  </div>
                  <div className="text-sm text-ink-800 font-medium break-words">{t.description}</div>
                  {(t.payment_method || !confirmado) && (
                    <div className="text-[11px] text-ink-500 flex items-center gap-2 flex-wrap pt-0.5">
                      {t.payment_method && <span>{paymentMethodLabel(t.payment_method)}</span>}
                      {!confirmado && <span className="text-amber-600 font-semibold">· Pendente — não entra no caixa</span>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {!loadingFin && !finError && periodTrans.length > 0 && (
            <div className="mcard !bg-ink-50/80 space-y-2.5">
              <div className="font-bold text-ink-800 text-sm">Totalizador do período</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-600 flex items-center gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                    Entradas:
                  </span>
                  <span className="num font-bold text-emerald-700">{formatCurrency(kpis.entradas)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-600 flex items-center gap-1.5">
                    <ArrowDownRight className="w-3.5 h-3.5 text-rose-600" />
                    Saídas:
                  </span>
                  <span className="num font-bold text-rose-700">{formatCurrency(kpis.saidas)}</span>
                </div>
                <div className="pt-2 mt-1 border-t border-ink-200 flex items-center justify-between gap-2">
                  <span className="font-bold text-ink-800 text-sm">Saldo:</span>
                  <span className={cn(
                    'num font-black text-lg',
                    kpis.saldo >= 0 ? 'text-violet-800' : 'text-rose-700'
                  )}>
                    {kpis.saldo >= 0 ? '+' : '−'} {formatCurrency(Math.abs(kpis.saldo))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-1">
        <p className="text-[11px] text-ink-500 leading-relaxed max-w-3xl">
          <span className="font-semibold text-ink-600">Obs:</span> Saldo em caixa ≠ Lucro.
          Compras de mercadoria são despesa de caixa hoje, mas o custo só é reconhecido no lucro no momento da venda.
          Faturamento é o total de vendas do período (view v_dashboard_sales.revenue).
          Entradas de caixa só contabilizam transações com status <strong>CONFIRMADO</strong>.
        </p>
      </div>

      {modalDespesaOpen && (
        <DespesaModal
          onClose={() => setModalDespesaOpen(false)}
          onSaved={() => {
            setModalDespesaOpen(false)
            dispatchInvalidate('financial')
          }}
        />
      )}
    </div>
  )
}

type DespesaCategoria =
  | 'SACOLAS' | 'EMBALAGEM' | 'ETIQUETAS' | 'PAPEL_SEDA'
  | 'PERFUMARIA' | 'MATERIAL' | 'FRETE' | 'MARKETING' | 'OUTROS'

const DESPESA_PRESETS: Array<{
  k: DespesaCategoria
  label: string
  icon: React.ComponentType<{ className?: string }>
  emoji?: string
  descPadrao?: string
}> = [
  { k: 'SACOLAS',    label: 'Sacolas',         icon: ShoppingBag,  emoji: '🛍️', descPadrao: 'Sacolas plásticas' },
  { k: 'EMBALAGEM',  label: 'Embalagem',       icon: Gift,         emoji: '🎁', descPadrao: 'Embalagem para pedidos' },
  { k: 'ETIQUETAS',  label: 'Etiquetas',       icon: Tag,          emoji: '🏷️', descPadrao: 'Etiquetas / Adesivos' },
  { k: 'PAPEL_SEDA', label: 'Papel seda',      icon: ScrollText,   emoji: '📜', descPadrao: 'Papel seda / tissue' },
  { k: 'PERFUMARIA', label: 'Perfumaria',      icon: Sparkles,     emoji: '🌸', descPadrao: 'Cheirinho / Perfumaria' },
  { k: 'MATERIAL',   label: 'Material',        icon: Wrench,       emoji: '🧰', descPadrao: 'Material expediente' },
  { k: 'FRETE',      label: 'Frete',           icon: Truck,        emoji: '🚚', descPadrao: 'Frete / transporte' },
  { k: 'MARKETING',  label: 'Marketing',       icon: Megaphone,    emoji: '📣', descPadrao: 'Marketing / anúncio' },
  { k: 'OUTROS',     label: 'Outros',          icon: MoreHorizontal, emoji: '💼', descPadrao: 'Outra despesa operacional' },
]

const CAT_EMOJI: Record<string, string> = Object.fromEntries(
  DESPESA_PRESETS.map(p => [p.k, p.emoji ?? '💼'])
)

function DespesaModal({
  onClose, onSaved
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('0,00')
  const [category, setCategory] = useState<DespesaCategoria>('SACOLAS')
  const [transDate, setTransDate] = useState<string>(toInputDate())
  const [paymentMethod, setPaymentMethod] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const applyPreset = (p: typeof DESPESA_PRESETS[number]) => {
    setCategory(p.k)
    if (!description.trim()) setDescription(p.descPadrao ?? p.label)
  }

  const submit = async () => {
    if (!description.trim()) {
      alert('Informe a descrição da despesa.'); return
    }
    const amt = parseBrl(amount)
    if (!amt || amt <= 0) {
      alert('Informe um valor maior que zero.'); return
    }
    setSaving(true)
    try {
      const params: RegistrarDespesaParams = {
        description: description.trim(),
        amount: amt,
        category,
        trans_date: transDate,
        payment_method: paymentMethod.trim()?.toUpperCase() || null,
        notes: notes.trim() || null,
      }
      await registrarDespesa(params)
      alert('Despesa lançada com sucesso!')
      onSaved()
    } catch (e: any) {
      console.error(e)
      alert('Erro ao lançar despesa: ' + (e?.message ?? 'desconhecido'))
    } finally {
      setSaving(false)
    }
  }

  const amtNum = parseBrl(amount) || 0

  return (
    <div
      className="modal-shell"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="modal-content modal-wide">
        <div className="modal-header">
          <div className="min-w-0">
            <h2 className="modal-title">Lançar despesa operacional</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Sacolas, cheirinho, frete avulso, marketing — RPC registrar_despesa + view v_dashboard_financial.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div>
            <label className="label text-sm mb-2">Tipo rápido</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {DESPESA_PRESETS.map(p => {
                const Icon = p.icon
                const ativo = category === p.k
                return (
                  <button
                    key={p.k}
                    onClick={() => applyPreset(p)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border transition min-h-[76px]',
                      ativo
                        ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-200 shadow-sm'
                        : 'border-ink-200 bg-white hover:bg-ink-50'
                    )}
                  >
                    <span className="text-xl leading-none" aria-hidden>
                      {p.emoji ?? ''}
                    </span>
                    <span className={cn(
                      'text-xs font-semibold leading-tight',
                      ativo ? 'text-brand-900' : 'text-ink-700'
                    )}>
                      {p.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <span className="text-base leading-none" aria-hidden>
                {CAT_EMOJI[category] ?? '💼'}
              </span>
              Descrição
            </label>
            <input className="input" value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Pacote 100 sacolas tamanho M" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label text-sm">Valor (R$)</label>
              <input className="input num text-lg font-bold text-rose-700"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                inputMode="decimal" placeholder="0,00" />
            </div>
            <div>
              <label className="label text-sm">Data</label>
              <input type="date" className="input" value={transDate}
                onChange={e => setTransDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label text-sm">Categoria</label>
              <select className="select pr-10 w-full" value={category}
                onChange={e => setCategory(e.target.value as DespesaCategoria)}>
                {DESPESA_PRESETS.map(p => (
                  <option key={p.k} value={p.k}>
                    {p.emoji ? `${p.emoji}  ${p.label}` : p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-sm">Forma de pagamento (opcional)</label>
              <select className="select pr-10 w-full" value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}>
                <option value="">— Não informar —</option>
                {['PIX','DINHEIRO','CREDITO','DEBITO','BOLETO','TRANSFERENCIA','OUTRO'].map(m => (
                  <option key={m} value={m}>{paymentMethodLabel(m)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label text-sm">Observações (opcional)</label>
            <textarea
              className="input min-h-[80px]"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="NF, fornecedor, para quais pedidos foi utilizado etc."
            />
          </div>

          <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600/80">Total lançamento</div>
              <div className="text-xs text-rose-700/80 mt-0.5">Será inserido como SAÍDA · CONFIRMADO em financial_transactions.</div>
            </div>
            <div className="text-2xl font-black text-rose-800 num">
              − {formatCurrency(amtNum)}
            </div>
          </div>
        </div>

        <div className="modal-footer flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary">Cancelar</button>
          <button onClick={submit} disabled={saving || !amtNum || amtNum <= 0 || !description.trim()} className="btn-danger justify-center">
            {saving ? (
              <>Lançando…</>
            ) : (
              <><Trash2 className="w-4 h-4" /> Confirmar despesa − {formatCurrency(amtNum)}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
