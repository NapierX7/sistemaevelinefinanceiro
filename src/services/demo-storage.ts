// Engine local para MODO DEMO (quando Supabase não está configurado)
// Persiste tudo em localStorage com UUIDs, para testar localmente.
import type {
  UUID,
  Product,
  Category,
  PackagingType,
  PaymentProvider,
  PaymentModality,
  PaymentFeeRule,
  Sale,
  SaleItem,
  SalePayment,
  SalePackaging,
  SaleCost,
  PurchaseEntry,
  PurchaseEntryItem,
  PurchaseCost,
  FinancialTransaction,
  InventoryMovement,
  InventoryBatch,
  Coupon,
  Setting,
} from '@/types/supabase'

const STORE_KEY = 'eveline-gestao-demo-store-v1'

interface DemoStore {
  sales: Sale[]
  sale_items: SaleItem[]
  sale_payments: SalePayment[]
  sale_packaging: SalePackaging[]
  sale_costs: SaleCost[]
  purchases: PurchaseEntry[]
  purchase_items: PurchaseEntryItem[]
  purchase_costs: PurchaseCost[]
  products: Product[]
  categories: Category[]
  packaging_types: PackagingType[]
  payment_providers: PaymentProvider[]
  payment_modalities: PaymentModality[]
  payment_fee_rules: PaymentFeeRule[]
  coupons: Coupon[]
  financial_transactions: FinancialTransaction[]
  inventory_movements: InventoryMovement[]
  inventory_batches: InventoryBatch[]
  settings: Setting[]
  friendly_counter: number
}

function uid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function loadStore(): DemoStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as DemoStore
  } catch {}
  return seedDemoStore()
}

export function saveStore(s: DemoStore) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch {}
}

function todayISO(): string { return new Date().toISOString() }

export function seedDemoStore(): DemoStore {
  const s: DemoStore = {
    sales: [],
    sale_items: [],
    sale_payments: [],
    sale_packaging: [],
    sale_costs: [],
    purchases: [],
    purchase_items: [],
    purchase_costs: [],
    products: [],
    categories: [],
    packaging_types: [],
    payment_providers: [],
    payment_modalities: [],
    payment_fee_rules: [],
    coupons: [],
    financial_transactions: [],
    inventory_movements: [],
    inventory_batches: [],
    settings: [],
    friendly_counter: 0,
  }

  const cats: [string, string][] = [
    ['Vestidos','vestidos'],['Blusas','blusas'],['Calças','calcas'],['Conjuntos','conjuntos'],['Regatas','regatas'],
  ]
  for (const [name, slug] of cats) s.categories.push({ id: uid(), name, slug, active: true, created_at: todayISO() })

  const catMap = (slug: string) => s.categories.find(c => c.slug === slug)?.id
  const seedProducts: Array<[string, string, Money, Money, string, string]> = [
    ['Regata alça fina', 'regatas', 25, 69.90, 'REGATA-001', 'PEQUENA'],
    ['Vestido longo amarelo', 'vestidos', 59.90, 189.90, 'VESTIDO-001', 'GRANDE'],
    ['Calça pantalona', 'calcas', 89.90, 189.90, 'CALCA-001', 'GRANDE'],
    ['Blusa de renda', 'blusas', 50, 99.90, 'BLUSA-001', 'PEQUENA'],
    ['Blusa assimétrica', 'blusas', 20, 69.90, 'BLUSA-002', 'PEQUENA'],
    ['Blusa assimétrica com renda', 'blusas', 20, 69.90, 'BLUSA-003', 'PEQUENA'],
    ['Vestido longo rosa', 'vestidos', 59.90, 189.90, 'VESTIDO-002', 'GRANDE'],
    ['Vestido longo preto', 'vestidos', 59.90, 189.90, 'VESTIDO-003', 'GRANDE'],
    ['Conjunto saia e top amarelo', 'conjuntos', 90, 199.90, 'CONJ-001', 'GRANDE'],
    ['Conjunto branco', 'conjuntos', 75, 189.90, 'CONJ-002', 'GRANDE'],
    ['Conjunto preto', 'conjuntos', 75, 189.90, 'CONJ-003', 'GRANDE'],
    ['Conjunto rosa', 'conjuntos', 75, 189.90, 'CONJ-004', 'GRANDE'],
    ['Conjunto saia e top bege', 'conjuntos', 90, 199.90, 'CONJ-005', 'GRANDE'],
    ['Calça marrom com lenço', 'calcas', 90, 189.90, 'CALCA-002', 'GRANDE'],
    ['Calça animal print', 'calcas', 90, 189.90, 'CALCA-003', 'GRANDE'],
  ]

  s.packaging_types.push({
    id: uid(), name: 'Sacola Grande', code: 'GRANDE', components: [], unit_cost: 8.313, is_default: false, created_at: todayISO(), updated_at: todayISO(),
  })
  s.packaging_types.push({
    id: uid(), name: 'Sacola Pequena', code: 'PEQUENA', components: [], unit_cost: 7.113, is_default: true, created_at: todayISO(), updated_at: todayISO(),
  })
  s.packaging_types.push({
    id: uid(), name: 'Sem embalagem', code: 'NENHUMA', components: [], unit_cost: 0, is_default: false, created_at: todayISO(), updated_at: todayISO(),
  })
  s.packaging_types.push({
    id: uid(), name: 'Outra', code: 'OUTRA', components: [], unit_cost: 0, is_default: false, created_at: todayISO(), updated_at: todayISO(),
  })

  const pkgId = (code: string) => s.packaging_types.find(p => p.code === code)?.id

  for (const [name, catSlug, cost, price, sku, pkgCode] of seedProducts) {
    s.products.push({
      id: uid(), name, sku, slug: (sku || name).toLowerCase(), category_id: catMap(catSlug),
      default_packaging_type_id: pkgId(pkgCode), current_cost: cost, sale_price: price,
      min_stock: 1, image_url: null, notes: null, active: true,
      created_at: todayISO(), updated_at: todayISO(),
      total_stock: 3, weighted_cost: cost,
    })
  }

  // Payment providers + modalities + fees
  const mp: PaymentProvider = { id: uid(), name: 'Mercado Pago', code: 'MERCADO_PAGO', active: true, created_at: todayISO() }
  const ip: PaymentProvider = { id: uid(), name: 'InfinitePay', code: 'INFINITEPAY', active: true, created_at: todayISO() }
  const pixd: PaymentProvider = { id: uid(), name: 'Pix Direto', code: 'PIX_DIRETO', active: true, created_at: todayISO() }
  s.payment_providers.push(mp, ip, pixd)

  const mpCheckout: PaymentModality = { id: uid(), provider_id: mp.id, name: 'Checkout', code: 'CHECKOUT', active: true, created_at: todayISO() }
  const ipTap: PaymentModality = { id: uid(), provider_id: ip.id, name: 'InfiniteTap / Maquininha', code: 'TAP', active: true, created_at: todayISO() }
  const ipLink: PaymentModality = { id: uid(), provider_id: ip.id, name: 'Link de Pagamento', code: 'LINK', active: true, created_at: todayISO() }
  const pixDir: PaymentModality = { id: uid(), provider_id: pixd.id, name: 'Direto', code: 'DIRETO', active: true, created_at: todayISO() }
  s.payment_modalities.push(mpCheckout, ipTap, ipLink, pixDir)

  const addFee = (prov: PaymentProvider, mod: PaymentModality | null, method: any, installments: number, fee: number) => {
    s.payment_fee_rules.push({
      id: uid(), provider_id: prov.id, modality_id: mod?.id ?? null,
      method, installments, receipt_term: '1 dia útil', revenue_tier: 'Plano atual',
      fee_percent: fee, fixed_fee: 0, valid_from: '2026-01-01', valid_until: null, created_at: todayISO(),
    })
  }
  // InfinitePay LINK
  addFee(ip, ipLink, 'PIX', 1, 1.49)
  addFee(ip, ipLink, 'CREDITO', 1, 4.99)
  addFee(ip, ipLink, 'CREDITO', 2, 6.09)
  addFee(ip, ipLink, 'CREDITO', 3, 7.19)
  // InfinitePay TAP
  addFee(ip, ipTap, 'PIX', 1, 0.99)
  addFee(ip, ipTap, 'DEBITO', 1, 1.89)
  addFee(ip, ipTap, 'CREDITO', 1, 3.79)
  addFee(ip, ipTap, 'CREDITO', 2, 4.89)
  // MP Checkout
  addFee(mp, mpCheckout, 'PIX', 1, 0.99)
  addFee(mp, mpCheckout, 'CREDITO', 1, 4.49)
  addFee(mp, mpCheckout, 'CREDITO', 2, 5.49)
  // Pix Direto
  addFee(pixd, pixDir, 'PIX', 1, 0)

  // Cupons iniciais
  s.coupons.push({
    id: uid(), code: 'CLIENTE10', description: '10% para cliente fiel',
    type: 'PERCENT', value: 10, usage_count: 0, active: true, created_at: todayISO(),
  })

  s.settings.push({
    id: uid(), key: 'pix_discount',
    value: { type: 'PERCENT', value: 0, enabled: false },
    description: 'Desconto Pix',
    updated_at: todayISO(),
  })

  saveStore(s)
  return s
}

type Money = number

// ---- Implementação dos serviços (demo mode) ----

export function demoListProducts(): Product[] {
  const s = loadStore()
  return s.products
    .filter(p => p.active)
    .map(p => ({
      ...p,
      total_stock: s.inventory_batches.filter(b => b.product_id === p.id).reduce((acc, b) => acc + b.quantity_available, 0),
      weighted_cost: (() => {
        const bs = s.inventory_batches.filter(b => b.product_id === p.id && b.quantity_available > 0)
        if (!bs.length) return p.current_cost
        const totalQty = bs.reduce((a, b) => a + b.quantity_available, 0) || 1
        const totalCost = bs.reduce((a, b) => a + (b.unit_cost + b.allocated_purchase_cost) * b.quantity_available, 0)
        return totalCost / totalQty
      })(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function demoListCategories(): Category[] {
  return loadStore().categories.filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name))
}

export function demoListPackagingTypes(): PackagingType[] {
  return loadStore().packaging_types
}

export function demoListPaymentProviders() {
  const s = loadStore()
  return s.payment_providers.filter(p => p.active).map(p => ({
    provider: p,
    modalities: s.payment_modalities.filter(m => m.provider_id === p.id && m.active),
  }))
}

export function demoListFeeRules(): PaymentFeeRule[] {
  return loadStore().payment_fee_rules.filter(r => !r.valid_until || new Date(r.valid_until) >= new Date())
}

export function demoFindFee(provider_id?: UUID, modality_id?: UUID, method?: string, installments = 1): PaymentFeeRule | null {
  const rules = demoListFeeRules()
  return rules.find(r =>
    r.provider_id === provider_id
    && r.modality_id === modality_id
    && r.method === method
    && r.installments === installments
  ) || null
}

export function demoListSales(): Sale[] {
  return [...loadStore().sales].sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime())
}

export function demoGetSale(id: UUID) {
  const s = loadStore()
  const sale = s.sales.find(x => x.id === id)
  if (!sale) return null
  return {
    sale,
    items: s.sale_items.filter(i => i.sale_id === id),
    payments: s.sale_payments.filter(i => i.sale_id === id),
    packaging: s.sale_packaging.find(i => i.sale_id === id) ?? null,
    costs: s.sale_costs.filter(i => i.sale_id === id),
  }
}

export function demoListPurchases(): PurchaseEntry[] {
  return [...loadStore().purchases].sort((a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime())
}

export function demoGetPurchase(id: UUID) {
  const s = loadStore()
  const purchase = s.purchases.find(x => x.id === id)
  if (!purchase) return null
  return {
    purchase,
    items: s.purchase_items.filter(i => i.purchase_entry_id === id),
    costs: s.purchase_costs.filter(i => i.purchase_entry_id === id),
  }
}

export function demoListFinancialTrans(): FinancialTransaction[] {
  return [...loadStore().financial_transactions].sort((a, b) => new Date(b.trans_date).getTime() - new Date(a.trans_date).getTime())
}

export function demoListMovements(): InventoryMovement[] {
  return [...loadStore().inventory_movements].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

export function demoListBatches(product_id?: UUID): InventoryBatch[] {
  const s = loadStore()
  const list = [...s.inventory_batches]
  return product_id ? list.filter(b => b.product_id === product_id) : list
}

export function demoListSettings(): Setting[] {
  return loadStore().settings
}

export function demoListCoupons(): Coupon[] {
  return loadStore().coupons
}

// ---- Mutations ----

export function demoCreateProduct(p: Partial<Product>): Product {
  const s = loadStore()
  const newP: Product = {
    id: uid(),
    sku: p.sku ?? '',
    name: p.name ?? 'Novo produto',
    slug: p.slug ?? uid(),
    category_id: p.category_id ?? null,
    default_packaging_type_id: p.default_packaging_type_id ?? null,
    current_cost: Number(p.current_cost ?? 0),
    sale_price: Number(p.sale_price ?? 0),
    min_stock: Number(p.min_stock ?? 0),
    image_url: p.image_url ?? null,
    notes: p.notes ?? null,
    active: p.active ?? true,
    created_at: todayISO(),
    updated_at: todayISO(),
  }
  s.products.push(newP)
  saveStore(s)
  return newP
}

export function demoUpdateProduct(id: UUID, patch: Partial<Product>): Product | null {
  const s = loadStore()
  const idx = s.products.findIndex(p => p.id === id)
  if (idx < 0) return null
  s.products[idx] = { ...s.products[idx], ...patch, updated_at: todayISO() }
  saveStore(s)
  return s.products[idx]
}

export function demoUpsertSetting(key: string, value: any, description?: string): Setting {
  const s = loadStore()
  const found = s.settings.find(x => x.key === key)
  if (found) { found.value = value; found.updated_at = todayISO(); if (description) found.description = description; saveStore(s); return found }
  const n: Setting = { id: uid(), key, value, description: description ?? '', updated_at: todayISO() }
  s.settings.push(n); saveStore(s); return n
}

export function demoUpsertFeeRule(rule: Partial<PaymentFeeRule>): PaymentFeeRule {
  const s = loadStore()
  if (rule.id) {
    const idx = s.payment_fee_rules.findIndex(x => x.id === rule.id)
    if (idx >= 0) { s.payment_fee_rules[idx] = { ...s.payment_fee_rules[idx], ...rule } as PaymentFeeRule; saveStore(s); return s.payment_fee_rules[idx] }
  }
  const nr: PaymentFeeRule = {
    id: uid(),
    provider_id: rule.provider_id!,
    modality_id: rule.modality_id ?? null,
    method: rule.method!,
    installments: rule.installments ?? 1,
    receipt_term: rule.receipt_term ?? null,
    revenue_tier: rule.revenue_tier ?? null,
    brand: rule.brand ?? null,
    fee_percent: Number(rule.fee_percent ?? 0),
    fixed_fee: Number(rule.fixed_fee ?? 0),
    valid_from: rule.valid_from ?? new Date().toISOString().slice(0,10),
    valid_until: rule.valid_until ?? null,
    created_at: todayISO(),
  }
  s.payment_fee_rules.push(nr); saveStore(s); return nr
}

export function demoDeleteFeeRule(id: UUID): boolean {
  const s = loadStore()
  const idx = s.payment_fee_rules.findIndex(x => x.id === id)
  if (idx < 0) return false
  s.payment_fee_rules.splice(idx, 1); saveStore(s); return true
}

// ========== RPC: create_purchase_entry ==========
export function demoCreatePurchaseEntry(args: {
  entry_date?: string, supplier?: string, origin?: string,
  cost_allocation_method?: 'quantity'|'value'|'none',
  items?: Array<{product_id?: UUID, product_name: string, unit_cost: number, quantity: number}>,
  shipping_cost?: number,
  other_costs?: Array<{description: string, category?: string, amount: number}>,
  notes?: string, user_id?: UUID,
}) {
  const s = loadStore()
  const items = args.items ?? []
  const method = args.cost_allocation_method ?? 'quantity'
  const entry: PurchaseEntry = {
    id: uid(), entry_date: args.entry_date ?? new Date().toISOString().slice(0,10),
    supplier: args.supplier ?? null, origin: args.origin ?? null,
    items_total: 0, shipping_cost: Number(args.shipping_cost ?? 0),
    other_costs: 0, total_cost: 0,
    cost_allocation_method: method, notes: args.notes ?? null,
    created_by: args.user_id ?? null, created_at: todayISO(),
  }
  s.purchases.push(entry)

  let othersTotal = 0
  for (const oc of args.other_costs ?? []) {
    othersTotal += Number(oc.amount ?? 0)
    s.purchase_costs.push({
      id: uid(), purchase_entry_id: entry.id,
      description: oc.description, category: oc.category ?? 'OUTRO',
      amount: Number(oc.amount ?? 0), created_at: todayISO(),
    })
  }
  let itemsTotal = 0
  let allocBase = 0
  const peItems: PurchaseEntryItem[] = []
  for (const it of items) {
    const qty = Math.max(0, Number(it.quantity ?? 0))
    const cost = Number(it.unit_cost ?? 0)
    const line = +(qty * cost).toFixed(2)
    itemsTotal += line
    if (method === 'quantity') allocBase += qty
    if (method === 'value') allocBase += line
    const pei: PurchaseEntryItem = {
      id: uid(), purchase_entry_id: entry.id, product_id: it.product_id ?? null,
      product_snapshot: it.product_name, unit_cost: cost, quantity: qty,
      line_total: line, allocated_share: 0, effective_cost: cost, created_at: todayISO(),
    }
    peItems.push(pei)
    s.purchase_items.push(pei)
    if (it.product_id) {
      const p = s.products.find(pp => pp.id === it.product_id)
      if (p) { p.current_cost = cost; p.updated_at = todayISO() }
    }
  }
  const totalShared = entry.shipping_cost + othersTotal
  for (const pei of peItems) {
    let share = 0
    if (method !== 'none' && allocBase > 0) {
      share = method === 'quantity'
        ? +(totalShared * (pei.quantity / allocBase)).toFixed(4)
        : +(totalShared * (pei.line_total / allocBase)).toFixed(4)
    }
    pei.allocated_share = share
    pei.effective_cost = +(pei.unit_cost + (pei.quantity > 0 ? share / pei.quantity : 0)).toFixed(4)
    // cria lote
    if (pei.quantity > 0) {
      s.inventory_batches.push({
        id: uid(), product_id: pei.product_id!, variant_id: null,
        purchase_entry_id: entry.id, purchase_item_id: pei.id,
        unit_cost: pei.unit_cost,
        allocated_purchase_cost: +(pei.quantity > 0 ? share / pei.quantity : 0).toFixed(4),
        quantity_received: pei.quantity, quantity_available: pei.quantity,
        received_at: todayISO(), created_at: todayISO(),
      })
      s.inventory_movements.push({
        id: uid(), product_id: pei.product_id!, variant_id: null, batch_id: null,
        movement_type: 'ENTRADA', reason: 'COMPRA', quantity: pei.quantity,
        unit_cost: pei.unit_cost, related_purchase_id: entry.id,
        created_by: args.user_id ?? null, created_at: todayISO(),
      })
    }
  }
  entry.items_total = +itemsTotal.toFixed(2)
  entry.other_costs = +othersTotal.toFixed(2)
  entry.total_cost = +(entry.items_total + entry.shipping_cost + entry.other_costs).toFixed(2)

  // financeiro
  s.financial_transactions.push({
    id: uid(), trans_date: entry.entry_date, trans_type: 'SAIDA', category: 'COMPRA_ESTOQUE',
    description: `Mercadoria compra ${entry.supplier || entry.origin || entry.entry_date}`,
    amount: entry.items_total, related_purchase_id: entry.id, status: 'CONFIRMADO',
    created_by: args.user_id ?? null, created_at: todayISO(),
  })
  if (entry.shipping_cost > 0) {
    s.financial_transactions.push({
      id: uid(), trans_date: entry.entry_date, trans_type: 'SAIDA', category: 'FRETE',
      description: 'Frete/deslocamento compra',
      amount: entry.shipping_cost, related_purchase_id: entry.id, status: 'CONFIRMADO',
      created_by: args.user_id ?? null, created_at: todayISO(),
    })
  }
  saveStore(s)
  return { ok: true, purchase_entry_id: entry.id, total_cost: entry.total_cost }
}

// ========== RPC: finalize_sale ==========
export function demoFinalizeSale(args: {
  source: any,
  items: Array<{product_id?: UUID, variant_id?: UUID, product_name: string, variant?: string, sku?: string, quantity: number, unit_sale_price: number, unit_actual_price: number, discount: number}>,
  general_discount?: number, coupon_id?: UUID, coupon_code?: string, pix_discount?: number,
  payment?: {provider_id?: UUID, modality_id?: UUID, method: any, installments: number, amount: number, fee_percent?: number, fee_expected?: number, fee_actual?: number, provider_snapshot?: string, modality_snapshot?: string},
  packaging?: {packaging_type_id?: UUID, tipo_snapshot?: string, custo_snapshot: number, custom_cost?: number, is_free?: boolean},
  extra_costs?: Array<{description: string, category?: string, amount: number}>,
  customer_name?: string, customer_phone?: string, user_id?: UUID,
}) {
  const s = loadStore()
  s.friendly_counter += 1
  const friendly_number = s.friendly_counter

  const sale: Sale = {
    id: uid(), friendly_number,
    sale_date: todayISO(), status: 'CONCLUIDA', source: args.source,
    customer_name: args.customer_name ?? null, customer_phone: args.customer_phone ?? null,
    items_subtotal: 0, product_discounts: 0, general_discount: +(args.general_discount ?? 0),
    coupon_discount: 0, pix_discount: +(args.pix_discount ?? 0),
    total_discounts: 0, total_customer: 0, packaging_cost: 0, extra_costs: 0,
    items_cost: 0, allocated_purchase_cost: 0,
    fee_expected: 0, fee_actual: 0, real_profit: 0, real_margin: 0,
    coupon_id: args.coupon_id ?? null, coupon_snapshot: args.coupon_code ?? null,
    created_by: args.user_id ?? null, created_at: todayISO(), updated_at: todayISO(),
  }
  s.sales.push(sale)

  // items + FIFO lotes
  let items_subtotal = 0
  let product_discounts = 0
  let items_cost = 0
  let alloc_cost = 0
  let items_count = 0
  for (const it of args.items) {
    const qty = Math.max(0, Number(it.quantity ?? 0))
    if (qty <= 0) continue
    items_count += qty
    const sub = +(Number(it.unit_sale_price ?? 0) * qty).toFixed(2)
    const dsc = +(Number(it.discount ?? 0) * qty).toFixed(2)
    items_subtotal += sub
    product_discounts += dsc

    // Consome lotes
    let need = qty
    const batchIds: UUID[] = []
    let costAccum = 0
    let allocAccum = 0
    const batches = s.inventory_batches
      .filter(b => b.product_id === it.product_id && b.quantity_available > 0)
      .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())
    for (const b of batches) {
      if (need <= 0) break
      const take = Math.min(need, b.quantity_available)
      b.quantity_available -= take
      need -= take
      batchIds.push(b.id)
      costAccum += take * b.unit_cost
      allocAccum += take * b.allocated_purchase_cost
      s.inventory_movements.push({
        id: uid(), product_id: b.product_id, variant_id: b.variant_id, batch_id: b.id,
        movement_type: 'SAIDA', reason: 'VENDA', quantity: take, unit_cost: b.unit_cost,
        related_sale_id: sale.id, created_by: args.user_id ?? null, created_at: todayISO(),
      })
    }
    if (need > 0) {
      // fallback: usa custo atual do produto
      const prod = s.products.find(p => p.id === it.product_id)
      const fallbackCost = prod?.current_cost ?? 0
      costAccum += need * fallbackCost
      s.inventory_movements.push({
        id: uid(), product_id: it.product_id!, variant_id: null, batch_id: null,
        movement_type: 'SAIDA', reason: 'VENDA_SEM_LOTE', quantity: need, unit_cost: fallbackCost,
        related_sale_id: sale.id, created_by: args.user_id ?? null, notes: 'Venda sem lote', created_at: todayISO(),
      })
    }
    items_cost += costAccum
    alloc_cost += allocAccum

    s.sale_items.push({
      id: uid(), sale_id: sale.id,
      product_id: it.product_id ?? null, variant_id: it.variant_id ?? null,
      product_name_snapshot: it.product_name, variant_snapshot: it.variant ?? null, sku_snapshot: it.sku ?? null,
      quantity: qty,
      unit_cost_snapshot: +(costAccum / qty).toFixed(4),
      allocated_purchase_cost_snapshot: +(allocAccum / qty).toFixed(4),
      unit_sale_price_snapshot: +Number(it.unit_sale_price ?? 0).toFixed(2),
      unit_actual_price: +Number(it.unit_actual_price ?? it.unit_sale_price ?? 0).toFixed(2),
      discount: dsc,
      total: +(sub - dsc).toFixed(2),
      batch_ids_used: batchIds,
      created_at: todayISO(),
    })
  }

  // Totals
  const general_discount = +(args.general_discount ?? 0)
  const pix_discount = +(args.pix_discount ?? 0)
  const coupon_discount = 0 // simplificado demo
  const total_discounts = +(product_discounts + general_discount + coupon_discount + pix_discount).toFixed(2)
  const total_customer = Math.max(0, +(items_subtotal - total_discounts).toFixed(2))

  // Pagamento
  let fee_expected = 0, fee_actual = 0
  if (args.payment) {
    fee_expected = +Number(args.payment.fee_expected ?? 0).toFixed(4)
    fee_actual = +Number(args.payment.fee_actual ?? args.payment.fee_expected ?? 0).toFixed(4)
    s.sale_payments.push({
      id: uid(), sale_id: sale.id,
      provider_id: args.payment.provider_id ?? null,
      modality_id: args.payment.modality_id ?? null,
      method: args.payment.method,
      installments: args.payment.installments ?? 1,
      provider_snapshot: args.payment.provider_snapshot ?? null,
      modality_snapshot: args.payment.modality_snapshot ?? null,
      fee_percent_snapshot: +Number(args.payment.fee_percent ?? 0).toFixed(4),
      fee_expected_snapshot: fee_expected,
      fee_real_snapshot: fee_actual,
      amount: +Number(args.payment.amount ?? total_customer).toFixed(2),
      created_at: todayISO(),
    })
  }

  // Embalagem
  let packaging_cost = 0
  if (args.packaging) {
    packaging_cost = +Number(args.packaging.custo_snapshot ?? 0).toFixed(4)
    if (args.packaging.is_free) packaging_cost = 0
    else if (args.packaging.custom_cost != null) packaging_cost = +Number(args.packaging.custom_cost).toFixed(4)
    s.sale_packaging.push({
      id: uid(), sale_id: sale.id, packaging_type_id: args.packaging.packaging_type_id ?? null,
      tipo_snapshot: args.packaging.tipo_snapshot ?? null,
      custo_snapshot: +Number(args.packaging.custo_snapshot ?? 0).toFixed(4),
      custom_cost: args.packaging.custom_cost ?? null,
      is_free: args.packaging.is_free ?? false,
      created_at: todayISO(),
    })
  }

  // Custos extras
  let extra_costs = 0
  for (const ec of args.extra_costs ?? []) {
    extra_costs += +Number(ec.amount ?? 0).toFixed(2)
    s.sale_costs.push({
      id: uid(), sale_id: sale.id, description: ec.description,
      category: ec.category ?? 'OUTRO', amount: +Number(ec.amount ?? 0).toFixed(2), created_at: todayISO(),
    })
  }

  // Lucro real
  const real_profit = +(total_customer - (items_cost + alloc_cost) - fee_actual - packaging_cost - extra_costs).toFixed(4)
  const real_margin = total_customer > 0 ? +((real_profit / total_customer) * 100).toFixed(4) : 0

  sale.items_subtotal = +items_subtotal.toFixed(2)
  sale.product_discounts = +product_discounts.toFixed(2)
  sale.general_discount = +general_discount.toFixed(2)
  sale.coupon_discount = +coupon_discount.toFixed(2)
  sale.pix_discount = +pix_discount.toFixed(2)
  sale.total_discounts = +total_discounts.toFixed(2)
  sale.total_customer = total_customer
  sale.packaging_cost = packaging_cost
  sale.extra_costs = +extra_costs.toFixed(2)
  sale.items_cost = +items_cost.toFixed(4)
  sale.allocated_purchase_cost = +alloc_cost.toFixed(4)
  sale.fee_expected = fee_expected
  sale.fee_actual = fee_actual
  sale.real_profit = real_profit
  sale.real_margin = real_margin

  // Financeiro
  s.financial_transactions.push({
    id: uid(), trans_date: sale.sale_date.slice(0,10), trans_type: 'ENTRADA', category: 'VENDA',
    description: `Venda #${String(friendly_number).padStart(6,'0')}`,
    amount: total_customer, related_sale_id: sale.id, status: 'CONFIRMADO',
    payment_method: args.payment?.method, created_by: args.user_id ?? null, created_at: todayISO(),
  })
  if (fee_actual > 0) {
    s.financial_transactions.push({
      id: uid(), trans_date: sale.sale_date.slice(0,10), trans_type: 'SAIDA', category: 'TAXA',
      description: `Taxa pagamento Venda #${String(friendly_number).padStart(6,'0')}`,
      amount: +fee_actual.toFixed(2), related_sale_id: sale.id, status: 'CONFIRMADO',
      created_by: args.user_id ?? null, created_at: todayISO(),
    })
  }
  if (packaging_cost > 0) {
    s.financial_transactions.push({
      id: uid(), trans_date: sale.sale_date.slice(0,10), trans_type: 'SAIDA', category: 'EMBALAGEM',
      description: `Embalagem Venda #${String(friendly_number).padStart(6,'0')}`,
      amount: +packaging_cost.toFixed(2), related_sale_id: sale.id, status: 'CONFIRMADO',
      created_by: args.user_id ?? null, created_at: todayISO(),
    })
  }
  if (extra_costs > 0) {
    s.financial_transactions.push({
      id: uid(), trans_date: sale.sale_date.slice(0,10), trans_type: 'SAIDA', category: 'OUTRA_DESPESA',
      description: `Custos extras Venda #${String(friendly_number).padStart(6,'0')}`,
      amount: +extra_costs.toFixed(2), related_sale_id: sale.id, status: 'CONFIRMADO',
      created_by: args.user_id ?? null, created_at: todayISO(),
    })
  }

  saveStore(s)
  return { ok: true, sale_id: sale.id, friendly_number, total_customer, real_profit, real_margin, items_count }
}

export function demoCancelSale(sale_id: UUID, reason: string, user_id?: UUID) {
  const s = loadStore()
  const sale = s.sales.find(x => x.id === sale_id)
  if (!sale) return { ok: false, error: 'Venda não encontrada' }
  if (sale.status === 'CANCELADA') return { ok: false, error: 'Venda já cancelada' }
  sale.status = 'CANCELADA'
  sale.cancel_reason = reason
  sale.cancelled_by = user_id ?? null
  sale.cancelled_at = todayISO()
  sale.updated_at = todayISO()

  const items = s.sale_items.filter(i => i.sale_id === sale_id)
  for (const it of items) {
    if (it.batch_ids_used && it.batch_ids_used.length) {
      for (const bid of it.batch_ids_used) {
        const b = s.inventory_batches.find(x => x.id === bid)
        if (b) b.quantity_available += it.quantity
        s.inventory_movements.push({
          id: uid(), product_id: it.product_id!, variant_id: it.variant_id ?? null, batch_id: bid,
          movement_type: 'ENTRADA', reason: 'CANCELAMENTO_VENDA', quantity: it.quantity,
          unit_cost: it.unit_cost_snapshot, related_sale_id: sale.id,
          created_by: user_id ?? null, created_at: todayISO(),
        })
        break
      }
    } else {
      s.inventory_movements.push({
        id: uid(), product_id: it.product_id!, variant_id: it.variant_id ?? null, batch_id: null,
        movement_type: 'AJUSTE_POS', reason: 'CANCELAMENTO_VENDA', quantity: it.quantity,
        unit_cost: it.unit_cost_snapshot, related_sale_id: sale.id,
        created_by: user_id ?? null, created_at: todayISO(),
      })
    }
  }

  s.financial_transactions.push({
    id: uid(), trans_date: new Date().toISOString().slice(0,10), trans_type: 'SAIDA', category: 'VENDA',
    description: `Estorno Venda #${String(sale.friendly_number).padStart(6,'0')}`,
    amount: sale.total_customer, related_sale_id: sale.id, status: 'CONFIRMADO',
    created_by: user_id ?? null, created_at: todayISO(),
  })
  if (sale.fee_actual > 0) {
    s.financial_transactions.push({
      id: uid(), trans_date: new Date().toISOString().slice(0,10), trans_type: 'ENTRADA', category: 'TAXA',
      description: `Estorno taxa Venda #${String(sale.friendly_number).padStart(6,'0')}`,
      amount: +sale.fee_actual.toFixed(2), related_sale_id: sale.id, status: 'CONFIRMADO',
      created_by: user_id ?? null, created_at: todayISO(),
    })
  }
  saveStore(s)
  return { ok: true, sale_id, friendly_number: sale.friendly_number }
}
