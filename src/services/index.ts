import {
  isSupabaseConfigured, supabase, getCurrentUserId,
} from '@/lib/supabase'
import * as Demo from './demo-storage'
import type { UUID, Product, Category, Sale, SaleItem, SalePayment, SalePackaging, SaleCost, PurchaseEntry, PurchaseFundingSource, FinancialTransaction, InventoryMovement, InventoryBatch, PaymentFeeRule, PackagingType, Coupon, Setting, PaymentProvider, PaymentModality, DashboardStockSummary, DashboardStockRow, DashboardSaleRow, DashboardFinancialRow, ObligationRow, DashboardCashSummary, DashboardReceivablesTotal, ProductWithStock, InfinitePayReceivable } from '@/types/supabase'

// ================================================================
// CAMADA UNIFICADA DE DADOS
// Escolhe automaticamente entre SUPABASE (se configurado) ou MODO DEMO (localStorage).
// ================================================================

export const usingSupabase = isSupabaseConfigured && supabase !== null

const INVALIDATE_EVENT = 'eg:invalidate'

export function dispatchInvalidateAll() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INVALIDATE_EVENT))
    ;((window as any).__reloadDashboard as undefined | (() => void))?.()
  }
}

export function dispatchInvalidate(scope: 'all' | 'dashboard' | 'sales' | 'inventory' | 'financial' | 'purchases' | 'products' = 'all') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INVALIDATE_EVENT, { detail: { scope } }))
    if (scope === 'all' || scope === 'dashboard') {
      ;((window as any).__reloadDashboard as undefined | (() => void))?.()
    }
  }
}

export function onInvalidate(callback: (scope?: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    const ev = e as CustomEvent<any>
    callback(ev.detail?.scope ?? 'all')
  }
  window.addEventListener(INVALIDATE_EVENT, handler as EventListener)
  return () => window.removeEventListener(INVALIDATE_EVENT, handler as EventListener)
}

export async function listProducts(): Promise<Product[]> {
  if (!usingSupabase) return Demo.demoListProducts()
  const { data, error } = await (supabase!)
    .from('products')
    .select('id, sku, name, slug, category_id, default_packaging_type_id, current_cost, sale_price, min_stock, active, created_at, updated_at')
    .eq('active', true)
    .order('name')
  if (error) { console.error('[services] listProducts error:', error); throw error }
  return (data as Product[]) ?? []
}

export async function listAllProducts(includeInactive = false): Promise<Product[]> {
  if (!usingSupabase) return Demo.demoListProducts()
  let q = (supabase!).from('products').select('id, sku, name, slug, category_id, default_packaging_type_id, current_cost, sale_price, min_stock, active, created_at, updated_at')
  if (!includeInactive) q = q.eq('active', true)
  const { data, error } = await q.order('name')
  if (error) { console.error('[services] listAllProducts error:', error); throw error }
  return (data as Product[]) ?? []
}

// ================================================================
// listProductsWithStock: FONTE ÚNICA DE VERDADE do estoque disponível
//   1) Tenta PRIMEIRO a VIEW confirmada public.products_with_stock
//      (retorna total_stock, weighted_cost etc.)
//   2) Se a VIEW falhar, faz fallback manual: listAllProducts + batches
//      usando Promise.allSettled INTERNO — NUNCA throw.
//      Se batches falhar individualmente, retorna produtos com
//      estoque 0 mas produtos SEMPRE aparecem.
// ================================================================
export async function listProductsWithStock(includeInactive = false): Promise<ProductWithStock[]> {
  if (usingSupabase) {
    try {
      let q = (supabase!).from('products_with_stock').select('*')
      if (!includeInactive) q = q.eq('active', true)
      const { data, error } = await q.order('name')
      if (!error && Array.isArray(data)) {
        return (data as any[]).map((row: any) => ({
          id: row.id,
          sku: row.sku ?? null,
          name: row.name ?? 'Produto sem nome',
          slug: row.slug ?? null,
          category_id: row.category_id ?? null,
          default_packaging_type_id: row.default_packaging_type_id ?? null,
          current_cost: Number(row.current_cost ?? 0),
          sale_price: Number(row.sale_price ?? 0),
          min_stock: Number(row.min_stock ?? 0),
          active: Boolean(row.active ?? true),
          image_url: row.image_url ?? null,
          notes: row.notes ?? null,
          created_at: row.created_at ?? new Date().toISOString(),
          updated_at: row.updated_at ?? new Date().toISOString(),
          available_quantity: Number(row.total_stock ?? 0),
          total_stock: Number(row.total_stock ?? 0),
          available_stock: Number(row.total_stock ?? 0),
          stock_quantity: Number(row.total_stock ?? 0),
          weighted_cost: row.weighted_cost == null ? null : Number(row.weighted_cost),
          weighted_average_cost: row.weighted_average_cost == null ? null : Number(row.weighted_average_cost),
          has_active_batches: Number(row.total_stock ?? 0) > 0,
        })) as ProductWithStock[]
      }
      if (error) console.warn('[services] listProductsWithStock view falhou, fallback manual:', error.message ?? error)
    } catch (e: any) {
      console.warn('[services] listProductsWithStock view exception, fallback manual:', e?.message ?? e)
    }
  }

  const [rp, rb] = await Promise.allSettled([
    listAllProducts(includeInactive),
    usingSupabase ? listInventoryBatches() : Promise.resolve([] as any[]),
  ])
  const products: any[] = rp.status === 'fulfilled' ? (rp.value as any[]) : []
  const batches: any[] = rb.status === 'fulfilled' ? (rb.value as any[]) : []
  if (rb.status === 'rejected') console.error('[services] listProductsWithStock batches falhou, usando estoque=0:', (rb as any).reason)

  const qtyPerProduct = new Map<string, number>()
  for (const b of batches) {
    const pid = b.product_id
    const add = Number(b.quantity_available ?? 0)
    if (add <= 0 && !qtyPerProduct.has(pid)) { qtyPerProduct.set(pid, 0); continue }
    qtyPerProduct.set(pid, (qtyPerProduct.get(pid) ?? 0) + add)
  }
  return products.map((p: any) => {
    const q = qtyPerProduct.get(p.id) ?? 0
    return {
      ...p,
      available_quantity: q,
      total_stock: q,
      available_stock: q,
      stock_quantity: q,
      has_active_batches: q > 0,
    }
  }) as ProductWithStock[]
}

export async function getProduct(id: UUID): Promise<Product | null> {
  if (!usingSupabase) return Demo.demoListProducts().find(p => p.id === id) ?? null
  const { data, error } = await (supabase as any).from('products').select('*').eq('id', id).maybeSingle()
  if (error) { console.error('[services] getProduct error:', error); throw error }
  return (data as Product | null) ?? null
}

export async function createProduct(p: Partial<Product>): Promise<Product> {
  let ret: any
  if (!usingSupabase) ret = Demo.demoCreateProduct(p)
  else {
    const sup: any = supabase
    const { data, error } = await sup.from('products').insert({
      sku: p.sku ?? null,
      name: p.name ?? 'Novo produto',
      slug: p.slug ?? null,
      category_id: p.category_id ?? null,
      default_packaging_type_id: p.default_packaging_type_id ?? null,
      current_cost: Number(p.current_cost ?? 0),
      sale_price: Number(p.sale_price ?? 0),
      min_stock: Number(p.min_stock ?? 0),
      image_url: p.image_url ?? null,
      notes: p.notes ?? null,
      active: p.active ?? true,
    }).select().single()
    if (error) throw error
    ret = data as Product
  }
  setTimeout(__reloadDashboard, 50)
  return ret
}

export async function updateProduct(id: UUID, patch: Partial<Product>): Promise<Product | null> {
  if (!usingSupabase) return Demo.demoUpdateProduct(id, patch)
  const sup: any = supabase
  const { data, error } = await sup.from('products').update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().maybeSingle()
  if (error) throw error
  return (data as Product) ?? null
}

export async function listCategories(): Promise<Category[]> {
  if (!usingSupabase) return Demo.demoListCategories()
  const { data } = await (supabase!).from('categories').select('*').eq('active', true).order('name')
  return (data as Category[]) ?? []
}

export async function listPackagingTypes(): Promise<PackagingType[]> {
  if (!usingSupabase) return Demo.demoListPackagingTypes()
  const { data } = await (supabase!).from('packaging_types').select('*').order('is_default', { ascending: false }).order('name')
  return (data as PackagingType[]) ?? []
}

export interface ProviderWithModalities { provider: PaymentProvider; modalities: PaymentModality[] }

export async function listPaymentProviders(): Promise<ProviderWithModalities[]> {
  if (!usingSupabase) return Demo.demoListPaymentProviders() as any
  const [providers, modalities] = await Promise.all([
    (supabase!).from('payment_providers').select('*').eq('active', true).order('name'),
    (supabase!).from('payment_modalities').select('*').eq('active', true).order('name'),
  ])
  const provs = (providers.data ?? []) as PaymentProvider[]
  const mods = (modalities.data ?? []) as PaymentModality[]
  return provs.map(p => ({
    provider: p,
    modalities: mods.filter(m => m.provider_id === p.id),
  }))
}

export async function listFeeRules(): Promise<PaymentFeeRule[]> {
  if (!usingSupabase) return Demo.demoListFeeRules()
  const { data } = await (supabase!).from('payment_fee_rules').select('*').order('valid_from', { ascending: false })
  return (data as PaymentFeeRule[]) ?? []
}

export async function upsertFeeRule(r: Partial<PaymentFeeRule>): Promise<PaymentFeeRule> {
  if (!usingSupabase) return Demo.demoUpsertFeeRule(r)
  const sup: any = supabase
  if (r.id) {
    const { data, error } = await sup.from('payment_fee_rules').update({
      fee_percent: Number(r.fee_percent ?? 0),
      fixed_fee: Number(r.fixed_fee ?? 0),
      valid_until: r.valid_until ?? null,
      receipt_term: r.receipt_term ?? null,
      revenue_tier: r.revenue_tier ?? null,
    }).eq('id', r.id).select().maybeSingle()
    if (error) throw error
    return (data as PaymentFeeRule) ?? (r as PaymentFeeRule)
  }
  const { data, error } = await sup.from('payment_fee_rules').insert({
    provider_id: r.provider_id!,
    modality_id: r.modality_id ?? null,
    method: r.method,
    installments: r.installments ?? 1,
    receipt_term: r.receipt_term ?? null,
    revenue_tier: r.revenue_tier ?? null,
    brand: r.brand ?? null,
    fee_percent: Number(r.fee_percent ?? 0),
    fixed_fee: Number(r.fixed_fee ?? 0),
    valid_from: r.valid_from ?? new Date().toISOString().slice(0,10),
    valid_until: r.valid_until ?? null,
  }).select().single()
  if (error) throw error
  return data as PaymentFeeRule
}

export async function deleteFeeRule(id: UUID): Promise<void> {
  if (!usingSupabase) { Demo.demoDeleteFeeRule(id); return }
  await (supabase!).from('payment_fee_rules').delete().eq('id', id)
}

export async function findFee(provider_id?: UUID, modality_id?: UUID, method?: string, installments = 1): Promise<PaymentFeeRule | null> {
  if (!usingSupabase) return Demo.demoFindFee(provider_id, modality_id, method, installments)
  if (!provider_id || !modality_id || !method) return null
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await (supabase!)
    .from('payment_fee_rules')
    .select('*')
    .eq('provider_id', provider_id)
    .eq('modality_id', modality_id)
    .eq('method', method)
    .eq('installments', installments)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle() as any
  return (data as PaymentFeeRule) ?? null
}

export async function listCoupons(): Promise<Coupon[]> {
  if (!usingSupabase) return Demo.demoListCoupons()
  const { data } = await (supabase!).from('coupons').select('*').eq('active', true).order('code')
  return (data as Coupon[]) ?? []
}

export async function getSetting(key: string): Promise<any | null> {
  if (!usingSupabase) {
    const list = Demo.demoListSettings()
    return list.find(s => s.key === key)?.value ?? null
  }
  const { data } = await (supabase!).from('settings').select('value').eq('key', key).maybeSingle()
  return (data as any)?.value ?? null
}

export async function upsertSetting(key: string, value: any, description?: string): Promise<void> {
  if (!usingSupabase) { Demo.demoUpsertSetting(key, value, description); return }
  const sup: any = supabase
  const { data: existing } = await sup.from('settings').select('*').eq('key', key).maybeSingle()
  if (existing) {
    await sup.from('settings').update({ value, description: description ?? existing.description, updated_at: new Date().toISOString() }).eq('key', key)
  } else {
    await sup.from('settings').insert({ key, value, description: description ?? '' })
  }
}

// =====================================================
// VENDAS
// =====================================================
export async function listSales(): Promise<Sale[]> {
  if (!usingSupabase) return Demo.demoListSales()
  const { data } = await (supabase!).from('sales').select('*').order('sale_date', { ascending: false })
  return (data as Sale[]) ?? []
}

export async function getSaleDetail(id: UUID) {
  if (!usingSupabase) return Demo.demoGetSale(id)
  const sup: any = supabase
  const [s1, s2, s3, s4, s5] = await Promise.all([
    sup.from('sales').select('*').eq('id', id).maybeSingle(),
    sup.from('sale_items').select('*').eq('sale_id', id),
    sup.from('sale_payments').select('*').eq('sale_id', id),
    sup.from('sale_packaging').select('*').eq('sale_id', id).maybeSingle(),
    sup.from('sale_costs').select('*').eq('sale_id', id),
  ])
  if (!s1.data) return null
  return {
    sale: s1.data as Sale,
    items: (s2.data as SaleItem[]) ?? [],
    payments: (s3.data as SalePayment[]) ?? [],
    packaging: (s4.data as SalePackaging | null) ?? null,
    costs: (s5.data as SaleCost[]) ?? [],
  }
}

export interface FinalizeSaleParams {
  source: any
  items: Array<{product_id?: UUID, variant_id?: UUID, product_name: string, variant?: string, sku?: string, quantity: number, unit_sale_price: number, unit_actual_price: number, discount: number}>
  general_discount?: number
  coupon_id?: UUID | null
  coupon_code?: string | null
  pix_discount?: number
  payment?: {
    provider_id?: UUID, modality_id?: UUID, method: any, installments: number, amount?: number,
    fee_percent?: number, fee_expected?: number, fee_actual?: number,
    provider_snapshot?: string, modality_snapshot?: string, fee_rule_id?: UUID
  }
  packaging?: {packaging_type_id?: UUID, tipo_snapshot?: string, custo_snapshot: number, custom_cost?: number, is_free?: boolean}
  extra_costs?: Array<{description: string, category?: string, amount: number}>
  customer_name?: string
  customer_phone?: string
}

function __computePaymentSourceHint(payment?: FinalizeSaleParams['payment']): string {
  if (!payment) return 'CAIXA_EVELINE'
  const psName = ((payment.provider_snapshot ?? '') as string).trim().toLowerCase()
  const paymMethod = String(payment.method ?? 'OUTRO').toUpperCase()
  if (psName.includes('mercado') || psName.startsWith('mp') || psName.includes('mercadopago') || paymMethod === 'MERCADOPAGO') {
    return 'MERCADO_PAGO'
  }
  if (psName.includes('infinite') || psName.includes('infinitepay') || paymMethod === 'INFINITEPAY') {
    return 'INFINITEPAY'
  }
  if (paymMethod === 'FABIANA') return 'FABIANA'
  if (paymMethod === 'DONA') return 'DONA'
  return 'CAIXA_EVELINE'
}

export async function finalizeSale(p: FinalizeSaleParams) {
  const userId = getCurrentUserId()
  let ret: any
  const paymentSourceHint = __computePaymentSourceHint(p.payment)
  if (!usingSupabase) {
    ret = Demo.demoFinalizeSale({ ...p, user_id: userId ?? undefined } as any)
  } else {
    const { data, error } = await (supabase as any).rpc('finalize_sale', {
      p_source: p.source,
      p_items: p.items as any,
      p_general_discount: p.general_discount ?? 0,
      p_coupon_id: p.coupon_id ?? null,
      p_coupon_code: p.coupon_code ?? null,
      p_pix_discount: p.pix_discount ?? 0,
      p_payment: p.payment ? ({
        provider_id: p.payment.provider_id ?? null,
        modality_id: p.payment.modality_id ?? null,
        method: p.payment.method,
        installments: p.payment.installments ?? 1,
        amount: p.payment.amount ?? null,
        fee_percent: p.payment.fee_percent ?? 0,
        fee_expected: p.payment.fee_expected ?? 0,
        fee_actual: p.payment.fee_actual ?? (p.payment.fee_expected ?? 0),
        provider_snapshot: p.payment.provider_snapshot ?? null,
        modality_snapshot: p.payment.modality_snapshot ?? null,
        fee_rule_id: p.payment.fee_rule_id ?? null,
        payment_source_hint: paymentSourceHint,
      } as any) : null,
      p_payment_source_hint: paymentSourceHint,
      p_packaging: p.packaging as any ?? null,
      p_extra_costs: (p.extra_costs ?? []) as any,
      p_customer_name: p.customer_name ?? null,
      p_customer_phone: p.customer_phone ?? null,
      p_user_id: userId ?? null,
    })
    if (error) throw error
    ret = data
  }
  setTimeout(__reloadDashboard, 50)
  try { dispatchInvalidateAll?.() } catch {}
  return ret
}

const __reloadDashboard = () => {
  try {
    const fn = (window as any).__reloadDashboard
    if (typeof fn === 'function') fn()
  } catch {}
}

export async function cancelSale(sale_id: UUID, reason: string) {
  const userId = getCurrentUserId()
  if (!usingSupabase) {
    const r = Demo.demoCancelSale(sale_id, reason, userId ?? undefined)
    setTimeout(__reloadDashboard, 50); return r
  }
  const { data, error } = await (supabase as any).rpc('cancel_sale', {
    p_sale_id: sale_id,
    p_reason: reason,
    p_user_id: userId ?? null,
  })
  if (error) throw error
  setTimeout(__reloadDashboard, 50)
  return data
}

export interface RecordRemainingPaymentParams {
  payment: {
    provider_id?: UUID | null
    modality_id?: UUID | null
    method: 'PIX' | 'CREDITO' | 'DEBITO' | 'BOLETO' | 'DINHEIRO' | 'OUTRO' | string
    installments?: number
    amount?: number
    fee_percent?: number
    fee_expected?: number
    fee_actual?: number
    provider_snapshot?: string | null
    modality_snapshot?: string | null
    fee_rule_id?: UUID | null
  }
  amount?: number | null
  trans_date?: string | null
  notes?: string | null
}

export async function recordRemainingPayment(
  sale_id: UUID,
  p: RecordRemainingPaymentParams
) {
  const userId = getCurrentUserId()
  let ret: any
  if (!usingSupabase) {
    ret = Demo.demoRecordRemainingPayment(sale_id, { ...p, user_id: userId ?? undefined } as any)
  } else {
    const { data, error } = await (supabase as any).rpc('record_remaining_payment', {
      p_sale_id: sale_id,
      p_payment: {
        provider_id: p.payment.provider_id ?? null,
        modality_id: p.payment.modality_id ?? null,
        method: p.payment.method,
        installments: p.payment.installments ?? 1,
        amount: p.payment.amount ?? null,
        fee_percent: p.payment.fee_percent ?? 0,
        fee_expected: p.payment.fee_expected ?? 0,
        fee_actual: p.payment.fee_actual ?? null,
        provider_snapshot: p.payment.provider_snapshot ?? null,
        modality_snapshot: p.payment.modality_snapshot ?? null,
        fee_rule_id: p.payment.fee_rule_id ?? null,
      } as any,
      p_amount: p.amount ?? null,
      p_trans_date: p.trans_date ?? null,
      p_user_id: userId ?? null,
      p_notes: p.notes ?? null,
    })
    if (error) throw error
    ret = data
  }
  setTimeout(__reloadDashboard, 50)
  return ret
}

// =====================================================
// COMPRAS / ENTRADAS
// =====================================================
export async function listPurchases(): Promise<PurchaseEntry[]> {
  if (!usingSupabase) return Demo.demoListPurchases()
  const { data } = await (supabase!).from('purchase_entries').select('*').order('entry_date', { ascending: false })
  return (data as PurchaseEntry[]) ?? []
}

export async function getPurchaseDetail(id: UUID) {
  if (!usingSupabase) return Demo.demoGetPurchase(id)
  const [p, i, c] = await Promise.all([
    (supabase!).from('purchase_entries').select('*').eq('id', id).maybeSingle(),
    (supabase!).from('purchase_entry_items').select('*').eq('purchase_entry_id', id),
    (supabase!).from('purchase_costs').select('*').eq('purchase_entry_id', id),
  ])
  if (!p.data) return null
  return {
    purchase: p.data as PurchaseEntry,
    items: (i.data as any[]) ?? [],
    costs: (c.data as any[]) ?? [],
  }
}

export interface CreatePurchaseParams {
  entry_date?: string
  supplier?: string
  origin?: string
  cost_allocation_method?: 'quantity' | 'value' | 'none'
  items: Array<{product_id?: UUID, product_name: string, unit_cost: number, quantity: number}>
  shipping_cost?: number
  other_costs?: Array<{description: string, category?: string, amount: number}>
  notes?: string
  funding_source?: PurchaseFundingSource | string
  creditor_name?: string
}

export async function createPurchase(p: CreatePurchaseParams) {
  const userId = getCurrentUserId()
  const funding_source = (p.funding_source as any) ?? 'CAIXA_EVELINE'
  let ret: any
  if (!usingSupabase) {
    ret = Demo.demoCreatePurchaseEntry({
      ...p,
      funding_source,
      creditor_name: p.creditor_name ?? undefined,
      user_id: userId ?? undefined
    })
  } else {
    const { data, error } = await (supabase as any).rpc('create_purchase_entry', {
      p_entry_date: p.entry_date ?? null,
      p_supplier: p.supplier ?? null,
      p_origin: p.origin ?? null,
      p_cost_allocation_method: p.cost_allocation_method ?? 'quantity',
      p_items: p.items as any,
      p_shipping_cost: p.shipping_cost ?? 0,
      p_other_costs: (p.other_costs ?? []) as any,
      p_notes: p.notes ?? null,
      p_user_id: userId ?? null,
      p_funding_source: funding_source,
      p_creditor_name: p.creditor_name ?? null,
    })
    if (error) throw error
    ret = data
  }
  // 2026-09-22: Invalida TODOS os estados (purchases/inventory/products/dashboard/financial)
  // para propagar os novos inventory_batches imediatamente.
  dispatchInvalidateAll()
  return ret
}

// ================================================================
// receivePurchase: Recebe mercadoria de uma COMPRA_EM_TRANSITO.
//   Idempotente: se já existirem inventory_batches vinculados, não duplica.
//   Cria lotes e movimentos de ENTRADA em batch.
//   NÃO CRIA NOVOS LANÇAMENTOS FINANCEIROS (não duplica o pagamento).
// ================================================================
export async function receivePurchase(purchase_entry_id: UUID): Promise<{
  ok: boolean; idempotent: boolean; batches_created: number; purchase_entry_id: UUID;
}> {
  const userId = getCurrentUserId()
  if (!usingSupabase) {
    return Demo.demoReceivePurchaseEntry(purchase_entry_id, { user_id: userId ?? undefined })
  }
  const sup: any = supabase
  // 1) Proteção idempotente: compra JÁ tem lotes? retorna sem criar.
  const existBatch = await sup
    .from('inventory_batches')
    .select('id', { count: 'exact', head: true })
    .eq('purchase_entry_id', purchase_entry_id)
  if (existBatch.error) throw existBatch.error
  if (existBatch.count && existBatch.count > 0) {
    return { ok: true, idempotent: true, batches_created: 0, purchase_entry_id }
  }
  // 2) Busca compra + itens associados (allocated_share / unit_cost / quantity)
  const [{ data: entryData, error: errEntry }, { data: items, error: errItems }] = await Promise.all([
    sup.from('purchase_entries').select('id, origin, entry_date, shipping_cost, funding_source').eq('id', purchase_entry_id).maybeSingle(),
    sup.from('purchase_entry_items').select('id, product_id, quantity, unit_cost, allocated_share, effective_cost, product_snapshot').eq('purchase_entry_id', purchase_entry_id),
  ])
  if (errEntry) throw errEntry
  if (errItems) throw errItems
  if (!entryData) {
    throw new Error('Compra não encontrada.')
  }
  if (!items || items.length === 0) {
    return { ok: true, idempotent: false, batches_created: 0, purchase_entry_id }
  }
  const nowIso = new Date().toISOString()
  const nowDate = new Date().toISOString().slice(0, 10)
  // 3) Cria 1 inventory_batch por item + 1 movement ENTRADA (RECEBIMENTO_COMPRA_EM_TRANSITO)
  //    NÃO cria nenhum registro em financial_transactions aqui. Pagamento já foi feito.
  const createdBatches: any[] = []
  const createdMovements: any[] = []
  for (const it of items) {
    const qty = Math.max(0, Number(it.quantity ?? 0))
    if (qty <= 0 || !it.product_id) continue
    const share = Number(it.allocated_share ?? 0)
    const uc = Number(it.unit_cost ?? 0)
    const allocPerUnit = qty > 0 ? +(share / qty).toFixed(4) : 0
    createdBatches.push({
      product_id: it.product_id,
      variant_id: null,
      purchase_entry_id,
      purchase_item_id: it.id,
      received_at: nowDate,
      quantity_received: qty,
      quantity_available: qty,
      unit_cost: uc,
      allocated_purchase_cost: allocPerUnit,
      supplier_id: null,
      notes: 'Recebimento automático - ' + (entryData?.entry_date ?? nowDate),
      created_at: nowIso,
      updated_at: nowIso,
    })
    createdMovements.push({
      product_id: it.product_id,
      variant_id: null,
      batch_id: null,
      movement_type: 'ENTRADA',
      reason: 'RECEBIMENTO_COMPRA_EM_TRANSITO',
      quantity: qty,
      unit_cost: uc,
      related_purchase_id: purchase_entry_id,
      created_by: userId ?? null,
      created_at: nowIso,
    })
  }
  if (createdBatches.length > 0) {
    const { error: errBat } = await sup.from('inventory_batches').insert(createdBatches)
    if (errBat) throw errBat
    const { error: errMov } = await sup.from('inventory_movements').insert(createdMovements)
    if (errMov) throw errMov
  }
  // 4) Propagada atualização global de estoque/produtos/dashboard.
  dispatchInvalidateAll()
  return { ok: true, idempotent: false, batches_created: createdBatches.length, purchase_entry_id }
}

export interface PayObligationParams {
  obligation_id: UUID | string
  amount: number
  payment_method?: string
  notes?: string
  trans_date?: string
  payment_ref?: string
}

export async function payObligation(p: PayObligationParams) {
  const userId = getCurrentUserId()
  let ret: any
  if (!usingSupabase) {
    ret = Demo.demoPayObligation({
      ...p,
      user_id: userId ?? undefined,
    })
  } else {
    const { data, error } = await (supabase as any).rpc('pay_obligation', {
      p_obligation_id: p.obligation_id,
      p_amount: Number(p.amount),
      p_payment_method: p.payment_method ?? 'PIX',
      p_notes: p.notes ?? null,
      p_trans_date: p.trans_date ?? new Date().toISOString().slice(0, 10),
      p_payment_ref: p.payment_ref ?? null,
      p_user_id: userId ?? null,
    })
    if (error) throw error
    ret = data
  }
  setTimeout(__reloadDashboard, 50)
  return ret
}

// =====================================================
// FINANCEIRO + MOVIMENTAÇÕES
// =====================================================
export async function listFinancialTransactions(): Promise<FinancialTransaction[]> {
  if (!usingSupabase) return Demo.demoListFinancialTrans()
  const { data } = await (supabase!).from('financial_transactions').select('*').order('trans_date', { ascending: false }).order('created_at', { ascending: false })
  return (data as FinancialTransaction[]) ?? []
}

export async function listInventoryMovements(): Promise<InventoryMovement[]> {
  if (!usingSupabase) return Demo.demoListMovements()
  const { data } = await (supabase!).from('inventory_movements').select('*').order('created_at', { ascending: false }).limit(500)
  return (data as InventoryMovement[]) ?? []
}

export async function listInventoryBatches(product_id?: UUID): Promise<InventoryBatch[]> {
  if (!usingSupabase) return Demo.demoListBatches(product_id)
  let q = (supabase!).from('inventory_batches')
    .select('id, product_id, variant_id, purchase_entry_id, purchase_item_id, received_at, quantity_received, quantity_available, unit_cost, allocated_purchase_cost, supplier_id, notes, created_at, updated_at')
  if (product_id) q = q.eq('product_id', product_id)
  const { data, error } = await q.order('received_at', { ascending: false })
  if (error) { console.error('[services] listInventoryBatches error:', error); throw error }
  return (data as InventoryBatch[]) ?? []
}

export async function updateSale(sale_id: UUID, patch: Partial<Sale>): Promise<Sale | null> {
  let ret: any = null
  if (!usingSupabase) {
    ret = Demo.demoUpdateSale(sale_id, patch)
  } else {
    const sup: any = supabase
    const patchSafe: Record<string, any> = {}
    if ('customer_name' in patch) patchSafe.customer_name = patch.customer_name
    if ('customer_phone' in patch) patchSafe.customer_phone = patch.customer_phone
    if ('sale_date' in patch) patchSafe.sale_date = patch.sale_date
    if ('source' in patch) patchSafe.source = patch.source
    if ('status' in patch) patchSafe.status = patch.status
    if ('notes' in patch) patchSafe.notes = patch.notes
    if ('total_customer' in patch) patchSafe.total_customer = Number(patch.total_customer ?? 0)

    const { data, error } = await sup.rpc('update_sale_with_financial_sync', {
      p_sale_id: sale_id,
      p_sale_patch: patchSafe,
      p_payment_patch: null,
    })
    if (error) throw error
    if (data && typeof data === 'object' && data.warning) {
      console.warn('[services.updateSale] RPC warning:', data.warning)
    }
    const { data: refreshed, error: errRef } = await sup
      .from('sales')
      .select('*')
      .eq('id', sale_id)
      .limit(1)
      .maybeSingle()
    if (errRef) throw errRef
    ret = (refreshed as Sale) ?? null
  }
  setTimeout(__reloadDashboard, 50)
  return ret
}

export async function listObligationsPendentes(): Promise<ObligationRow[]> {
  if (!usingSupabase) return Demo.demoListObligationsPendentes()
  const sup: any = supabase
  const STATUS_NAO_PENDENTES = ['PAGO', 'CANCELADO'] as const
  const mapRow = (d: any): ObligationRow => ({
    id: d.id,
    creditor_name: String(d.creditor_name ?? d.credor ?? d.creditor ?? 'Credor'),
    description: d.description ?? d.descricao ?? null,
    amount: Number(d.amount ?? d.valor ?? 0),
    status: (['PENDENTE','PAGO','PARCIAL','CANCELADO'].includes(String(d.status ?? ''))
      ? String(d.status) as any
      : 'PENDENTE'),
    category: d.category ?? d.categoria ?? undefined,
    due_date: d.due_date ?? d.data_vencimento ?? null,
    notes: d.notes ?? d.observacoes ?? null,
    related_purchase_id: d.related_purchase_id ?? d.purchase_entry_id ?? null,
  })
  try {
    const { data, error } = await sup
      .from('v_dashboard_obligations')
      .select('*')
      .order('creditor_name', { ascending: true } as any)
    if (!error && Array.isArray(data)) {
      return data.filter((d: any) => !(STATUS_NAO_PENDENTES as readonly string[]).includes(String(d.status ?? ''))).map(mapRow)
    }
  } catch (e: any) {
    console.warn('[services] v_dashboard_obligations indisponível, fallback tabela obligations:', e?.message ?? String(e))
  }
  const { data, error } = await sup
    .from('obligations')
    .select('*')
    .not('status', 'in', `(${STATUS_NAO_PENDENTES.join(',')})`)
    .order('creditor_name', { ascending: true } as any)
  if (error) { console.error('[services] listObligationsPendentes error:', error); throw error }
  return (data ?? []).map(mapRow)
}

export async function updateSalePayment(payment_id: UUID, patch: Partial<SalePayment> & { sale_id?: UUID }): Promise<SalePayment | null> {
  let ret: any = null
  if (!usingSupabase) {
    ret = (Demo.demoUpdateSalePayment(payment_id, patch) ?? null)
  } else {
    const sup: any = supabase
    const patchSafe: Record<string, any> = { id: payment_id }
    if (patch.method !== undefined) patchSafe.method = patch.method
    if (patch.amount !== undefined) patchSafe.amount = Number(patch.amount)
    if ((patch as any).trans_date !== undefined) patchSafe.trans_date = (patch as any).trans_date
    if ((patch as any).provider_snapshot !== undefined) patchSafe.provider_snapshot = (patch as any).provider_snapshot
    if ((patch as any).modality_snapshot !== undefined) patchSafe.modality_snapshot = (patch as any).modality_snapshot
    if ((patch as any).fee_expected_snapshot !== undefined) patchSafe.fee_expected_snapshot = Number((patch as any).fee_expected_snapshot ?? 0)
    if ((patch as any).fee_real_snapshot !== undefined) patchSafe.fee_real_snapshot = Number((patch as any).fee_real_snapshot ?? 0)
    if ((patch as any).fee_percent_snapshot !== undefined) patchSafe.fee_percent_snapshot = Number((patch as any).fee_percent_snapshot ?? 0)
    if (patch.installments !== undefined) patchSafe.installments = Number(patch.installments ?? 1)
    if ((patch as any).notes_snapshot !== undefined) patchSafe.notes_snapshot = (patch as any).notes_snapshot
    if ((patch as any).notes !== undefined) patchSafe.notes = (patch as any).notes

    const saleIdRaw = (patch as any).sale_id
    let sale_id: UUID | null = null
    if (saleIdRaw) {
      sale_id = saleIdRaw as UUID
    } else {
      const { data: spRow, error: errSp } = await sup
        .from('sale_payments')
        .select('id, sale_id')
        .eq('id', payment_id)
        .limit(1)
        .maybeSingle()
      if (errSp) throw errSp
      sale_id = spRow?.sale_id ?? null
    }
    if (!sale_id) throw new Error('Pagamento não encontrado ou sem sale_id vinculado.')

    const { data, error } = await sup.rpc('update_sale_with_financial_sync', {
      p_sale_id: sale_id,
      p_sale_patch: {},
      p_payment_patch: patchSafe,
    })
    if (error) throw error
    if (data && typeof data === 'object' && data.warning) {
      console.warn('[services.updateSalePayment] RPC warning:', data.warning)
    }
    const { data: refreshed, error: errRef } = await sup
      .from('sale_payments')
      .select('*')
      .eq('id', payment_id)
      .limit(1)
      .maybeSingle()
    if (errRef) throw errRef
    ret = (refreshed as SalePayment) ?? null
  }
  setTimeout(__reloadDashboard, 50)
  return ret
}

export async function deleteSalePayment(payment_id: UUID): Promise<void> {
  if (!usingSupabase) { Demo.demoDeleteSalePayment(payment_id) }
  else {
    const { error } = await (supabase as any)
      .from('sale_payments')
      .delete()
      .eq('id', payment_id)
    if (error) throw error
  }
  setTimeout(__reloadDashboard, 50)
}

export interface RegistrarDespesaParams {
  description: string
  amount: number
  category?: 'SACOLAS' | 'EMBALAGEM' | 'ETIQUETAS' | 'PAPEL_SEDA' | 'PERFUMARIA' | 'MATERIAL' | 'FRETE' | 'MARKETING' | 'OUTROS' | string
  trans_date?: string
  payment_method?: string | null
  notes?: string | null
}

export async function registrarDespesa(p: RegistrarDespesaParams): Promise<{ id: UUID }> {
  const user_id = getCurrentUserId() ?? undefined
  if (!usingSupabase) {
    return Demo.demoRegistrarDespesa({ ...p, created_by: user_id ?? null }) as any
  }
  const sup: any = supabase
  const category = (p.category ?? 'OUTROS').toString().trim().toUpperCase()
  const { data, error } = await sup.rpc('registrar_despesa', {
    p_descricao: p.description.trim(),
    p_valor: Number((p.amount ?? 0).toFixed(2)),
    p_categoria: category,
    p_data: p.trans_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    p_forma_pagamento: p.payment_method?.trim()?.toUpperCase() || null,
    p_observacoes: p.notes?.trim() || null,
  })
  if (error) throw error
  return { id: data as UUID }
}

// =====================================================
// DASHBOARD — VIEWS OFICIAIS (SÓ LEITURA)
// v_dashboard_stock_summary / v_dashboard_sales / v_dashboard_financial
// Não há fallback para erros: erro real → throw.
// =====================================================
export async function dashboardStockSummary(): Promise<DashboardStockSummary> {
  if (!usingSupabase) return Demo.demoDashboardStockSummary()
  const sup: any = supabase
  const { data, error } = await sup
    .from('v_dashboard_stock_summary')
    .select('total_units, total_stock_cost, total_sales_potential, total_skus, out_of_stock_skus, in_stock_skus')
    .single()
  if (error) {
    console.error('[services.dashboardStockSummary] erro:', error)
    throw new Error(`Dashboard Estoque: ${error.message || String(error)}`)
  }
  const d: any = data ?? {}
  return {
    total_units: Number(d.total_units ?? 0),
    total_stock_cost: Number(d.total_stock_cost ?? 0),
    total_sales_potential: Number(d.total_sales_potential ?? 0),
    total_skus: Number(d.total_skus ?? 0),
    out_of_stock_skus: Number(d.out_of_stock_skus ?? 0),
    in_stock_skus: Number(d.in_stock_skus ?? 0),
  }
}

function addDay(dateStr: string): string {
  // Retorna YYYY-MM-DD acrescido de 1 dia, para usar lt em range de data
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
  dt.setDate(dt.getDate() + 1)
  const YYYY = dt.getFullYear()
  const MM = String(dt.getMonth() + 1).padStart(2, '0')
  const DD = String(dt.getDate()).padStart(2, '0')
  return `${YYYY}-${MM}-${DD}`
}

export interface DashboardDateRange {
  startInclusive: string // YYYY-MM-DD (inclusivo)
  endInclusive: string   // YYYY-MM-DD (inclusivo — query usará < endInclusive + 1 dia)
}

export async function dashboardSales(range: DashboardDateRange): Promise<DashboardSaleRow[]> {
  if (!usingSupabase) return Demo.demoDashboardSales(range)
  const sup: any = supabase
  const endExclusiveISO = addDay(range.endInclusive) + 'T00:00:00'
  const startISO = range.startInclusive + 'T00:00:00'
  const { data, error } = await sup
    .from('v_dashboard_sales')
    .select('*')
    .gte('sale_date', startISO)
    .lt('sale_date', endExclusiveISO)
    .order('sale_date', { ascending: false })
  if (error) {
    console.error('[services.dashboardSales] erro:', error, { startISO, endExclusiveISO })
    throw new Error(`Dashboard Vendas: ${error.message || String(error)}`)
  }
  return (data ?? []) as DashboardSaleRow[]
}

export async function dashboardFinancial(range: DashboardDateRange): Promise<DashboardFinancialRow[]> {
  if (!usingSupabase) return Demo.demoDashboardFinancial(range)
  const sup: any = supabase
  const endExclusiveISO = addDay(range.endInclusive) + 'T00:00:00'
  const startISO = range.startInclusive + 'T00:00:00'
  const { data, error } = await sup
    .from('v_dashboard_financial')
    .select('*')
    .gte('trans_date', startISO)
    .lt('trans_date', endExclusiveISO)
    .order('trans_date', { ascending: false })
  if (error) {
    console.error('[services.dashboardFinancial] erro:', error, { startISO, endExclusiveISO })
    throw new Error(`Dashboard Financeiro: ${error.message || String(error)}`)
  }
  return (data ?? []) as DashboardFinancialRow[]
}

/**
 * Resumo ATUAL do caixa operacional — NUNCA aplica filtro de data.
 * Consulta a view v_cash_eveline_summary (posição acumulada, inclui ajuste conciliação).
 */
export async function dashboardCashEvelineSummary(): Promise<DashboardCashSummary> {
  if (!usingSupabase) return Demo.demoDashboardCashEvelineSummary()
  const sup: any = supabase
  const { data, error } = await sup
    .from('v_cash_eveline_summary')
    .select('entradas, saidas, movimento_liquido, movimentos_nao_classificados')
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[services.dashboardCashEvelineSummary] erro:', error)
    throw new Error(`Caixa Eveline: ${error.message || String(error)}`)
  }
  const d: any = data ?? {}
  return {
    entradas: Number(d.entradas ?? 0),
    saidas: Number(d.saidas ?? 0),
    movimento_liquido: Number(d.movimento_liquido ?? 0),
    movimentos_nao_classificados: Number(d.movimentos_nao_classificados ?? 0),
  }
}

/**
 * Total de contas a receber GLOBAL (não filtrado por período).
 * Usa view v_dashboard_receivables se existir, senão faz soma via sales.
 */
export async function dashboardReceivablesTotal(): Promise<DashboardReceivablesTotal> {
  if (!usingSupabase) return Demo.demoDashboardReceivablesTotal()
  const sup: any = supabase
  try {
    const { data, error } = await sup
      .from('v_dashboard_receivables')
      .select('*')
    if (error) throw error
    const arr = (data ?? []) as any[]
    if (arr.length > 0 && arr[0].total_a_receber !== undefined) {
      const d: any = arr[0]
      return {
        total_a_receber: Number(d.total_a_receber ?? 0),
        vendas_pendentes_qtd: Number(d.vendas_pendentes_qtd ?? d.qtde ?? 0),
      }
    }
    const total = arr.reduce((s, r) => s + Number(r.amount_receivable ?? r.a_receber ?? 0), 0)
    return { total_a_receber: +total.toFixed(2), vendas_pendentes_qtd: arr.length || 0 }
  } catch (e: any) {
    console.warn('[services.dashboardReceivablesTotal] view v_dashboard_receivables falhou, usando fallback:', e?.message)
    const fallBack = await sup
      .from('sales')
      .select('total_customer, amount_received, status')
      .not('status', 'eq', 'CANCELADA' as any)
    if (fallBack.error) throw e ?? fallBack.error
    const rows: any[] = (fallBack.data ?? []) as any[]
    let total = 0
    let qtd = 0
    for (const r of rows) {
      const tot = Number(r.total_customer ?? 0)
      const rec = Number(r.amount_received ?? 0)
      const aReceber = +(tot - rec).toFixed(2)
      if (aReceber > 0.009) {
        total += aReceber
        qtd += 1
      }
    }
    return { total_a_receber: +total.toFixed(2), vendas_pendentes_qtd: qtd }
  }
}

export async function listSalePaymentsBySaleIds(saleIds: UUID[]): Promise<SalePayment[]> {
  if (!saleIds?.length) return []
  if (!usingSupabase) return Demo.demoListSalePaymentsBySaleIds(saleIds)
  const sup: any = supabase
  const { data, error } = await sup
    .from('sale_payments')
    .select('*')
    .in('sale_id', saleIds)
  if (error) {
    console.error('[services.listSalePaymentsBySaleIds] erro:', error)
    throw new Error(`Vendas por pagamento (query sale_payments): ${error.message || String(error)}`)
  }
  return (data ?? []) as SalePayment[]
}

export async function listSaleItemsBySaleIds(saleIds: UUID[]): Promise<SaleItem[]> {
  if (!saleIds?.length) return []
  if (!usingSupabase) return Demo.demoListSaleItemsBySaleIds(saleIds)
  const sup: any = supabase
  const { data, error } = await sup
    .from('sale_items')
    .select('*')
    .in('sale_id', saleIds)
  if (error) {
    console.error('[services.listSaleItemsBySaleIds] erro:', error)
    throw new Error(`Itens de venda (query sale_items): ${error.message || String(error)}`)
  }
  return (data ?? []) as SaleItem[]
}

export async function dashboardStock(): Promise<DashboardStockRow[]> {
  if (!usingSupabase) return Demo.demoDashboardStock()
  const sup: any = supabase
  const { data, error } = await sup
    .from('v_dashboard_stock')
    .select('*')
    .order('product_name')
  if (error) {
    console.error('[services.dashboardStock] erro:', error)
    throw new Error(`Dashboard Estoque (lista): ${error.message || String(error)}`)
  }
  const rows: DashboardStockRow[] = ((data ?? []) as any[]).map(d => ({
    product_id: d.product_id ?? d.id,
    sku: d.sku ?? null,
    product_name: d.product_name ?? d.name ?? null,
    category_name: d.category_name ?? d.category ?? null,
    image_url: d.image_url ?? null,
    units_available: Number(d.units_available ?? d.total_units ?? d.quantity_available ?? 0),
    stock_cost: Number(d.stock_cost ?? d.total_stock_cost ?? d.cost ?? 0),
    sales_potential: Number(d.sales_potential ?? d.total_sales_potential ?? 0),
    min_stock: d.min_stock !== undefined && d.min_stock !== null ? Number(d.min_stock) : null,
    active: d.active ?? true,
  }))
  return rows
}

// ================================================================
// INFINITEPAY — REPASSES
// ================================================================

export async function listAllInfinitePayReceivables(): Promise<InfinitePayReceivable[]> {
  if (!usingSupabase) return (Demo as any).demoListInfinitePayReceivables?.() ?? []
  const sup: any = supabase

  // ============================================================
  // MARCO DE ELEGIBILIDADE — Venda #43
  // Controle individual de repasses começa nesta venda.
  // Vendas anteriores foram incorporadas na conciliação histórica
  // e não podem reaparecer como "pendentes" só por falta de repasse individual.
  // ============================================================
  const SALE_43_ID = '2eec77bc-25a2-49f2-9ba7-e44c2b7d48e9'
  let marcoCreatedAt: Date | null = null
  try {
    const { data: marcoSale, error: errMarco } = await sup
      .from('sales')
      .select('id, created_at')
      .eq('id', SALE_43_ID)
      .limit(1)
      .maybeSingle()
    if (errMarco) {
      console.warn('[services.listAllInfinitePayReceivables] busca marco Venda #43 avisou:', errMarco?.message ?? errMarco)
    }
    if (marcoSale?.created_at) {
      marcoCreatedAt = new Date(String(marcoSale.created_at))
      if (Number.isNaN(marcoCreatedAt.getTime())) marcoCreatedAt = null
    }
  } catch (e: any) {
    console.warn('[services.listAllInfinitePayReceivables] busca marco Venda #43 falhou, prossegue sem filtro de marco (seguro, pior caso aparece tudo).', e?.message ?? e)
    marcoCreatedAt = null
  }

  const { data: ft, error: errFt } = await sup
    .from('financial_transactions')
    .select('id, related_sale_id, amount, trans_date, category, status, payment_source')
    .eq('category', 'REPASSE_INFINITEPAY')
    .eq('status', 'CONFIRMADO')
    .eq('payment_source', 'CAIXA_EVELINE')
  if (errFt) console.warn('[services.listAllInfinitePayReceivables] REPASSE query falhou:', errFt?.message ?? errFt)
  const repassesBySale = new Map<string, any>()
  if (Array.isArray(ft)) {
    for (const r of ft) {
      if (!r.related_sale_id) continue
      const prev = repassesBySale.get(String(r.related_sale_id))
      if (!prev || (r.amount ?? 0) > (prev.amount ?? 0)) repassesBySale.set(String(r.related_sale_id), r)
    }
  }

  const { data: payments, error: errSp } = await sup
    .from('sale_payments')
    .select('*')
  if (errSp) {
    console.error('[services.listAllInfinitePayReceivables] sale_payments query falhou:', errSp?.message ?? errSp)
    throw errSp
  }

  const allPayments: any[] = Array.isArray(payments) ? payments : []
  const ipPayments = allPayments.filter(sp => {
    const prov = String((sp as any).provider_snapshot ?? sp.provider ?? '').trim().toLowerCase()
    return prov.includes('infinite')
  })

  const saleIds = Array.from(new Set(ipPayments.map(sp => String(sp.sale_id)).filter(Boolean))) as UUID[]
  const salesMap = new Map<string, any>()
  if (saleIds.length > 0) {
    const { data: sales, error: errSl } = await sup
      .from('sales')
      .select('id, friendly_number, sale_date, customer_name, status, total_customer, created_at')
      .in('id', saleIds)
    if (errSl) console.warn('[services.listAllInfinitePayReceivables] sales query falhou:', errSl?.message ?? errSl)
    if (Array.isArray(sales)) for (const s of sales) salesMap.set(String(s.id), s)
  }

  const out: InfinitePayReceivable[] = []
  for (const sp of ipPayments) {
    const sale: any | undefined = salesMap.get(String(sp.sale_id))
    const isSale43 = String(sp.sale_id) === SALE_43_ID

    // ============================================================
    // REGRA 1 — ELEGIBILIDADE POR MARCO
    // Mantém fora: vendas LEGADAS anteriores à Venda #43 (conciliação histórica).
    // Preserva a própria Venda #43 mesmo se created_at dela vier com timezone zootécnico.
    // ============================================================
    if (!isSale43 && marcoCreatedAt) {
      const saleCreatedRaw = sale?.created_at ?? sp.created_at ?? null
      if (saleCreatedRaw) {
        const saleCreated = new Date(String(saleCreatedRaw))
        if (!Number.isNaN(saleCreated.getTime()) && saleCreated.getTime() < marcoCreatedAt.getTime()) {
          continue
        }
      }
    }

    // ============================================================
    // REGRA 2 — CLIENTE JÁ PAGOU
    // amount_received é o snapshot real do que caiu na InfinitePay no momento do pagamento.
    // Ignora 0 / nulo / pagamentos pendentes de captura.
    // ============================================================
    const amountReceived = Number((sp as any).amount_received ?? (sp as any).received_amount ?? (sp as any).amount ?? 0)
    if (!(amountReceived > 0)) continue

    const bruto = Number(sp.amount ?? 0)
    const taxa = Number((sp as any).fee_real_snapshot ?? (sp as any).fee_actual_snapshot ?? (sp as any).fee_expected_snapshot ?? 0)
    const liquido = Math.max(0, bruto - taxa)
    const rep = repassesBySale.get(String(sp.sale_id))
    out.push({
      sale_payment_id: sp.id,
      sale_id: sp.sale_id,
      sale_friendly_number: sale?.friendly_number ?? null,
      sale_date: sale?.sale_date ?? sp.trans_date ?? sp.created_at ?? null,
      customer_name: sale?.customer_name ?? null,
      provider_snapshot: (sp as any).provider_snapshot ?? null,
      method: sp.method ?? (sp as any).payment_method_snapshot ?? null,
      installments: Number((sp as any).installments_snapshot ?? sp.installments ?? 1),
      bruto,
      taxa_real: taxa,
      liquido,
      payment_created_at: sp.created_at ?? new Date().toISOString(),
      repasse_confirmado: !!rep,
      repasse_trans_id: rep?.id ?? null,
      repasse_amount: rep?.amount ?? null,
      repasse_date: rep?.trans_date ?? null,
    })
  }
  return out.sort((a, b) => new Date(b.payment_created_at).getTime() - new Date(a.payment_created_at).getTime())
}

export interface ConfirmRepasseParams {
  sale_payment_id: UUID;
  sale_id: UUID;
  amount_received: number;
  liquido_esperado: number;
  trans_date?: string;
  notes?: string;
}

export async function confirmRepasseInfinitePay(p: ConfirmRepasseParams): Promise<{ ok: boolean; idempotent?: boolean; blocked?: boolean; message: string; transacao_id?: UUID }> {
  if (!p || !(Number(p.amount_received) > 0)) return { ok: false, message: 'Valor recebido inválido.' }
  const amt = Number(p.amount_received)
  const dateStr = p.trans_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const iso = `${dateStr}T12:00:00.000Z`

  if (!usingSupabase) {
    return ((Demo as any).demoConfirmRepasseInfinitePay?.(p) ?? { ok: true, message: 'Repasse confirmado (modo demo).' })
  }

  const sup: any = supabase

  const { data: existing, error: errEx } = await sup
    .from('financial_transactions')
    .select('*')
    .eq('category', 'REPASSE_INFINITEPAY')
    .eq('related_sale_id', p.sale_id)
    .eq('status', 'CONFIRMADO')
    .eq('payment_source', 'CAIXA_EVELINE')
    .limit(1)
    .maybeSingle()
  if (errEx) console.warn('[services.confirmRepasseInfinitePay] checagem idempotência avisou:', errEx?.message ?? errEx)
  if (existing) return { ok: true, idempotent: true, message: 'Repasse já confirmado anteriormente (idempotente). Nenhuma duplicidade criada.', transacao_id: existing.id }

  // REGRA ANTI-DUPLICAÇÃO CRÍTICA:
  // Se a VENDA original já foi gravada com payment_source CAIXA_EVELINE,
  // o dinheiro já entrou no caixa na época da venda. CRIAR REPASSE agora DUPLICARIA o caixa.
  // Bloqueia e pede correção manual dessa venda legada.
  try {
    const { data: vendaOriginal } = await sup
      .from('financial_transactions')
      .select('id, category, trans_type, payment_source, amount, status')
      .eq('trans_type', 'ENTRADA')
      .eq('category', 'VENDA')
      .eq('related_sale_id', p.sale_id)
      .in_('payment_source', ['CAIXA_EVELINE'])
      .eq('status', 'CONFIRMADO')
      .limit(1)
      .maybeSingle()
    if (vendaOriginal) {
      return {
        ok: false,
        blocked: true,
        message: `BLOQUEIO ANTI-DUPLICAÇÃO: esta venda (R$ ${Number(vendaOriginal.amount).toFixed(2)}) já foi contabilizada direto em CAIXA_EVELINE no momento da venda. Confirmar repasse duplicaria o dinheiro em caixa. Se o dinheiro realmente caiu após a venda, a correção de dados históricos deve ser feita separadamente, NÃO por este botão.`
      }
    }
  } catch (e: any) {
    console.warn('[services.confirmRepasseInfinitePay] anti-duplicação query falhou, prosseguindo seguro:', e?.message ?? e)
  }

  const descArr = []
  descArr.push('Repasse InfinitePay')
  if (p.sale_id) descArr.push(`venda ${p.sale_id?.slice(0, 8)}`)
  if (p.liquido_esperado > 0 && Math.abs(amt - Number(p.liquido_esperado)) > 0.001) {
    descArr.push(`(diferença recebido ${amt.toFixed(2)} vs esperado ${Number(p.liquido_esperado).toFixed(2)})`)
  }
  const description = descArr.join(' · ')

  const payload: any = {
    trans_date: iso,
    trans_type: 'ENTRADA',
    category: 'REPASSE_INFINITEPAY',
    description,
    amount: amt,
    related_sale_id: p.sale_id,
    payment_source: 'CAIXA_EVELINE',
    status: 'CONFIRMADO',
    payment_method: 'TRANSFERENCIA',
    notes: p.notes?.trim() || null,
  }

  const { data: inserted, error: errIns } = await sup
    .from('financial_transactions')
    .insert(payload)
    .select('*')
    .single()
  if (errIns) {
    console.error('[services.confirmRepasseInfinitePay] insert falhou:', errIns)
    return { ok: false, message: `Erro ao registrar repasse: ${errIns?.message ?? String(errIns)}` }
  }

  setTimeout(__reloadDashboard, 50)
  return { ok: true, message: `Repasse de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amt)} registrado com sucesso.`, transacao_id: inserted?.id }
}
