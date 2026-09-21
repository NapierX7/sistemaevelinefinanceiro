import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Truck, ChevronDown, X, Trash2, Package, Calendar,
  Building2, MapPin, Filter, DollarSign, Calculator, Check
} from 'lucide-react'
import {
  formatCurrency, cn, parseBrl, formatDate, toInputDate, formatFriendlyNumber, pluralize
} from '@/lib/format'
import {
  listPurchases, listAllProducts, createPurchase, getPurchaseDetail,
  onInvalidate, dispatchInvalidate, dispatchInvalidateAll
} from '@/services'
import type { PurchaseEntry, Product, PurchaseFundingSource } from '@/types/supabase'
import type { CreatePurchaseParams } from '@/services'

type Step = 1 | 2
type AllocationMethod = 'quantity' | 'value' | 'none'

interface PurchaseItem {
  product_id?: string
  product_name: string
  quantity: string
  unit_cost: string
}

interface OtherCost {
  description: string
  category: string
  amount: string
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<PurchaseEntry[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [p, pr] = await Promise.all([listPurchases(), listAllProducts(true)])
      setPurchases(p)
      setProducts(pr)
    } catch (e) {
      console.error(e)
      alert('Erro ao carregar compras.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const cleanup = onInvalidate((scope) => {
      if (scope === 'all' || scope === 'purchases' || scope === 'inventory' || scope === 'products') {
        load()
      }
    })
    return cleanup
  }, [])

  const loadDetail = async (id: string) => {
    setDetailId(id)
    setDetailLoading(true)
    try {
      const d = await getPurchaseDetail(id)
      setDetail(d)
    } catch (e) {
      console.error(e)
      alert('Erro ao carregar detalhes.')
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-5 pb-4 sm:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900">Compras / Entradas</h1>
          <p className="text-sm text-ink-500 mt-0.5">Entradas de mercadoria e rateio de custos.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Nova Entrada
        </button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Data entrada</th>
                <th>Fornecedor</th>
                <th>Origem</th>
                <th className="text-right">Itens</th>
                <th className="text-right">Total custo</th>
                <th>Status</th>
                <th className="w-32 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-ink-500">Carregando...</td></tr>
              ) : purchases.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-ink-500">
                  <Filter className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                  Nenhuma entrada registrada. Clique em "Nova Entrada" para começar.
                </td></tr>
              ) : purchases.map((p, i) => (
                <tr key={p.id} className="hover:bg-ink-50/50 transition">
                  <td className="font-bold num">#{String(purchases.length - i)}</td>
                  <td className="num text-ink-700">{formatDate(p.entry_date)}</td>
                  <td className="font-medium text-ink-800">{p.supplier || '—'}</td>
                  <td className="text-ink-600 text-sm">{p.origin || '—'}</td>
                  <td className="text-right num">{(p as any).items_count || '—'}</td>
                  <td className="text-right num font-bold text-ink-900">{formatCurrency(p.total_cost)}</td>
                  <td>
                    <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      Confirmada
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => loadDetail(p.id)} className="btn-secondary !py-2 text-xs">
                      Ver detalhe
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <NewPurchaseModal
          products={products}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load() }}
        />
      )}

      {detailId && (
        <DetailModal
          detailId={detailId}
          detail={detail}
          loading={detailLoading}
          onClose={() => { setDetailId(null); setDetail(null) }}
        />
      )}
    </div>
  )
}

function NewPurchaseModal({
  products, onClose, onSaved
}: {
  products: Product[]
  onClose: () => void
  onSaved: () => void
}) {
  const [step, setStep] = useState<Step>(1)
  const [supplier, setSupplier] = useState('')
  const [entryDate, setEntryDate] = useState(toInputDate())
  const [origin, setOrigin] = useState('')
  const [notes, setNotes] = useState('')
  const [fundingSource, setFundingSource] = useState<PurchaseFundingSource | string>('CAIXA_EVELINE')
  const [creditorName, setCreditorName] = useState('')
  const [items, setItems] = useState<PurchaseItem[]>([{
    product_id: undefined, product_name: '', quantity: '1', unit_cost: '0,00'
  }])
  const [shippingCost, setShippingCost] = useState('0,00')
  const [otherCosts, setOtherCosts] = useState<OtherCost[]>([])
  const [allocation, setAllocation] = useState<AllocationMethod>('quantity')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err' | 'warn' | 'info'; msg: string } | null>(null)
  const showFeedback = (type: 'ok' | 'err' | 'warn' | 'info', msg: string, ms = 4800) => {
    setToast({ type, msg })
    window.clearTimeout((showFeedback as any)._t)
    ;(showFeedback as any)._t = window.setTimeout(() => setToast(null), ms)
  }

  const itemsCalc = useMemo(() => {
    return items.map(it => {
      const qty = Number(it.quantity) || 0
      const uc = parseBrl(it.unit_cost)
      return { ...it, qtyNum: qty, costNum: uc, subtotal: qty * uc }
    })
  }, [items])

  const subtotalMerc = itemsCalc.reduce((s, i) => s + i.subtotal, 0)
  const freteNum = parseBrl(shippingCost)
  const outrosNum = otherCosts.reduce((s, c) => s + parseBrl(c.amount), 0)
  const totalGeral = subtotalMerc + freteNum + outrosNum
  const totalQtd = itemsCalc.reduce((s, i) => s + i.qtyNum, 0)
  const totalValor = subtotalMerc

  const rateioCalc = useMemo(() => {
    const custosRateio = freteNum + outrosNum
    return itemsCalc.map(it => {
      let rateio = 0
      if (allocation === 'quantity' && totalQtd > 0) {
        rateio = (it.qtyNum / totalQtd) * custosRateio
      } else if (allocation === 'value' && totalValor > 0) {
        rateio = (it.subtotal / totalValor) * custosRateio
      }
      const custoEfetivo = it.qtyNum > 0 ? (it.subtotal + rateio) / it.qtyNum : 0
      return { ...it, rateio, custoEfetivo }
    })
  }, [itemsCalc, freteNum, outrosNum, allocation, totalQtd, totalValor])

  const addItem = () => setItems(arr => [...arr, {
    product_id: undefined, product_name: '', quantity: '1', unit_cost: '0,00'
  }])
  const removeItem = (i: number) => setItems(arr => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr)
  const updateItem = (i: number, patch: Partial<PurchaseItem>) =>
    setItems(arr => arr.map((it, idx) => idx === i ? { ...it, ...patch } : it))

  const onSelectProduct = (i: number, pid: string) => {
    const p = products.find(x => x.id === pid)
    if (p) {
      updateItem(i, {
        product_id: pid,
        product_name: p.name,
        unit_cost: formatCurrency(p.current_cost).replace('R$ ', '')
      })
    } else {
      updateItem(i, { product_id: undefined })
    }
  }

  const addCusto = () => setOtherCosts(arr => [...arr, { description: 'Sacolas plásticas', category: 'Embalagem', amount: '0,00' }])
  const addCustoRapido = (preset: { description: string; category: string }) =>
    setOtherCosts(arr => [...arr, { ...preset, amount: '0,00' }])
  const removeCusto = (i: number) => setOtherCosts(arr => arr.filter((_, idx) => idx !== i))
  const updateCusto = (i: number, patch: Partial<OtherCost>) =>
    setOtherCosts(arr => arr.map((c, idx) => idx === i ? { ...c, ...patch } : c))

  const canAdvance = () => {
    if (step === 1) return true
    return itemsCalc.some(i => i.product_name.trim() && i.qtyNum > 0 && i.costNum >= 0)
  }

  const submit = async () => {
    const validos = itemsCalc.filter(i => i.product_name.trim() && i.qtyNum > 0)
    if (validos.length === 0) {
      showFeedback('err', 'Adicione pelo menos um item válido (nome e quantidade).')
      return
    }
    if (fundingSource === 'OUTRO' && !creditorName.trim()) {
      showFeedback('err', 'Informe o nome do credor (origem "Outro").')
      return
    }
    setSaving(true)
    try {
      const params: CreatePurchaseParams = {
        entry_date: entryDate,
        supplier: supplier.trim() || undefined,
        origin: origin.trim() || undefined,
        cost_allocation_method: allocation,
        items: validos.map(i => ({
          product_id: i.product_id,
          product_name: i.product_name.trim(),
          quantity: i.qtyNum,
          unit_cost: i.costNum,
        })),
        shipping_cost: freteNum,
        other_costs: otherCosts
          .filter(c => c.description.trim() && parseBrl(c.amount) > 0)
          .map(c => ({
            description: c.description.trim(),
            category: c.category.trim() || undefined,
            amount: parseBrl(c.amount),
          })),
        notes: notes.trim() || undefined,
        funding_source: fundingSource,
        creditor_name: (fundingSource === 'FABIANA') ? 'Fabiana'
          : (fundingSource === 'DONA') ? 'Dona da Loja'
          : (fundingSource === 'OUTRO') ? creditorName.trim()
          : undefined,
      }
      const result: any = await createPurchase(params)
      dispatchInvalidate('purchases')
      dispatchInvalidate('inventory')
      dispatchInvalidate('products')
      dispatchInvalidateAll()

      const total = Number(result?.total_cost ?? totalGeral)
      if (result?.obligation_id) {
        const cred = (fundingSource === 'FABIANA') ? 'Fabiana'
          : (fundingSource === 'DONA') ? 'Dona da Loja'
          : creditorName.trim() || 'credor'
        showFeedback('warn', `Entrada registrada. Compra financiada por ${cred} (R$ ${formatCurrency(total).replace('R$ ', '')}). Obrigação pendente criada (não saiu do caixa).`)
      } else if (result?.financial_created) {
        showFeedback('ok', `Entrada registrada com sucesso. Saídas financeiras lançadas no caixa da Eveline (R$ ${formatCurrency(total).replace('R$ ', '')}).`)
      } else {
        showFeedback('info', `Entrada de estoque registrada (R$ ${formatCurrency(total).replace('R$ ', '')}).`)
      }

      setTimeout(() => onSaved(), 500)
    } catch (e: any) {
      console.error(e)
      showFeedback('err', `Erro ao registrar entrada: ${e?.message ?? String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="sticky top-0 bg-white border-b border-ink-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              {[1, 2].map(s => (
                <div key={s} className="flex items-center gap-2">
                  <div className={cn(
                    'step-indicator',
                    s < step ? 'step-done' : s === step ? 'step-active' : 'step-pending'
                  )}>
                    {s < step ? '✓' : s}
                  </div>
                  <span className={cn(
                    'text-sm font-semibold',
                    s <= step ? 'text-ink-900' : 'text-ink-400'
                  )}>
                    {s === 1 ? 'Dados da NF' : 'Produtos + Rateio'}
                  </span>
                  {s === 1 && <div className="w-10 sm:w-16 h-px bg-ink-200" />}
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-500">
              {step === 1 ? 'Informe fornecedor e data.' : 'Adicione produtos, custos e confirme o rateio.'}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {toast && (
            <div
              role="status"
              className={cn(
                'rounded-xl border shadow-sm px-4 py-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2',
                toast.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : toast.type === 'warn'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : toast.type === 'info'
                  ? 'bg-sky-50 border-sky-200 text-sky-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              )}
            >
              <Check className={cn('w-5 h-5 flex-shrink-0 mt-0.5',
                toast.type === 'ok' ? 'text-emerald-600'
                  : toast.type === 'warn' ? 'text-amber-600'
                  : toast.type === 'info' ? 'text-sky-600'
                  : 'text-rose-600')} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold leading-snug">
                  {toast.type === 'ok' ? 'Sucesso' : toast.type === 'warn' ? 'Atenção' : toast.type === 'info' ? 'Informação' : 'Ops'}
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

          {step === 1 && (
            <div className="space-y-4 max-w-xl mx-auto py-4">
              <div>
                <label className="label flex items-center gap-1.5">
                  <Building2 className="w-4 h-4" /> Fornecedor
                </label>
                <input className="input" value={supplier} onChange={e => setSupplier(e.target.value)}
                  placeholder="Nome do fornecedor / fabricante" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" /> Data da entrada
                  </label>
                  <input type="date" className="input" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" /> Origem
                  </label>
                  <input className="input" value={origin} onChange={e => setOrigin(e.target.value)}
                    placeholder="Ex: São Paulo / SP" />
                </div>
              </div>

              <div className="card !p-4 space-y-3 bg-gradient-to-br from-ink-50/60 to-white">
                <h4 className="font-bold text-ink-900 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-brand-700" />
                  Quem pagou esta compra? (Origem do dinheiro)
                </h4>
                <p className="text-xs text-ink-500 -mt-1.5">
                  Controla se esta compra reduz o caixa da Eveline hoje ou se gera uma obrigação a restituir depois.
                  Estoques, FIFO, CMV e lucro funcionam IGUAL em qualquer opção.
                </p>
                <div className="space-y-2">
                  {([
                    { k: 'CAIXA_EVELINE' as const, title: '💰 Caixa Operacional da Eveline', desc: 'Dinheiro da conta operacional. SAÍDA real do caixa hoje.' },
                    { k: 'FABIANA' as const, title: 'Fabiana (💰 dinheiro dela)', desc: 'NÃO sai do caixa hoje. Vira obrigação pendente a restituir.' },
                    { k: 'DONA' as const, title: 'Dona da Loja (💰 dinheiro da sócia)', desc: 'NÃO sai do caixa hoje. Vira obrigação pendente.' },
                    { k: 'OUTRO' as const, title: 'Outro credor / terceiro', desc: 'Informar o nome abaixo. NÃO sai do caixa hoje. Vira obrigação.' },
                  ]).map(opt => (
                    <label key={opt.k} className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition',
                      fundingSource === opt.k
                        ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-200'
                        : 'border-ink-200 hover:bg-ink-50'
                    )}>
                      <input type="radio" className="mt-1 accent-brand-900"
                        checked={fundingSource === opt.k}
                        onChange={() => setFundingSource(opt.k)} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-ink-900">{opt.title}</div>
                        <div className="text-xs text-ink-500 mt-0.5">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>

                {fundingSource === 'OUTRO' && (
                  <div>
                    <label className="label text-sm">Nome do credor *</label>
                    <input
                      className="input"
                      value={creditorName}
                      onChange={e => setCreditorName(e.target.value)}
                      placeholder="Ex: Carlos (fornecedor emprestou o valor) / Família etc."
                    />
                  </div>
                )}

                {fundingSource === 'CAIXA_EVELINE' ? (
                  <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 text-xs text-sky-900 space-y-0.5">
                    <div className="font-bold">ℹ️ Efeito financeiro imediato</div>
                    <div>Esta compra irá gerar automaticamente <b>saídas reais</b> de caixa em financeiro (estoque + frete + outros), reduzindo o saldo da conta operacional hoje.</div>
                  </div>
                ) : fundingSource === 'OUTRO' ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 space-y-0.5">
                    <div className="font-bold">⚠️ Compra financiada por terceiro</div>
                    <div>
                      NÃO será lançada como saída do caixa agora. Irá aparecer automaticamente no <b>Dashboard · Bloco Obrigações Pendentes</b> no valor total de <b>{formatCurrency(totalGeral)}</b>.
                    </div>
                    <div>Quando devolver o dinheiro, execute <b>“Pagar obrigação”</b> para lançar a saída NAQUELE MOMENTO.</div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 space-y-0.5">
                    <div className="font-bold">⚠️ Compra financiada por <b>{fundingSource === 'FABIANA' ? 'Fabiana' : 'Dona da Loja'}</b></div>
                    <div>
                      NÃO será lançada como saída do caixa agora. Irá aparecer automaticamente no <b>Dashboard · Bloco Obrigações Pendentes</b> no valor total de <b>{formatCurrency(totalGeral)}</b>.
                    </div>
                    <div>Quando devolver o dinheiro, execute <b>“Pagar obrigação”</b> para lançar a saída NAQUELE MOMENTO.</div>
                  </div>
                )}
              </div>

              <div>
                <label className="label">Observações (opcional)</label>
                <textarea className="input min-h-[80px]" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Nº da NF, condições de pagamento..." />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-ink-800 flex items-center gap-2">
                    <Package className="w-4 h-4" /> Produtos da entrada
                  </h3>
                  <button onClick={addItem} className="btn-secondary !py-2 text-xs">
                    <Plus className="w-3.5 h-3.5" /> Adicionar produto
                  </button>
                </div>
                <div className="space-y-3">
                  {items.map((it, i) => {
                    const r = rateioCalc[i]
                    return (
                      <div key={i} className="p-3 rounded-lg border border-ink-100 bg-ink-50/30 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                          <div className="sm:col-span-5">
                            <label className="label text-xs mb-1">Produto</label>
                            <div className="relative">
                              <select
                                className="select pr-10 w-full text-sm"
                                value={it.product_id || ''}
                                onChange={e => onSelectProduct(i, e.target.value)}
                              >
                                <option value="">Selecione ou digite abaixo...</option>
                                {products.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                              <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                            </div>
                            {!it.product_id && (
                              <input
                                className="input mt-2 text-sm"
                                placeholder="Ou digite o nome do produto novo..."
                                value={it.product_name}
                                onChange={e => updateItem(i, { product_name: e.target.value })}
                              />
                            )}
                          </div>
                          <div className="sm:col-span-2">
                            <label className="label text-xs mb-1">Qtd</label>
                            <input
                              type="number" min={0} step="1"
                              className="input num text-sm"
                              value={it.quantity}
                              onChange={e => updateItem(i, { quantity: e.target.value })}
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="label text-xs mb-1">Custo unit. (R$)</label>
                            <input
                              className="input num text-sm"
                              value={it.unit_cost}
                              onChange={e => updateItem(i, { unit_cost: e.target.value })}
                              inputMode="decimal"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="label text-xs mb-1">Subtotal</label>
                            <div className="input text-sm num font-bold text-brand-900 bg-ink-50">
                              {formatCurrency(r?.subtotal || 0)}
                            </div>
                          </div>
                          <div className="sm:col-span-1 flex items-end">
                            <button
                              onClick={() => removeItem(i)}
                              disabled={items.length === 1}
                              className="btn-ghost !p-2 text-rose-600 hover:bg-rose-50 w-full"
                              aria-label="Remover item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        {allocation !== 'none' && (freteNum > 0 || outrosNum > 0) && (r?.qtyNum || 0) > 0 && (
                          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-ink-100">
                            <div className="p-2 rounded bg-white border border-ink-100">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Rateio</div>
                              <div className="text-sm num font-semibold text-violet-700">{formatCurrency(r?.rateio || 0)}</div>
                            </div>
                            <div className="p-2 rounded bg-white border border-ink-100">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Custo efetivo un.</div>
                              <div className="text-sm num font-bold text-brand-900">{formatCurrency(r?.custoEfetivo || 0)}</div>
                            </div>
                            <div className="p-2 rounded bg-white border border-ink-100">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">% rateio</div>
                              <div className="text-sm num font-semibold text-ink-700">
                                {allocation === 'quantity'
                                  ? totalQtd > 0 ? `${((r?.qtyNum || 0) / totalQtd * 100).toFixed(1)}%` : '0%'
                                  : totalValor > 0 ? `${((r?.subtotal || 0) / totalValor * 100).toFixed(1)}%` : '0%'}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card p-4 space-y-4">
                  <h3 className="font-bold text-ink-800 flex items-center gap-2">
                    <Truck className="w-4 h-4" /> Custos adicionais da entrada
                  </h3>
                  <p className="text-xs text-ink-500">
                    Sacolas, cheirinho, frete, taxas — tudo é rateado no custo efetivo de cada peça.
                  </p>
                  <div>
                    <label className="label text-sm">Frete / Transporte (R$)</label>
                    <input className="input num" value={shippingCost} onChange={e => setShippingCost(e.target.value)}
                      inputMode="decimal" placeholder="0,00" />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="label mb-0 text-sm">Custos extras (sacolas, cheirinho etc.)</label>
                      <button onClick={addCusto} className="btn-ghost !py-1.5 text-xs">
                        <Plus className="w-3 h-3" /> Personalizado
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {([
                        { k: 'bag', description: 'Sacolas plásticas', category: 'Embalagem', icon: '🛍️' },
                        { k: 'scent', description: 'Cheirinho / Perfumaria', category: 'Embalagem', icon: '🌸' },
                        { k: 'tissue', description: 'Papel seda / tissue', category: 'Embalagem', icon: '📜' },
                        { k: 'sticker', description: 'Etiquetas / Adesivos', category: 'Embalagem', icon: '🏷️' },
                        { k: 'box', description: 'Caixas de presente', category: 'Embalagem', icon: '🎁' },
                        { k: 'ribbon', description: 'Fitas / Laços', category: 'Embalagem', icon: '🎀' },
                        { k: 'cardfee', description: 'Taxa maquininha (entrada)', category: 'Taxa', icon: '💳' },
                        { k: 'handling', description: 'Manuseio / Serviço', category: 'Manuseio', icon: '🧰' },
                        { k: 'insurance', description: 'Seguro / Rastreio', category: 'Seguro', icon: '🛡️' },
                        { k: 'tax', description: 'Imposto / ICMS', category: 'Imposto', icon: '🧾' },
                      ]).map(p => (
                        <button key={p.k} onClick={() => addCustoRapido({ description: p.description, category: p.category })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                                     bg-white border border-ink-200 text-ink-700
                                     hover:bg-brand-50 hover:border-brand-300 hover:text-brand-800
                                     active:scale-[0.98] transition min-h-[36px]">
                          <span className="text-sm leading-none">{p.icon}</span>
                          <span>{p.description}</span>
                        </button>
                      ))}
                    </div>

                    {otherCosts.length === 0 ? (
                      <div className="p-3 rounded-lg bg-ink-50 border border-ink-100 border-dashed text-center text-xs text-ink-500">
                        Nenhum custo extra adicionado. Clique nos botões acima para lançar rápido.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {otherCosts.map((c, i) => (
                          <div key={i} className="grid grid-cols-12 gap-2 items-start">
                            <div className="col-span-5">
                              <input className="input text-xs" placeholder="Descrição (ex: Sacolas P)"
                                value={c.description} onChange={e => updateCusto(i, { description: e.target.value })} />
                            </div>
                            <div className="col-span-3">
                              <select className="select pr-8 text-xs" value={c.category}
                                onChange={e => updateCusto(i, { category: e.target.value })}>
                                <option>Embalagem</option>
                                <option>Outra despesa</option>
                                <option>Imposto</option>
                                <option>Seguro</option>
                                <option>Taxa</option>
                                <option>Manuseio</option>
                              </select>
                            </div>
                            <div className="col-span-3">
                              <input className="input num text-xs" value={c.amount}
                                onChange={e => updateCusto(i, { amount: e.target.value })} inputMode="decimal"
                                placeholder="0,00" />
                            </div>
                            <div className="col-span-1">
                              <button onClick={() => removeCusto(i)} className="btn-ghost !p-2 text-rose-600 hover:bg-rose-50 w-full" aria-label="Remover custo">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="card p-4 space-y-4">
                  <h3 className="font-bold text-ink-800 flex items-center gap-2">
                    <Calculator className="w-4 h-4" /> Método de rateio
                  </h3>
                  <p className="text-xs text-ink-500">Como frete e outros custos serão distribuídos entre os produtos.</p>
                  <div className="space-y-2">
                    {([
                      { k: 'quantity' as const, title: 'Proporcional por QUANTIDADE', desc: 'Rateia por volume de peças recebidas. (padrão)' },
                      { k: 'value' as const, title: 'Proporcional por VALOR', desc: 'Rateia pelo custo da mercadoria na linha.' },
                      { k: 'none' as const, title: 'Nenhum rateio', desc: 'Custos extras NÃO são alocados nos produtos (custo unitário mantido).' },
                    ]).map(opt => (
                      <label key={opt.k} className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition',
                        allocation === opt.k
                          ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-200'
                          : 'border-ink-200 hover:bg-ink-50'
                      )}>
                        <input type="radio" className="mt-1 accent-brand-900"
                          checked={allocation === opt.k}
                          onChange={() => setAllocation(opt.k)} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-ink-900">{opt.title}</div>
                          <div className="text-xs text-ink-500 mt-0.5">{opt.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card p-5 bg-gradient-to-br from-ink-50 to-white">
                <div className="divider-label !my-2">Resumo da entrada</div>
                <div className="space-y-2">
                  <ResumoRow label="Subtotal mercadorias" value={formatCurrency(subtotalMerc)} />
                  <ResumoRow label="Frete" value={formatCurrency(freteNum)} />
                  <ResumoRow label={`Outros custos (${pluralize(otherCosts.filter(c => parseBrl(c.amount) > 0).length, 'item')})`} value={formatCurrency(outrosNum)} />
                  {allocation !== 'none' && (
                    <ResumoRow label="Custos a rateiar" value={formatCurrency(freteNum + outrosNum)} dim highlight="violet" />
                  )}
                  <div className="pt-3 border-t border-ink-200 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-ink-900">TOTAL DA ENTRADA</div>
                      <div className="text-[11px] text-ink-500">{pluralize(totalQtd, 'peça')} · método: {allocation === 'quantity' ? 'Quantidade' : allocation === 'value' ? 'Valor' : 'Sem rateio'}</div>
                    </div>
                    <div className="text-2xl font-black num text-brand-900">{formatCurrency(totalGeral)}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-5 py-4 flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <div className="flex gap-2">
            {step > 1 && (
              <button onClick={() => setStep(s => (s - 1) as Step)} disabled={saving} className="btn-secondary">
                ← Voltar
              </button>
            )}
            <button onClick={onClose} disabled={saving} className="btn-ghost">Cancelar</button>
          </div>
          <div className="flex gap-2">
            {step < 2 && (
              <button
                onClick={() => setStep(s => (s + 1) as Step)}
                disabled={!canAdvance()}
                className="btn-primary"
              >
                Avançar →
              </button>
            )}
            {step === 2 && (
              <button onClick={submit} disabled={saving || totalQtd === 0} className="btn-primary">
                {saving ? 'Registrando...' : '✓ Confirmar Entrada'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ResumoRow({ label, value, dim, highlight }: { label: string; value: string; dim?: boolean; highlight?: 'violet' }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn('text-sm', dim ? 'text-violet-700 font-semibold' : 'text-ink-600')}>{label}</span>
      <span className={cn('num', dim ? 'font-bold text-violet-700' : 'font-semibold text-ink-800')}>{value}</span>
    </div>
  )
}

function DetailModal({
  detailId, detail, loading, onClose
}: {
  detailId: string
  detail: any
  loading: boolean
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-white border-b border-ink-100 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-ink-900">Detalhe da Entrada</h2>
            <p className="text-xs text-ink-500 mt-0.5">{loading ? 'Carregando...' : (detail?.purchase?.id || detailId?.slice(0, 8))}</p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="text-center py-10 text-ink-500">Carregando detalhes...</div>
          ) : detail ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <InfoMini label="Fornecedor" value={detail.purchase?.supplier || '—'} />
                <InfoMini label="Data" value={formatDate(detail.purchase?.entry_date)} />
                <InfoMini label="Origem" value={detail.purchase?.origin || '—'} />
                <InfoMini label="Rateio" value={
                  detail.purchase?.cost_allocation_method === 'quantity' ? 'Qtd' :
                  detail.purchase?.cost_allocation_method === 'value' ? 'Valor' : 'Nenhum'
                } />
              </div>
              <div className="card">
                <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between">
                  <h3 className="font-bold text-ink-800">Itens ({(detail.items || []).length})</h3>
                </div>
                <div className="table-wrap">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th className="text-right">Qtd</th>
                        <th className="text-right">Custo unit.</th>
                        <th className="text-right">Rateio</th>
                        <th className="text-right">Custo efetivo</th>
                        <th className="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).map((it: any) => (
                        <tr key={it.id}>
                          <td className="font-medium text-ink-800">{it.product_snapshot}</td>
                          <td className="text-right num">{it.quantity}</td>
                          <td className="text-right num">{formatCurrency(it.unit_cost)}</td>
                          <td className="text-right num text-violet-700">{formatCurrency(it.allocated_share)}</td>
                          <td className="text-right num font-bold text-brand-900">{formatCurrency(it.effective_cost)}</td>
                          <td className="text-right num font-bold">{formatCurrency(it.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {(detail.costs || []).length > 0 && (
                <div className="card">
                  <div className="px-4 py-3 border-b border-ink-100">
                    <h3 className="font-bold text-ink-800">Custos extras</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Descrição</th>
                          <th>Categoria</th>
                          <th className="text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.costs || []).map((c: any) => (
                          <tr key={c.id}>
                            <td>{c.description}</td>
                            <td>{c.category || '—'}</td>
                            <td className="text-right num font-semibold text-rose-700">{formatCurrency(c.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="p-4 rounded-xl bg-ink-900 text-white flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/60 font-bold">Total da entrada</div>
                </div>
                <div className="text-2xl font-black num">{formatCurrency(detail.purchase?.total_cost)}</div>
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-ink-500">Sem dados.</div>
          )}
        </div>
        <div className="border-t border-ink-100 px-5 py-4 flex justify-end">
          <button onClick={onClose} className="btn-secondary">Fechar</button>
        </div>
      </div>
    </div>
  )
}

function InfoMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-ink-50 border border-ink-100">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-sm font-bold text-ink-900 mt-0.5 truncate">{value}</div>
    </div>
  )
}
