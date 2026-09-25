import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Minus, X, ArrowRight, ArrowLeft, Check, Package, Tag, MapPin, CreditCard, Gift, Search, ChevronDown, Trash2, AlertTriangle, Calendar, Filter, ShoppingCart, Receipt, DollarSign, TrendingUp, Home, Save, ArrowUpRight, ArrowDownRight, PackageCheck, ShoppingBag, Store, Truck, Globe, MoreHorizontal
} from 'lucide-react'
import {
  formatCurrency, formatPercent, formatDate, formatDateTime, formatFriendlyNumber, parseBrl, sourceLabel, statusLabel, paymentMethodLabel, pluralize, rangePresets, inRange, cn
} from '@/lib/format'
import type { Product, Sale, SaleItem, SalePayment, SalePackaging, SaleCost, Coupon, UUID, PaymentMethod, SaleSource, PaymentFeeRule, PackagingType } from '@/types/supabase'
import {
  listAllProducts, listPackagingTypes, listPaymentProviders, findFee, listCoupons, getSetting, finalizeSale,
  dispatchInvalidateAll
} from '@/services'
import type { FinalizeSaleParams, ProviderWithModalities } from '@/services'

type Step = 1 | 2 | 3 | 4 | 5 | 6

interface CartItem {
  product: Product
  quantity: number
  discountProduct: number
}

interface AppliedCoupon {
  coupon: Coupon
  value: number
}

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: 'Produtos' },
  { step: 2, label: 'Desconto' },
  { step: 3, label: 'Origem' },
  { step: 4, label: 'Pagamento' },
  { step: 5, label: 'Embalagem' },
  { step: 6, label: 'Revisão' },
]

const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'DEBITO', 'CREDITO', 'BOLETO', 'DINHEIRO', 'OUTRO']
const EXTRA_COST_CATEGORIES = ['Frete', 'Entrega', 'Outro']
const ORIGENS: { source: SaleSource; label: string; icon: React.ReactNode; hint?: string }[] = [
  { source: 'SITE', label: 'Site / E-commerce', icon: <Globe className="w-6 h-6" />, hint: 'Checkout online' },
  { source: 'PRESENCIAL', label: 'Presencial / Loja', icon: <Store className="w-6 h-6" />, hint: 'Tap/POS na loja' },
  { source: 'DISTANCIA', label: 'WhatsApp / Distância', icon: <Truck className="w-6 h-6" />, hint: 'Link de pagamento' },
  { source: 'OUTRO', label: 'Outro', icon: <MoreHorizontal className="w-6 h-6" />, hint: 'Sem sugestão' },
]

export default function NewSalePage() {
  const navigate = useNavigate()

  const [currentStep, setCurrentStep] = useState<Step>(1)
  const [visitedSteps, setVisitedSteps] = useState<Set<Step>>(new Set([1]))
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)

  const [products, setProducts] = useState<Product[]>([])
  const [allCoupons, setAllCoupons] = useState<Coupon[]>([])
  const [paymentProviders, setPaymentProviders] = useState<ProviderWithModalities[]>([])
  const [packagingTypes, setPackagingTypes] = useState<PackagingType[]>([])
  const [pixDiscountEnabled, setPixDiscountEnabled] = useState(false)
  const [pixDiscountPercent, setPixDiscountPercent] = useState(0)

  const [cart, setCart] = useState<CartItem[]>([])
  const [searchProduct, setSearchProduct] = useState('')
  const [showProductsPanel, setShowProductsPanel] = useState(false)

  const [generalDiscountType, setGeneralDiscountType] = useState<'BRL' | 'PERCENT'>('BRL')
  const [generalDiscountInput, setGeneralDiscountInput] = useState('')
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [pixEnabled, setPixEnabled] = useState(false)

  const [source, setSource] = useState<SaleSource>('PRESENCIAL')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')

  const [selectedProviderId, setSelectedProviderId] = useState<UUID | ''>('')
  const [selectedModalityId, setSelectedModalityId] = useState<UUID | ''>('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX')
  const [installments, setInstallments] = useState(1)
  const [feeRule, setFeeRule] = useState<PaymentFeeRule | null>(null)
  const [feeActual, setFeeActual] = useState('0')
  const [editFeePercent, setEditFeePercent] = useState(false)
  const [feePercentActual, setFeePercentActual] = useState('0')

  const [packagingSelection, setPackagingSelection] = useState<'GRANDE' | 'PEQUENA'>('PEQUENA')
  const [packagingTypeId, setPackagingTypeId] = useState<UUID | ''>('')
  const [packagingCostInput, setPackagingCostInput] = useState('7.08')
  const [extraCosts, setExtraCosts] = useState<{ id: string; description: string; category: string; amount: string }[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      listAllProducts(),
      listCoupons(),
      listPaymentProviders(),
      listPackagingTypes(),
      getSetting('pix_discount_enabled'),
      getSetting('pix_discount_percent'),
    ]).then(([prods, cps, provs, pkgs, pixEnabled, pixPct]) => {
      setProducts(prods)
      setAllCoupons(cps)
      setPaymentProviders(provs)
      setPackagingTypes(pkgs)
      setPixDiscountEnabled(Boolean(pixEnabled))
      setPixDiscountPercent(Number(pixPct ?? 0))
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!source || paymentProviders.length === 0) return
    let providerName = ''
    let modalityName = ''
    let methodDefault: PaymentMethod = 'PIX'
    if (source === 'SITE') { providerName = 'Mercado Pago'; modalityName = 'Checkout'; methodDefault = 'CREDITO' }
    else if (source === 'PRESENCIAL') { providerName = 'InfinitePay'; modalityName = 'Tap'; methodDefault = 'DEBITO' }
    else if (source === 'DISTANCIA') { providerName = 'InfinitePay'; modalityName = 'Link'; methodDefault = 'PIX' }
    else { return }
    const prov = paymentProviders.find(p => p.provider.name.toLowerCase().includes(providerName.toLowerCase()) || p.provider.code?.toLowerCase().includes(providerName.toLowerCase()))
    if (prov) {
      setSelectedProviderId(prov.provider.id)
      const mod = prov.modalities.find(m => m.name.toLowerCase().includes(modalityName.toLowerCase()) || m.code?.toLowerCase().includes(modalityName.toLowerCase()))
      if (mod) setSelectedModalityId(mod.id)
    }
    setPaymentMethod(methodDefault)
  }, [source, paymentProviders])

  const selectedProvider = useMemo(() => paymentProviders.find(p => p.provider.id === selectedProviderId), [paymentProviders, selectedProviderId])
  const selectedModality = useMemo(() => selectedProvider?.modalities.find(m => m.id === selectedModalityId), [selectedProvider, selectedModalityId])

  useEffect(() => {
    if (!selectedProviderId || !selectedModalityId || !paymentMethod) {
      setFeeRule(null); return
    }
    findFee(selectedProviderId, selectedModalityId, paymentMethod, installments).then(r => setFeeRule(r))
  }, [selectedProviderId, selectedModalityId, paymentMethod, installments])

  useEffect(() => {
    if (feeRule) {
      setFeeActual(feeExpectedCalc.toFixed(2))
      setFeePercentActual(String(feeRule.fee_percent))
    } else {
      setFeeActual('0')
      setFeePercentActual('0')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeRule])

  const packagingSuggestedCost = useMemo(() => {
    const code = packagingSelection
    const registered = packagingTypes.find(p =>
      p.code?.toUpperCase() === code ||
      p.name.toLocaleLowerCase('pt-BR').includes(code === 'GRANDE' ? 'grande' : 'pequena')
    )
    return Number(registered?.unit_cost ?? (code === 'GRANDE' ? 8.28 : 7.08))
  }, [packagingSelection, packagingTypes])

  useEffect(() => {
    if (cart.length === 0) return

    const normalize = (value: string) =>
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const containsJeansPants = cart.some(({ product }) => {
      const description = normalize(product.name + ' ' + (product.sku ?? ''))
      return description.includes('jeans') && description.includes('calca')
    })
    const recommended: 'GRANDE' | 'PEQUENA' =
      cart.reduce((total, item) => total + item.quantity, 0) > 1 || containsJeansPants ? 'GRANDE' : 'PEQUENA'
    const registered = packagingTypes.find(p =>
      p.code?.toUpperCase() === recommended ||
      p.name.toLocaleLowerCase('pt-BR').includes(recommended === 'GRANDE' ? 'grande' : 'pequena')
    )
    const cost = Number(registered?.unit_cost ?? (recommended === 'GRANDE' ? 8.28 : 7.08))

    setPackagingSelection(recommended)
    setPackagingTypeId(registered?.id ?? '')
    setPackagingCostInput(cost.toFixed(2))
  }, [cart, packagingTypes])

  const addProduct = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) {
        return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { product, quantity: 1, discountProduct: 0 }]
    })
  }

  const updateCartItemQty = (productId: UUID, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.product.id !== productId) return i
      const newQty = Math.max(0, i.quantity + delta)
      return { ...i, quantity: newQty }
    }).filter(i => i.quantity > 0))
  }

  const removeCartItem = (productId: UUID) => {
    setCart(prev => prev.filter(i => i.product.id !== productId))
  }

  const setItemDiscount = (productId: UUID, value: string) => {
    setCart(prev => prev.map(i => i.product.id === productId
      ? { ...i, discountProduct: parseBrl(value) }
      : i
    ))
  }

  const subtotalCarrinho = useMemo(
    () => cart.reduce((s, i) => s + Number(i.product.sale_price ?? 0) * i.quantity, 0),
    [cart]
  )
  const descontoProdutos = useMemo(
    () => cart.reduce((s, i) => s + Number(i.discountProduct ?? 0), 0),
    [cart]
  )
  const pecas = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart])

  const generalDiscountBrl = useMemo(() => {
    const cartSemDescontoProduto = subtotalCarrinho - descontoProdutos
    if (generalDiscountType === 'BRL') return Math.min(parseBrl(generalDiscountInput), cartSemDescontoProduto)
    return (cartSemDescontoProduto * Math.min(100, parseBrl(generalDiscountInput))) / 100
  }, [generalDiscountInput, generalDiscountType, subtotalCarrinho, descontoProdutos])

  const subtotalAposDescontosManuais = subtotalCarrinho - descontoProdutos - generalDiscountBrl

  const couponDiscount = useMemo(() => {
    if (!appliedCoupon) return 0
    const base = Math.max(0, subtotalAposDescontosManuais)
    if (appliedCoupon.coupon.type === 'FIXED') return Math.min(appliedCoupon.coupon.value, base)
    const pct = (base * appliedCoupon.coupon.value) / 100
    return Math.min(pct, appliedCoupon.coupon.max_discount ?? Infinity)
  }, [appliedCoupon, subtotalAposDescontosManuais])

  const subtotalComDescontosGerais = Math.max(0, subtotalAposDescontosManuais - couponDiscount)

  const pixDiscount = useMemo(() => {
    if (!pixEnabled || !pixDiscountEnabled) return 0
    return (subtotalComDescontosGerais * pixDiscountPercent) / 100
  }, [pixEnabled, pixDiscountEnabled, pixDiscountPercent, subtotalComDescontosGerais])

  const totalCliente = Math.max(0, subtotalComDescontosGerais - pixDiscount)

  const feeExpectedCalc = useMemo(() => {
    if (!feeRule) return 0
    return (totalCliente * (Number(feeRule.fee_percent ?? 0)) / 100) + Number(feeRule.fixed_fee ?? 0)
  }, [feeRule, totalCliente])

  const feeActualBrl = useMemo(() => {
    if (editFeePercent && feeRule) {
      return (totalCliente * Math.max(0, parseBrl(feePercentActual))) / 100 + Number(feeRule?.fixed_fee ?? 0)
    }
    return parseBrl(feeActual)
  }, [feeActual, feePercentActual, editFeePercent, totalCliente, feeRule])

  const economiaTaxa = feeExpectedCalc - feeActualBrl

  const packagingCostBrl = useMemo(() => parseBrl(packagingCostInput), [packagingCostInput])

  const extraCostsTotal = useMemo(() => extraCosts.reduce((s, c) => s + parseBrl(c.amount), 0), [extraCosts])

  const totalAdicionais = packagingCostBrl + extraCostsTotal

  const custoMercadorias = useMemo(() =>
    cart.reduce((s, i) => s + Number(i.product.current_cost ?? 0) * i.quantity, 0),
    [cart])

  const custoTotal = custoMercadorias + feeActualBrl + packagingCostBrl + extraCostsTotal
  const lucroReal = totalCliente - custoTotal
  const margem = totalCliente ? (lucroReal / totalCliente) * 100 : 0

  const filteredProducts = useMemo(() => {
    if (!searchProduct.trim()) return products
    const s = searchProduct.toLowerCase().trim()
    return products.filter(p =>
      p.name.toLowerCase().includes(s) ||
      (p.sku || '').toLowerCase().includes(s)
    )
  }, [products, searchProduct])

  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase()
    if (!code) { alert('Digite um cupom'); return }
    const found = allCoupons.find(c => c.code.toUpperCase() === code && c.active)
    if (!found) { alert('Cupom inválido ou inativo'); return }
    const minOrder = Number(found.min_order_value ?? 0)
    if (subtotalAposDescontosManuais < minOrder) {
      alert(`Cupom requer valor mínimo de ${formatCurrency(minOrder)} (atual: ${formatCurrency(subtotalAposDescontosManuais)})`)
      return
    }
    const base = Math.max(0, subtotalAposDescontosManuais)
    const val = found.type === 'FIXED' ? Math.min(found.value, base) : Math.min((base * found.value) / 100, found.max_discount ?? Infinity)
    setAppliedCoupon({ coupon: found, value: val })
  }

  const removeCoupon = () => { setAppliedCoupon(null); setCouponInput('') }

  const addExtraCost = () => {
    setExtraCosts(prev => [...prev, { id: Math.random().toString(36).slice(2), description: '', category: 'Outro', amount: '' }])
  }

  const updateExtraCost = (id: string, field: 'description' | 'category' | 'amount', value: string) => {
    setExtraCosts(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  const removeExtraCost = (id: string) => {
    setExtraCosts(prev => prev.filter(c => c.id !== id))
  }

  const canAdvance = useMemo(() => {
    if (currentStep === 1) return cart.length > 0 && pecas > 0
    if (currentStep === 2) return true
    if (currentStep === 3) return !!source
    if (currentStep === 4) return !!paymentMethod
    if (currentStep === 5) return true
    return true
  }, [currentStep, cart, pecas, source, paymentMethod])

  const goNext = () => {
    if (!canAdvance) {
      if (currentStep === 1) alert('Adicione pelo menos 1 produto ao carrinho.')
      else if (currentStep === 4) alert('Selecione o método de pagamento.')
      return
    }
    if (currentStep < 6) {
      const next = (currentStep + 1) as Step
      setCurrentStep(next)
      setVisitedSteps(prev => new Set(prev).add(next))
    }
  }

  const goPrev = () => {
    if (currentStep > 1) setCurrentStep((currentStep - 1) as Step)
  }

  const clickStep = (s: Step) => {
    if (visitedSteps.has(s)) setCurrentStep(s)
  }

  const doFinalize = async () => {
    try {
      setFinalizing(true)
      const items: FinalizeSaleParams['items'] = cart.map(i => {
        const unitSale = Number(i.product.sale_price ?? 0)
        const totalSale = unitSale * i.quantity
        const discountTotal = Number(i.discountProduct ?? 0)
        const unitActual = totalSale > 0 ? (totalSale - discountTotal) / i.quantity : unitSale
        return {
          product_id: i.product.id,
          product_name: i.product.name,
          sku: i.product.sku ?? undefined,
          quantity: i.quantity,
          unit_sale_price: unitSale,
          unit_actual_price: unitActual,
          discount: discountTotal,
        }
      })

      const packagingTypeIdFinal = packagingTypeId || (packagingSelection === 'GRANDE' || packagingSelection === 'PEQUENA'
        ? (packagingTypes.find(p => p.name.toLowerCase().includes(packagingSelection === 'GRANDE' ? 'gran' : 'peq'))?.id)
        : undefined)

      const params: FinalizeSaleParams = {
        source,
        items,
        general_discount: generalDiscountBrl,
        coupon_id: appliedCoupon?.coupon.id ?? null,
        coupon_code: appliedCoupon?.coupon.code ?? null,
        pix_discount: pixDiscount,
        payment: {
          provider_id: selectedProviderId || undefined,
          modality_id: selectedModalityId || undefined,
          method: paymentMethod,
          installments,
          amount: totalCliente,
          fee_percent: Number(feeRule?.fee_percent ?? 0),
          fee_expected: feeExpectedCalc,
          fee_actual: feeActualBrl,
          provider_snapshot: selectedProvider?.provider.name,
          modality_snapshot: selectedModality?.name,
          fee_rule_id: feeRule?.id,
        },
        packaging: {
          packaging_type_id: packagingTypeIdFinal || undefined,
          tipo_snapshot: packagingSelection,
          custo_snapshot: packagingSuggestedCost,
          custom_cost: packagingCostBrl,
          is_free: false,
        },
        extra_costs: extraCosts
          .filter(c => c.description.trim() && parseBrl(c.amount) > 0)
          .map(c => ({ description: c.description, category: c.category, amount: parseBrl(c.amount) })),
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
      }

      const res = await finalizeSale(params)
      const sale_id = res?.sale_id ?? res?.id ?? res
      const friendly_number = res?.friendly_number ?? res?.num ?? ''
      alert(`Venda #${friendly_number ? formatFriendlyNumber(friendly_number) : ''} finalizada!`)
      dispatchInvalidateAll()
      navigate(`/vendas/${sale_id}`)
    } catch (e: any) {
      console.error(e)
      alert('Erro ao finalizar venda: ' + (e?.message ?? String(e)))
    } finally {
      setFinalizing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-ink-500 text-sm">Carregando PDV…</div>
      </div>
    )
  }

  return (
    <div className="pb-40 sm:pb-10 space-y-4">
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-ink-100 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-ink-900">Nova venda</h1>
            <p className="text-xs text-ink-500 mt-0.5">PDV · 6 etapas para finalizar a venda</p>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-ink-500">Total cliente</div>
            <div className="text-2xl font-black text-brand-900 num">{formatCurrency(totalCliente)}</div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-1 sm:gap-2">
          {STEPS.map((s, idx) => (
            <div key={s.step} className="flex items-center flex-1 min-w-0">
              <button
                onClick={() => clickStep(s.step)}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1.5',
                  visitedSteps.has(s.step) ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'
                )}
              >
                <div className={cn(
                  'step-indicator',
                  currentStep === s.step ? 'step-active' :
                  visitedSteps.has(s.step) && currentStep > s.step ? 'step-done' : 'step-pending'
                )}>
                  {visitedSteps.has(s.step) && currentStep > s.step ? <Check className="w-3.5 h-3.5" /> : s.step}
                </div>
                <span className={cn(
                  'text-xs font-semibold hidden sm:inline truncate',
                  currentStep === s.step ? 'text-brand-900' :
                  visitedSteps.has(s.step) ? 'text-ink-700' : 'text-ink-400'
                )}>{s.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <div className={cn(
                  'flex-1 h-0.5 mx-0.5 sm:mx-1 rounded',
                  visitedSteps.has(s.step) && currentStep > s.step ? 'bg-brand-700' : 'bg-ink-100'
                )} />
              )}
            </div>
          ))}
        </div>
      </div>

      {currentStep === 1 && (
        <StepProducts
          cart={cart} addProduct={addProduct} removeCartItem={removeCartItem}
          updateCartItemQty={updateCartItemQty} setItemDiscount={setItemDiscount}
          filteredProducts={filteredProducts} searchProduct={searchProduct}
          setSearchProduct={setSearchProduct} showProductsPanel={showProductsPanel}
          setShowProductsPanel={setShowProductsPanel}
        />
      )}

      {currentStep === 2 && (
        <StepDiscount
          subtotalCarrinho={subtotalCarrinho} descontoProdutos={descontoProdutos}
          generalDiscountBrl={generalDiscountBrl} generalDiscountType={generalDiscountType}
          setGeneralDiscountType={setGeneralDiscountType} generalDiscountInput={generalDiscountInput}
          setGeneralDiscountInput={setGeneralDiscountInput}
          appliedCoupon={appliedCoupon} couponInput={couponInput} setCouponInput={setCouponInput}
          applyCoupon={applyCoupon} removeCoupon={removeCoupon}
          pixDiscountEnabled={pixDiscountEnabled} pixEnabled={pixEnabled} setPixEnabled={setPixEnabled}
          pixDiscount={pixDiscount} pixDiscountPercent={pixDiscountPercent}
          subtotalAposDescontosManuais={subtotalAposDescontosManuais}
          couponDiscount={couponDiscount} subtotalComDescontosGerais={subtotalComDescontosGerais}
          totalCliente={totalCliente}
        />
      )}

      {currentStep === 3 && (
        <StepSource
          source={source} setSource={setSource}
          customerName={customerName} setCustomerName={setCustomerName}
          customerPhone={customerPhone} setCustomerPhone={setCustomerPhone}
        />
      )}

      {currentStep === 4 && (
        <StepPayment
          paymentProviders={paymentProviders}
          selectedProviderId={selectedProviderId} setSelectedProviderId={(id: string) => { setSelectedProviderId(id); setSelectedModalityId('') }}
          selectedModalityId={selectedModalityId} setSelectedModalityId={setSelectedModalityId}
          paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
          installments={installments} setInstallments={setInstallments}
          feeRule={feeRule} feeExpectedCalc={feeExpectedCalc}
          feeActual={feeActual} setFeeActual={setFeeActual}
          editFeePercent={editFeePercent} setEditFeePercent={setEditFeePercent}
          feePercentActual={feePercentActual} setFeePercentActual={setFeePercentActual}
          economiaTaxa={economiaTaxa}
          totalCliente={totalCliente} feeActualBrl={feeActualBrl}
        />
      )}

      {currentStep === 5 && (
        <StepPackaging
          packagingSelection={packagingSelection} setPackagingSelection={setPackagingSelection}
          packagingTypes={packagingTypes} packagingTypeId={packagingTypeId} setPackagingTypeId={setPackagingTypeId}

          packagingCostInput={packagingCostInput} setPackagingCostInput={setPackagingCostInput}
          packagingSuggestedCost={packagingSuggestedCost} packagingCostBrl={packagingCostBrl}
          extraCosts={extraCosts} addExtraCost={addExtraCost}
          updateExtraCost={updateExtraCost} removeExtraCost={removeExtraCost}
          extraCostsTotal={extraCostsTotal} totalAdicionais={totalAdicionais}
        />
      )}

      {currentStep === 6 && (
        <StepReview
          cart={cart} subtotalCarrinho={subtotalCarrinho} descontoProdutos={descontoProdutos}
          generalDiscountBrl={generalDiscountBrl} appliedCoupon={appliedCoupon} couponDiscount={couponDiscount}
          pixDiscount={pixDiscount} totalCliente={totalCliente}
          source={source} customerName={customerName} customerPhone={customerPhone}
          selectedProvider={selectedProvider} selectedModality={selectedModality}
          paymentMethod={paymentMethod} installments={installments}
          feeExpectedCalc={feeExpectedCalc} feeActualBrl={feeActualBrl} economiaTaxa={economiaTaxa}
          packagingSelection={packagingSelection} packagingCostBrl={packagingCostBrl}
          extraCosts={extraCosts} extraCostsTotal={extraCostsTotal}
          custoMercadorias={custoMercadorias} custoTotal={custoTotal} lucroReal={lucroReal} margem={margem}
        />
      )}

      <div className="sticky-bottom-panel sm:hidden">
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-500">Subtotal ({pluralize(pecas, 'peça')})</span>
            <span className="num font-semibold">{formatCurrency(subtotalCarrinho - descontoProdutos - generalDiscountBrl - couponDiscount)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink-700">Total cliente</span>
            <span className="text-xl font-black text-brand-900 num">{formatCurrency(totalCliente)}</span>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={goPrev} disabled={currentStep === 1} className="btn-secondary flex-1 min-h-[48px]">
              <ArrowLeft className="w-4 h-4" /> Anterior
            </button>
            {currentStep < 6 ? (
              <button onClick={goNext} disabled={!canAdvance} className="btn-primary flex-1 min-h-[48px]">
                Próxima <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={doFinalize} disabled={finalizing} className="btn-success flex-1 min-h-[48px]">
                <Check className="w-4 h-4" /> {finalizing ? 'Finalizando…' : 'Finalizar Venda'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden sm:flex items-center justify-between gap-3 sticky bottom-0 bg-white border-t border-ink-100 py-3 -mx-4 px-4 safe-bottom z-20">
        <button onClick={goPrev} disabled={currentStep === 1} className="btn-secondary min-w-[140px]">
          <ArrowLeft className="w-4 h-4" /> Anterior
        </button>
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-ink-500 text-xs">Subtotal ({pluralize(pecas, 'peça')})</span>
            <div className="font-bold num">{formatCurrency(subtotalCarrinho - descontoProdutos - generalDiscountBrl - couponDiscount)}</div>
          </div>
          <div className="h-8 w-px bg-ink-100" />
          <div className="text-right">
            <span className="text-ink-500 text-xs">Total cliente</span>
            <div className="text-2xl font-black text-brand-900 num">{formatCurrency(totalCliente)}</div>
          </div>
        </div>
        {currentStep < 6 ? (
          <button onClick={goNext} disabled={!canAdvance} className="btn-primary min-w-[160px]">
            Próxima <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={doFinalize} disabled={finalizing} className="btn-success min-w-[200px]">
            <Check className="w-4 h-4" /> {finalizing ? 'Finalizando…' : 'Finalizar Venda'}
          </button>
        )}
      </div>
    </div>
  )
}

function StepProducts({ cart, addProduct, removeCartItem, updateCartItemQty, setItemDiscount,
  filteredProducts, searchProduct, setSearchProduct, showProductsPanel, setShowProductsPanel }: any) {
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between mb-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={searchProduct}
              onChange={e => setSearchProduct(e.target.value)}
              onFocus={() => setShowProductsPanel(true)}
              placeholder="Buscar produto por nome ou SKU…"
              className="input pl-9"
            />
          </div>
          <button onClick={() => setShowProductsPanel((s: boolean) => !s)} className="btn-primary">
            <Plus className="w-4 h-4" /> Adicionar produto
          </button>
        </div>

        {showProductsPanel && (
          <div className="border-t border-ink-100 pt-4 mt-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-800">Selecione um produto</h3>
              <button onClick={() => setShowProductsPanel(false)} className="btn-ghost !py-1.5 !px-2 text-xs">
                <X className="w-4 h-4" /> Fechar
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto hide-scroll pr-1">
              {filteredProducts.length === 0 ? (
                <div className="col-span-full py-8 text-center text-sm text-ink-500">
                  Nenhum produto encontrado.
                </div>
              ) : filteredProducts.map((p: any) => {
                const inCart = cart.find((i: CartItem) => i.product.id === p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="text-left p-3 rounded-lg border border-ink-100 hover:border-brand-300 hover:bg-brand-50/30 transition group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-ink-800 truncate group-hover:text-brand-800">{p.name}</div>
                        {p.sku && <div className="text-[11px] text-ink-400 mt-0.5">SKU: {p.sku}</div>}
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          Estoque: {Number((p as any).stock_quantity ?? p.total_stock ?? 0)} un.
                        </div>
                      </div>
                      {inCart && (
                        <span className="chip bg-brand-100 text-brand-800">{inCart.quantity}x</span>
                      )}
                    </div>
                    <div className="mt-2 text-base font-black text-brand-900 num">{formatCurrency(p.sale_price)}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink-800 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-brand-700" />
            Carrinho de produtos
          </h3>
          <span className="chip bg-ink-100 text-ink-600">
            {pluralize(cart.length, 'item')}
          </span>
        </div>
        {cart.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-center">
            <Package className="w-12 h-12 text-ink-200 mb-3" />
            <div className="text-sm font-semibold text-ink-700">Carrinho vazio</div>
            <div className="text-xs text-ink-500 mt-1 max-w-sm">
              Adicione produtos clicando em "+ Adicionar produto" acima.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-ink-50">
            {cart.map((item: CartItem) => {
              const subtotalLine = Number(item.product.sale_price ?? 0) * item.quantity - Number(item.discountProduct ?? 0)
              return (
                <div key={item.product.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-ink-900 truncate">{item.product.name}</div>
                      {item.product.sku && (
                        <div className="text-[11px] text-ink-500 mt-0.5">SKU: {item.product.sku}</div>
                      )}
                      <div className="text-xs text-ink-600 mt-0.5">
                        Preço unitário: <span className="num font-semibold">{formatCurrency(item.product.sale_price)}</span>
                      </div>
                    </div>
                    <button onClick={() => removeCartItem(item.product.id)} className="btn-ghost !p-2 text-rose-600 hover:bg-rose-50 !rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 sm:items-end">
                    <div className="col-span-1 sm:col-span-3">
                      <label className="label !text-[11px] !mb-1">Quantidade</label>
                      <div className="flex items-center rounded-lg border border-ink-200 overflow-hidden">
                        <button onClick={() => updateCartItemQty(item.product.id, -1)} className="px-2.5 py-2 hover:bg-ink-50 text-ink-700 min-h-[44px] flex-1 sm:flex-none">
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => {
                            const v = Math.max(0, parseInt(e.target.value) || 0)
                            updateCartItemQty(item.product.id, v - item.quantity)
                          }}
                          className="w-full text-center py-2 outline-none text-sm font-bold num border-x border-ink-100 bg-white min-w-0 min-h-[44px]"
                        />
                        <button onClick={() => updateCartItemQty(item.product.id, +1)} className="px-2.5 py-2 hover:bg-ink-50 text-ink-700 min-h-[44px] flex-1 sm:flex-none">
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="col-span-1 sm:col-span-3">
                      <label className="label !text-[11px] !mb-1">Desconto R$</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.discountProduct > 0 ? String(item.discountProduct).replace('.', ',') : ''}
                        onChange={e => setItemDiscount(item.product.id, e.target.value)}
                        placeholder="0,00"
                        className="input text-sm num"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-6 text-right sm:text-right pt-2 sm:pt-0 border-t sm:border-t-0 border-ink-100 mt-1 sm:mt-0">
                      <div className="text-[11px] text-ink-500">Subtotal linha</div>
                      <div className="text-lg sm:text-xl font-black text-ink-900 num">{formatCurrency(subtotalLine)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StepDiscount({
  subtotalCarrinho, descontoProdutos, generalDiscountBrl, generalDiscountType, setGeneralDiscountType,
  generalDiscountInput, setGeneralDiscountInput, appliedCoupon, couponInput, setCouponInput,
  applyCoupon, removeCoupon, pixDiscountEnabled, pixEnabled, setPixEnabled, pixDiscount,
  pixDiscountPercent, subtotalAposDescontosManuais, couponDiscount, subtotalComDescontosGerais, totalCliente
}: any) {
  const base = Math.max(0, subtotalCarrinho - descontoProdutos)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <div className="card p-4">
          <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-brand-700" /> Desconto geral
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-5 flex items-stretch rounded-lg border border-ink-200 overflow-hidden">
              {(['BRL', 'PERCENT'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setGeneralDiscountType(t)}
                  className={cn(
                    'flex-1 px-3 py-2.5 text-sm font-bold transition min-h-[44px]',
                    generalDiscountType === t
                      ? 'bg-brand-900 text-white'
                      : 'bg-white text-ink-600 hover:bg-ink-50'
                  )}
                >
                  {t === 'BRL' ? 'R$ Fixo' : '% Percentual'}
                </button>
              ))}
            </div>
            <div className="sm:col-span-7">
              <label className="label !text-[11px] !mb-1">
                Valor do desconto {generalDiscountType === 'BRL' ? '(R$)' : '(%)'}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={generalDiscountInput}
                onChange={e => setGeneralDiscountInput(e.target.value)}
                placeholder={generalDiscountType === 'BRL' ? '0,00' : '0'}
                className="input num"
              />
            </div>
          </div>
          {generalDiscountBrl > 0 && (
            <div className="mt-3 flex items-center justify-between p-3 rounded-lg bg-amber-50 border border-amber-100">
              <span className="text-xs font-semibold text-amber-800">Desconto geral aplicado</span>
              <span className="text-sm font-black text-amber-900 num">- {formatCurrency(generalDiscountBrl)}</span>
            </div>
          )}
          <p className="text-[11px] text-ink-500 mt-3 leading-relaxed">
            Aplicado proporcionalmente sobre todos os itens, após descontos individuais.
          </p>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
            <Gift className="w-4 h-4 text-violet-600" /> Cupom promocional
          </h3>
          {appliedCoupon ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                <div>
                  <div className="chip bg-emerald-100 text-emerald-800">
                    Cupom aplicado: <span className="font-black uppercase">{appliedCoupon.coupon.code}</span>
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-1.5">
                    {appliedCoupon.coupon.type === 'FIXED'
                      ? `R$ fixo ${formatCurrency(appliedCoupon.coupon.value)}`
                      : `${formatPercent(appliedCoupon.coupon.value)} de desconto`}
                    {appliedCoupon.coupon.max_discount && ` · teto ${formatCurrency(appliedCoupon.coupon.max_discount)}`}
                  </div>
                </div>
                <button onClick={removeCoupon} className="btn-ghost !p-2 text-rose-600 hover:bg-rose-50 !rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={couponInput}
                onChange={e => setCouponInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && applyCoupon()}
                placeholder="Digite o código do cupom…"
                className="input flex-1 uppercase"
              />
              <button onClick={applyCoupon} className="btn-secondary whitespace-nowrap min-h-[44px]">
                Aplicar cupom
              </button>
            </div>
          )}
        </div>

        {pixDiscountEnabled && (
          <div className="card p-4">
            <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-sky-600" /> Desconto Pix (pré-visualização)
            </h3>
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pixEnabled}
                onChange={e => setPixEnabled(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-sky-700"
              />
              <div className="flex-1">
                <div className="text-sm font-bold text-ink-800">Cliente pretende pagar com Pix</div>
                <div className="text-xs text-ink-500 mt-0.5">
                  Desconto de {formatPercent(pixDiscountPercent)} habilitado nas configurações.
                </div>
              </div>
            </label>
            {pixEnabled && pixDiscount > 0 && (
              <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-800">Economia Pix</span>
                  <span className="text-sm font-black text-emerald-900 num">- {formatCurrency(pixDiscount)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <div className="card p-4 lg:sticky lg:top-[140px]">
          <h3 className="text-sm font-bold text-ink-800 mb-4">Resumo de descontos</h3>
          <div className="space-y-2.5 text-sm">
            <Row label="Subtotal carrinho" value={formatCurrency(subtotalCarrinho)} />
            <Row label="(-) Desconto produtos" value={formatCurrency(descontoProdutos)} negative />
            <Row label="(-) Desconto geral" value={formatCurrency(generalDiscountBrl)} negative />
            {couponDiscount > 0 && (
              <Row label={`(-) Cupom ${appliedCoupon?.coupon.code ?? ''}`} value={formatCurrency(couponDiscount)} negative />
            )}
            <div className="border-t border-ink-100 my-2 pt-2">
              <Row label="= Subtotal" value={formatCurrency(subtotalComDescontosGerais)} strong />
            </div>
            {pixDiscount > 0 && (
              <Row label="(-) Desconto Pix" value={formatCurrency(pixDiscount)} negative />
            )}
            <div className="border-t-2 border-ink-200 mt-3 pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-ink-800">TOTAL CLIENTE</span>
                <span className="text-2xl font-black text-brand-900 num">{formatCurrency(totalCliente)}</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-ink-500 mt-4 leading-relaxed">
            Avance para etapa de Pagamento para confirmar se haverá desconto Pix de fato.
          </p>
        </div>
      </div>
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
        negative && 'text-rose-700'
      )}>{negative && value !== formatCurrency(0) ? '- ' : ''}{value}</span>
    </div>
  )
}

function StepSource({ source, setSource, customerName, setCustomerName, customerPhone, setCustomerPhone }: any) {
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-brand-700" /> Origem da venda
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {ORIGENS.map(o => {
            const active = source === o.source
            return (
              <button
                key={o.source}
                onClick={() => setSource(o.source)}
                className={cn(
                  'p-4 rounded-xl border-2 text-left transition min-h-[120px] flex flex-col',
                  active
                    ? 'border-brand-700 bg-brand-50/60 ring-2 ring-brand-100'
                    : 'border-ink-100 bg-white hover:border-ink-200 hover:bg-ink-50/40'
                )}
              >
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center mb-3',
                  active ? 'bg-brand-900 text-white' : 'bg-ink-100 text-ink-600'
                )}>
                  {o.icon}
                </div>
                <div className="text-sm font-bold text-ink-900">{o.label}</div>
                {o.hint && <div className="text-[11px] text-ink-500 mt-1">{o.hint}</div>}
                {active && (
                  <div className="mt-auto pt-2 flex items-center gap-1.5 text-[11px] font-bold text-brand-800">
                    <Check className="w-3.5 h-3.5" /> Selecionado
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-bold text-ink-800 mb-3">Dados do cliente (opcional)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nome completo</label>
            <input
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Nome do cliente…"
              className="input"
            />
          </div>
          <div>
            <label className="label">Telefone / WhatsApp</label>
            <input
              value={customerPhone}
              onChange={e => setCustomerPhone(e.target.value)}
              placeholder="(11) 99999-9999"
              className="input"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function StepPayment({
  paymentProviders, selectedProviderId, setSelectedProviderId, selectedModalityId, setSelectedModalityId,
  paymentMethod, setPaymentMethod, installments, setInstallments,
  feeRule, feeExpectedCalc, feeActual, setFeeActual,
  editFeePercent, setEditFeePercent, feePercentActual, setFeePercentActual,
  economiaTaxa, totalCliente, feeActualBrl
}: any) {
  const selectedProvider = paymentProviders.find((p: ProviderWithModalities) => p.provider.id === selectedProviderId)
  const modalities: any[] = selectedProvider?.modalities ?? []
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <div className="card p-4 space-y-4">
          <h3 className="text-sm font-bold text-ink-800 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-brand-700" /> Meio de pagamento
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Provider</label>
              <div className="relative">
                <select
                  value={selectedProviderId}
                  onChange={e => setSelectedProviderId(e.target.value)}
                  className="select w-full"
                >
                  <option value="">Selecione o provider…</option>
                  {paymentProviders.map((p: ProviderWithModalities) => (
                    <option key={p.provider.id} value={p.provider.id}>{p.provider.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Modalidade</label>
              <div className="relative">
                <select
                  value={selectedModalityId}
                  onChange={e => setSelectedModalityId(e.target.value)}
                  disabled={!selectedProviderId}
                  className="select w-full"
                >
                  <option value="">{selectedProviderId ? 'Selecione a modalidade…' : 'Selecione o provider primeiro'}</option>
                  {modalities.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div>
            <label className="label">Método</label>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={cn(
                    'px-3.5 py-2 rounded-lg border text-sm font-bold transition min-h-[40px]',
                    paymentMethod === m
                      ? 'border-brand-900 bg-brand-900 text-white shadow-sm'
                      : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50'
                  )}
                >
                  {paymentMethodLabel(m)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Parcelas</label>
            <div className="relative max-w-[180px]">
              <input
                type="number"
                min={1} max={12}
                disabled={paymentMethod !== 'CREDITO'}
                value={installments}
                onChange={e => setInstallments(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))}
                className="input num"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-500 font-semibold">x</span>
            </div>
            {paymentMethod !== 'CREDITO' && (
              <p className="text-[11px] text-ink-500 mt-1">Parcelamento só habilitado para método Crédito.</p>
            )}
          </div>
        </div>

        <div className="card p-4 space-y-4">
          <h3 className="text-sm font-bold text-ink-800">Taxas de pagamento (previsto × real)</h3>

          <div className="p-3 rounded-lg bg-ink-50 border border-ink-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-500">a) Taxa PREVISTA (regra)</span>
              {feeRule ? (
                <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <Check className="w-3 h-3" /> Regra encontrada
                </span>
              ) : (
                <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                  <AlertTriangle className="w-3 h-3" /> Sem regra
                </span>
              )}
            </div>
            {feeRule ? (
              <div className="space-y-1.5 text-sm">
                <div className="text-ink-700">
                  Regra: <span className="font-semibold">{formatPercent(feeRule.fee_percent, 2)} + {formatCurrency(feeRule.fixed_fee)}</span>
                  {feeRule.receipt_term && <span className="text-ink-500"> ({feeRule.receipt_term})</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-ink-500">fee_percent:</span>{' '}
                    <span className="font-bold num">{formatPercent(feeRule.fee_percent, 2)}</span>
                  </div>
                  <div>
                    <span className="text-ink-500">fixed_fee:</span>{' '}
                    <span className="font-bold num">{formatCurrency(feeRule.fixed_fee)}</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-ink-200 mt-2 flex items-baseline justify-between">
                  <span className="text-xs font-semibold text-ink-600">fee_expected (R$ calculado)</span>
                  <span className="text-base font-black text-ink-900 num">{formatCurrency(feeExpectedCalc)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-amber-800 leading-relaxed">
                  ⚠️ Nenhuma regra de taxa encontrada para a combinação Provider + Modalidade + Método + Parcelas selecionadas.
                  A taxa prevista será 0, mas você pode definir a taxa real manualmente abaixo. <strong>Venda pode prosseguir.</strong>
                </p>
                <div className="pt-2 border-t border-ink-200 flex items-baseline justify-between">
                  <span className="text-xs font-semibold text-ink-600">fee_expected</span>
                  <span className="text-base font-black text-ink-900 num">{formatCurrency(0)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 rounded-lg bg-brand-50/40 border border-brand-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-800">b) Taxa REAL</span>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editFeePercent}
                  onChange={e => setEditFeePercent(e.target.checked)}
                  className="w-3.5 h-3.5 accent-brand-800"
                />
                Editar taxa percentual real
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label !text-[11px] !mb-1">Valor taxa REAL (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={editFeePercent}
                  value={editFeePercent ? feeActualBrl.toFixed(2).replace('.', ',') : feeActual}
                  onChange={e => setFeeActual(e.target.value)}
                  placeholder="0,00"
                  className="input num"
                />
              </div>
              {editFeePercent ? (
                <div>
                  <label className="label !text-[11px] !mb-1">Percentual real (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={feePercentActual}
                    onChange={e => setFeePercentActual(e.target.value)}
                    placeholder="0"
                    className="input num"
                  />
                </div>
              ) : (
                <div>
                  <div className="label !text-[11px] !mb-1">Diferença vs previsto</div>
                  {economiaTaxa > 0.01 ? (
                    <div className="h-[44px] flex items-center px-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <span className="chip bg-emerald-100 text-emerald-800">
                        Economia na taxa: <strong className="num">{formatCurrency(economiaTaxa)}</strong>
                      </span>
                    </div>
                  ) : economiaTaxa < -0.01 ? (
                    <div className="h-[44px] flex items-center px-3 rounded-lg bg-amber-50 border border-amber-200">
                      <span className="chip bg-amber-100 text-amber-800">
                        Taxa acima do previsto: <strong className="num">{formatCurrency(-economiaTaxa)}</strong>
                      </span>
                    </div>
                  ) : (
                    <div className="h-[44px] flex items-center px-3 rounded-lg bg-ink-50 border border-ink-200 text-xs text-ink-600">
                      Taxa real igual à prevista
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-ink-500 mt-3 leading-relaxed">
              Economia na taxa <strong>não é desconto para o cliente</strong>. É apenas ganho/otimização interna do negócio.
            </p>
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="card p-4 lg:sticky lg:top-[140px] space-y-3">
          <h3 className="text-sm font-bold text-ink-800">Resumo do pagamento</h3>
          <div className="space-y-2 text-sm">
            <Row label="Total cliente" value={formatCurrency(totalCliente)} strong />
            <Row label="(-) Taxa PREVISTA" value={formatCurrency(feeExpectedCalc)} negative />
            <Row label="(-) Taxa REAL" value={formatCurrency(feeActualBrl)} negative strong />
            <div className="border-t-2 border-ink-200 my-2 pt-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-ink-800">Recebível líquido</span>
                <span className="text-xl font-black text-emerald-700 num">{formatCurrency(totalCliente - feeActualBrl)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepPackaging({
  packagingSelection, setPackagingSelection, packagingTypes, packagingTypeId, setPackagingTypeId,
  packagingCostInput,
  packagingSuggestedCost, packagingCostBrl, extraCosts, addExtraCost,
  updateExtraCost, removeExtraCost, extraCostsTotal, totalAdicionais
}: any) {
  const opcoes = [
    { k: 'GRANDE', label: 'Sacola Grande', sub: 'Automática: mais de 1 peça ou calça jeans', defaultCost: packagingTypes.find((p: PackagingType) => p.code === 'GRANDE')?.unit_cost ?? 8.28 },
    { k: 'PEQUENA', label: 'Sacola Pequena', sub: 'Automática: 1 peça que não seja calça jeans', defaultCost: packagingTypes.find((p: PackagingType) => p.code === 'PEQUENA')?.unit_cost ?? 7.08 },
  ] as const
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-700" /> Tipo de embalagem
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
          {opcoes.map(o => {
            const active = packagingSelection === o.k
            return (
              <button
                key={o.k}
                disabled
                className={cn(
                  'p-3 rounded-xl border-2 text-left transition min-h-[100px] flex flex-col',
                  active ? 'border-brand-700 bg-brand-50/60 ring-2 ring-brand-100' :
                    'border-ink-100 bg-white opacity-55'
                )}
              >
                <div className="text-sm font-bold text-ink-900">{o.label}</div>
                <div className="text-[11px] text-ink-500 mt-1 flex-1">{o.sub}</div>
                <div className="mt-2 text-base font-black num">
                  {formatCurrency(Number(o.defaultCost))}
                </div>
                {active && <span className="chip bg-brand-900 text-white mt-2 self-start"><Check className="w-3 h-3" /> Selecionada</span>}
              </button>
            )
          })}
        </div>


        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-violet-50/60 border border-violet-100">
            <div className="text-sm font-bold text-violet-900">Seleção automática</div>
            <div className="text-[11px] text-violet-700 mt-0.5">
              A regra vigente é aplicada ao carrinho e o custo fica registrado como snapshot da venda.
            </div>
          </div>
          <div>
            <label className="label">Custo gerencial da embalagem</label>
            <input
              type="text"
              value={packagingCostInput}
              readOnly
              className="input num bg-ink-50"
            />
            <p className="text-[11px] text-ink-500 mt-1">
              {formatCurrency(packagingSuggestedCost)} reduz o lucro, sem gerar nova saída de caixa.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-ink-800">Custos extras</h3>
          <button onClick={addExtraCost} className="btn-secondary !py-2 text-xs">
            <Plus className="w-4 h-4" /> Adicionar custo extra
          </button>
        </div>
        {extraCosts.length === 0 ? (
          <div className="py-6 text-center text-sm text-ink-500 border border-dashed border-ink-200 rounded-lg">
            Nenhum custo extra cadastrado.
          </div>
        ) : (
          <div className="space-y-2">
            {extraCosts.map((c: any) => (
              <div key={c.id} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg border border-ink-100 bg-ink-50/30">
                <div className="col-span-12 sm:col-span-5">
                  <label className="label !text-[11px] !mb-1">Descrição</label>
                  <input
                    value={c.description}
                    onChange={e => updateExtraCost(c.id, 'description', e.target.value)}
                    placeholder="Ex: Frete moto"
                    className="input !py-2 text-sm"
                  />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <label className="label !text-[11px] !mb-1">Categoria</label>
                  <div className="relative">
                    <select
                      value={c.category}
                      onChange={e => updateExtraCost(c.id, 'category', e.target.value)}
                      className="select w-full !py-2 text-sm"
                    >
                      {EXTRA_COST_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                  </div>
                </div>
                <div className="col-span-4 sm:col-span-3">
                  <label className="label !text-[11px] !mb-1">Valor R$</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={c.amount}
                    onChange={e => updateExtraCost(c.id, 'amount', e.target.value)}
                    placeholder="0,00"
                    className="input !py-2 text-sm num"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  <button
                    onClick={() => removeExtraCost(c.id)}
                    className="btn-ghost !p-2 text-rose-600 hover:bg-rose-50 !rounded-lg h-[44px] w-full sm:w-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-bold text-ink-800 mb-3">Resumo de adicionais</h3>
        <div className="space-y-2 text-sm">
          <Row label="Custo embalagem (real)" value={formatCurrency(packagingCostBrl)} />
          <Row label="+ Custos extras (soma)" value={formatCurrency(extraCostsTotal)} />
          <div className="border-t-2 border-ink-200 mt-2 pt-2">
            <Row label="= Total adicionais" value={formatCurrency(totalAdicionais)} strong />
          </div>
        </div>
      </div>
    </div>
  )
}

function StepReview({
  cart, subtotalCarrinho, descontoProdutos, generalDiscountBrl, appliedCoupon, couponDiscount,
  pixDiscount, totalCliente, source, customerName, customerPhone,
  selectedProvider, selectedModality, paymentMethod, installments,
  feeExpectedCalc, feeActualBrl, economiaTaxa,
  packagingSelection, packagingCostBrl,
  extraCosts, extraCostsTotal, custoMercadorias, custoTotal, lucroReal, margem
}: any) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <div className="card p-4">
          <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-brand-700" /> Itens da venda
          </h3>
          <div className="table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Preço unit.</th>
                  <th className="text-right">Desc R$</th>
                  <th className="text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item: CartItem) => {
                  const sub = Number(item.product.sale_price ?? 0) * item.quantity - Number(item.discountProduct ?? 0)
                  return (
                    <tr key={item.product.id}>
                      <td>
                        <div className="font-semibold text-ink-900 truncate">{item.product.name}</div>
                        {item.product.sku && <div className="text-[11px] text-ink-500">SKU: {item.product.sku}</div>}
                      </td>
                      <td className="text-right num font-bold">{item.quantity}</td>
                      <td className="text-right num">{formatCurrency(item.product.sale_price)}</td>
                      <td className="text-right num text-rose-700">{item.discountProduct > 0 ? `- ${formatCurrency(item.discountProduct)}` : '-'}</td>
                      <td className="text-right num font-black text-ink-900">{formatCurrency(sub)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-amber-600" /> Descontos
          </h3>
          <div className="space-y-2 text-sm">
            <Row label="Subtotal carrinho" value={formatCurrency(subtotalCarrinho)} />
            <div className="pl-3 border-l-2 border-amber-100 ml-2 space-y-2">
              <Row label="↓ Desconto nos produtos" value={formatCurrency(descontoProdutos)} negative />
              <Row label="↓ Desconto geral" value={formatCurrency(generalDiscountBrl)} negative />
              {appliedCoupon && (
                <Row label={`↓ Cupom [${appliedCoupon.coupon.code}]`} value={formatCurrency(couponDiscount)} negative />
              )}
              {pixDiscount > 0 && (
                <Row label="↓ Desconto Pix" value={formatCurrency(pixDiscount)} negative />
              )}
            </div>
            <Row label="= Total descontos concedidos" value={formatCurrency(subtotalCarrinho - (subtotalCarrinho - descontoProdutos - generalDiscountBrl - couponDiscount - pixDiscount))} negative strong />
          </div>
          <div className="mt-4 p-4 rounded-xl bg-brand-900 text-white flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-white/70">Total cliente</div>
              <div className="text-[11px] text-white/50 mt-0.5">valor que o cliente paga</div>
            </div>
            <div className="text-3xl font-black num">{formatCurrency(totalCliente)}</div>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brand-700" /> Origem e cliente
          </h3>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center text-brand-800 flex-shrink-0">
              {ORIGENS.find(o => o.source === source)?.icon ?? <MoreHorizontal className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-ink-900">{sourceLabel(source)}</div>
              {(customerName || customerPhone) ? (
                <div className="text-sm text-ink-600 mt-1 space-y-0.5">
                  {customerName && <div>Cliente: <strong>{customerName}</strong></div>}
                  {customerPhone && <div>Tel.: <span className="num">{customerPhone}</span></div>}
                </div>
              ) : (
                <div className="text-xs text-ink-500 mt-1">Cliente não identificado.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-brand-700" /> Pagamento
          </h3>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="chip bg-ink-100 text-ink-700">
              Provider: <strong>{selectedProvider?.provider.name ?? '—'}</strong>
            </span>
            <span className="chip bg-ink-100 text-ink-700">
              Modalidade: <strong>{selectedModality?.name ?? '—'}</strong>
            </span>
            <span className="chip bg-brand-100 text-brand-800">
              Método: <strong>{paymentMethodLabel(paymentMethod)}</strong>
            </span>
            <span className="chip bg-violet-100 text-violet-800">
              <strong>{installments}x</strong>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-lg bg-ink-50 border border-ink-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Taxa PREVISTA</div>
              <div className="text-lg font-black text-ink-900 num mt-1">{formatCurrency(feeExpectedCalc)}</div>
            </div>
            <div className="p-3 rounded-lg bg-brand-50 border border-brand-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-brand-800">Taxa REAL</div>
              <div className="text-lg font-black text-brand-900 num mt-1">{formatCurrency(feeActualBrl)}</div>
            </div>
            <div className={cn(
              'p-3 rounded-lg border',
              economiaTaxa >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'
            )}>
              <div className={cn(
                'text-[11px] font-bold uppercase tracking-wider',
                economiaTaxa >= 0 ? 'text-emerald-700' : 'text-amber-700'
              )}>Economia / (extra)</div>
              <div className={cn(
                'text-lg font-black num mt-1',
                economiaTaxa >= 0 ? 'text-emerald-800' : 'text-amber-800'
              )}>
                {economiaTaxa >= 0 ? '+' : '-'} {formatCurrency(Math.abs(economiaTaxa))}
              </div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-violet-700" /> Embalagem + custos extras
          </h3>
          <div className="flex items-center justify-between p-3 rounded-lg bg-ink-50 border border-ink-100 mb-3">
            <div>
              <div className="font-bold text-ink-900">
                Tipo: {packagingSelection === 'GRANDE' ? 'Grande' :
                  packagingSelection === 'PEQUENA' ? 'Pequena' :
                    packagingSelection === 'SEM' ? 'Sem embalagem' : 'Outra'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-ink-500">Custo real</div>
              <div className="text-lg font-black num text-ink-900">{formatCurrency(packagingCostBrl)}</div>
            </div>
          </div>
          {extraCosts.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-ink-600 uppercase tracking-wider">Custos extras</div>
              {extraCosts.filter((c: any) => c.description.trim() || parseBrl(c.amount) > 0).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-sm py-1.5 border-b border-ink-50 last:border-0">
                  <div className="min-w-0 flex-1 pr-3">
                    <span className="font-semibold text-ink-800 truncate">{c.description || 'Sem descrição'}</span>
                    <span className="text-[11px] text-ink-400 ml-1.5">· {c.category}</span>
                  </div>
                  <span className="font-bold num text-ink-900">{formatCurrency(parseBrl(c.amount))}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-ink-500">Sem custos extras.</div>
          )}
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="lg:sticky lg:top-[140px] space-y-4">
          <div className="p-5 rounded-2xl bg-ink-900 text-white shadow-lg">
            <h3 className="text-sm font-bold text-white/90 mb-4 flex items-center gap-2">
              <Receipt className="w-4 h-4" /> Bloco financeiro
            </h3>
            <div className="space-y-2.5 text-sm">
              <ReviewRow label="Custo mercadorias" value={formatCurrency(custoMercadorias)} />
              <ReviewRow label="Taxa pagamento (real)" value={formatCurrency(feeActualBrl)} />
              <ReviewRow label="Embalagem (real)" value={formatCurrency(packagingCostBrl)} />
              <ReviewRow label="Outros custos" value={formatCurrency(extraCostsTotal)} />
              <div className="border-t border-white/10 my-3 pt-3">
                <ReviewRow label="= CUSTO TOTAL" value={formatCurrency(custoTotal)} strong />
              </div>
              <div className="pt-2 mt-2 border-t border-white/10">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-bold text-white/80">LUCRO REAL</span>
                  <span className={cn(
                    'text-2xl font-black num',
                    lucroReal >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  )}>
                    {formatCurrency(lucroReal)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-2">
                  <span className="text-xs font-semibold text-white/60">MARGEM %</span>
                  <span className={cn(
                    'text-base font-black num',
                    margem >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  )}>{formatPercent(margem, 1)}</span>
                </div>
              </div>
            </div>
            <div className="mt-5 p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-white/60">Total cliente</span>
                <span className="text-lg font-black num">{formatCurrency(totalCliente)}</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-xs text-amber-900 leading-relaxed">
                <strong>Confira tudo antes de finalizar!</strong>
                Após clicar em "Finalizar Venda" os valores serão salvos como snapshot. Para editar, use os botões "Anterior" ou clique em uma etapa já visitada na barra superior.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-white/70', strong && 'text-white/90 font-bold')}>{label}</span>
      <span className={cn('num font-semibold text-white/90', strong && 'text-base font-black text-white')}>{value}</span>
    </div>
  )
}
