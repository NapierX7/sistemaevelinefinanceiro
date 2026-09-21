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
  PurchaseFundingSource,
  FinancialTransaction,
  InventoryMovement,
  InventoryBatch,
  Coupon,
  Setting,
  DashboardStockSummary,
  DashboardStockRow,
  DashboardSaleRow,
  DashboardFinancialRow,
  ObligationRow,
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
    ['Blusa um ombro só', 'blusas', 20, 69.90, 'BLUSA-004', 'PEQUENA'],
    ['Vestido longo rosa', 'vestidos', 59.90, 189.90, 'VESTIDO-002', 'GRANDE'],
    ['Vestido longo preto', 'vestidos', 59.90, 189.90, 'VESTIDO-003', 'GRANDE'],
    ['Conjunto saia e top amarelo', 'conjuntos', 90, 199.90, 'CONJ-001', 'GRANDE'],
    ['Conjunto branco', 'conjuntos', 75, 189.90, 'CONJ-002', 'GRANDE'],
    ['Conjunto preto', 'conjuntos', 75, 189.90, 'CONJ-003', 'GRANDE'],
    ['Conjunto rosa', 'conjuntos', 75, 189.90, 'CONJ-004', 'GRANDE'],
    ['Conjunto saia e top bege', 'conjuntos', 90, 199.90, 'CONJ-005', 'GRANDE'],
    ['Conjunto camisa e short', 'conjuntos', 75, 159.90, 'CONJ-006', 'GRANDE'],
    ['Conjunto saia e top poá amarelo', 'conjuntos', 75, 189.90, 'CONJ-007', 'GRANDE'],
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

  const addFee = (prov: PaymentProvider, mod: PaymentModality | null, method: any, installments: number, fee: number, brand: string | null = null) => {
    s.payment_fee_rules.push({
      id: uid(), provider_id: prov.id, modality_id: mod?.id ?? null,
      method, installments, receipt_term: '1 dia útil', revenue_tier: 'Plano atual', brand,
      fee_percent: fee, fixed_fee: 0, valid_from: '2026-01-01', valid_until: null, created_at: todayISO(),
    })
  }
  // InfinitePay LINK (Pix 0% para lojista; cliente recebe desconto Pix config)
  addFee(ip, ipLink, 'PIX', 1, 0)
  addFee(ip, ipLink, 'CREDITO', 1, 4.2)
  addFee(ip, ipLink, 'CREDITO', 2, 6.09)
  addFee(ip, ipLink, 'CREDITO', 3, 7.19)
  // InfinitePay TAP / Maquininha
  addFee(ip, ipTap, 'PIX', 1, 0)
  addFee(ip, ipTap, 'DEBITO', 1, 1.89)
  // Visa / Mastercard (brand NULL)
  addFee(ip, ipTap, 'CREDITO', 1, 3.15)
  addFee(ip, ipTap, 'CREDITO', 2, 5.39)
  // ELO (diferenciado)
  addFee(ip, ipTap, 'CREDITO', 1, 4.91, 'ELO')
  addFee(ip, ipTap, 'CREDITO', 2, 6.47, 'ELO')
  // MP Checkout (Pix 0%)
  addFee(mp, mpCheckout, 'PIX', 1, 0)
  addFee(mp, mpCheckout, 'CREDITO', 1, 4.49)
  addFee(mp, mpCheckout, 'CREDITO', 2, 5.49)
  // Pix Direto (sempre 0%)
  addFee(pixd, pixDir, 'PIX', 1, 0)

  // Cupons iniciais
  s.coupons.push({
    id: uid(), code: 'CLIENTE10', description: '10% para cliente fiel',
    type: 'PERCENT', value: 10, usage_count: 0, active: true, created_at: todayISO(),
  })

  s.settings.push({
    id: uid(), key: 'pix_discount_enabled',
    value: true,
    description: 'Habilita desconto Pix à vista',
    updated_at: todayISO(),
  })
  s.settings.push({
    id: uid(), key: 'pix_discount_percent',
    value: 10,
    description: 'Percentual de desconto Pix à vista (padrão: 10%)',
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
  funding_source?: PurchaseFundingSource | string,
  creditor_name?: string,
}) {
  const s = loadStore()
  const items = args.items ?? []
  const method = args.cost_allocation_method ?? 'quantity'
  const fs = (['CAIXA_EVELINE','FABIANA','DONA','OUTRO'] as readonly string[])
    .includes(String(args.funding_source ?? '')) ? String(args.funding_source) : 'CAIXA_EVELINE'
  const rawCreditor = args.creditor_name ?? undefined;
  const creditor = (typeof rawCreditor === 'string' && rawCreditor.trim().length > 0)
    ? rawCreditor.trim()
    : (fs === 'FABIANA' ? 'Fabiana' : (fs === 'DONA' ? 'Dona da Loja' : undefined));
  const oblCategory = fs === 'FABIANA' ? 'APORTE_TERCEIROS'
    : fs === 'DONA' ? 'MATERIAL_DONA'
    : 'OUTRO'

  const entry: PurchaseEntry = {
    id: uid(), entry_date: args.entry_date ?? new Date().toISOString().slice(0,10),
    supplier: args.supplier ?? null, origin: args.origin ?? null,
    items_total: 0, shipping_cost: Number(args.shipping_cost ?? 0),
    other_costs: 0, total_cost: 0,
    cost_allocation_method: method, notes: args.notes ?? null,
    created_by: args.user_id ?? null, created_at: todayISO(),
    funding_source: fs,
    related_obligation_id: null,
    creditor_name: creditor ?? null,
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

  // ============================================================
  // financeiro condicional (origem do dinheiro)
  // CAIXA_EVELINE → cria SAÍDAS financeiras com payment_source
  // FABIANA/DONA/OUTRO → cria obligation PENDENTE (NÃO toca caixa)
  // ============================================================
  let obligation_id: UUID | null = null
  let financial_created = false
  if (fs === 'CAIXA_EVELINE') {
    financial_created = true
    s.financial_transactions.push({
      id: uid(), trans_date: entry.entry_date, trans_type: 'SAIDA', category: 'COMPRA_ESTOQUE',
      description: `Mercadoria compra ${entry.supplier || entry.origin || entry.entry_date}`,
      amount: entry.items_total, related_purchase_id: entry.id, status: 'CONFIRMADO',
      created_by: args.user_id ?? null, created_at: todayISO(),
      payment_source: 'CAIXA_EVELINE',
    })
    if (entry.shipping_cost > 0) {
      s.financial_transactions.push({
        id: uid(), trans_date: entry.entry_date, trans_type: 'SAIDA', category: 'FRETE',
        description: 'Frete/deslocamento compra',
        amount: entry.shipping_cost, related_purchase_id: entry.id, status: 'CONFIRMADO',
        created_by: args.user_id ?? null, created_at: todayISO(),
        payment_source: 'CAIXA_EVELINE',
      })
    }
    if (entry.other_costs > 0) {
      s.financial_transactions.push({
        id: uid(), trans_date: entry.entry_date, trans_type: 'SAIDA', category: 'OUTRA_DESPESA',
        description: `Outros custos compra (rateio: ${entry.supplier || 'fornecedor'})`,
        amount: entry.other_costs, related_purchase_id: entry.id, status: 'CONFIRMADO',
        created_by: args.user_id ?? null, created_at: todayISO(),
        payment_source: 'CAIXA_EVELINE',
      })
    }
  } else if (['FABIANA','DONA','OUTRO'].includes(fs) && entry.total_cost > 0) {
    const ob: ObligationRow & {[k: string]: any} = {
      id: uid(),
      creditor_name: creditor || (fs === 'FABIANA' ? 'Fabiana' : fs === 'DONA' ? 'Dona da Loja' : 'Outro'),
      description: `Compra mercadoria ${entry.supplier || entry.origin || ''}${entry.notes ? ' - ' + entry.notes : ''}`,
      amount: entry.total_cost,
      amount_paid: 0,
      remaining_balance: entry.total_cost,
      status: 'PENDENTE',
      category: oblCategory,
      due_date: null,
      notes: null,
      related_purchase_id: entry.id,
      created_at: todayISO(),
      paid_at: null,
      last_payment_at: null,
    }
    if (!(s as any).obligations) (s as any).obligations = []
    ;(s as any).obligations.push(ob)
    obligation_id = ob.id
    entry.related_obligation_id = obligation_id
  }

  saveStore(s)
  return {
    ok: true, purchase_entry_id: entry.id, total_cost: entry.total_cost,
    funding_source: fs, creditor_name: creditor ?? null, obligation_id,
    financial_created,
  }
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
    payment_source: 'CAIXA_EVELINE',
  })
  if (fee_actual > 0) {
    s.financial_transactions.push({
      id: uid(), trans_date: sale.sale_date.slice(0,10), trans_type: 'SAIDA', category: 'TAXA',
      description: `Taxa pagamento Venda #${String(friendly_number).padStart(6,'0')}`,
      amount: +fee_actual.toFixed(2), related_sale_id: sale.id, status: 'CONFIRMADO',
      created_by: args.user_id ?? null, created_at: todayISO(),
      payment_source: 'CAIXA_EVELINE',
    })
  }
  if (extra_costs > 0) {
    s.financial_transactions.push({
      id: uid(), trans_date: sale.sale_date.slice(0,10), trans_type: 'SAIDA', category: 'OUTRA_DESPESA',
      description: `Custos extras Venda #${String(friendly_number).padStart(6,'0')}`,
      amount: +extra_costs.toFixed(2), related_sale_id: sale.id, status: 'CONFIRMADO',
      created_by: args.user_id ?? null, created_at: todayISO(),
      payment_source: 'CAIXA_EVELINE',
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

export function demoRecordRemainingPayment(
  sale_id: UUID,
  p: {
    payment: {
      provider_id?: UUID | null; modality_id?: UUID | null; method: string; installments?: number;
      amount?: number; fee_percent?: number; fee_expected?: number; fee_actual?: number;
      provider_snapshot?: string | null; modality_snapshot?: string | null; fee_rule_id?: UUID | null;
    };
    amount?: number | null; trans_date?: string | null; notes?: string | null; user_id?: UUID;
  }
) {
  const s = loadStore()
  const sale = s.sales.find(x => x.id === sale_id)
  if (!sale) return { ok: false, error: 'Venda não encontrada' }
  if (sale.status !== 'PARCIAL' && sale.status !== 'PENDENTE') {
    return { ok: false, error: `Status ${sale.status} não pode receber pagamento restante` }
  }
  const pay = s.sale_payments.filter(x => x.sale_id === sale_id).reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  const pending = Math.max(0, +(Number(sale.total_customer) - pay).toFixed(2))
  const amount = +((p.amount ?? pending) || pending).toFixed(2)
  if (amount <= 0) return { ok: false, error: 'Valor recebido deve ser > 0' }
  if (amount > (pending + 0.01)) return { ok: false, error: 'Valor informado > saldo pendente R$' + pending.toFixed(2) }

  const paym = p.payment
  const method = paym?.method ?? 'PIX'
  const fee_pct = Number(paym?.fee_percent ?? 0)
  const fee_expected = Number(paym?.fee_expected ?? (amount * fee_pct / 100)) || 0
  const fee_actual = Number(paym?.fee_actual ?? fee_expected) || 0
  const installments = paym?.installments ?? 1
  const uid_salepay = (crypto as any).randomUUID?.() ?? 'demo-sp-' + Math.random().toString(36).slice(2)
  const uid_tr = (crypto as any).randomUUID?.() ?? 'demo-ft-' + Math.random().toString(36).slice(2)

  s.sale_payments.push({
    id: uid_salepay, sale_id,
    method: method as any, installments,
    provider_id: paym?.provider_id ?? null,
    modality_id: paym?.modality_id ?? null,
    fee_rule_id: paym?.fee_rule_id ?? null,
    fee_percent_snapshot: fee_pct,
    fee_expected_snapshot: fee_expected,
    fee_real_snapshot: fee_actual,
    amount,
    provider_snapshot: paym?.provider_snapshot ?? null,
    modality_snapshot: paym?.modality_snapshot ?? null,
    created_at: todayISO(),
  })

  s.financial_transactions.push({
    id: uid_tr,
    trans_date: (p.trans_date ? new Date(p.trans_date).toISOString().slice(0,10) : new Date().toISOString().slice(0,10)),
    trans_type: 'ENTRADA', category: 'VENDA',
    description: `Pagamento complementar Venda #${String(sale.friendly_number).padStart(6,'0')} (${method} ${installments}x)`,
    amount, related_sale_id: sale.id, payment_method: method,
    status: 'CONFIRMADO',
    created_by: p.user_id ?? null,
    notes: p.notes ?? '',
    created_at: todayISO(),
  })
  if (fee_actual > 0) {
    s.financial_transactions.push({
      id: (crypto as any).randomUUID?.() ?? 'demo-ft2-'+Math.random().toString(36).slice(2),
      trans_date: new Date().toISOString().slice(0,10),
      trans_type: 'SAIDA', category: 'TAXA',
      description: `Taxa complementar Venda #${sale.friendly_number}`,
      amount: +fee_actual.toFixed(2), related_sale_id: sale.id, payment_method: method,
      status: 'CONFIRMADO', created_by: p.user_id ?? null, created_at: todayISO(),
    })
  }

  for (const ft of s.financial_transactions) {
    if (ft.related_sale_id === sale_id && ft.status === 'PENDENTE' && ft.trans_type === 'ENTRADA' && ft.category === 'VENDA') {
      ft.status = 'CONFIRMADO'
      ft.notes = (ft.notes ?? '') + ' [quitado por pagamento complementar]'
    }
  }

  const payTot = pay + amount
  const pendAfter = Math.max(0, +(Number(sale.total_customer) - payTot).toFixed(2))
  sale.status = pendAfter <= 0.005 ? 'CONCLUIDA' : 'PARCIAL'
  sale.fee_actual = +(Number(sale.fee_actual) + fee_actual).toFixed(2)
  sale.fee_expected = +(Number(sale.fee_expected) + fee_expected).toFixed(2)
  sale.real_profit = +(Number(sale.total_customer) - (Number(sale.items_cost) + Number(sale.packaging_cost) + Number(sale.extra_costs) + Number(sale.fee_actual))).toFixed(2)
  sale.real_margin = sale.total_customer ? (sale.real_profit / Number(sale.total_customer) * 100) : 0
  sale.updated_at = todayISO()
  saveStore(s)
  return {
    ok: true, sale_id, amount, fee_actual,
    new_status: sale.status,
    pending_after: pendAfter,
    sale_payment_id: uid_salepay,
    financial_transaction_id: uid_tr,
  }
}

export function demoUpdateSale(sale_id: UUID, patch: any): Sale | null {
  const s = loadStore()
  const sale = s.sales.find(x => x.id === sale_id)
  if (!sale) return null
  if (patch.customer_name !== undefined) sale.customer_name = patch.customer_name
  if (patch.customer_phone !== undefined) sale.customer_phone = patch.customer_phone
  if (patch.sale_date !== undefined) sale.sale_date = patch.sale_date
  if (patch.source !== undefined) sale.source = patch.source
  if (patch.status !== undefined) sale.status = patch.status
  if (patch.notes !== undefined) (sale as any).notes = patch.notes
  if (patch.total_customer !== undefined) sale.total_customer = Number(patch.total_customer)
  sale.updated_at = todayISO()
  saveStore(s)
  return sale as Sale
}

export function demoUpdateSalePayment(payment_id: UUID, patch: any): any | null {
  const s = loadStore()
  const p = s.sale_payments.find((x: any) => x.id === payment_id)
  if (!p) return null
  if (patch.method !== undefined) p.method = patch.method
  if (patch.amount !== undefined) p.amount = Number(patch.amount)
  if (patch.trans_date !== undefined) p.trans_date = patch.trans_date
  if (patch.provider_snapshot !== undefined) p.provider_snapshot = patch.provider_snapshot
  if (patch.modality_snapshot !== undefined) p.modality_snapshot = patch.modality_snapshot
  if (patch.fee_expected_snapshot !== undefined) p.fee_expected_snapshot = Number(patch.fee_expected_snapshot ?? 0)
  if (patch.fee_real_snapshot !== undefined) p.fee_real_snapshot = Number(patch.fee_real_snapshot ?? 0)
  if (patch.installments_snapshot !== undefined) p.installments_snapshot = Number(patch.installments_snapshot ?? 1)
  if (patch.notes !== undefined) p.notes = patch.notes
  saveStore(s)
  return p
}

export function demoDeleteSalePayment(payment_id: UUID): void {
  const s = loadStore()
  s.sale_payments = (s.sale_payments as any[]).filter((x: any) => x.id !== payment_id)
  saveStore(s)
}

export function demoRegistrarDespesa(args: {
  description: string
  amount: number
  category?: string
  trans_date?: string
  payment_method?: string | null
  notes?: string | null
  created_by?: string | null
}): { id: string } {
  const s = loadStore()
  const cat = (args.category ?? 'OUTROS').trim().toUpperCase()
  const ALLOWED = ['SACOLAS','EMBALAGEM','ETIQUETAS','PAPEL_SEDA','PERFUMARIA','MATERIAL','FRETE','MARKETING','OUTROS']
  if (!ALLOWED.includes(cat)) throw new Error('Categoria de despesa inválida: ' + cat)
  const id = uid()
  const now = todayISO()
  const dateOnly = args.trans_date?.slice(0, 10) ?? now.slice(0, 10)
  s.financial_transactions.push({
    id,
    trans_date: dateOnly,
    trans_type: 'SAIDA',
    category: cat,
    description: args.description.trim(),
    amount: Number((args.amount ?? 0).toFixed(2)),
    payment_method: args.payment_method ? args.payment_method.trim().toUpperCase() : null,
    status: 'CONFIRMADO',
    notes: args.notes?.trim() || null,
    created_by: args.created_by ?? null,
    created_at: now,
    updated_at: now,
  } as any)
  saveStore(s)
  return { id }
}

// ================================================================
// DASHBOARD — implementações das views oficiais (MODO DEMO)
// v_dashboard_stock_summary / v_dashboard_sales / v_dashboard_financial
// Resultados idênticos às definições SQL (exceto filtros de período)
// ================================================================
export function demoDashboardStockSummary(): DashboardStockSummary {
  const s = loadStore()
  const stockByProduct = new Map<string, { qty: number; cost: number }>()
  for (const b of s.inventory_batches) {
    const cur = stockByProduct.get(b.product_id) ?? { qty: 0, cost: 0 }
    const q = Number(b.quantity_available ?? 0)
    cur.qty += q
    cur.cost += q * Number(b.unit_cost ?? 0)
    stockByProduct.set(b.product_id, cur)
  }
  let total_units = 0, total_stock_cost = 0, total_sales_potential = 0, out_of_stock_skus = 0, in_stock_skus = 0
  const total_skus = s.products.length
  for (const p of s.products) {
    const q = stockByProduct.get(p.id)?.qty ?? 0
    if (q <= 0) out_of_stock_skus += 1
    else in_stock_skus += 1
    total_units += q
    total_stock_cost += stockByProduct.get(p.id)?.cost ?? 0
    total_sales_potential += q * Number((p as any).sale_price ?? 0)
  }
  return {
    total_units: Number(total_units.toFixed(0)),
    total_stock_cost: Number(total_stock_cost.toFixed(2)),
    total_sales_potential: Number(total_sales_potential.toFixed(2)),
    total_skus,
    out_of_stock_skus,
    in_stock_skus,
  }
}

function demoDashboardSaleRows(): DashboardSaleRow[] {
  const s = loadStore()
  const out: DashboardSaleRow[] = []
  for (const sale of s.sales) {
    if (sale.status === 'CANCELADA') continue
    const items = s.sale_items.filter(i => i.sale_id === sale.id)
    const payments = s.sale_payments.filter(p => p.sale_id === sale.id)
    const pieces = items.reduce((sum, i) => sum + Number(i.quantity ?? 0), 0)
    const received = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
    const totalCust = Number(sale.total_customer ?? 0)
    const receivable = Math.max(0, totalCust - received)
    const fees = Number(sale.fee_actual ?? 0)
    const itemsCost = Number(sale.items_cost ?? 0)
    const allocCost = Number(sale.allocated_purchase_cost ?? 0)
    const packaging = Number(sale.packaging_cost ?? 0)
    const extra = Number(sale.extra_costs ?? 0)
    const disc = Number(sale.total_discounts ?? 0)
    const firstPay = payments[0]
    out.push({
      sale_id: sale.id,
      sale_date: sale.sale_date,
      revenue: totalCust,
      pieces_sold: pieces,
      amount_received: received,
      amount_receivable: receivable,
      payment_fees: fees,
      items_cost: itemsCost,
      allocated_purchase_cost: allocCost,
      packaging_cost: packaging,
      extra_costs: extra,
      total_discounts: disc,
      friendly_number: sale.friendly_number,
      customer_name: sale.customer_name ?? null,
      source_snapshot: sale.source,
      status: sale.status,
      payment_method_snapshot: firstPay?.method ?? (firstPay as any)?.payment_method_snapshot ?? null,
      payment_provider_snapshot: firstPay?.provider_snapshot ?? (firstPay as any)?.payment_provider_snapshot ?? null,
      installments_snapshot: firstPay?.installments ?? (firstPay as any)?.installments_snapshot ?? null,
      real_profit: Number(sale.real_profit ?? 0),
      total_customer: totalCust,
      total_items: pieces,
    })
  }
  return out
}

export function demoDashboardSales(range: { startInclusive: string; endInclusive: string }): DashboardSaleRow[] {
  const [sy, sm, sd] = range.startInclusive.split('-').map(Number)
  const [ey, em, ed] = range.endInclusive.split('-').map(Number)
  const startTs = new Date(sy, (sm ?? 1) - 1, sd ?? 1).getTime()
  // endExclusiveTs = endInclusive + 1 dia, meia noite (mesma semântica do < endDate+1 T00:00 do Supabase)
  const endDay = new Date(ey, (em ?? 1) - 1, ed ?? 1)
  endDay.setDate(endDay.getDate() + 1)
  const endExclusiveTs = endDay.getTime()
  return demoDashboardSaleRows()
    .filter(r => {
      const t = new Date(r.sale_date).getTime()
      return t >= startTs && t < endExclusiveTs
    })
    .sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime())
}

export function demoDashboardFinancial(range: { startInclusive: string; endInclusive: string }): DashboardFinancialRow[] {
  const s = loadStore()
  const [sy, sm, sd] = range.startInclusive.split('-').map(Number)
  const [ey, em, ed] = range.endInclusive.split('-').map(Number)
  const startTs = new Date(sy, (sm ?? 1) - 1, sd ?? 1).getTime()
  const endDay = new Date(ey, (em ?? 1) - 1, ed ?? 1)
  endDay.setDate(endDay.getDate() + 1)
  const endExclusiveTs = endDay.getTime()
  const out: DashboardFinancialRow[] = []
  for (const t of s.financial_transactions) {
    const tm = new Date(t.trans_date ?? t.created_at).getTime()
    if (tm < startTs || tm >= endExclusiveTs) continue
    out.push({
      financial_transaction_id: t.id,
      trans_date: (t.trans_date ?? t.created_at).slice(0, 10),
      trans_type: t.trans_type,
      status: t.status,
      amount: Number(t.amount ?? 0),
      category: t.category ?? null,
      description: t.description ?? null,
      payment_method: t.payment_method ?? null,
    })
  }
  return out.sort((a, b) => new Date(b.trans_date).getTime() - new Date(a.trans_date).getTime())
}

export function demoListSalePaymentsBySaleIds(saleIds: string[]): SalePayment[] {
  if (!saleIds?.length) return []
  const setIds = new Set(saleIds)
  const s = loadStore()
  return s.sale_payments.filter(p => setIds.has(p.sale_id)) ?? []
}

export function demoDashboardStock(): DashboardStockRow[] {
  const s = loadStore()
  const byProduct = new Map<string, { qty: number; cost: number }>()
  for (const b of s.inventory_batches) {
    const cur = byProduct.get(b.product_id) ?? { qty: 0, cost: 0 }
    const q = Number(b.quantity_available ?? 0)
    cur.qty += q
    cur.cost += q * (Number(b.unit_cost ?? 0) + Number((b as any).allocated_purchase_cost ?? 0))
    byProduct.set(b.product_id, cur)
  }
  const rows: DashboardStockRow[] = []
  for (const p of s.products) {
    const qty = byProduct.get(p.id)?.qty ?? 0
    const cost = byProduct.get(p.id)?.cost ?? 0
    const cat = s.categories.find(c => c.id === p.category_id)
    rows.push({
      product_id: p.id,
      sku: p.sku ?? null,
      product_name: p.name,
      category_name: cat?.name ?? null,
      image_url: (p as any).image_url ?? null,
      units_available: qty,
      stock_cost: cost,
      sales_potential: qty * Number((p as any).sale_price ?? 0),
      min_stock: Number(p.min_stock ?? 0),
      active: p.active,
    })
  }
  return rows.sort((a, b) => String(a.product_name ?? '').localeCompare(String(b.product_name ?? '')))
}

export function demoListSaleItemsBySaleIds(saleIds: string[]): SaleItem[] {
  if (!saleIds?.length) return []
  const setIds = new Set(saleIds)
  const s = loadStore()
  return s.sale_items.filter(i => setIds.has(i.sale_id)) ?? []
}

export function demoListObligationsPendentes(): ObligationRow[] {
  const s = loadStore()
  const source = Array.isArray((s as any).obligations) ? (s as any).obligations as any[] : []
  const out: ObligationRow[] = []
  for (const o of source) {
    const status = (String(o.status ?? 'PENDENTE').toUpperCase()) as any
    if (status === 'PAGO' || status === 'CANCELADO') continue
    const amount = Number(o.amount ?? o.valor ?? 0)
    const amount_paid = Number(o.amount_paid ?? 0)
    out.push({
      id: String(o.id ?? crypto.randomUUID()),
      creditor_name: String(o.creditor_name ?? o.credor ?? '—'),
      description: o.description ?? o.motivo ?? null,
      amount,
      amount_paid,
      remaining_balance: +(amount - amount_paid).toFixed(2),
      status: (['PENDENTE', 'PARCIAL', 'PAGO', 'CANCELADO'].includes(status) ? status : 'PENDENTE') as any,
      category: String(o.category ?? o.categoria ?? 'OUTRO'),
      due_date: o.due_date ?? o.vencimento ?? null,
      notes: o.notes ?? o.observacoes ?? null,
      related_purchase_id: o.related_purchase_id ?? null,
      created_at: o.created_at ?? null,
      paid_at: o.paid_at ?? null,
      last_payment_at: o.last_payment_at ?? null,
    })
  }
  return out
}

// ========== RPC: pay_obligation ==========
export function demoPayObligation(args: {
  obligation_id: string,
  amount: number,
  payment_method?: string,
  notes?: string,
  trans_date?: string,
  payment_ref?: string,
  user_id?: UUID,
}) {
  const s = loadStore()
  const payAmount = Number(args.amount ?? 0)
  if (payAmount <= 0) throw new Error('Valor do pagamento deve ser maior que zero.')
  const obligations = Array.isArray((s as any).obligations) ? (s as any).obligations as any[] : []
  const idx = obligations.findIndex((o: any) => String(o.id) === String(args.obligation_id))
  if (idx < 0) throw new Error('Obrigação não encontrada.')
  const ob = obligations[idx]
  const obAmount = Number(ob.amount ?? 0)
  const obPaid = Number(ob.amount_paid ?? 0)
  const remaining = +(obAmount - obPaid).toFixed(2)
  if (payAmount > remaining + 0.009) {
    throw new Error(`Pagamento (R$ ${payAmount.toFixed(2)}) maior que saldo pendente (R$ ${remaining.toFixed(2)}).`)
  }
  if (args.payment_ref && args.payment_ref.trim()) {
    const existente = s.financial_transactions.find((f: any) =>
      String(f.related_obligation_id) === String(args.obligation_id) &&
      String(f.payment_ref ?? '') === String(args.payment_ref)
    )
    if (existente) return { ok: false, idempotent: true, message: 'Pagamento já lançado com esta referência.' }
  }
  const newPaid = +(obPaid + payAmount).toFixed(2)
  const newRemaining = +(obAmount - newPaid).toFixed(2)
  ob.amount_paid = newPaid
  ob.status = newRemaining <= 0.009 ? 'PAGO' : 'PARCIAL'
  ob.last_payment_at = todayISO()
  if (newRemaining <= 0.009) ob.paid_at = todayISO()

  const trans = {
    id: uid(),
    trans_date: args.trans_date ?? new Date().toISOString().slice(0, 10),
    trans_type: 'SAIDA' as const,
    category: 'PAGAMENTO_OBRIGACAO',
    description: `Pagamento obrigação ${ob.creditor_name ?? ''}${args.payment_ref ? ' · Ref. ' + args.payment_ref : ''}${args.notes ? ' · ' + args.notes : ''}`,
    amount: payAmount,
    related_obligation_id: String(args.obligation_id),
    status: 'CONFIRMADO' as const,
    created_by: args.user_id ?? null,
    payment_method: args.payment_method ?? 'PIX',
    payment_ref: args.payment_ref ?? null,
    notes: args.notes ?? null,
    payment_source: 'CAIXA_EVELINE',
    created_at: todayISO(),
  }
  s.financial_transactions.push(trans)
  obligations[idx] = ob
  saveStore(s)
  return {
    ok: true,
    idempotent: false,
    obligation_id: ob.id,
    financial_transaction_id: trans.id,
    amount_paid: payAmount,
    remaining_balance: newRemaining,
    new_status: ob.status,
  }
}

