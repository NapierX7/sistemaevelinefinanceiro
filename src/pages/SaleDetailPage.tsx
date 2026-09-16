import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, X, AlertTriangle, Check, ShoppingBag, Tag, MapPin, CreditCard, PackageCheck, Receipt, DollarSign, Trash2, Package, ArrowDownRight, Edit3
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, formatDateTime, formatFriendlyNumber, parseBrl, sourceLabel, statusLabel, paymentMethodLabel, pluralize, cn
} from '@/lib/format'
import type { Sale, SaleItem, SalePayment, SalePackaging, SaleCost, UUID } from '@/types/supabase'
import { getSaleDetail, cancelSale } from '@/services'

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

  const load = () => {
    if (!id) return
    setLoading(true)
    getSaleDetail(id as UUID)
      .then(d => setDetail(d ?? null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const s = detail?.sale
  const items = detail?.items ?? []
  const payments = detail?.payments ?? []
  const packaging = detail?.packaging
  const costs = detail?.costs ?? []
  const primaryPay = payments[0]

  const canCancel = useMemo(() => {
    if (!s) return false
    if (s.status === 'CANCELADA' || (s as any).cancelled === true) return false
    return s.status === 'CONCLUIDA' || s.status === 'PENDENTE'
  }, [s])

  const totalDescProdutos = items.reduce((sum, i) => sum + Number(i.discount ?? 0), 0)

  const cogsTotal = Number(s?.items_cost ?? (s as any)?.cogs_total ?? 0)
  const feeActualTotal = Number(s?.fee_actual ?? (s as any)?.fee_actual_total ?? 0)
  const feeExpectedTotal = Number(s?.fee_expected ?? 0)
  const packCostActual = packaging ? (packaging.is_free ? 0 : Number(packaging.custom_cost ?? packaging.custo_snapshot ?? 0))
    : Number((s as any)?.packaging_cost_actual ?? s?.packaging_cost ?? 0)
  const extraCostsTotal = costs.reduce((sum, c) => sum + Number(c.amount ?? 0), 0)
  const shipCost = Number((s as any)?.shipping_cost_snapshot ?? 0)
  const custoTotalSnapshot = cogsTotal + feeActualTotal + packCostActual + extraCostsTotal + shipCost
  const lucroReal = Number(s?.real_profit ?? (Number(s?.total_customer ?? 0) - custoTotalSnapshot))
  const margem = Number(s?.total_customer ?? 0) ? (lucroReal / Number(s?.total_customer ?? 0)) * 100 : 0

  const taxaEconomia = feeExpectedTotal - feeActualTotal

  const doCancel = async () => {
    if (!s) return
    if (!cancelReason.trim()) { alert('Informe o motivo do cancelamento.'); return }
    try {
      setCanceling(true)
      await cancelSale(s.id, cancelReason.trim())
      alert('Venda cancelada com sucesso!')
      setCancelOpen(false)
      setCancelStep(1)
      setCancelReason('')
      load()
    } catch (e: any) {
      console.error(e)
      alert('Erro ao cancelar: ' + (e?.message ?? String(e)))
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

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <Link to="/vendas" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800 mb-2">
            <ArrowLeft className="w-4 h-4" /> ← Histórico de vendas
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900">
              Venda #{formatFriendlyNumber(s.friendly_number)}
            </h1>
            <span className={st.class}>{st.label}</span>
          </div>
          <div className="text-sm text-ink-500 mt-1 num">
            {formatDateTime(s.sale_date ?? s.created_at)}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isCancelled && canCancel && (
            <button onClick={() => setCancelOpen(true)} className="btn-danger min-h-[44px]">
              <Trash2 className="w-4 h-4" /> Cancelar venda
            </button>
          )}
        </div>
      </div>

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
            <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-amber-600" /> Descontos concedidos
            </h3>
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
            <div className="mt-4 p-4 rounded-xl bg-brand-900 text-white flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-white/70">Total cliente (pago)</div>
                <div className="text-[11px] text-white/50 mt-0.5">valor final após todos descontos</div>
              </div>
              <div className="text-3xl font-black num">{formatCurrency(s.total_customer ?? 0)}</div>
            </div>
          </div>

          <div className="card p-4 sm:p-5">
            <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand-700" /> Origem &amp; Cliente
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Cliente</div>
                  <div className="text-base font-black text-ink-900 mt-0.5">
                    {s.customer_name ?? 'Não identificado'}
                  </div>
                  {s.customer_phone && (
                    <div className="text-sm text-ink-600 num mt-0.5">{s.customer_phone}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="card p-4 sm:p-5">
            <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-brand-700" /> Pagamento
            </h3>
            {payments.length === 0 ? (
              <div className="text-sm text-ink-500 py-4">Sem pagamento registrado.</div>
            ) : payments.map(p => {
              const economia = (Number(p.fee_expected_snapshot ?? 0)) - Number(p.fee_real_snapshot ?? 0)
              return (
                <div key={p.id} className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="chip bg-ink-100 text-ink-700">
                      Provider: <strong>{p.provider_snapshot ?? '—'}</strong>
                    </span>
                    <span className="chip bg-ink-100 text-ink-700">
                      Modalidade: <strong>{p.modality_snapshot ?? '—'}</strong>
                    </span>
                    <span className="chip bg-brand-100 text-brand-800">
                      Método: <strong>{paymentMethodLabel(p.method)}</strong>
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
                        {formatPercent(p.fee_percent_snapshot)} · regra original
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
                  <div className="p-4 rounded-xl bg-ink-50 border border-ink-100 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Líquido recebível</div>
                      <div className="text-[11px] text-ink-500 mt-0.5">Total cliente - taxa real</div>
                    </div>
                    <div className="text-2xl font-black text-emerald-700 num">
                      {formatCurrency(Number(p.amount ?? 0) - Number(p.fee_real_snapshot ?? 0))}
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
                <ReviewRow label="Custo mercadorias (COGS)" value={formatCurrency(cogsTotal)} />
                <ReviewRow label="Taxa pagamento (REAL)" value={formatCurrency(feeActualTotal)} />
                <ReviewRow label="Embalagem (real)" value={formatCurrency(packCostActual)} />
                <ReviewRow label="Outros custos" value={formatCurrency(extraCostsTotal)} />
                {shipCost > 0 && <ReviewRow label="Frete incluso" value={formatCurrency(shipCost)} />}
                <div className="border-t border-white/10 my-3 pt-3">
                  <ReviewRow label="= CUSTO TOTAL" value={formatCurrency(custoTotalSnapshot)} strong />
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
                <span className="chip bg-ink-100 text-ink-600 text-[10px]">Apenas visual</span>
              </div>
              <textarea
                disabled
                rows={3}
                value={(s as any).notes ?? (isCancelled ? s.cancel_reason ?? '' : '')}
                placeholder="Sem observações nesta venda."
                className="input resize-none bg-ink-50"
              />
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
                      if (!cancelReason.trim()) { alert('Informe o motivo para prosseguir.'); return }
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

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-white/70', strong && 'text-white/90 font-bold')}>{label}</span>
      <span className={cn('num font-semibold text-white/90', strong && 'text-base font-black text-white')}>{value}</span>
    </div>
  )}
