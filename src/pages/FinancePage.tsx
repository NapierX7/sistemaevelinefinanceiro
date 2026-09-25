import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
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
  onInvalidate, dispatchInvalidate,
  dashboardCashEvelineSummary, dashboardReceivablesTotal, listObligationsPendentes,
  computeSalesPeriodKpis, computeFinancialPeriodKpis, consolidateObligations
} from '@/services'
import type { DashboardSaleRow, DashboardFinancialRow, DashboardCashSummary, DashboardReceivablesTotal, ObligationRow } from '@/types/supabase'
import type { RegistrarDespesaParams } from '@/services'

type PresetKey = keyof ReturnType<typeof rangePresets> | 'PERSONALIZADO'

export default function FinancePage() {
  const presets = rangePresets()
  const [preset, setPreset] = useState<PresetKey>('ESTE_MES')
  const [from, setFrom] = useState<string>(presets.ESTE_MES.from.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(presets.ESTE_MES.to.toISOString().slice(0, 10))
  const [transactions, setTransactions] = useState<DashboardFinancialRow[]>([])
  const [salesRows, setSalesRows] = useState<DashboardSaleRow[]>([])
  const [obligationsRows, setObligationsRows] = useState<ObligationRow[]>([])
  const [cashSummary, setCashSummary] = useState<DashboardCashSummary | null>(null)
  const [receivablesTotal, setReceivablesTotal] = useState<DashboardReceivablesTotal | null>(null)
  const [loadingSales, setLoadingSales] = useState(true)
  const [loadingFin, setLoadingFin] = useState(true)
  const [loadingOblig, setLoadingOblig] = useState(true)
  const [loadingCash, setLoadingCash] = useState(true)
  const [loadingReceiv, setLoadingReceiv] = useState(true)
  const [salesError, setSalesError] = useState<string | null>(null)
  const [finError, setFinError] = useState<string | null>(null)
  const [obligError, setObligError] = useState<string | null>(null)
  const [cashError, setCashError] = useState<string | null>(null)
  const [receivError, setReceivError] = useState<string | null>(null)
  const [modalDespesaOpen, setModalDespesaOpen] = useState(false)
  const [loadTick, setLoadTick] = useState(0)

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
        setSalesError(null); setFinError(null); setObligError(null); setCashError(null); setReceivError(null)
        setLoadingSales(true); setLoadingFin(true); setLoadingOblig(true); setLoadingCash(true); setLoadingReceiv(true)
        Promise.allSettled([
          dashboardSales({ startInclusive: from, endInclusive: to }),
          dashboardFinancial({ startInclusive: from, endInclusive: to }),
          listObligationsPendentes(),
          dashboardCashEvelineSummary(),
          dashboardReceivablesTotal(),
        ]).then(([salesRes, finRes, obligRes, cashRes, recvRes]) => {
          if (salesRes.status === 'fulfilled') setSalesRows(salesRes.value)
          else { setSalesError(String(salesRes.reason?.message ?? salesRes.reason)) ; console.error(salesRes.reason) }
          if (finRes.status === 'fulfilled') setTransactions(finRes.value)
          else { setFinError(String(finRes.reason?.message ?? finRes.reason)) ; console.error('[fin error]') }
          if (obligRes.status === 'fulfilled') setObligationsRows(obligRes.value)
          else { setObligError(String(obligRes.reason?.message ?? obligRes.reason)) ; console.error(obligRes.reason) }
          if (cashRes.status === 'fulfilled') setCashSummary(cashRes.value)
          else { setCashError(String(cashRes.reason?.message ?? cashRes.reason)) ; console.error(cashRes.reason) }
          if (recvRes.status === 'fulfilled') setReceivablesTotal(recvRes.value)
          else { setReceivError(String(recvRes.reason?.message ?? recvRes.reason)) ; console.error(recvRes.reason) }
        }).finally(() => { setLoadingSales(false); setLoadingFin(false); setLoadingOblig(false); setLoadingCash(false); setLoadingReceiv(false) })
      }
    })
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, loadTick])

  useEffect(() => {
    let cancelled = false
    setLoadingOblig(true); setObligError(null)
    listObligationsPendentes()
      .then(d => { if (!cancelled) setObligationsRows(d) })
      .catch(err => {
        console.error('[Finance] obrigações falhou:', err)
        if (!cancelled) setObligError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingOblig(false) })
    return () => { cancelled = true }
  }, [loadTick])

  useEffect(() => {
    let cancelled = false
    setLoadingCash(true); setCashError(null)
    dashboardCashEvelineSummary()
      .then(d => { if (!cancelled) setCashSummary(d) })
      .catch(err => {
        console.error('[Finance] cash summary falhou:', err)
        if (!cancelled) setCashError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingCash(false) })
    return () => { cancelled = true }
  }, [loadTick])

  useEffect(() => {
    let cancelled = false
    setLoadingReceiv(true); setReceivError(null)
    dashboardReceivablesTotal()
      .then(d => { if (!cancelled) setReceivablesTotal(d) })
      .catch(err => {
        console.error('[Finance] receivables total falhou:', err)
        if (!cancelled) setReceivError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingReceiv(false) })
    return () => { cancelled = true }
  }, [loadTick])

  const periodSales = salesRows // já vem filtrado pela view no período
  const periodTrans = transactions // já vem filtrado pela view no período

  const salesKpis = useMemo(() => computeSalesPeriodKpis(periodSales), [periodSales])
  const finKpis = useMemo(() => computeFinancialPeriodKpis(periodTrans), [periodTrans])
  const obrigacoes = useMemo(() => consolidateObligations(obligationsRows), [obligationsRows])
  const naoInformado = useMemo(() => {
    return periodTrans.filter(t => {
      if (t.status !== 'CONFIRMADO') return false
      const ps = t.payment_source ?? null
      return ps === null || String(ps).trim() === ''
    })
  }, [periodTrans])

  // Posição ATUAL de caixa: SEMPRE usa a view acumulada (independe de período).
  const saldoCaixaAtual = Number(cashSummary?.movimento_liquido ?? 0)

  // A RECEBER TOTAL (global) usa dashboardReceivablesTotal; período mostra apenas parcela do período.
  const aReceberGlobal = Number(receivablesTotal?.total_a_receber ?? 0)

  const kpis = useMemo(() => {
    return {
      faturamento: salesKpis.faturamento,
      recebido: salesKpis.recebido,
      aReceber_periodo: salesKpis.a_receber,
      lucro: salesKpis.lucro_real,
      margem: salesKpis.margem_percent,
      entradas: finKpis.entradas_confirmadas,
      saidas: finKpis.saidas_confirmadas,
      // saldo do PERÍODO (temporal); o KPI de CAIXA usa saldoCaixaAtual.
      saldo_periodo: finKpis.saldo_periodo,
    }
  }, [salesKpis, finKpis])

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

  const loadingAny = loadingSales || loadingFin || loadingOblig || loadingCash || loadingReceiv

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

      {(salesError || finError || obligError || cashError || receivError) && (
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
          {cashError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold">Erro ao carregar caixa atual (view v_cash_eveline_summary)</div>
                <div className="mt-0.5 opacity-90 break-words">{cashError}</div>
              </div>
            </div>
          )}
          {receivError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold">Erro ao carregar a receber (view v_dashboard_receivables)</div>
                <div className="mt-0.5 opacity-90 break-words">{receivError}</div>
              </div>
            </div>
          )}
          {obligError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold">Erro ao carregar obrigações pendentes</div>
                <div className="mt-0.5 opacity-90 break-words">{obligError}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <div className="kpi-card border-t-4 !border-t-emerald-500">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">FATURAMENTO</div>
              <div className="text-[11px] text-ink-400 mt-0.5">período selecionado</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="kpi-value num text-emerald-800">
            {salesError ? '—' : formatCurrency(kpis.faturamento)}
          </div>
          <div className="kpi-sub mt-0.5">
            {salesError ? 'Verifique a view v_dashboard_sales' : (
              <>
                {pluralize(periodSales.length, 'venda', 'vendas')}
                {kpis.recebido > 0 ? <> · recebido <strong className="text-emerald-700">{formatCurrency(kpis.recebido)}</strong></> : ''}
              </>
            )}
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
              <>Margem: {kpis.faturamento > 0 ? `${kpis.margem.toFixed(1)}%` : 'sem vendas'}</>
            )}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-emerald-600">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">RECEBIDO</div>
              <div className="text-[11px] text-ink-400 mt-0.5">pagamentos confirmados período</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div className="kpi-value num text-emerald-900">
            {salesError ? '—' : formatCurrency(kpis.recebido)}
          </div>
          <div className="kpi-sub mt-0.5">
            {salesError ? '—' : (kpis.faturamento > 0 ? `${((kpis.recebido / kpis.faturamento) * 100).toFixed(0)}% do faturamento` : '')}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-amber-500">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">A RECEBER</div>
              <div className="text-[11px] text-ink-400 mt-0.5">global — view oficial</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-50 ring-1 ring-amber-100 flex items-center justify-center text-amber-700 flex-shrink-0">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="kpi-value num text-amber-800">
            {receivError ? '—' : formatCurrency(aReceberGlobal)}
          </div>
          <div className="kpi-sub mt-0.5">
            {receivError
              ? 'Ver view v_dashboard_receivables'
              : (
                aReceberGlobal <= 0.009
                  ? 'tudo em dia'
                  : `${Number(receivablesTotal?.vendas_pendentes_qtd ?? 0)} ${pluralize(Number(receivablesTotal?.vendas_pendentes_qtd ?? 0), 'venda', 'vendas')} pendentes`
              )}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-sky-500">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">SALDO PERÍODO</div>
              <div className="text-[11px] text-ink-400 mt-0.5">entradas − saídas do período</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-sky-50 ring-1 ring-sky-100 flex items-center justify-center text-sky-700 flex-shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className={cn(
            'kpi-value num',
            finError ? 'text-rose-700' : kpis.saldo_periodo >= 0 ? 'text-sky-900' : 'text-rose-700'
          )}>
            {finError ? '—' : (kpis.saldo_periodo >= 0 ? '' : '− ')}{formatCurrency(Math.abs(kpis.saldo_periodo))}
          </div>
          <div className="kpi-sub mt-0.5">
            {finError
              ? 'Ver view v_dashboard_financial'
              : `+${formatCurrency(kpis.entradas)} · −${formatCurrency(kpis.saidas)}`}
          </div>
        </div>

        <div className="kpi-card border-t-4 !border-t-violet-600">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1">
              <div className="kpi-label">CAIXA ATUAL</div>
              <div className="text-[11px] text-ink-400 mt-0.5">posição hoje — independe período</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-violet-50 ring-1 ring-violet-100 flex items-center justify-center text-violet-700 flex-shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className={cn(
            'kpi-value num',
            cashError ? 'text-rose-700' : saldoCaixaAtual >= 0 ? 'text-violet-900' : 'text-rose-700'
          )}>
            {cashError ? '—' : (saldoCaixaAtual >= 0 ? '' : '− ')}{formatCurrency(Math.abs(saldoCaixaAtual))}
          </div>
          <div className="kpi-sub mt-0.5">
            {cashError
              ? 'Ver view v_cash_eveline_summary'
              : `view oficial · ${loadingCash ? 'carregando…' : 'atualizado'}`}
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
                        <span className="font-bold text-ink-800 text-sm">Saldo do período:</span>
                        <span className={cn(
                          'num font-black text-lg',
                          kpis.saldo_periodo >= 0 ? 'text-violet-800' : 'text-rose-700'
                        )}>
                          {kpis.saldo_periodo >= 0 ? '+' : '−'} {formatCurrency(Math.abs(kpis.saldo_periodo))}
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
                  <span className="font-bold text-ink-800 text-sm">Saldo do período:</span>
                  <span className={cn(
                    'num font-black text-lg',
                    kpis.saldo_periodo >= 0 ? 'text-sky-800' : 'text-rose-700'
                  )}>
                    {kpis.saldo_periodo >= 0 ? '+' : '−'} {formatCurrency(Math.abs(kpis.saldo_periodo))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          SEÇÃO · MOVIMENTAÇÕES A CLASSIFICAR
          ============================================================ */}
      <section>
        <div className="flex items-center gap-2 mb-2 mt-6 px-0.5">
          <div className="w-1.5 h-5 rounded-full bg-rose-500" />
          <h2 className="font-black text-ink-900 tracking-tight">Movimentações a classificar</h2>
          <span className="chip bg-rose-50 text-rose-700 text-[10px] font-bold uppercase tracking-[0.14em]">
            payment_source NULL
          </span>
        </div>
        <div className="card p-5 space-y-4">
          {(() => {
            const rows = naoInformado
            const entradas = rows.filter(r => r.trans_type === 'ENTRADA').reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0)
            const saidas = rows.filter(r => r.trans_type === 'SAIDA').reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0)
            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-rose-50 border border-rose-100">
                    <div>
                      <div className="text-xs text-rose-700 font-semibold">Movimentações pendentes</div>
                      <div className="text-xs text-rose-600/80 mt-0.5">NÃO entram no caixa oficial</div>
                    </div>
                    <div className="text-lg font-black text-rose-800 num">{rows.length}</div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                    <div>
                      <div className="text-xs text-emerald-700 font-semibold">Entradas não classificadas</div>
                      <div className="text-xs text-emerald-600/80 mt-0.5">precisam de origem</div>
                    </div>
                    <div className="text-lg font-black text-emerald-800 num">{formatCurrency(entradas)}</div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-orange-50 border border-orange-100">
                    <div>
                      <div className="text-xs text-orange-700 font-semibold">Saídas não classificadas</div>
                      <div className="text-xs text-orange-600/80 mt-0.5">precisam de origem</div>
                    </div>
                    <div className="text-lg font-black text-orange-800 num">{formatCurrency(saidas)}</div>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <div className="text-center py-6">
                    <Tag className="w-10 h-10 text-ink-200 mx-auto mb-2" />
                    <div className="text-sm font-bold text-ink-600">Nenhuma movimentação pendente.</div>
                    <div className="text-xs text-ink-400 mt-0.5">Tudo classificado corretamente.</div>
                  </div>
                ) : (
                  <div className="table-wrap -mx-1">
                    <table className="table-base min-w-[520px]">
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Tipo</th>
                          <th>Categoria</th>
                          <th>Descrição</th>
                          <th className="text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(t => {
                          const isEntrada = t.trans_type === 'ENTRADA'
                          const valorAbs = Math.abs(Number(t.amount ?? 0))
                          return (
                            <tr key={t.financial_transaction_id ?? (t as any).id}>
                              <td className="num whitespace-nowrap text-ink-700">{formatDate(t.trans_date)}</td>
                              <td>
                                <span className={cn(
                                  'chip ring-1 flex w-fit items-center gap-1',
                                  isEntrada
                                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                    : 'bg-rose-50 text-rose-700 ring-rose-200'
                                )}>
                                  {isEntrada ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                  {isEntrada ? 'Entrada' : 'Saída'}
                                </span>
                              </td>
                              <td><span className="chip bg-ink-100 text-ink-700">{catLabel(t.category ?? null)}</span></td>
                              <td className="text-sm text-ink-800 break-words">{t.description}</td>
                              <td className={cn('text-right num font-bold whitespace-nowrap', isEntrada ? 'text-emerald-700' : 'text-rose-700')}>
                                {isEntrada ? '+' : '−'} {formatCurrency(valorAbs)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </section>

      {/* ============================================================
          SEÇÃO · OBRIGAÇÕES / VALORES A RESTITUIR
          ============================================================ */}
      <section>
        <div className="flex items-center gap-2 mb-2 mt-6 px-0.5">
          <div className="w-1.5 h-5 rounded-full bg-violet-500" />
          <h2 className="font-black text-ink-900 tracking-tight">Obrigações / Valores a restituir</h2>
        </div>
        <div className="card p-5 space-y-4">
          {loadingOblig ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-3 rounded-xl border border-ink-100 bg-ink-50/30 space-y-2 animate-pulse">
                  <div className="h-3 w-40 bg-ink-100 rounded" />
                  <div className="h-2 w-full bg-ink-100 rounded-full" />
                  <div className="h-2 w-32 bg-ink-100 rounded" />
                </div>
              ))}
            </div>
          ) : obligError ? (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Não foi possível carregar as obrigações</div>
              <div className="mt-0.5 opacity-90 break-words">{obligError}</div>
            </div>
          ) : obrigacoes.linhas.length === 0 ? (
            <div className="text-center py-6">
              <Wallet className="w-10 h-10 text-ink-200 mx-auto mb-2" />
              <div className="text-sm font-bold text-ink-600">Sem obrigações pendentes conhecidas.</div>
              <div className="text-xs text-ink-400 mt-0.5">Quando forem efetivamente pagas → saem do caixa.</div>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {obrigacoes.linhas.map(l => {
                  const total = Number(l.original ?? 0)
                  const pago = Number(l.pago ?? 0)
                  const restante = Number(l.restante ?? Math.max(0, total - pago))
                  const pctRaw = total > 0 ? (pago / total) * 100 : 0
                  const pct = Math.min(100, Math.max(0, pctRaw))
                  const st = String(l.status ?? 'PENDENTE')
                  let statusTone = 'bg-rose-50 text-rose-700 ring-rose-200'
                  if (st === 'PAGO') statusTone = 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  else if (st === 'PARCIAL') statusTone = 'bg-amber-50 text-amber-700 ring-amber-200'
                  else if (st === 'CANCELADO') statusTone = 'bg-ink-100 text-ink-500 ring-ink-200'
                  return (
                    <div key={l.creditor} className="p-3 rounded-xl border border-ink-100 bg-ink-50/30">
                      <div className="flex justify-between items-center mb-2 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Wallet className="w-4 h-4 text-violet-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-ink-800 truncate">{l.creditor}</div>
                            <div className="text-[11px] text-ink-500 num">
                              {pluralize(l.qtd, 'lançamento')}
                            </div>
                          </div>
                        </div>
                        <span className={cn('chip ring-1 text-[10px] font-bold uppercase tracking-wider', statusTone)}>
                          {st}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="text-[11px] text-ink-500 num">
                          Restante <b className="text-ink-800">{formatCurrency(restante)}</b>
                        </div>
                        <div className="text-[11px] font-bold text-violet-700 num whitespace-nowrap">
                          {`${pct.toFixed(2)}%`}
                        </div>
                      </div>
                      <div className="flex-1 h-2 rounded-full bg-violet-100 overflow-hidden mb-2">
                        <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[11px] text-ink-500 num">
                        {formatCurrency(pago)} pago de {formatCurrency(total)}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="pt-3 mt-1 border-t border-ink-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-violet-700">Total obrigações pendentes</span>
                  <span className="text-lg font-black num text-ink-900">{formatCurrency(obrigacoes.totalRemaining)}</span>
                </div>
                {obrigacoes.totalPago > 0 && (
                  <div className="text-[11px] text-ink-500 mt-1 num">
                    Já pago/abatido: {formatCurrency(obrigacoes.totalPago)} de {formatCurrency(obrigacoes.totalOriginal)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <p className="text-[11px] text-ink-500 leading-relaxed mt-2 px-1">
          Quando forem efetivamente pagas → saem do caixa naquele momento. Custo de mercadoria já foi contabilizado no estoque / CMV.
        </p>
      </section>

      <div className="px-1 mt-4">
        <p className="text-[11px] text-ink-500 leading-relaxed max-w-3xl">
          <span className="font-semibold text-ink-600">Obs:</span> <strong>Caixa atual</strong> (R$ {formatCurrency(saldoCaixaAtual)}) é uma posição de hoje usando a view oficial <code>v_cash_eveline_summary</code> e NÃO depende do filtro de período.
          Filtros de período afetam apenas faturamento, lucro e totalizadores de entrada/saída do mês. Saldo em caixa ≠ Lucro.
          Compras de mercadoria são despesa de caixa hoje, mas o custo só é reconhecido no lucro no momento da venda.
          Faturamento é o total de vendas do período (view v_dashboard_sales).
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
