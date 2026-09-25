import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Calendar, DollarSign, TrendingUp, Package, ShoppingCart, Receipt,
  ArrowUpRight, ArrowDownRight, Filter, AlertTriangle, ChevronDown, AlertCircle,
  CreditCard, Wallet, Clock, Check, X, CheckCircle2, List
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, rangePresets,
  statusLabel, sourceLabel, paymentMethodLabel, pluralize, cn
} from '@/lib/format'
import {
  dashboardStockSummary, dashboardSales, dashboardFinancial,
  listSalePaymentsBySaleIds, listObligationsPendentes, payObligation, dispatchInvalidateAll,
  dashboardCashEvelineSummary, dashboardReceivablesTotal,
  listAllInfinitePayReceivables, confirmRepasseInfinitePay,
  computeSalesPeriodKpis, computeFinancialPeriodKpis,
  consolidateObligations, normalizePaymentLabel,
} from '@/services'
import type {
  DashboardStockSummary, DashboardSaleRow, DashboardFinancialRow,
  SalePayment, UUID, ObligationRow, DashboardCashSummary, DashboardReceivablesTotal,
  InfinitePayReceivable
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
  const [obligationsRows, setObligationsRows] = useState<ObligationRow[]>([])
  const [cashSummary, setCashSummary] = useState<DashboardCashSummary | null>(null)
  const [receivablesTotal, setReceivablesTotal] = useState<DashboardReceivablesTotal | null>(null)

  const [loadingStock, setLoadingStock] = useState(true)
  const [loadingSales, setLoadingSales] = useState(true)
  const [loadingFin, setLoadingFin] = useState(true)
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [loadingOblig, setLoadingOblig] = useState(true)
  const [loadingCash, setLoadingCash] = useState(true)
  const [loadingReceiv, setLoadingReceiv] = useState(true)

  const [stockError, setStockError] = useState<string | null>(null)
  const [salesError, setSalesError] = useState<string | null>(null)
  const [finError, setFinError] = useState<string | null>(null)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)
  const [obligError, setObligError] = useState<string | null>(null)
  const [cashError, setCashError] = useState<string | null>(null)
  const [receivError, setReceivError] = useState<string | null>(null)

  const [showPayModal, setShowPayModal] = useState(false)
  const [paySelectedObligationId, setPaySelectedObligationId] = useState<string>('')
  const [payAmount, setPayAmount] = useState<string>('')
  const [payMethod, setPayMethod] = useState<string>('PIX')
  const [payRef, setPayRef] = useState<string>('')
  const [payNotes, setPayNotes] = useState<string>('')
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [payLoading, setPayLoading] = useState(false)
  const [payActionError, setPayActionError] = useState<string | null>(null)
  const [paySuccessMsg, setPaySuccessMsg] = useState<string | null>(null)

  const [ipReceivables, setIpReceivables] = useState<InfinitePayReceivable[]>([])
  const [loadingIp, setLoadingIp] = useState(true)
  const [ipError, setIpError] = useState<string | null>(null)

  const [showIpConfirmModal, setShowIpConfirmModal] = useState(false)
  const [showIpListModal, setShowIpListModal] = useState(false)
  const [ipListTab, setIpListTab] = useState<'pendentes' | 'repassadas'>('pendentes')
  const [ipSelected, setIpSelected] = useState<InfinitePayReceivable | null>(null)
  const [ipFormAmount, setIpFormAmount] = useState<string>('')
  const [ipFormDate, setIpFormDate] = useState<string>('')
  const [ipFormNotes, setIpFormNotes] = useState<string>('')
  const [ipLoading, setIpLoading] = useState(false)
  const [ipActionError, setIpActionError] = useState<string | null>(null)
  const [ipSuccessMsg, setIpSuccessMsg] = useState<string | null>(null)

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
    setLoadingOblig(true); setObligError(null)
    listObligationsPendentes()
      .then(d => { if (!cancelled) setObligationsRows(d) })
      .catch(err => {
        console.error('[Dashboard] obrigações pendentes falhou:', err)
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
        console.error('[Dashboard] cash summary falhou:', err)
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
        console.error('[Dashboard] receivables total falhou:', err)
        if (!cancelled) setReceivError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingReceiv(false) })
    return () => { cancelled = true }
  }, [loadTick])

  useEffect(() => {
    let cancelled = false
    setLoadingIp(true); setIpError(null)
    listAllInfinitePayReceivables()
      .then(arr => { if (!cancelled) setIpReceivables(arr) })
      .catch(err => {
        console.error('[Dashboard] InfinitePay recebíveis falhou:', err)
        if (!cancelled) setIpError(err?.message ?? String(err))
      })
      .finally(() => { if (!cancelled) setLoadingIp(false) })
    return () => { cancelled = true }
  }, [loadTick])

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
    const k = computeSalesPeriodKpis(salesRows)
    return {
      faturamento: k.faturamento,
      recebido: k.recebido,
      aReceber: k.a_receber,
      lucro: k.lucro_real,
      margem: k.margem_percent,
      pedidos: k.pedidos,
      pecas: k.pecas,
      ticketMedio: k.ticket_medio,
      custoMerc: k.custo_mercadorias,
      custoAlloc: k.custo_rateio_aquisicao,
      custoFrete: k.custo_frete_extras,
      custoTaxas: k.custo_taxas,
      custoEmbalagens: k.custo_embalagem,
      descontos: k.descontos,
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
        const key = normalizePaymentLabel({
          provider_snapshot: (sp as any).provider_snapshot ?? (sp as any).provider ?? null,
          method: sp.method ?? (sp as any).payment_method_snapshot ?? null,
          modality_snapshot: (sp as any).modality_snapshot ?? (sp as any).modality ?? null,
          installments: (sp as any).installments ?? null,
        })
        if (!groups[key]) groups[key] = { label: key, count: 0, total: 0 }
        groups[key].count += 1
        groups[key].total += Number(sp.amount ?? 0)
      }
    }
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }, [salesRows, salePayments])

  // ============================================================================
  // IMPORTANTE — RECEBIDO  vs  CAIXA (não são a mesma coisa)
  // ============================================================================
  // RECEBIDO (kpis.recebido) = dashboardSales.amount_received
  //   → Pagamentos RECEBIDOS associados a VENDAS dentro do período filtrado.
  //
  // CAIXA (receitas - despesas) = dashboardFinancial trans_type CONFIRMADO
  //   → TODOS os movimentos de caixa confirmados:
  //     - entradas (inclui recebimentos de venda, mas também estornos, ajustes,
  //       recebimentos financeiros não-venda, etc.)
  //     - saídas (compras, despesas, fornecedores, taxas, saques, etc.)
  //
  // Como compras de mercadoria são saída hoje mas CMV só na venda futura,
  // caixa != lucro e caixa != recebido.
  // NÃO FORÇAR IGUALDADE. As duas métricas são legítimas e independentes.
  // ============================================================================
  // ============================================================================
  // CAIXA EVELINE (somente dinheiro que realmente entrou/saiu da conta operacional)
  // ============================================================================
  // Regra #2 e #9 do fechamento:
  //   - payment_source = 'CAIXA_EVELINE' — movimentações da conta operacional
  //   - CONFIRMADO apenas
  //   - Compras pagas por Fabiana/Dona/Outro NÃO entram aqui
  //   - Pagamento de obrigação (SAIDA) entra aqui Apenas quando o dinheiro realmente sai
  //
  // Fallback por enquanto: se payment_source for NULL (histórico antes da coluna existir),
  // inclui no cálculo como CAIXA_EVELINE para não quebrar leitura.
  // Quando a correção histórica das compras Fabi for aplicada, o payment_source
  // será definido em todas as transações e o fallback não importará mais.
  // ============================================================================
  // ============================================================================
  // CAIXA EVELINE (somente dinheiro que realmente entrou/saiu da conta operacional)
  // ============================================================================
  // REGRA DEFINITIVA item 3:
  //   - Somente movimentações com payment_source === 'CAIXA_EVELINE' entram no saldo.
  //   - NULL, vazio ou NAO_INFORMADO NÃO são considerados Caixa Eveline.
  //   - Estes aparecem no Bloco V (Pendências de classificação).
  // ============================================================================
  // ============================================================================
  // BLOCO V — Movimentações a classificar (do período filtrado).
  // REGRA OFICIAL: payment_source NULL. NÃO confundir com payment_method=NAO_INFORMADO.
  // ============================================================================
  const naoInformado = useMemo(() => {
    return finRows.filter(t => {
      if (t.status !== 'CONFIRMADO') return false
      const ps = t.payment_source ?? null
      return ps === null || String(ps).trim() === ''
    })
  }, [finRows])

  // ============================================================================
  // SALDO DO CAIXA ATUAL (posição acumulada, NÃO filtrado por período).
  // Usa a view v_cash_eveline_summary (cashSummary). Inclui AJUSTE_CONCILIACAO.
  // ============================================================================
  const receitas = Number(cashSummary?.entradas ?? 0)
  const despesas = Number(cashSummary?.saidas ?? 0)
  const saldoCaixa = Number(cashSummary?.movimento_liquido ?? 0)

  // ============================================================================
  // INFINITEPAY — A REPASSAR (GLOBAL, não filtrado por período).
  // Service: listAllInfinitePayReceivables()
  // ============================================================================
  const { aRepassarInfinitePay, totalRepassadoInfinitePay, ipLinhasARepassar, ipLinhasRepassadas } = useMemo(() => {
    let rep = 0
    let repassado = 0
    const arepassar: InfinitePayReceivable[] = []
    const repassadas: InfinitePayReceivable[] = []
    for (const r of ipReceivables) {
      if (r.repasse_confirmado) {
        repassado += Number(r.repasse_amount ?? r.liquido)
        repassadas.push(r)
      } else {
        rep += Number(r.liquido)
        arepassar.push(r)
      }
    }
    return {
      aRepassarInfinitePay: rep,
      totalRepassadoInfinitePay: repassado,
      ipLinhasARepassar: arepassar,
      ipLinhasRepassadas: repassadas,
    }
  }, [ipReceivables])
  const aposCreditoIp = saldoCaixa + aRepassarInfinitePay

  // ============================================================================
  // A RECEBER TOTAL (todas vendas, não só período). Usa dashboardReceivablesTotal.
  // ============================================================================
  const aReceberGlobal = Number(receivablesTotal?.total_a_receber ?? 0)
  const caixaProjetado = aposCreditoIp
  const potencialFinanceiroTotal = caixaProjetado + aReceberGlobal + Number(stock?.total_sales_potential ?? 0)

  const obrigacoes = useMemo(() => consolidateObligations(obligationsRows), [obligationsRows])

  const recentSales = [...salesRows].slice(0, 8)
  const loadingAny = loadingStock || loadingSales || loadingFin || loadingPayments || loadingOblig || loadingCash || loadingReceiv

  function openPayModal() {
    const first = obligationsRows.filter(o => o.status !== 'PAGO' && o.status !== 'CANCELADO')[0]
    setPaySelectedObligationId(first ? String(first.id) : '')
    if (first) {
      const remaining = Number(first.remaining_balance ?? first.amount ?? 0)
      setPayAmount(remaining > 0 ? remaining.toFixed(2) : '')
    } else {
      setPayAmount('')
    }
    setPayMethod('PIX')
    setPayRef('')
    setPayNotes('')
    setPayDate(new Date().toISOString().slice(0, 10))
    setPayActionError(null)
    setPaySuccessMsg(null)
    setPayLoading(false)
    setShowPayModal(true)
  }

  function onSelectObligationChange(oid: string) {
    setPaySelectedObligationId(oid)
    const obl = obligationsRows.find(o => String(o.id) === oid)
    if (obl) {
      const remaining = Number(obl.remaining_balance ?? obl.amount ?? 0)
      setPayAmount(remaining > 0 ? remaining.toFixed(2) : '')
    }
    setPayActionError(null)
    setPaySuccessMsg(null)
  }

  async function handleSubmitPay(e: React.FormEvent) {
    e.preventDefault()
    const amtRaw = Number(payAmount.replace(',', '.'))
    if (!paySelectedObligationId) {
      setPayActionError('Selecione uma obrigação para pagar.')
      return
    }
    if (!(amtRaw > 0)) {
      setPayActionError('Valor inválido. Informe um valor numérico maior que zero.')
      return
    }
    setPayLoading(true)
    setPayActionError(null)
    setPaySuccessMsg(null)
    try {
      const res = await payObligation({
        obligation_id: paySelectedObligationId,
        amount: amtRaw,
        payment_method: payMethod || undefined,
        payment_ref: payRef.trim() || undefined,
        notes: payNotes.trim() || undefined,
        trans_date: payDate || undefined,
      })
      if (res && typeof res === 'object') {
        const anyRes = res as any
        if (anyRes.ok === false && anyRes.idempotent === true) {
          setPaySuccessMsg('Pagamento já registrado anteriormente (idempotente). Nenhuma duplicidade criada.')
        } else if (anyRes.ok === false) {
          setPayActionError(String(anyRes.error ?? 'Falha ao registrar pagamento.'))
          setPayLoading(false)
          return
        } else {
          setPaySuccessMsg(
            'Pagamento de ' + formatCurrency(amtRaw) + ' registrado. ' +
            'Saldo restante: ' + formatCurrency(Number(anyRes.remaining_balance ?? 0)) + '.'
          )
        }
      } else {
        setPaySuccessMsg('Pagamento registrado com sucesso.')
      }
      dispatchInvalidateAll()
      setTimeout(() => {
        setShowPayModal(false)
      }, 1400)
    } catch (err: any) {
      setPayActionError(err?.message ?? String(err ?? 'Erro desconhecido ao pagar obrigação.'))
    } finally {
      setPayLoading(false)
    }
  }

  async function handleSubmitIpRepasse(e: React.FormEvent) {
    e.preventDefault()
    if (!ipSelected) {
      setIpActionError('Nenhum recebível selecionado.')
      return
    }
    const amtRaw = Number(ipFormAmount.replace(',', '.'))
    if (!(amtRaw > 0)) {
      setIpActionError('Valor recebido inválido.')
      return
    }
    setIpLoading(true)
    setIpActionError(null)
    setIpSuccessMsg(null)
    try {
      const res = await confirmRepasseInfinitePay({
        sale_payment_id: ipSelected.sale_payment_id,
        sale_id: ipSelected.sale_id,
        amount_received: amtRaw,
        liquido_esperado: Number(ipSelected.liquido ?? 0),
        trans_date: ipFormDate || undefined,
        notes: ipFormNotes || undefined,
      })
      if (!res?.ok) {
        setIpActionError(res?.message ?? 'Erro ao confirmar repasse.')
        setIpLoading(false)
        return
      }
      setIpSuccessMsg(res.message ?? 'Repasse confirmado com sucesso.')
      dispatchInvalidateAll()
      setTimeout(() => {
        setShowIpConfirmModal(false)
        setIpSelected(null)
      }, 1500)
    } catch (err: any) {
      setIpActionError(err?.message ?? String(err ?? 'Erro desconhecido ao confirmar repasse.'))
    } finally {
      setIpLoading(false)
    }
  }

  return (
    <div className="page-wrap pb-4 sm:pb-6">
      {/* Cabeçalho + filtro período */}
      <header className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Visão geral de vendas, estoque e financeiro.</p>
          </div>
          <div className="w-full sm:w-auto">
            <div className="filter-row sm:gap-2 w-full">
              <div className="relative sm:min-w-[200px] flex-1 sm:flex-none">
                <select
                  value={preset}
                  onChange={e => setPreset(e.target.value as PresetKey)}
                  className="select pr-10 w-full"
                >
                  {Object.entries(presets).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                  <option value="PERSONALIZADO">Personalizado</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
              <div className="flex gap-2 items-center w-full sm:w-auto justify-between sm:justify-start">
                <div className="flex items-center gap-1.5 px-3 rounded-card bg-white border border-ink-200 flex-1 sm:flex-none">
                  <Calendar className="w-4 h-4 text-ink-500 shrink-0" />
                  <input
                    type="date"
                    value={from}
                    onChange={e => { setFrom(e.target.value); setPreset('PERSONALIZADO') }}
                    className="bg-transparent text-sm outline-none w-full sm:w-[110px] py-2 min-w-0"
                  />
                </div>
                <span className="text-ink-400 text-sm shrink-0 hidden sm:block">à</span>
                <div className="flex items-center gap-1.5 px-3 rounded-card bg-white border border-ink-200 flex-1 sm:flex-none">
                  <Calendar className="w-4 h-4 text-ink-500 shrink-0" />
                  <input
                    type="date"
                    value={to}
                    onChange={e => { setTo(e.target.value); setPreset('PERSONALIZADO') }}
                    className="bg-transparent text-sm outline-none w-full sm:w-[110px] py-2 min-w-0"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ============================================================
          BLOCO I · CAIXA + PROJEÇÃO
          ============================================================ */}
      <section>
        <div className="flex items-center gap-2 mb-2 px-0.5">
          <div className="w-1.5 h-5 rounded-full bg-emerald-600" />
          <h2 className="font-black text-ink-900 tracking-tight">I · Caixa & Projeção</h2>
          <span className="chip bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-[0.14em] hidden sm:inline-flex">
            Cash basis + recebíveis
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex flex-col justify-between p-4 rounded-card bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm min-h-[140px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Wallet className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/75">Saldo atual</div>
                  <div className="text-[10px] text-white/60 mt-0.5 truncate">CAIXA_EVELINE</div>
                </div>
              </div>
              {loadingCash && <div className="text-[10px] text-white/60 animate-pulse shrink-0">…</div>}
            </div>
            <div className="kpi-value !text-white num">
              {(loadingCash || cashError) ? '—' : formatCurrency(saldoCaixa)}
            </div>
            <div className="mt-2 text-[10px] text-white/70 flex items-center justify-between gap-2">
              <span className="truncate">Ent. {(loadingCash || cashError) ? '—' : formatCurrency(receitas)}</span>
              <span className="truncate">Sai. {(loadingCash || cashError) ? '—' : formatCurrency(despesas)}</span>
            </div>
          </div>

          {/* CARD 2 · INFINITEPAY — COMPACTO (mobile + desktop iguais). Sem lista inline. */}
          <div className="flex flex-col p-4 rounded-card bg-white border border-sky-200 shadow-sm sm:col-span-2 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-700 shrink-0">
                  <CreditCard className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500">A repassar InfinitePay</div>
                  <div className="text-[10px] text-ink-400 mt-0.5 truncate hidden sm:block">Bruto − taxa real · sem filtro de data</div>
                </div>
              </div>
              {loadingIp && <div className="text-[10px] text-ink-400 animate-pulse shrink-0">Carregando…</div>}
            </div>

            <div className="flex flex-wrap items-baseline gap-2">
              <div className="text-2xl sm:text-3xl font-black num tracking-tight text-sky-700">
                {(loadingIp || ipError) ? '—' : formatCurrency(aRepassarInfinitePay)}
              </div>
              <span className="chip bg-sky-50 text-sky-700 text-[10px] font-bold">
                {(loadingIp || ipError) ? '—' : `${pluralize(ipLinhasARepassar.length, 'venda', 'vendas')} pendentes`}
              </span>
              {!loadingIp && !ipError && totalRepassadoInfinitePay > 0 && (
                <span className="chip bg-emerald-50 text-emerald-700 text-[10px]">
                  +{formatCurrency(totalRepassadoInfinitePay)} repassado
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-ink-400 line-clamp-2">
              Entra no caixa quando você confirmar o recebimento do repasse da operadora.
            </p>

            {ipError && (
              <div className="mt-3 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
                Não foi possível carregar recebíveis InfinitePay.
              </div>
            )}

            <div className="mt-3">
              <button
                onClick={() => {
                  setIpListTab(ipLinhasARepassar.length > 0 ? 'pendentes' : 'repassadas')
                  setShowIpListModal(true)
                }}
                className="btn-secondary btn-block btn-sm flex items-center justify-center gap-1.5"
              >
                <List className="w-4 h-4" /> Ver repasses
              </button>
            </div>
          </div>

          <div className="flex flex-col justify-between p-4 rounded-card bg-gradient-to-br from-sky-500 to-brand-600 text-white shadow-sm min-h-[140px]">
            <div className="flex items-center gap-2 mb-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/75">Disponível / Após crédito</div>
                <div className="text-[10px] text-white/60 mt-0.5 truncate">saldo + recebíveis</div>
              </div>
            </div>
            <div className="kpi-value !text-white num">
              {((loadingCash || loadingIp) || cashError || ipError) ? '—' : formatCurrency(aposCreditoIp)}
            </div>
            <div className="mt-2 text-[10px] text-white/70 line-clamp-2">
              Projeção após crédito da operadora.
            </div>
          </div>

          <div className="flex flex-col justify-between p-4 rounded-card bg-white border border-ink-200 shadow-sm sm:col-span-2 lg:col-span-1 min-h-[140px]">
            <div className="flex items-center justify-between mb-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-700 shrink-0">
                  <Clock className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500">A receber de clientes</div>
                  <div className="text-[10px] text-ink-400 mt-0.5 truncate hidden sm:block">Vendas pendentes</div>
                </div>
              </div>
              {loadingReceiv && <div className="text-[10px] text-ink-400 animate-pulse shrink-0">…</div>}
            </div>
            <div className="kpi-value !text-amber-700 num">
              {(loadingReceiv || receivError) ? '—' : formatCurrency(aReceberGlobal)}
            </div>
            <div className="mt-2 text-[11px] text-ink-400 line-clamp-2">
              {receivablesTotal && !receivError
                ? `${pluralize(receivablesTotal.vendas_pendentes_qtd ?? 0, 'venda', 'vendas')} pendente(s).`
                : 'Não entrou no caixa ainda.'}
            </div>
          </div>
        </div>
      </section>

      {/* MODAL LISTA IP — 2 ABAS: PENDENTES / REPASSADAS */}
      {showIpListModal && typeof document !== 'undefined' && createPortal(
        (
          <>
            <div className="modal-backdrop" aria-hidden onClick={() => setShowIpListModal(false)} />
            <div className="modal-shell" onClick={() => setShowIpListModal(false)}>
          <div className="modal-content modal-wide" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header bg-sky-50/60">
              <div className="flex items-center gap-2 min-w-0">
                <CreditCard className="w-5 h-5 text-sky-700 shrink-0" />
                <div className="min-w-0">
                  <h3 className="modal-title">Repasses InfinitePay</h3>
                  <p className="text-[11px] text-ink-500 mt-0.5">
                    <span className="font-bold text-sky-700 num">{formatCurrency(aRepassarInfinitePay)}</span>
                    {' · '}
                    {ipLinhasARepassar.length} pendentes
                    {' · '}
                    <span className="text-emerald-700 num">{formatCurrency(totalRepassadoInfinitePay)}</span> repassados
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowIpListModal(false)}
                className="btn-icon !min-w-[40px] !min-h-[40px] -mr-1 shrink-0"
                aria-label="Fechar"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-4 sm:px-6 pt-4 grid grid-cols-2 gap-2 border-b border-ink-100">
              <button
                onClick={() => setIpListTab('pendentes')}
                className={
                  'relative pb-3 text-[12px] font-bold transition-colors ' +
                  (ipListTab === 'pendentes'
                    ? 'text-sky-700 '
                    : 'text-ink-400 hover:text-ink-700')
                }
              >
                Pendentes
                {ipLinhasARepassar.length > 0 && (
                  <span className={
                    'ml-2 inline-flex items-center justify-center h-4 min-w-4 px-1.5 rounded-full text-[10px] font-black ' +
                    (ipListTab === 'pendentes' ? 'bg-sky-600 text-white' : 'bg-ink-200 text-ink-600')
                  }>
                    {ipLinhasARepassar.length}
                  </span>
                )}
                {ipListTab === 'pendentes' && (
                  <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-600 rounded-t-sm" aria-hidden />
                )}
              </button>
              <button
                onClick={() => setIpListTab('repassadas')}
                className={
                  'relative pb-3 text-[12px] font-bold transition-colors ' +
                  (ipListTab === 'repassadas'
                    ? 'text-emerald-700 '
                    : 'text-ink-400 hover:text-ink-700')
                }
              >
                Repassados
                {ipLinhasRepassadas.length > 0 && (
                  <span className={
                    'ml-2 inline-flex items-center justify-center h-4 min-w-4 px-1.5 rounded-full text-[10px] font-black ' +
                    (ipListTab === 'repassadas' ? 'bg-emerald-600 text-white' : 'bg-ink-200 text-ink-600')
                  }>
                    {ipLinhasRepassadas.length}
                  </span>
                )}
                {ipListTab === 'repassadas' && (
                  <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-emerald-600 rounded-t-sm" aria-hidden />
                )}
              </button>
            </div>

            <div className="modal-body flex flex-col gap-2.5">
              {ipListTab === 'pendentes' && (
                <>
                  {ipLinhasARepassar.length === 0 && (
                    <div className="p-6 rounded-xl border border-dashed border-ink-200 text-center text-ink-400 text-sm">
                      Nenhum valor a repassar.
                    </div>
                  )}
                  {ipLinhasARepassar.map(r => (
                    <div key={r.sale_payment_id} className="p-3.5 rounded-xl border border-sky-100 bg-sky-50/30 flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {r.sale_friendly_number ? (
                              <span className="chip bg-white text-sky-700 border border-sky-200 text-[10px] font-bold">#{String(r.sale_friendly_number).padStart(4, '0')}</span>
                            ) : null}
                            <span className="text-[11px] text-ink-500">{formatDate(r.sale_date ?? r.payment_created_at)}</span>
                            {r.installments > 1 && (
                              <span className="chip bg-white text-ink-500 text-[10px] border border-ink-200">{r.installments}x</span>
                            )}
                          </div>
                          <div className="mt-1 text-[15px] font-bold text-ink-900 truncate">
                            {r.customer_name ?? 'Cliente não identificado'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-sky-700">Líquido</div>
                          <div className="text-lg font-black num text-sky-700">{formatCurrency(r.liquido)}</div>
                        </div>
                      </div>
                      <div className="text-[11px] text-ink-500 num grid grid-cols-2 gap-2 border-t border-sky-100 pt-2">
                        <div>Bruto: <span className="font-semibold text-ink-700">{formatCurrency(r.bruto)}</span></div>
                        <div>Taxa real: <span className="font-semibold text-rose-600">-{formatCurrency(r.taxa_real)}</span></div>
                      </div>
                      <button
                        onClick={() => {
                          setShowIpListModal(false)
                          setIpSelected(r)
                          setIpFormAmount(r.liquido.toFixed(2).replace('.', ','))
                          setIpFormDate(new Date().toISOString().slice(0, 10))
                          setIpFormNotes('')
                          setIpActionError(null)
                          setIpSuccessMsg(null)
                          setTimeout(() => setShowIpConfirmModal(true), 50)
                        }}
                        className="btn-primary btn-sm btn-block flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Confirmar recebimento
                      </button>
                    </div>
                  ))}
                </>
              )}

              {ipListTab === 'repassadas' && (
                <>
                  {ipLinhasRepassadas.length === 0 && (
                    <div className="p-6 rounded-xl border border-dashed border-ink-200 text-center text-ink-400 text-sm">
                      Nenhum repasse confirmado ainda.
                    </div>
                  )}
                  {ipLinhasRepassadas.map(r => (
                    <div key={r.sale_payment_id} className="p-3.5 rounded-xl border border-emerald-100 bg-emerald-50/40 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {r.sale_friendly_number ? (
                              <span className="chip bg-white text-emerald-700 border border-emerald-200 text-[10px] font-bold">#{String(r.sale_friendly_number).padStart(4, '0')}</span>
                            ) : null}
                            <span className="chip bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider">
                              Repassado
                            </span>
                            {r.repasse_date && (
                              <span className="text-[11px] text-ink-500">Data {formatDate(r.repasse_date)}</span>
                            )}
                            {!r.repasse_date && r.sale_date && (
                              <span className="text-[11px] text-ink-500">Venda {formatDate(r.sale_date ?? r.payment_created_at)}</span>
                            )}
                          </div>
                          <div className="mt-1 text-[14px] font-semibold text-ink-800 truncate">
                            {r.customer_name ?? 'Cliente não identificado'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Líquido</div>
                          <div className="text-lg font-black num text-emerald-700">
                            {formatCurrency(Number(r.repasse_amount ?? r.liquido))}
                          </div>
                        </div>
                      </div>
                      <div className="text-[11px] text-ink-500 num grid grid-cols-2 gap-2 border-t border-emerald-100 pt-2">
                        <div>Bruto: <span className="font-semibold text-ink-700">{formatCurrency(r.bruto)}</span></div>
                        <div>Taxa real: <span className="font-semibold text-rose-600">-{formatCurrency(r.taxa_real)}</span></div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowIpListModal(false)}
                className="btn-secondary btn-block"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
        </>
        ),
        document.body
      )}

      {/* ============================================================
          BLOCO II · RESULTADO DO PERÍODO (accrual)
          ============================================================ */}
      <section>
        <div className="flex items-center gap-2 mb-2 px-0.5">
          <div className="w-1.5 h-5 rounded-full bg-brand-600" />
          <h2 className="font-black text-ink-900 tracking-tight">II · Resultado do período</h2>
          <span className="chip bg-brand-50 text-brand-700 text-[10px] font-bold uppercase tracking-[0.14em]">
            Faturamento − Custos = Lucro
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="card p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-ink-800">Composição do resultado</h3>
              <span className="chip bg-ink-100 text-ink-600">
                {loadingSales ? 'Carregando…' : pluralize(salesRows.length, 'venda')}
              </span>
            </div>

            {salesError && (
              <div className="mb-3 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
                <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Não foi possível carregar as vendas do período</div>
                <div className="mt-0.5 opacity-90 break-words">Tente novamente. Se persistir, contate o suporte.</div>
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
                  { label: 'Receita (total cliente, líquido de desconto)', value: kpis.faturamento, tone: 'bg-brand-600', showPercent: true, total: kpis.faturamento },
                  { label: 'Custo das mercadorias (FIFO/CMV)', value: kpis.custoMerc, tone: 'bg-rose-500', total: kpis.faturamento },
                  kpis.custoAlloc > 0
                    ? { label: 'Rateio de aquisição (frete/impostos em lotes)', value: kpis.custoAlloc, tone: 'bg-rose-400', total: kpis.faturamento }
                    : null,
                  { label: 'Taxas de pagamento (real)', value: kpis.custoTaxas, tone: 'bg-orange-500', total: kpis.faturamento },
                  { label: 'Embalagem gerencial (consumida)', value: kpis.custoEmbalagens, tone: 'bg-violet-500', total: kpis.faturamento },
                  { label: 'Frete / custos extras', value: kpis.custoFrete, tone: 'bg-sky-500', total: kpis.faturamento },
                  { label: 'Lucro real', value: kpis.lucro, tone: kpis.lucro >= 0 ? 'bg-emerald-500' : 'bg-rose-700', total: kpis.faturamento, strong: true },
                ].filter(Boolean) as any} />
                <div className="mt-4 pt-3 border-t border-ink-100 text-[11px] text-ink-500 leading-relaxed grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  <span>Descontos concedidos no período: <b className="text-ink-700 num">{formatCurrency(kpis.descontos)}</b> — já abatidos no faturamento (não é custo).</span>
                  <span>Embalagem gerencial ≠ saída de caixa (dinheiro já saiu quando foram compradas).</span>
                </div>
              </div>
            )}
          </div>

          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-ink-800">KPIs de resultado</h3>
            </div>
            {loadingSales ? (
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-4 bg-ink-100 rounded animate-pulse w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { k: 'Faturamento (líquido)', v: kpis.faturamento, c: 'bg-brand-600', strong: true },
                  kpis.descontos > 0 ? { k: 'Descontos (abatidos)', v: kpis.descontos, c: 'bg-rose-600', strong: false } : null,
                  { k: 'Pedidos', v: kpis.pedidos, c: 'bg-ink-500', strong: false, isCount: true },
                  { k: 'Peças vendidas', v: kpis.pecas, c: 'bg-blue-500', strong: false, isCount: true },
                  { k: 'Ticket médio', v: kpis.ticketMedio, c: 'bg-amber-500', strong: false },
                  { k: 'Margem %', v: kpis.margem / 100, c: 'bg-emerald-600', strong: true, isPercent: true },
                  kpis.custoMerc > 0 ? { k: 'CMV (mercadoria FIFO)', v: kpis.custoMerc, c: 'bg-rose-500', strong: false } : null,
                  kpis.custoAlloc > 0 ? { k: 'Rateio aquisição (lotes)', v: kpis.custoAlloc, c: 'bg-rose-400', strong: false } : null,
                  kpis.custoTaxas > 0 ? { k: 'Taxas de pagamento', v: kpis.custoTaxas, c: 'bg-orange-600', strong: false } : null,
                  kpis.custoEmbalagens > 0 ? { k: 'Embalagem gerencial', v: kpis.custoEmbalagens, c: 'bg-violet-600', strong: false } : null,
                  kpis.custoFrete > 0 ? { k: 'Frete / extras', v: kpis.custoFrete, c: 'bg-sky-600', strong: false } : null,
                ].filter(Boolean).map((r: any, i) => {
                  if (r?.isCount) {
                    return (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={cn('w-2.5 h-2.5 rounded-full', r.c)} />
                          <span className={cn('text-sm', r.strong ? 'font-bold text-ink-900' : 'text-ink-700')}>{r.k}</span>
                        </div>
                        <span className={cn('num', r.strong ? 'text-sm font-black' : 'text-sm font-semibold text-ink-800')}>
                          {String(r.v)}
                        </span>
                      </div>
                    )
                  }
                  if (r?.isPercent) {
                    return (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={cn('w-2.5 h-2.5 rounded-full', r.c)} />
                          <span className={cn('text-sm', r.strong ? 'font-bold text-ink-900' : 'text-ink-700')}>{r.k}</span>
                        </div>
                        <span className={cn('num', r.strong ? 'text-sm font-black text-emerald-700' : 'text-sm font-semibold text-ink-800')}>
                          {formatPercent(r.v * 100)}
                        </span>
                      </div>
                    )
                  }
                  return (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={cn('w-2.5 h-2.5 rounded-full', r.c)} />
                        <span className={cn('text-sm', r.strong ? 'font-bold text-ink-900' : 'text-ink-700')}>{r.k}</span>
                      </div>
                      <span className={cn('num', r.strong ? 'text-sm font-black text-rose-700' : 'text-sm font-semibold text-ink-800')}>
                        {formatCurrency(r.v)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        </div>
      </section>

      {/* ============================================================
          BLOCO III · ESTOQUE (atual)
          ============================================================ */}
      <section>
        <div className="flex items-center gap-2 mb-2 px-0.5">
          <div className="w-1.5 h-5 rounded-full bg-blue-600" />
          <h2 className="font-black text-ink-900 tracking-tight">III · Estoque atual</h2>
          <span className="chip bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-[0.14em]">
            independente de período
          </span>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
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
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Não foi possível carregar o resumo de estoque</div>
              <div className="mt-0.5 opacity-90 break-words">Tente novamente em instantes.</div>
            </div>
          )}

          {loadingStock ? (
            <div className="space-y-2.5 mb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="p-3 rounded-lg bg-ink-50 border border-ink-100">
                    <div className="h-2.5 w-24 bg-ink-200 rounded animate-pulse" />
                    <div className="h-5 w-16 bg-ink-200 rounded mt-1 animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ) : stockError ? null : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-4">
              <MiniKpi label="Peças disponíveis" value={String(stock?.total_units ?? 0)} />
              <MiniKpi label="Custo do estoque (unit_cost + rateio)" value={formatCurrency(stock?.total_stock_cost ?? 0)} />
              <MiniKpi label="Potencial de venda (preço × qtd)" value={formatCurrency(stock?.total_sales_potential ?? 0)} />
              <MiniKpi label="SKUs cadastrados" value={String(stock?.total_skus ?? 0)} />
              <MiniKpi label="Com estoque" value={String(stock?.in_stock_skus ?? 0)} />
              <MiniKpi label="Sem estoque" value={String(stock?.out_of_stock_skus ?? 0)} />
            </div>
          )}

          {!loadingStock && !stockError && stock && Number(stock?.total_units ?? 0) > 0 && (
            <div className="mb-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs">
              <div className="font-bold flex items-center gap-1.5 mb-0.5"><AlertTriangle className="w-3.5 h-3.5" /> Conferência física (referência 21/09/2026)</div>
              <div className="opacity-90 leading-relaxed">
                A loja reportou <b>7 unidades/conjuntos físicos</b> em estoque. O sistema está mostrando <b>{stock?.total_units ?? 0} unidades</b>. Se esses números forem diferentes, use a tela <b>Ajuste de Estoque</b> para reconciliar. Não ajuste automaticamente — confira item por item.
              </div>
            </div>
          )}

          {!loadingStock && !stockError && stock && (
            <>
              {stock.out_of_stock_skus > 0 ? (
                <div className="space-y-2.5">
                  <AlertBlock
                    icon={<AlertTriangle className="w-4 h-4" />}
                    tone="rose"
                    title={`${pluralize(stock.out_of_stock_skus, 'produto', 'produtos')} sem estoque · ${stock.in_stock_skus ?? 0} com estoque`}
                    items={[]}
                  />
                </div>
              ) : <EmptyStateSmall text="Estoque saudável, sem alertas." />}
            </>
          )}
        </div>
      </section>

      {/* ============================================================
          BLOCO IV · OBRIGAÇÕES / VALORES A RESTITUIR
          ============================================================ */}
      <section>
        <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-violet-600" />
            <h2 className="font-black text-ink-900 tracking-tight">IV · Obrigações / Valores a restituir</h2>
            <span className="chip bg-violet-50 text-violet-700 text-[10px] font-bold uppercase tracking-[0.14em]">
              Não reduz caixa enquanto PENDENTE
            </span>
          </div>
          <button
            type="button"
            onClick={openPayModal}
            disabled={obrigacoes.linhas.length === 0 || loadingOblig}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 disabled:cursor-not-allowed text-white text-[12px] font-bold transition-colors shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            Pagar obrigação
          </button>
        </div>
        <div className="card p-5 space-y-3">
          {obligError && (
            <div className="mb-2 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Não foi possível carregar as obrigações</div>
              <div className="mt-0.5 opacity-90 break-words">Tente novamente em instantes.</div>
            </div>
          )}
          {loadingOblig ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-9 bg-ink-100 rounded animate-pulse w-full" />
              ))}
            </div>
          ) : obrigacoes.linhas.length === 0 ? (
            <EmptyStateSmall text="Sem obrigações pendentes conhecidas." />
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
                          {formatPercent(pct, 2)}
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
          <p className="text-[11px] text-ink-500 leading-relaxed pt-1">
            Quando forem efetivamente pagas → saem do caixa naquele momento. Custo já foi contabilizado no estoque/CMV.
          </p>
        </div>
      </section>

      {/* ============================================================
          BLOCO V · PENDÊNCIAS DE CLASSIFICAÇÃO
          ============================================================ */}
      <section>
        <div className="flex items-center gap-2 mb-2 px-0.5">
          <div className="w-1.5 h-5 rounded-full bg-rose-500" />
          <h2 className="font-black text-ink-900 tracking-tight">V · Movimentações a classificar</h2>
          <span className="chip bg-rose-50 text-rose-700 text-[10px] font-bold uppercase tracking-[0.14em]">
            payment_source NULL
          </span>
        </div>
        <div className="card p-5 space-y-4">
          {finError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
              <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Não foi possível carregar o financeiro</div>
              <div className="mt-0.5 opacity-90 break-words">Tente novamente em instantes.</div>
            </div>
          )}
          {!finError && (() => {
            const rows = naoInformado
            const entradas = rows.filter(r => r.trans_type === 'ENTRADA').reduce((s, r) => s + Number(r.amount ?? 0), 0)
            const saidas = rows.filter(r => r.trans_type === 'SAIDA').reduce((s, r) => s + Number(r.amount ?? 0), 0)
            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-rose-50 border border-rose-100">
                    <div>
                      <div className="text-xs text-rose-700 font-semibold">Movimentações pendentes</div>
                      <div className="text-xs text-rose-600/80 mt-0.5">NÃO entram no saldo oficial</div>
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
                  <EmptyStateSmall text="Nenhuma movimentação pendente. Tudo classificado corretamente." />
                ) : (
                  <div className="table-wrap -mx-1">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Tipo</th>
                          <th>Categoria</th>
                          <th>Descrição</th>
                          <th className="text-right">Valor</th>
                          <th>Vínculo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const rowId = (r as any).id ?? r.financial_transaction_id ?? String(r.trans_date) + String(r.amount) + String(r.description ?? '')
                          const amt = Number(r.amount ?? 0)
                          const vinculo: string[] = []
                          if ((r as any).related_sale_id) vinculo.push(`Venda: ${String((r as any).related_sale_id).slice(0, 8)}…`)
                          if ((r as any).related_purchase_id) vinculo.push(`Compra: ${String((r as any).related_purchase_id).slice(0, 8)}…`)
                          if ((r as any).related_obligation_id) vinculo.push(`Obrigação: ${String((r as any).related_obligation_id).slice(0, 8)}…`)
                          return (
                            <tr key={rowId} className="hover:bg-ink-50/50">
                              <td className="text-ink-700 num">{formatDate(r.trans_date, true)}</td>
                              <td>
                                {r.trans_type === 'ENTRADA' ? (
                                  <span className="chip bg-emerald-100 text-emerald-800">ENTRADA</span>
                                ) : (
                                  <span className="chip bg-rose-100 text-rose-800">SAÍDA</span>
                                )}
                              </td>
                              <td className="text-ink-700 text-sm">{String(r.category ?? '—')}</td>
                              <td className="text-ink-700 text-sm max-w-[260px] truncate">{String(r.description ?? 'Sem descrição')}</td>
                              <td className={cn('text-right num font-bold', r.trans_type === 'ENTRADA' ? 'text-emerald-700' : 'text-rose-700')}>
                                {formatCurrency(amt)}
                              </td>
                              <td className="text-xs text-ink-500">
                                {vinculo.length ? vinculo.join(', ') : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="text-[11px] text-ink-500 leading-relaxed pt-1">
                  Estas movimentações <b>NÃO estão</b> sendo consideradas no Saldo em Caixa pois ainda não possuem classificação de origem.
                </p>
              </>
            )
          })()}
        </div>
      </section>

      {/* Pagamentos por método */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card p-5 lg:col-span-1">
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
              <div className="mt-0.5 opacity-90">Não foi possível carregar os detalhes de pagamentos. Tente novamente.</div>
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

        {/* Vendas recentes */}
        <div className="card p-5 lg:col-span-2">
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
            <div className="mt-0.5 opacity-90">Não foi possível carregar o histórico. Tente novamente em instantes.</div>
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
                      <td className="text-right num font-bold text-ink-900">{formatCurrency((r as any).total_customer ?? r.revenue)}</td>
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
      </section>

      {showIpConfirmModal && ipSelected && typeof document !== 'undefined' && createPortal(
        (
          <div
            className="modal-shell"
            onClick={(e) => { if (e.target === e.currentTarget && !ipLoading) setShowIpConfirmModal(false) }}
          >
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header !bg-sky-50">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-sky-600 flex items-center justify-center flex-shrink-0">
                    <CreditCard className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="modal-title">Confirmar recebimento InfinitePay</h3>
                    <p className="text-[11px] text-sky-700 mt-1">
                      Cria ENTRADA / REPASSE_INFINITEPAY no caixa Eveline.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !ipLoading && setShowIpConfirmModal(false)}
                  disabled={ipLoading}
                  className="btn-icon"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form id="ip-repasse-form" onSubmit={handleSubmitIpRepasse} className="modal-body space-y-4">
                <div className="p-4 rounded-xl border border-sky-100 bg-sky-50/40 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-ink-500 text-xs uppercase tracking-[0.08em] font-bold">Venda</span>
                    <span className="num font-bold text-sky-800">
                      #{String(ipSelected.sale_friendly_number ?? '').padStart(4, '0') || 'Sem número'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-500">Cliente</span>
                    <span className="font-semibold text-ink-900 truncate max-w-[220px] text-right">{ipSelected.customer_name ?? 'Não identificado'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-500">Data da venda</span>
                    <span className="num text-ink-800">{formatDate(ipSelected.sale_date ?? ipSelected.payment_created_at)}</span>
                  </div>
                  {ipSelected.installments > 1 && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-500">Parcelamento</span>
                      <span className="num text-ink-800">{ipSelected.installments}x</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl border border-ink-100 bg-white">
                    <div className="text-[10px] font-bold uppercase text-ink-400 tracking-[0.08em]">Bruto</div>
                    <div className="mt-1 text-lg font-black num text-ink-800">{formatCurrency(ipSelected.bruto)}</div>
                  </div>
                  <div className="p-3 rounded-xl border border-rose-100 bg-rose-50/40">
                    <div className="text-[10px] font-bold uppercase text-rose-500 tracking-[0.08em]">Taxa real</div>
                    <div className="mt-1 text-lg font-black num text-rose-700">−{formatCurrency(ipSelected.taxa_real)}</div>
                  </div>
                  <div className="p-3 rounded-xl border border-emerald-100 bg-emerald-50/50">
                    <div className="text-[10px] font-bold uppercase text-emerald-600 tracking-[0.08em]">Líquido</div>
                    <div className="mt-1 text-lg font-black num text-emerald-700">{formatCurrency(ipSelected.liquido)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Valor recebido (R$)</label>
                    <input
                      type="text"
                      value={ipFormAmount}
                      onChange={(e) => setIpFormAmount(e.target.value)}
                      disabled={ipLoading}
                      placeholder="ex: 501,15"
                      className="w-full h-12 px-3.5 rounded-xl border border-ink-200 bg-white text-sm num focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-400 disabled:bg-ink-50"
                    />
                    <p className="mt-1 text-[10px] text-ink-500">
                      Preenchido com o líquido esperado. Ajuste se houver diferença real.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Data do crédito</label>
                    <input
                      type="date"
                      value={ipFormDate}
                      onChange={(e) => setIpFormDate(e.target.value)}
                      disabled={ipLoading}
                      className="w-full h-12 px-3.5 rounded-xl border border-ink-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-400 disabled:bg-ink-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Observações (opcional)</label>
                  <textarea
                    rows={2}
                    value={ipFormNotes}
                    onChange={(e) => setIpFormNotes(e.target.value)}
                    disabled={ipLoading}
                    placeholder="Ex: comprovante nº 123.456, diferença R$0,15 de tarifário adicional, etc."
                    className="w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-400 disabled:bg-ink-50 resize-none"
                  />
                </div>

                {ipActionError && (
                  <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" /> Não foi possível confirmar o repasse
                    </div>
                    <div className="mt-0.5 opacity-90">{ipActionError}</div>
                  </div>
                )}

                {ipSuccessMsg && (
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs">
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Repasse registrado
                    </div>
                    <div className="mt-0.5 opacity-90">{ipSuccessMsg}</div>
                  </div>
                )}

              </form>
              <div className="modal-footer flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  disabled={ipLoading}
                  onClick={() => !ipLoading && setShowIpConfirmModal(false)}
                  className="btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="ip-repasse-form"
                  onClick={handleSubmitIpRepasse}
                  disabled={ipLoading}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {ipLoading
                    ? <span className="animate-pulse">Registrando…</span>
                    : <><CheckCircle2 className="w-4 h-4" /> Confirmar recebimento</>
                  }
                </button>
              </div>
            </div>
          </div>
        ),
        document.body
      )}

      {showPayModal && typeof document !== 'undefined' && createPortal(
        (
          <div
            className="modal-shell"
            onClick={(e) => { if (e.target === e.currentTarget && !payLoading) setShowPayModal(false) }}
          >
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header !bg-violet-50">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="modal-title">Registrar pagamento de obrigação</h3>
                    <p className="text-[11px] text-violet-700 mt-1">
                      O valor será lançado como SAÍDA / PAGAMENTO_OBRIGACAO no caixa Eveline.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !payLoading && setShowPayModal(false)}
                  disabled={payLoading}
                  className="btn-icon"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form id="pay-obligation-form" onSubmit={handleSubmitPay} className="modal-body space-y-4">
                <div>
                  <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Obrigação a pagar</label>
                  <select
                    value={paySelectedObligationId}
                    onChange={(e) => onSelectObligationChange(e.target.value)}
                    disabled={payLoading}
                    className="w-full h-12 px-3.5 rounded-xl border border-ink-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-ink-50 disabled:text-ink-500"
                  >
                    <option value="">Selecione uma obrigação…</option>
                    {obligationsRows
                      .filter(o => o.status !== 'PAGO' && o.status !== 'CANCELADO')
                      .map(o => {
                        const remaining = Number(o.remaining_balance ?? o.amount ?? 0)
                        const original = Number(o.amount ?? 0)
                        const pctPaid = original > 0 ? Math.min(100, (Number(o.amount_paid ?? 0) / original) * 100) : 0
                        return (
                          <option key={String(o.id)} value={String(o.id)}>
                            {o.creditor_name} — {formatCurrency(remaining)} restante
                            {pctPaid > 0 ? ` (${pctPaid.toFixed(0)}% pago)` : ''}
                            {' '}· {o.status}
                          </option>
                        )
                      })
                    }
                  </select>
                  {paySelectedObligationId && (() => {
                    const obl = obligationsRows.find(o => String(o.id) === paySelectedObligationId)
                    if (!obl) return null
                    const paid = Number(obl.amount_paid ?? 0)
                    const total = Number(obl.amount ?? 0)
                    return (
                      <div className="mt-2 p-3 rounded-xl bg-violet-50/60 border border-violet-100 text-[11px] text-violet-900 space-y-1">
                        {obl.description && <div><span className="font-semibold">Motivo:</span> {obl.description}</div>}
                        <div><span className="font-semibold">Valor original:</span> {formatCurrency(total)}</div>
                        <div><span className="font-semibold">Já pago:</span> {formatCurrency(paid)}</div>
                        <div><span className="font-semibold">Saldo restante:</span> {formatCurrency(Number(obl.remaining_balance ?? total - paid))}</div>
                      </div>
                    )
                  })()}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Valor a pagar (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0,00"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      disabled={payLoading}
                      className="w-full h-12 px-3.5 rounded-xl border border-ink-200 bg-white text-sm num focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-ink-50"
                    />
                    <p className="mt-1 text-[10px] text-ink-500">
                      Use ponto ou vírgula para decimais. Pagamento parcial permitido.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Data do pagamento</label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      disabled={payLoading}
                      className="w-full h-12 px-3.5 rounded-xl border border-ink-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-ink-50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Forma de pagamento</label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      disabled={payLoading}
                      className="w-full h-12 px-3.5 rounded-xl border border-ink-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-ink-50"
                    >
                      {['PIX','DINHEIRO','DEBITO','CREDITO','BOLETO','TRANSFERENCIA','OUTRO'].map(m => (
                        <option key={m} value={m}>{paymentMethodLabel(m)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">
                      Nº comprovante (opcional)
                    </label>
                    <input
                      type="text"
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                      disabled={payLoading}
                      placeholder="ex: TXID do PIX, nº boleto"
                      className="w-full h-12 px-3.5 rounded-xl border border-ink-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-ink-50"
                    />
                    <p className="mt-1 text-[10px] text-ink-500">
                      Usado para idempotência: mesmo comprovante 2x → NÃO duplica saída.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink-700 mb-1.5 uppercase tracking-[0.08em]">Observações (opcional)</label>
                  <textarea
                    rows={2}
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    disabled={payLoading}
                    placeholder="Ex: pagamento em dinheiro, segunda parcela, etc."
                    className="w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-ink-50 resize-none"
                  />
                </div>

                {payActionError && (
                  <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs">
                    <div className="font-bold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Não foi possível registrar</div>
                    <div className="mt-0.5 opacity-90 break-words">{payActionError}</div>
                  </div>
                )}

                {paySuccessMsg && (
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs">
                    <div className="font-bold flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Sucesso</div>
                    <div className="mt-0.5 opacity-90 break-words">{paySuccessMsg}</div>
                  </div>
                )}

              </form>
              <div className="modal-footer flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => !payLoading && setShowPayModal(false)}
                  disabled={payLoading}
                  className="btn-secondary flex-1 sm:flex-none"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="pay-obligation-form"
                  disabled={payLoading || !paySelectedObligationId}
                  className="btn-primary !bg-violet-600 hover:!bg-violet-700 flex-1 sm:flex-[1.5]"
                >
                  {payLoading ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Registrando…
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Confirmar pagamento
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ),
        document.body
      )}
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
    <div className="kpi-card min-w-0">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <span className="kpi-label min-w-0">{label}</span>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center ring-1 flex-shrink-0', tones[tone])}>{icon}</div>
      </div>
      <div className="kpi-value num whitespace-nowrap overflow-hidden text-ellipsis">{value}</div>
      {sub && <div className="kpi-sub min-w-0">{sub}</div>}
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
