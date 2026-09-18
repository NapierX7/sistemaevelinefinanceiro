import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, X, AlertTriangle, Check, ShoppingBag, Tag, MapPin, CreditCard, PackageCheck, Receipt, DollarSign, Trash2, Package, ArrowDownRight, Edit3, Wallet, Calculator, Save, Pencil, UserCircle, CalendarDays, Clock
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, formatDateTime, formatFriendlyNumber, parseBrl, sourceLabel, statusLabel, paymentMethodLabel, pluralize, cn
} from '@/lib/format'
import type { Sale, SaleItem, SalePayment, SalePackaging, SaleCost, UUID, PaymentMethod, SaleStatus, SaleSource } from '@/types/supabase'
import { getSaleDetail, cancelSale, recordRemainingPayment, updateSale, updateSalePayment, deleteSalePayment, onInvalidate, dispatchInvalidateAll } from '@/services'

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<{
    sale: Sale; items: SaleItem[]; payments: SalePayment[]; packaging: SalePackaging | null; costs: SaleCost[]
  } | null>(null)

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelStep, setCancelStep] = useState<1 | 2>(1)
  const [cancelReason, setCancelReason] = useState('')
  const [canceling, setCanceling] = useState(false)

  const [quitOpen, setQuitOpen] = useState(false)
  const [quitMethod, setQuitMethod] = useState<PaymentMethod>('PIX')
  const [quitAmount, setQuitAmount] = useState<string>('')
  const [quitFee, setQuitFee] = useState<string>('')
  const [quitDate, setQuitDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [quitNotes, setQuitNotes] = useState<string>('')
  const [quiting, setQuiting] = useState(false)

  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [patch, setPatch] = useState<{
    customer_name: string;
    customer_phone: string;
    sale_date: string;
    source: SaleSource;
    status: SaleStatus;
    total_customer: string;
    notes: string;
  }>({
    customer_name: '',
    customer_phone: '',
    sale_date: '',
    source: 'PRESENCIAL',
    status: 'CONCLUIDA',
    total_customer: '',
    notes: '',
  })

  const [paymentEdit, setPaymentEdit] = useState<{
    open: boolean;
    paymentId: UUID | null;
    method: PaymentMethod;
    provider_snapshot: string;
    modality_snapshot: string;
    amount: string;
    fee_expected_snapshot: string;
    fee_real_snapshot: string;
    fee_percent_snapshot: string;
    installments: number;
    notes_snapshot: string;
  }>({
    open: false, paymentId: null, method: 'PIX', provider_snapshot: '',
    modality_snapshot: '', amount: '', fee_expected_snapshot: '',
    fee_real_snapshot: '', fee_percent_snapshot: '', installments: 1, notes_snapshot: ''
  })

  // Feedback visual inline (substitui alert() nativo — requisito do projeto)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const showFeedback = (type: 'ok' | 'err', msg: string, ms = 4200) => {
    setToast({ type, msg })
    window.clearTimeout((showFeedback as any)._t)
    ;(showFeedback as any)._t = window.setTimeout(() => setToast(null), ms)
  }

  const load = () => {
    if (!id) return
    setLoading(true)
    getSaleDetail(id as UUID)
      .then(d => setDetail(d ?? null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    const cleanup = onInvalidate((scope) => {
      if (scope === 'all' || scope === 'sales' || scope === 'dashboard' || scope === 'financial') {
        load()
      }
    })
    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const s = detail?.sale
  const items = detail?.items ?? []
  const payments = detail?.payments ?? []
  const packaging = detail?.packaging
  const costs = detail?.costs ?? []
  const primaryPay = payments[0]

  const canCancel = useMemo(() => {
    if (!s) return false
    if (s.status === 'CANCELADA' || (s as any).cancelled === true) return false
    return s.status === 'CONCLUIDA' || s.status === 'PENDENTE' || s.status === 'PARCIAL'
  }, [s])

  const totalDescProdutos = items.reduce((sum, i) => sum + Number(i.discount ?? 0), 0)

  const cogsTotal = Number(s?.items_cost ?? (s as any)?.cogs_total ?? 0)
  // ==========================================================================
  // LUCRO REAL: composição OFICIAL, 100% baseada em snapshots históricos
  // de sales (NÃO recalcula com produtos.xxx atuais, NÃO usa estoque atual).
  //
  // FÓRMULA CANÔNICA (usada no Supabase SQL do backend):
  //   real_profit =
  //     total_customer                 (valor líquido pago pelo cliente,
  //                                     DESCONTOS já aplicados — NÃO abater
  //                                     pix_discount/total_discounts NOVAMENTE
  //                                     para não fazer desconto duplo)
  //     - items_cost                   (COGS: unit_cost_snapshot * qty
  //                                     FIFO dos sale_items)
  //     - allocated_purchase_cost      (rateio da compra: frete + outros
  //                                     rateados dos lotes consumidos nesta
  //                                     venda — este é o R$12,55 da Venda#41
  //                                     que entrava silenciosamente na conta
  //                                     mas não era exibido no bloco anterior)
  //     - fee_actual                   (taxas de pagamento REALMENTE cobradas)
  //     - packaging_cost               (embalagem snapshot)
  //     - extra_costs                  (custos extras lançados)
  //     - shipping_cost_snapshot       (frete, se houver)
  //
  // margem = real_profit / total_customer * 100
  //
  // IMPORTANTE — Evitar dupla contabilização do desconto:
  //   total_customer NÃO é (preço cheio), é (líquido com desconto).
  //   NÃO subtrair total_discounts / pix_discount mais de uma vez.
  // ==========================================================================
  const rateioCompraTotal = Number(s?.allocated_purchase_cost ?? 0)
  const feeActualTotal = Number(s?.fee_actual ?? (s as any)?.fee_actual_total ?? 0)
  const feeExpectedTotal = Number(s?.fee_expected ?? 0)
  const packCostActual = packaging ? (packaging.is_free ? 0 : Number(packaging.custom_cost ?? packaging.custo_snapshot ?? 0))
    : Number((s as any)?.packaging_cost_actual ?? s?.packaging_cost ?? 0)
  const extraCostsTotal = costs.reduce((sum, c) => sum + Number(c.amount ?? 0), 0)
  const shipCost = Number((s as any)?.shipping_cost_snapshot ?? 0)
  const custoTotalSnapshot = cogsTotal + rateioCompraTotal + feeActualTotal + packCostActual + extraCostsTotal + shipCost
  // Preferência total pelo snapshot oficial sales.real_profit do banco (que
  // bate 100% com a view v_dashboard_sales). Usamos a fórmula local apenas
  // se o banco por algum motivo não populou real_profit.
  const lucroReal = s && typeof s.real_profit === 'number' && isFinite(Number(s.real_profit))
    ? Number(s.real_profit)
    : (Number(s?.total_customer ?? 0) - custoTotalSnapshot)
  const margem = s && (Number(s.total_customer ?? 0) > 0.009)
    ? (lucroReal / Number(s.total_customer)) * 100
    : 0

  const taxaEconomia = feeExpectedTotal - feeActualTotal

  const paidTotal = useMemo(
    () => payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
    [payments]
  )
  const pendingBalance = useMemo(() => {
    const total = Number(s?.total_customer ?? 0)
    return Math.max(0, +(total - paidTotal).toFixed(2))
  }, [s, paidTotal])
  const isPartialOrPending = s?.status === 'PARCIAL' || s?.status === 'PENDENTE'

  const openEditMode = () => {
    if (!s) return
    const d = s.sale_date ?? s.created_at ?? new Date().toISOString()
    const justDate = d.slice(0, 10)
    setPatch({
      customer_name: s.customer_name ?? '',
      customer_phone: s.customer_phone ?? '',
      sale_date: justDate,
      source: s.source,
      status: s.status,
      total_customer: String(Number(s.total_customer ?? 0).toFixed(2)),
      // Sem cast necessário agora; `notes` faz parte do tipo Sale oficial.
      notes: String(s.notes ?? s.cancel_reason ?? ''),
    })
    setEditMode(true)
  }

  const closeEditMode = () => {
    setEditMode(false)
    setPaymentEdit({ ...paymentEdit, open: false })
  }

  const openPaymentEdit = (p: SalePayment) => {
    setPaymentEdit({
      open: true,
      paymentId: p.id,
      method: p.method,
      provider_snapshot: p.provider_snapshot ?? '',
      modality_snapshot: p.modality_snapshot ?? '',
      amount: String(Number(p.amount ?? 0).toFixed(2)),
      fee_expected_snapshot: String(Number(p.fee_expected_snapshot ?? 0).toFixed(2)),
      fee_real_snapshot: String(Number(p.fee_real_snapshot ?? 0).toFixed(2)),
      fee_percent_snapshot: String(Number((p as any).fee_percent_snapshot ?? 0).toFixed(2)),
      installments: Number(p.installments ?? 1),
      notes_snapshot: String((p as any).notes ?? (p as any).notes_snapshot ?? ''),
    })
  }

  const confirmPaymentEdit = async () => {
    if (!paymentEdit.paymentId) return
    try {
      setSaving(true)
      const amountNum = parseBrl(paymentEdit.amount)
      const feeExp = parseBrl(paymentEdit.fee_expected_snapshot) ?? 0
      const feeReal = parseBrl(paymentEdit.fee_real_snapshot) ?? 0
      const feePerc = parseBrl(paymentEdit.fee_percent_snapshot) ?? 0
      await updateSalePayment(paymentEdit.paymentId, {
        method: paymentEdit.method,
        provider_snapshot: paymentEdit.provider_snapshot.trim() || undefined,
        modality_snapshot: paymentEdit.modality_snapshot.trim() || undefined,
        amount: amountNum || 0,
        fee_expected_snapshot: feeExp,
        fee_real_snapshot: feeReal,
        fee_percent_snapshot: feePerc,
        installments: Math.max(1, Number(paymentEdit.installments) || 1),
        notes_snapshot: paymentEdit.notes_snapshot.trim() || undefined,
      })
      setPaymentEdit({ ...paymentEdit, open: false })
      showFeedback('ok', 'Pagamento atualizado com sucesso.')
      dispatchInvalidateAll()
      load()
    } catch (e: any) {
      console.error('[SaleDetail] erro ao atualizar pagamento:', e)
      showFeedback('err', 'Erro ao atualizar pagamento: ' + (e?.message ?? String(e)))
    } finally {
      setSaving(false)
    }
  }

  const doDeletePayment = async (paymentId: UUID) => {
    if (!confirm('Tem certeza que deseja EXCLUIR este registro de pagamento?\n\nEsta ação não pode ser desfeita.')) return
    try {
      setSaving(true)
      await deleteSalePayment(paymentId)
      showFeedback('ok', 'Pagamento excluído com sucesso.')
      dispatchInvalidateAll()
      load()
    } catch (e: any) {
      console.error('[SaleDetail] erro ao excluir pagamento:', e)
      showFeedback('err', 'Erro ao excluir pagamento: ' + (e?.message ?? String(e)))
    } finally {
      setSaving(false)
    }
  }

  const savePatch = async () => {
    if (!s) return
    try {
      setSaving(true)
      const totalNum = parseBrl(patch.total_customer) ?? 0
      if (totalNum < 0) { showFeedback('err', 'Total do cliente não pode ser negativo.'); return }

      // Payload EXPLÍCITO com APENAS colunas REAIS editáveis de public.sales.
      // Nunca enviamos objetos do estado React diretamente para .update()
      // para evitar colunas que não existem no schema (ex.: "notes" desatualizado
      // gerava "Could not find the 'notes' column...").
      const payload: Partial<Sale> = {
        customer_name: patch.customer_name.trim() || null,
        customer_phone: patch.customer_phone.trim() || null,
        source: patch.source,
        status: patch.status,
        total_customer: Number(totalNum),
        notes: patch.notes.trim().length ? patch.notes.trim() : null,
      }
      if (patch.sale_date) {
        payload.sale_date = new Date(patch.sale_date + 'T12:00:00').toISOString()
      }
      payload.updated_at = new Date().toISOString()

      const res = await updateSale(s.id, payload)
      if (!res) throw new Error('Sem retorno do servidor ao salvar venda.')

      showFeedback('ok', 'Venda atualizada com sucesso.')
      closeEditMode()
      dispatchInvalidateAll()
      load()
    } catch (e: any) {
      console.error('[SaleDetail] erro ao salvar patch da venda:', e)
      showFeedback('err', 'Erro ao salvar alterações: ' + (e?.message ?? String(e)))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (s && window.location.hash === '#editar' && !editMode && !loading) {
      openEditMode()
    }
  }, [s, loading])

  useEffect(() => {
    if (editMode && s) {
      openEditMode()
    }
  }, [s])

  const openQuit = () => {
    if (!s) return
    setQuitMethod('PIX')
    setQuitAmount(String(pendingBalance.toFixed(2)))
    setQuitFee('0')
    setQuitDate(new Date().toISOString().slice(0, 10))
    setQuitNotes('')
    setQuitOpen(true)
  }

  const doQuit = async () => {
    if (!s) return
    try {
      const amountNum = parseBrl(quitAmount)
      if (!amountNum || amountNum <= 0) { showFeedback('err', 'Informe um valor válido.'); return }
      if (amountNum > (pendingBalance + 0.01)) { showFeedback('err', `Valor ${formatCurrency(amountNum)} > saldo pendente ${formatCurrency(pendingBalance)}. Reduza.`); return }
      const feeNum = parseBrl(quitFee) ?? 0
      setQuiting(true)
      const res = await recordRemainingPayment(s.id, {
        amount: amountNum,
        trans_date: quitDate,
        notes: quitNotes.trim() || undefined,
        payment: {
          method: quitMethod,
          provider_snapshot: quitMethod === 'PIX' ? 'Pix Direto' : quitMethod === 'DINHEIRO' ? 'Dinheiro' : quitMethod === 'OUTRO' ? 'Outro' : quitMethod,
          modality_snapshot: quitMethod === 'PIX' ? 'Pix à vista' : quitMethod === 'DINHEIRO' ? 'Dinheiro' : 'Outro',
          fee_expected: feeNum,
          fee_actual: feeNum,
          fee_percent: 0,
          installments: 1,
        },
      })
      if ((res as any)?.error) {
        throw new Error(String((res as any).error))
      }
      showFeedback('ok', `Pagamento de ${formatCurrency(amountNum)} registrado. Status: ${(res as any)?.new_status ?? 'CONCLUIDA'}`)
      setQuitOpen(false)
      dispatchInvalidateAll()
      load()
    } catch (e: any) {
      console.error('[SaleDetail] erro ao registrar pagamento restante:', e)
      showFeedback('err', 'Erro: ' + (e?.message ?? String(e)))
    } finally {
      setQuiting(false)
    }
  }

  const doCancel = async () => {
    if (!s) return
    if (!cancelReason.trim()) { showFeedback('err', 'Informe o motivo do cancelamento.'); return }
    try {
      setCanceling(true)
      await cancelSale(s.id, cancelReason.trim())
      showFeedback('ok', 'Venda cancelada com sucesso.')
      setCancelOpen(false)
      setCancelStep(1)
      setCancelReason('')
      dispatchInvalidateAll()
      load()
    } catch (e: any) {
      console.error('[SaleDetail] erro ao cancelar venda:', e)
      showFeedback('err', 'Erro ao cancelar: ' + (e?.message ?? String(e)))
    } finally {
      setCanceling(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-ink-500 text-sm">Carregando detalhe da venda…</div>
      </div>
    )
  }
  if (!s) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h2 className="text-lg font-black text-ink-900">Venda não encontrada</h2>
        <p className="text-sm text-ink-500 max-w-sm">A venda que você tentou acessar não existe ou foi removida.</p>
        <Link to="/vendas" className="btn-primary mt-2"><ArrowLeft className="w-4 h-4" /> Voltar para histórico</Link>
      </div>
    )
  }

  const st = statusLabel(s.status)
  const isCancelled = s.status === 'CANCELADA' || !!(s as any).cancelled

  return (
    <div className="pb-24 sm:pb-8 space-y-4">
      {/* Feedback inline (ok/erro) — substitui alert() nativo */}
      {toast && (
        <div
          role="status"
          className={cn(
            'rounded-xl border shadow-sm px-4 py-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2',
            toast.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          )}
        >
          <Check className={cn('w-5 h-5 flex-shrink-0 mt-0.5',
            toast.type === 'ok' ? 'text-emerald-600' : 'text-rose-600')} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold leading-snug">
              {toast.type === 'ok' ? 'Sucesso' : 'Ops'}
            </div>
            <div className="text-sm mt-0.5 break-words">{toast.msg}</div>
          </div>
          <button
            onClick={() => setToast(null)}
            className="btn-ghost !p-1.5 flex-shrink-0"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isCancelled && (
        <div className="rounded-xl bg-rose-50 border-2 border-rose-200 p-4 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-black text-rose-900">Venda CANCELADA</div>
            <div className="text-sm text-rose-800 mt-0.5 space-y-0.5">
              {s.cancelled_at && <div>Em <strong className="num">{formatDateTime(s.cancelled_at)}</strong></div>}
              {s.cancel_reason && (
                <div>Motivo: <strong className="break-words">{s.cancel_reason}</strong></div>
              )}
            </div>
          </div>
        </div>
      )}

      {!isCancelled && isPartialOrPending && (
        <div className="rounded-xl bg-amber-50 border-2 border-amber-200 p-4 flex items-start gap-3">
          <Wallet className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="font-black text-amber-900 flex items-center gap-2 flex-wrap">
              {s.status === 'PARCIAL' ? 'Venda PARCIALMENTE PAGA' : 'Venda PENDENTE (não recebida)'}
              <span className="chip bg-amber-100 text-amber-800">
                {payments.length} pagamento(s) · total recebido {formatCurrency(paidTotal)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="p-2 rounded-lg bg-white border border-amber-100">
                <div className="text-[11px] uppercase tracking-wider text-amber-700 font-bold">Total venda</div>
                <div className="text-lg font-black num text-amber-900 mt-0.5">{formatCurrency(Number(s.total_customer ?? 0))}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-amber-100">
                <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-bold">Recebido</div>
                <div className="text-lg font-black num text-emerald-700 mt-0.5">{formatCurrency(paidTotal)}</div>
              </div>
              <div className="p-2 rounded-lg bg-rose-50 border border-rose-100">
                <div className="text-[11px] uppercase tracking-wider text-rose-700 font-bold">A receber</div>
                <div className="text-xl font-black num text-rose-700 mt-0.5">{formatCurrency(pendingBalance)}</div>
              </div>
            </div>
            <div className="pt-1">
              <button onClick={openQuit} className="btn-primary min-h-[44px]">
                <Wallet className="w-4 h-4" /> Registrar pagamento restante
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link to="/vendas" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800 mb-2">
            <ArrowLeft className="w-4 h-4" /> ← Histórico de vendas
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900">
              Venda #{String(s.friendly_number ?? '')}
            </h1>
            {editMode ? (
              <div className="flex items-center gap-1.5 pr-1 min-h-[34px]">
                <span className="chip bg-ink-100 text-ink-500 text-[11px] uppercase tracking-wider font-bold">Status</span>
                <select
                  value={patch.status}
                  onChange={e => setPatch(p => ({ ...p, status: e.target.value as SaleStatus }))}
                  className="!h-[32px] !py-1 px-2 text-sm font-bold rounded-lg border border-brand-400 bg-brand-50 text-brand-900"
                  disabled={saving}
                >
                  <option value="CONCLUIDA">Concluída</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="PARCIAL">Parcialmente paga</option>
                  <option value="CANCELADA">Cancelada</option>
                  <option value="REEMBOLSADA">Reembolsada</option>
                </select>
              </div>
            ) : (
              <span className={st.class}>{st.label}</span>
            )}
          </div>
          <div className="text-sm text-ink-500 mt-1 num flex items-center gap-1.5 flex-wrap">
            {editMode ? (
              <>
                <CalendarDays className="w-4 h-4" />
                <input
                  type="date"
                  value={patch.sale_date}
                  onChange={e => setPatch(p => ({ ...p, sale_date: e.target.value }))}
                  className="bg-transparent border-b border-dashed border-brand-400 !h-[32px] px-1 !py-0 text-sm num"
                  disabled={saving}
                />
              </>
            ) : (
              <>
                <Clock className="w-4 h-4" />
                {formatDateTime(s.sale_date ?? s.created_at)}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {editMode ? (
            <>
              <button
                onClick={closeEditMode}
                disabled={saving}
                className="btn-secondary flex-1 sm:flex-none min-h-[44px]"
              >
                <X className="w-4 h-4" /> Cancelar edição
              </button>
              <button
                onClick={savePatch}
                disabled={saving}
                className="btn-primary flex-1 sm:flex-none min-h-[44px]"
              >
                <Save className="w-4 h-4" /> {saving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </>
          ) : (
            <button
              onClick={openEditMode}
              disabled={saving}
              className="btn-secondary min-h-[44px]"
            >
              <Pencil className="w-4 h-4" /> Editar venda
            </button>
          )}
          {!isCancelled && canCancel && !editMode && (
            <button onClick={() => setCancelOpen(true)} className="btn-danger min-h-[44px]">
              <Trash2 className="w-4 h-4" /> Cancelar venda
            </button>
          )}
        </div>
      </div>

      {editMode && (
        <div className="rounded-xl bg-brand-50 border-2 border-brand-200 p-3.5 flex items-start gap-3">
          <Edit3 className="w-5 h-5 text-brand-800 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-sm">
            <div className="font-black text-brand-900">Modo de edição ativo</div>
            <div className="text-brand-800/80 mt-0.5">
              Você pode alterar cliente, data, origem, status, valor total, observações e dados de pagamentos.
              Não se esqueça de clicar em <strong>Salvar alterações</strong> no canto superior quando terminar.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-800 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-brand-700" /> Itens da venda
              </h3>
              <span className="chip bg-ink-100 text-ink-600">{pluralize(items.length, 'item')}</span>
            </div>
            <div className="table-wrap">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="text-right">SKU</th>
                    <th className="text-right">Qtd</th>
                    <th className="text-right">Preço unit.</th>
                    <th className="text-right">Desc un.</th>
                    <th className="text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-ink-500 text-sm">Sem itens.</td></tr>
                  ) : items.map(i => (
                    <tr key={i.id}>
                      <td>
                        <div className="font-semibold text-ink-900 truncate">{i.product_name_snapshot}</div>
                        {i.variant_snapshot && <div className="text-[11px] text-ink-500 mt-0.5">{i.variant_snapshot}</div>}
                      </td>
                      <td className="text-right text-xs text-ink-500 num">{i.sku_snapshot ?? '-'}</td>
                      <td className="text-right num font-bold">{i.quantity}</td>
                      <td className="text-right num">{formatCurrency(i.unit_sale_price_snapshot)}</td>
                      <td className="text-right num text-rose-700">
                        {i.discount > 0 ? `-${formatCurrency(i.discount / i.quantity)}` : '-'}
                      </td>
                      <td className="text-right num font-black text-ink-900">{formatCurrency(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-800 flex items-center gap-2">
                <Tag className="w-4 h-4 text-amber-600" /> Descontos concedidos
              </h3>
              {editMode && (
                <span className="chip bg-amber-50 text-amber-800 !py-0.5 !text-[11px]">Total cliente editável</span>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Subtotal dos itens (bruto)" value={formatCurrency(s.items_subtotal ?? 0)} />
              <div className="pl-3 border-l-2 border-amber-100 ml-2 space-y-2 my-2">
                <Row label="↓ Desconto nos produtos" value={formatCurrency(totalDescProdutos)} negative />
                <Row label="↓ Desconto geral" value={formatCurrency(s.general_discount ?? 0)} negative />
                {(s.coupon_discount ?? 0) > 0 && (
                  <Row label={`↓ Cupom [${s.coupon_snapshot ?? '—'}]`} value={formatCurrency(s.coupon_discount)} negative />
                )}
                {(s.pix_discount ?? 0) > 0 && (
                  <Row label="↓ Desconto Pix" value={formatCurrency(s.pix_discount)} negative />
                )}
              </div>
              <div className="border-t border-ink-100 my-2 pt-2">
                <Row label="= Total descontos" value={formatCurrency(s.total_discounts ?? 0)} negative strong />
              </div>
            </div>
            {editMode ? (
              <div className="mt-4 p-4 rounded-xl bg-brand-900 text-white space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-white/70">Total cliente (final)</div>
                    <div className="text-[11px] text-white/50 mt-0.5">valor final após todos descontos</div>
                  </div>
                  <DollarSign className="w-5 h-5 text-white/60" />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-bold text-white/70">Novo valor total do cliente</label>
                  <div className="mt-1.5 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/80 font-black text-lg num">R$</span>
                    <input
                      value={patch.total_customer}
                      onChange={e => setPatch(p => ({ ...p, total_customer: e.target.value }))}
                      placeholder="Ex: 130,00"
                      className="input !pl-12 !text-right !text-2xl !font-black num !bg-white/10 !border-white/20 text-white placeholder:text-white/40 focus:!border-white/50"
                      disabled={saving}
                    />
                  </div>
                  <div className="text-[11px] text-white/60 mt-1.5">
                    Altere este valor se precisar ajustar o total final recebido do cliente.
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 p-4 rounded-xl bg-brand-900 text-white flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-white/70">Total cliente (pago)</div>
                  <div className="text-[11px] text-white/50 mt-0.5">valor final após todos descontos</div>
                </div>
                <div className="text-3xl font-black num">{formatCurrency(s.total_customer ?? 0)}</div>
              </div>
            )}
          </div>

          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-800 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-brand-700" /> Origem &amp; Cliente
              </h3>
              {editMode && (
                <span className="chip bg-brand-50 text-brand-800 !py-0.5 !text-[11px]">Edição ativa</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {editMode ? (
                <>
                  <div className="space-y-1.5">
                    <label className="label flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> Origem da venda
                    </label>
                    <div className="relative">
                      <select
                        value={patch.source}
                        onChange={e => setPatch(p => ({ ...p, source: e.target.value as SaleSource }))}
                        className="select w-full"
                        disabled={saving}
                      >
                        <option value="PRESENCIAL">Presencial / Loja</option>
                        <option value="SITE">Site / E-commerce</option>
                        <option value="DISTANCIA">WhatsApp / Distância</option>
                        <option value="OUTRO">Outro</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="label flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5" /> Data da venda
                    </label>
                    <input
                      type="date"
                      value={patch.sale_date}
                      onChange={e => setPatch(p => ({ ...p, sale_date: e.target.value }))}
                      className="input"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="label flex items-center gap-1.5">
                      <UserCircle className="w-3.5 h-3.5" /> Nome do cliente
                    </label>
                    <input
                      type="text"
                      value={patch.customer_name}
                      onChange={e => setPatch(p => ({ ...p, customer_name: e.target.value }))}
                      placeholder="Ex: Maria da Silva"
                      className="input"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="label flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5" /> Telefone / WhatsApp (opcional)
                    </label>
                    <input
                      type="tel"
                      value={patch.customer_phone}
                      onChange={e => setPatch(p => ({ ...p, customer_phone: e.target.value }))}
                      placeholder="Ex: (11) 98765-4321"
                      className="input num"
                      disabled={saving}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center text-brand-800 flex-shrink-0">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Origem</div>
                      <div className="text-base font-black text-ink-900 mt-0.5">{sourceLabel(s.source)}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-ink-100 flex items-center justify-center text-ink-700 flex-shrink-0">
                      <UserCircle className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Cliente</div>
                      <div className="text-base font-black text-ink-900 mt-0.5 break-words">
                        {s.customer_name ?? 'Não identificado'}
                      </div>
                      {s.customer_phone && (
                        <div className="text-sm text-ink-600 num mt-0.5 break-all">{s.customer_phone}</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-800 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-brand-700" /> Pagamento
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="chip bg-ink-100 text-ink-600">{pluralize(payments.length, 'pagamento')}</span>
                {editMode && (
                  <span className="chip bg-emerald-50 text-emerald-800 !py-0.5 !text-[11px]">Valores editáveis</span>
                )}
              </div>
            </div>
            {payments.length === 0 ? (
              <div className="text-sm text-ink-500 py-4">Sem pagamento registrado.</div>
            ) : payments.map((p, idx) => {
              const economia = (Number(p.fee_expected_snapshot ?? 0)) - Number(p.fee_real_snapshot ?? 0)
              return (
                <div key={p.id} className="space-y-4 border-b border-ink-100 last:border-b-0 pb-5 last:pb-0 mb-5 last:mb-0 relative">
                  {editMode && (
                    <div className="absolute -top-1 -right-1 flex items-center gap-1.5 z-10">
                      <button
                        onClick={() => openPaymentEdit(p)}
                        disabled={saving}
                        className="btn-secondary !py-1.5 !px-2.5 text-xs whitespace-nowrap min-h-[34px] shadow-sm"
                        title="Editar este pagamento (método, valor, taxas, parcelas)"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Editar
                      </button>
                      <button
                        onClick={() => doDeletePayment(p.id)}
                        disabled={saving}
                        className="!py-1.5 !px-2.5 text-xs whitespace-nowrap min-h-[34px] rounded-lg border transition inline-flex items-center gap-1.5 font-semibold border-rose-200 bg-white text-rose-700 hover:bg-rose-50 shadow-sm"
                        title="Excluir este registro de pagamento"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <span className="chip bg-ink-100 text-ink-700">
                      <strong className="mr-1">#{idx + 1}</strong>
                      {p.trans_date ? <span className="text-ink-500 font-medium num mr-1">{formatDate(p.trans_date)}</span> : null}
                      {p.method ? paymentMethodLabel(p.method) : 'Método'}
                    </span>
                    <span className="chip bg-ink-100 text-ink-700">
                      Provider: <strong>{p.provider_snapshot ?? '—'}</strong>
                    </span>
                    <span className="chip bg-ink-100 text-ink-700">
                      Modalidade: <strong>{p.modality_snapshot ?? '—'}</strong>
                    </span>
                    <span className="chip bg-violet-100 text-violet-800">
                      <strong>{p.installments}x</strong>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="p-3 rounded-lg bg-ink-50 border border-ink-100">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Taxa PREVISTA</div>
                      <div className="text-lg font-black text-ink-900 num mt-1">{formatCurrency(p.fee_expected_snapshot)}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5">
                        {formatPercent((p as any).fee_percent_snapshot ?? 0)} · regra original
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-brand-50 border border-brand-100">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-brand-800">Taxa REAL</div>
                      <div className="text-lg font-black text-brand-900 num mt-1">{formatCurrency(p.fee_real_snapshot)}</div>
                      <div className="text-[11px] text-brand-700 mt-0.5">valor descontado de fato</div>
                    </div>
                    <div className={cn(
                      'p-3 rounded-lg border',
                      economia >= -0.01 ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'
                    )}>
                      <div className={cn(
                        'text-[11px] font-bold uppercase tracking-wider',
                        economia >= -0.01 ? 'text-emerald-700' : 'text-amber-700'
                      )}>Economia / (extra)</div>
                      <div className={cn(
                        'text-lg font-black num mt-1',
                        economia >= -0.01 ? 'text-emerald-800' : 'text-amber-800'
                      )}>
                        {economia >= 0 ? '+' : '-'} {formatCurrency(Math.abs(economia))}
                      </div>
                      <div className={cn(
                        'text-[11px] mt-0.5',
                        economia >= -0.01 ? 'text-emerald-700/80' : 'text-amber-700/80'
                      )}>
                        ganho/otimização interna
                      </div>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-ink-50 border border-ink-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Valor pago pelo cliente</div>
                      <div className="text-2xl font-black text-ink-900 num mt-0.5">
                        {formatCurrency(p.amount ?? 0)}
                      </div>
                      {(p as any).notes && (
                        <div className="text-[11px] text-ink-600 mt-1 italic break-words">
                          "{(p as any).notes}"
                        </div>
                      )}
                      <div className="text-[11px] text-emerald-700 mt-1">
                        ↳ Líquido recebível: <strong className="num">{formatCurrency(Number(p.amount ?? 0) - Number(p.fee_real_snapshot ?? 0))}</strong>
                      </div>
                    </div>
                    <div className="text-right sm:ml-4">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Líquido recebível</div>
                      <div className="text-2xl font-black text-emerald-700 num mt-0.5">
                        {formatCurrency(Number(p.amount ?? 0) - Number(p.fee_real_snapshot ?? 0))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="card p-4 sm:p-5">
            <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
              <PackageCheck className="w-4 h-4 text-violet-700" /> Embalagem &amp; Custos extras
            </h3>
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-ink-50 border border-ink-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center text-violet-800 flex-shrink-0">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Embalagem</div>
                    <div className="text-base font-black text-ink-900 mt-0.5">
                      {packaging?.tipo_snapshot ?? 'Sem embalagem definida'}
                    </div>
                    {packaging && (
                      <div className="text-xs text-ink-600 mt-1 space-y-0.5">
                        <div>Custo sugerido: <span className="num">{formatCurrency(packaging.custo_snapshot)}</span></div>
                        {packaging.custom_cost !== undefined && packaging.custom_cost !== null && (
                          <div>Custo customizado: <span className="num">{formatCurrency(packaging.custom_cost)}</span></div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {packaging?.is_free && (
                    <span className="chip bg-emerald-100 text-emerald-800">
                      <Check className="w-3 h-3" /> Cortesia / Gratuita
                    </span>
                  )}
                  <div className="text-right">
                    <div className="text-[11px] text-ink-500">Custo real</div>
                    <div className="text-lg font-black num text-ink-900">{formatCurrency(packCostActual)}</div>
                  </div>
                </div>
              </div>

              {costs.length > 0 ? (
                <div>
                  <div className="text-xs font-bold text-ink-600 uppercase tracking-wider mb-2">Custos extras</div>
                  <div className="space-y-1.5">
                    {costs.map(c => (
                      <div key={c.id} className="flex items-center justify-between text-sm py-2 px-3 rounded-lg border border-ink-100 bg-ink-50/50">
                        <div className="min-w-0 flex-1 pr-3">
                          <span className="font-semibold text-ink-800 truncate inline-block max-w-full">{c.description}</span>
                          {c.category && (
                            <span className="text-[11px] text-ink-400 ml-2">· {c.category}</span>
                          )}
                        </div>
                        <span className="font-bold num text-ink-900">{formatCurrency(c.amount)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-sm py-2 px-3">
                      <span className="text-sm font-bold text-ink-700">Soma custos extras</span>
                      <span className="font-black num text-ink-900">{formatCurrency(extraCostsTotal)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-ink-500">Sem custos extras lançados.</div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1 space-y-4">
          <div className="lg:sticky lg:top-[90px] space-y-4">
            <div className="p-5 rounded-2xl bg-ink-900 text-white shadow-lg">
              <h3 className="text-sm font-bold text-white/90 mb-4 flex items-center gap-2">
                <Receipt className="w-4 h-4" /> Bloco financeiro · snapshots
              </h3>
              <div className="space-y-2.5 text-sm">
                <ReviewRow label="Mercadorias (COGS)" value={formatCurrency(cogsTotal)} />
                {rateioCompraTotal > 0.009 && (
                  <ReviewRow
                    label={<span>Rateio de compras <span className="text-white/50">(frete + outros rateados nos lotes)</span></span>}
                    value={formatCurrency(rateioCompraTotal)} />
                )}
                <ReviewRow label="Taxa pagamento (real)" value={formatCurrency(feeActualTotal)} />
                <ReviewRow label="Embalagem (real)" value={formatCurrency(packCostActual)} />
                <ReviewRow label="Outros custos" value={formatCurrency(extraCostsTotal)} />
                {shipCost > 0.009 && <ReviewRow label="Frete incluso" value={formatCurrency(shipCost)} />}
                <div className="border-t border-white/10 my-3 pt-3">
                  <ReviewRow
                    label={<span>= CUSTO TOTAL <span className="text-white/50">(soma dos itens acima)</span></span>}
                    value={formatCurrency(custoTotalSnapshot)} strong />
                </div>
                <div className="pt-3 mt-3 border-t border-white/10 space-y-3">
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-bold text-white/80">LUCRO REAL</span>
                      <span className={cn(
                        'text-2xl font-black num',
                        lucroReal >= -0.01 ? 'text-emerald-400' : 'text-rose-400'
                      )}>
                        {formatCurrency(lucroReal)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-semibold text-white/60">MARGEM %</span>
                    <span className={cn(
                      'text-base font-black num',
                      margem >= -0.01 ? 'text-emerald-400' : 'text-rose-400'
                    )}>{formatPercent(margem, 1)}</span>
                  </div>
                </div>
              </div>
              <div className="mt-5 p-3 rounded-lg bg-white/5 border border-white/10 space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-white/60">Total cliente</span>
                  <span className="text-lg font-black num">{formatCurrency(s.total_customer)}</span>
                </div>
                {taxaEconomia > 0.01 && (
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-emerald-300">Economia na taxa</span>
                    <span className="font-bold num text-emerald-300">+ {formatCurrency(taxaEconomia)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink-800 flex items-center gap-2">
                  <Edit3 className="w-4 h-4" /> Observações
                </h3>
                {editMode ? (
                  <span className="chip bg-brand-50 text-brand-800 !py-0.5 !text-[11px]">Editável</span>
                ) : (
                  <span className="chip bg-ink-100 text-ink-600 text-[10px]">Apenas visual</span>
                )}
              </div>
              <textarea
                rows={4}
                value={editMode ? patch.notes : (s.notes ?? (isCancelled ? s.cancel_reason ?? '' : ''))}
                onChange={editMode ? e => setPatch(p => ({ ...p, notes: e.target.value })) : undefined}
                disabled={!editMode}
                placeholder={editMode ? "Adicione observações internas sobre esta venda…" : "Sem observações nesta venda."}
                className={cn(
                  'input resize-none',
                  editMode ? 'bg-white border-brand-300 focus:border-brand-500' : 'bg-ink-50 text-ink-700'
                )}
              />
              {editMode && (
                <p className="text-[11px] text-ink-500 leading-relaxed">
                  Estas observações ficarão salvas no histórico e visíveis apenas internamente.
                </p>
              )}
            </div>

            {canCancel && !isCancelled ? (
              <button onClick={() => setCancelOpen(true)} className="btn-danger btn-block min-h-[48px]">
                <Trash2 className="w-4 h-4" /> Cancelar venda
              </button>
            ) : isCancelled ? (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-center">
                <div className="text-sm font-bold text-rose-800">Venda já cancelada</div>
                <div className="text-xs text-rose-700/80 mt-0.5">Ação irreversível.</div>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-center">
                <div className="text-sm font-bold text-amber-800">Não pode ser cancelada</div>
                <div className="text-xs text-amber-700/80 mt-0.5">Status atual: {s.status}</div>
              </div>
            )}

            <Link to="/vendas/nova" className="btn-primary btn-block min-h-[44px]">
              <ShoppingBag className="w-4 h-4" /> Nova venda
            </Link>
          </div>
        </div>
      </div>

      {quitOpen && s && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/60 backdrop-blur-sm">
          <div className="w-full max-w-md card p-5 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
                <Wallet className="w-5.5 h-5.5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-black text-ink-900">Registrar pagamento restante</h3>
                <p className="text-sm text-ink-600 mt-0.5">
                  Venda #{String(s.friendly_number ?? '')} · cliente {s.customer_name}
                </p>
              </div>
              <button onClick={() => { setQuitOpen(false) }} className="btn-ghost !p-2" disabled={quiting}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 mb-4">
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-amber-700 font-bold">Saldo pendente</div>
                  <div className="text-xl font-black num text-rose-700 mt-0.5">{formatCurrency(pendingBalance)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-amber-700 font-bold">Recebido até agora</div>
                  <div className="text-xl font-black num text-emerald-700 mt-0.5">{formatCurrency(paidTotal)}</div>
                </div>
              </div>

              <div>
                <label className="label">Data do pagamento *</label>
                <input
                  type="date"
                  value={quitDate}
                  onChange={e => setQuitDate(e.target.value)}
                  className="input"
                  disabled={quiting}
                />
              </div>

              <div>
                <label className="label">Valor recebido * <span className="text-ink-400 text-[11px]">(sugestão: pendente)</span></label>
                <div className="flex gap-2">
                  <input
                    value={quitAmount}
                    onChange={e => setQuitAmount(e.target.value)}
                    placeholder="Ex: 130,00"
                    className="input !text-right !font-black !text-lg num"
                    disabled={quiting}
                  />
                  <button
                    type="button"
                    className="btn-secondary min-w-[90px]"
                    disabled={quiting}
                    onClick={() => setQuitAmount(String(pendingBalance.toFixed(2)))}
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    Pendente
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Forma de pagamento *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['PIX','DINHEIRO','CREDITO','DEBITO','BOLETO','OUTRO'] as PaymentMethod[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setQuitMethod(m)}
                      disabled={quiting}
                      className={cn(
                        '!min-h-[42px] text-xs font-bold rounded-lg border transition',
                        quitMethod === m
                          ? 'bg-brand-700 text-white border-brand-700 shadow-sm'
                          : 'bg-white text-ink-700 border-ink-200 hover:border-brand-400 hover:text-brand-700'
                      )}
                    >
                      {paymentMethodLabel(m)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Taxa real (opcional) <span className="text-ink-400 text-[11px]">(se houve desconto na máquina)</span></label>
                <input
                  value={quitFee}
                  onChange={e => setQuitFee(e.target.value)}
                  placeholder="0,00"
                  className="input !text-right num"
                  disabled={quiting}
                />
              </div>

              <div>
                <label className="label">Observações</label>
                <textarea
                  value={quitNotes}
                  onChange={e => setQuitNotes(e.target.value)}
                  rows={2}
                  placeholder="Ex: Recebido Pix 13:45h, chave CNPJ"
                  className="input resize-none"
                  disabled={quiting}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setQuitOpen(false)} disabled={quiting} className="btn-secondary flex-1 min-h-[44px]">
                Cancelar
              </button>
              <button onClick={doQuit} disabled={quiting} className="btn-primary flex-1 min-h-[44px]">
                {quiting ? 'Registrando…' : 'Registrar pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentEdit.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/60 backdrop-blur-sm">
          <div className="w-full max-w-lg card p-5 shadow-2xl max-h-[95vh] overflow-y-auto">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 flex-shrink-0">
                <CreditCard className="w-5.5 h-5.5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-black text-ink-900">Editar dados do pagamento</h3>
                <p className="text-sm text-ink-600 mt-0.5">
                  Ajuste método, valor pago, taxas, parcelas e observações.
                </p>
              </div>
              <button
                onClick={() => setPaymentEdit(p => ({ ...p, open: false }))}
                className="btn-ghost !p-2"
                disabled={saving}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 mb-4">
              <div>
                <label className="label">Forma de pagamento *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['PIX','DINHEIRO','CREDITO','DEBITO','BOLETO','OUTRO'] as PaymentMethod[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentEdit(p => ({ ...p, method: m }))}
                      disabled={saving}
                      className={cn(
                        '!min-h-[40px] text-xs font-bold rounded-lg border transition',
                        paymentEdit.method === m
                          ? 'bg-brand-700 text-white border-brand-700 shadow-sm'
                          : 'bg-white text-ink-700 border-ink-200 hover:border-brand-400 hover:text-brand-700'
                      )}
                    >
                      {paymentMethodLabel(m)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Provider (opcional)</label>
                  <input
                    type="text"
                    value={paymentEdit.provider_snapshot}
                    onChange={e => setPaymentEdit(p => ({ ...p, provider_snapshot: e.target.value }))}
                    placeholder="Ex: Mercado Pago, Stripe, Pix"
                    className="input"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="label">Modalidade (opcional)</label>
                  <input
                    type="text"
                    value={paymentEdit.modality_snapshot}
                    onChange={e => setPaymentEdit(p => ({ ...p, modality_snapshot: e.target.value }))}
                    placeholder="Ex: Pix à vista, Crédito 2x"
                    className="input"
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Valor pago pelo cliente *</label>
                  <input
                    type="text"
                    value={paymentEdit.amount}
                    onChange={e => setPaymentEdit(p => ({ ...p, amount: e.target.value }))}
                    placeholder="Ex: 130,00"
                    className="input !text-right !font-bold num"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="label">Número de parcelas</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={paymentEdit.installments}
                      onChange={e => setPaymentEdit(p => ({ ...p, installments: Number(e.target.value || 1) }))}
                      className="input num"
                      disabled={saving}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">Taxa prevista (R$)</label>
                  <input
                    type="text"
                    value={paymentEdit.fee_expected_snapshot}
                    onChange={e => setPaymentEdit(p => ({ ...p, fee_expected_snapshot: e.target.value }))}
                    placeholder="0,00"
                    className="input !text-right num"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="label">Taxa real (R$)</label>
                  <input
                    type="text"
                    value={paymentEdit.fee_real_snapshot}
                    onChange={e => setPaymentEdit(p => ({ ...p, fee_real_snapshot: e.target.value }))}
                    placeholder="0,00"
                    className="input !text-right num"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="label">Taxa % (opcional)</label>
                  <input
                    type="text"
                    value={paymentEdit.fee_percent_snapshot}
                    onChange={e => setPaymentEdit(p => ({ ...p, fee_percent_snapshot: e.target.value }))}
                    placeholder="0,00"
                    className="input !text-right num"
                    disabled={saving}
                  />
                </div>
              </div>

              <div>
                <label className="label">Observações do pagamento</label>
                <textarea
                  value={paymentEdit.notes_snapshot}
                  onChange={e => setPaymentEdit(p => ({ ...p, notes_snapshot: e.target.value }))}
                  rows={2}
                  placeholder="Ex: Recebido Pix 13:45h, chave celular"
                  className="input resize-none"
                  disabled={saving}
                />
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-sm">
                <div className="font-bold text-emerald-900">Resumo</div>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-emerald-700/80 font-bold">Líquido recebível</div>
                    <div className="text-lg font-black text-emerald-800 num mt-0.5">
                      {formatCurrency(
                        Math.max(0, (parseBrl(paymentEdit.amount) ?? 0) - (parseBrl(paymentEdit.fee_real_snapshot) ?? 0))
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-emerald-700/80 font-bold">Economia</div>
                    <div className="text-lg font-black text-emerald-800 num mt-0.5">
                      {formatCurrency(
                        Math.max(0, (parseBrl(paymentEdit.fee_expected_snapshot) ?? 0) - (parseBrl(paymentEdit.fee_real_snapshot) ?? 0))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPaymentEdit(p => ({ ...p, open: false }))}
                disabled={saving}
                className="btn-secondary flex-1 min-h-[44px]"
              >
                Voltar
              </button>
              <button
                onClick={confirmPaymentEdit}
                disabled={saving}
                className="btn-primary flex-1 min-h-[44px]"
              >
                {saving ? (
                  <>Salvando…</>
                ) : (
                  <><Save className="w-4 h-4" /> Salvar pagamento</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelOpen && s && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/60 backdrop-blur-sm">
          <div className="w-full max-w-md card p-5 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 flex-shrink-0">
                <AlertTriangle className="w-5.5 h-5.5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-black text-ink-900">Cancelar venda #{formatFriendlyNumber(s.friendly_number)}</h3>
                <p className="text-sm text-ink-600 mt-0.5">
                  Esta ação é <strong>irreversível</strong>.
                </p>
              </div>
              <button onClick={() => { setCancelOpen(false); setCancelStep(1) }} className="btn-ghost !p-2" disabled={canceling}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {cancelStep === 1 ? (
              <>
                <div className="mb-4 space-y-2">
                  <label className="label">Motivo do cancelamento <span className="text-rose-600">*</span></label>
                  <textarea
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    placeholder="Descreva o motivo: cliente desistiu, produto com problema, erro no PDV, etc."
                    rows={5}
                    className="input resize-none"
                    disabled={canceling}
                  />
                  <p className="text-[11px] text-ink-500 leading-relaxed">
                    Este motivo ficará salvo no histórico da venda e será usado para auditoria futura.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setCancelOpen(false)} disabled={canceling} className="btn-secondary flex-1 min-h-[44px]">
                    Voltar
                  </button>
                  <button
                    onClick={() => {
                      if (!cancelReason.trim()) { showFeedback('err', 'Informe o motivo para prosseguir.'); return }
                      setCancelStep(2)
                    }}
                    disabled={canceling || !cancelReason.trim()}
                    className="btn-danger flex-1 min-h-[44px]"
                  >
                    Prosseguir <ArrowDownRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 p-4 rounded-xl bg-rose-50 border-2 border-rose-200 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
                    <div className="text-sm font-bold text-rose-900 leading-snug">
                      Confirmação final: tem CERTEZA que deseja cancelar?
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-sm text-rose-800 list-disc pl-6">
                    <li>O estoque dos produtos será <strong>devolvido</strong>.</li>
                    <li>O status da venda mudará para <strong>Cancelada</strong>.</li>
                    <li>Os KPIs do dashboard serão recalculados.</li>
                    <li>Esta ação é <strong>100% irreversível</strong> e não pode ser desfeita.</li>
                  </ul>
                  {cancelReason.trim() && (
                    <div className="pt-2 mt-2 border-t border-rose-200/60">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700/80 mb-1">Motivo informado</div>
                      <div className="text-sm text-rose-900 bg-white/70 p-2.5 rounded-lg break-words">
                        {cancelReason.trim()}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setCancelStep(1)} disabled={canceling} className="btn-secondary flex-1 min-h-[44px]">
                    ← Voltar e editar
                  </button>
                  <button
                    onClick={doCancel}
                    disabled={canceling || !cancelReason.trim()}
                    className="btn-danger flex-1 min-h-[44px]"
                  >
                    {canceling ? 'Cancelando…' : (
                      <><Check className="w-4 h-4" /> Sim, cancelar agora</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, negative, strong }: { label: string; value: string; negative?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-ink-600', strong && 'font-bold text-ink-800')}>{label}</span>
      <span className={cn(
        'num font-semibold',
        strong && 'text-base font-black text-ink-900',
        negative && value !== formatCurrency(0) && 'text-rose-700'
      )}>{negative && value !== formatCurrency(0) ? '- ' : ''}{value}</span>
    </div>
  )
}

function ReviewRow({ label, value, strong }:
  { label: string | React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-white/70', strong && 'text-white/90 font-bold')}>{label}</span>
      <span className={cn('num font-semibold text-white/90', strong && 'text-base font-black text-white')}>{value}</span>
    </div>
  )}
