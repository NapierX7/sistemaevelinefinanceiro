import {
  isSupabaseConfigured, supabase, getCurrentUserId,
} from '@/lib/supabase'
import * as Demo from './demo-storage'
import type { UUID, Product, Category, Sale, SaleItem, SalePayment, SalePackaging, SaleCost, PurchaseEntry, FinancialTransaction, InventoryMovement, InventoryBatch, PaymentFeeRule, PackagingType, Coupon, Setting, PaymentProvider, PaymentModality } from '@/types/supabase'

// ================================================================
// CAMADA UNIFICADA DE DADOS
// Escolhe automaticamente entre SUPABASE (se configurado) ou MODO DEMO (localStorage).
// ================================================================

export const usingSupabase = isSupabaseConfigured && supabase !== null

export async function listProducts(): Promise<Product[]> {
  if (!usingSupabase) return Demo.demoListProducts()
  const { data } = await (supabase!)
    .from('products_with_stock')
    .select('*')
    .eq('active', true)
    .order('name')
  return (data as Product[]) ?? []
}

export async function listAllProducts(includeInactive = false): Promise<Product[]> {
  if (!usingSupabase) return Demo.demoListProducts()
  let q = (supabase!).from('products_with_stock').select('*')
  if (!includeInactive) q = q.eq('active', true)
  const { data } = await q.order('name')
  return (data as Product[]) ?? []
}

export async function getProduct(id: UUID): Promise<Product | null> {
  if (!usingSupabase) return Demo.demoListProducts().find(p => p.id === id) ?? null
  const { data } = await (supabase as any).from('products_with_stock').select('*').eq('id', id).maybeSingle()
  return (data as Product | null) ?? null
}

export async function createProduct(p: Partial<Product>): Promise<Product> {
  if (!usingSupabase) return Demo.demoCreateProduct(p)
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
  return data as Product
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

export async function finalizeSale(p: FinalizeSaleParams) {
  const userId = getCurrentUserId()
  if (!usingSupabase) {
    return Demo.demoFinalizeSale({ ...p, user_id: userId ?? undefined } as any)
  }
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
    } as any) : null,
    p_packaging: p.packaging as any ?? null,
    p_extra_costs: (p.extra_costs ?? []) as any,
    p_customer_name: p.customer_name ?? null,
    p_customer_phone: p.customer_phone ?? null,
    p_user_id: userId ?? null,
  })
  if (error) throw error
  return data
}

export async function cancelSale(sale_id: UUID, reason: string) {
  const userId = getCurrentUserId()
  if (!usingSupabase) return Demo.demoCancelSale(sale_id, reason, userId ?? undefined)
  const { data, error } = await (supabase as any).rpc('cancel_sale', {
    p_sale_id: sale_id,
    p_reason: reason,
    p_user_id: userId ?? null,
  })
  if (error) throw error
  return data
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
}

export async function createPurchase(p: CreatePurchaseParams) {
  const userId = getCurrentUserId()
  if (!usingSupabase) return Demo.demoCreatePurchaseEntry({ ...p, user_id: userId ?? undefined })
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
  })
  if (error) throw error
  return data
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
  let q = (supabase!).from('inventory_batches').select('*')
  if (product_id) q = q.eq('product_id', product_id)
  const { data } = await q.order('received_at', { ascending: false })
  return (data as InventoryBatch[]) ?? []
}
