export type UUID = string;

export type Money = number;

export type SaleSource = 'SITE' | 'PRESENCIAL' | 'DISTANCIA' | 'OUTRO';
export type SaleStatus = 'PENDENTE' | 'CONCLUIDA' | 'CANCELADA' | 'REEMBOLSADA' | 'PARCIAL';
export type PaymentMethod = 'PIX' | 'CREDITO' | 'DEBITO' | 'BOLETO' | 'DINHEIRO' | 'OUTRO';
export type MovementType = 'ENTRADA' | 'SAIDA' | 'AJUSTE_POS' | 'AJUSTE_NEG' | 'PERDA' | 'DEVOLUCAO';
export type TransType = 'ENTRADA' | 'SAIDA';
export type TransCategory =
  | 'VENDA'
  | 'COMPRA_ESTOQUE'
  | 'FRETE'
  | 'TAXA'
  | 'EMBALAGEM'
  | 'ENTREGA'
  | 'OUTRA_RECEITA'
  | 'OUTRA_DESPESA';

export interface Profile {
  id: UUID;
  full_name?: string | null;
  role: 'admin' | 'owner' | 'staff';
  phone?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: UUID;
  name: string;
  slug?: string | null;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: UUID;
  sku?: string | null;
  name: string;
  slug?: string | null;
  category_id?: UUID | null;
  default_packaging_type_id?: UUID | null;
  current_cost: Money;
  sale_price: Money;
  min_stock: number;
  image_url?: string | null;
  notes?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  // campos da VIEW products_with_stock (aliases para compatibilidade)
  total_stock?: number;
  stock_quantity?: number;
  weighted_cost?: Money;
  weighted_average_cost?: Money;
  available_stock?: number;
  reserved_stock?: number;
}

export interface ProductVariant {
  id: UUID;
  product_id: UUID;
  color?: string | null;
  size?: string | null;
  sku?: string | null;
  current_cost: Money;
  sale_price: Money;
  stock: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PackagingComponent {
  id: UUID;
  name: string;
  cost: Money;
  created_at: string;
  updated_at: string;
}

export interface PackagingType {
  id: UUID;
  name: string;
  code?: string | null;
  components?: any[] | null;
  unit_cost: Money;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentProvider {
  id: UUID;
  name: string;
  code: string;
  active: boolean;
  created_at: string;
}

export interface PaymentModality {
  id: UUID;
  provider_id: UUID;
  name: string;
  code: string;
  active: boolean;
  created_at: string;
}

export interface PaymentFeeRule {
  id: UUID;
  provider_id: UUID;
  modality_id?: UUID | null;
  method: PaymentMethod;
  installments: number;
  receipt_term?: string | null;
  revenue_tier?: string | null;
  brand?: string | null;
  fee_percent: Money;
  fixed_fee: Money;
  valid_from: string;
  valid_until?: string | null;
  created_at: string;
}

export interface Coupon {
  id: UUID;
  code: string;
  description?: string | null;
  type: 'PERCENT' | 'FIXED';
  value: Money;
  max_discount?: Money | null;
  min_order_value?: Money | null;
  usage_limit?: number | null;
  usage_count: number;
  valid_from?: string | null;
  valid_until?: string | null;
  active: boolean;
  created_at: string;
}

export interface InventoryBatch {
  id: UUID;
  product_id: UUID;
  variant_id?: UUID | null;
  purchase_entry_id?: UUID | null;
  purchase_item_id?: UUID | null;
  unit_cost: Money;
  allocated_purchase_cost: Money;
  quantity_received: number;
  quantity_available: number;
  received_at: string;
  created_at: string;
}

export interface InventoryMovement {
  id: UUID;
  product_id: UUID;
  variant_id?: UUID | null;
  batch_id?: UUID | null;
  movement_type: MovementType;
  reason: string;
  quantity: number;
  unit_cost?: Money | null;
  related_sale_id?: UUID | null;
  related_purchase_id?: UUID | null;
  created_by?: UUID | null;
  notes?: string | null;
  created_at: string;
}

export interface PurchaseEntry {
  id: UUID;
  entry_date: string;
  supplier?: string | null;
  origin?: string | null;
  items_total: Money;
  shipping_cost: Money;
  other_costs: Money;
  total_cost: Money;
  cost_allocation_method: 'quantity' | 'value' | 'none';
  notes?: string | null;
  created_by?: UUID | null;
  created_at: string;
}

export interface PurchaseEntryItem {
  id: UUID;
  purchase_entry_id: UUID;
  product_id?: UUID | null;
  product_snapshot: string;
  unit_cost: Money;
  quantity: number;
  line_total: Money;
  allocated_share: Money;
  effective_cost: Money;
  created_at: string;
}

export interface PurchaseCost {
  id: UUID;
  purchase_entry_id?: UUID | null;
  description: string;
  category?: string | null;
  amount: Money;
  created_at: string;
}

export interface Sale {
  id: UUID;
  friendly_number: number;
  sale_date: string;
  status: SaleStatus;
  source: SaleSource;
  customer_name?: string | null;
  customer_phone?: string | null;
  items_subtotal: Money;
  product_discounts: Money;
  general_discount: Money;
  coupon_discount: Money;
  pix_discount: Money;
  total_discounts: Money;
  total_customer: Money;
  packaging_cost: Money;
  extra_costs: Money;
  items_cost: Money;
  allocated_purchase_cost: Money;
  fee_expected: Money;
  fee_actual: Money;
  real_profit: Money;
  real_margin: Money;
  coupon_id?: UUID | null;
  coupon_snapshot?: string | null;
  cancel_reason?: string | null;
  cancelled_by?: UUID | null;
  cancelled_at?: string | null;
  created_by?: UUID | null;
  created_at: string;
  updated_at: string;

  // snapshots e totais calculados (compatibilidade)
  total_items?: number;
  items_count?: number;
  cogs_total?: Money;
  shipping_cost_snapshot?: Money;
  extra_costs_total?: Money;
  fee_expected_total?: Money;
  fee_actual_total?: Money;
  packaging_cost_actual?: Money;
  packaging_cost_snapshot?: Money;
  source_snapshot?: SaleSource | string | null;
  payment_provider_snapshot?: string | null;
  payment_modality_snapshot?: string | null;
  payment_method_snapshot?: PaymentMethod | string | null;
  installments_snapshot?: number;
  coupon_discount_snapshot?: Money;
  pix_discount_total?: Money;
  can_cancel?: boolean;
  cancelled?: boolean;
}

export interface SaleItem {
  id: UUID;
  sale_id: UUID;
  product_id?: UUID | null;
  variant_id?: UUID | null;
  product_name_snapshot: string;
  variant_snapshot?: string | null;
  sku_snapshot?: string | null;
  quantity: number;
  unit_cost_snapshot: Money;
  allocated_purchase_cost_snapshot: Money;
  unit_sale_price_snapshot: Money;
  unit_actual_price: Money;
  discount: Money;
  total: Money;
  batch_ids_used?: UUID[] | null;
  created_at: string;
}

export interface SalePayment {
  id: UUID;
  sale_id: UUID;
  provider_id?: UUID | null;
  modality_id?: UUID | null;
  method: PaymentMethod;
  installments: number;
  provider_snapshot?: string | null;
  modality_snapshot?: string | null;
  fee_rule_id?: UUID | null;
  fee_percent_snapshot: Money;
  fee_expected_snapshot: Money;
  fee_real_snapshot: Money;
  amount: Money;
  trans_date?: string;
  notes?: string | null;
  notes_snapshot?: string | null;
  installments_snapshot?: number;
  created_at: string;
  updated_at?: string;
}

export interface SalePackaging {
  id: UUID;
  sale_id: UUID;
  packaging_type_id?: UUID | null;
  tipo_snapshot?: string | null;
  custo_snapshot: Money;
  custom_cost?: Money | null;
  is_free: boolean;
  created_at: string;
}

export interface SaleCost {
  id: UUID;
  sale_id: UUID;
  description: string;
  category?: string | null;
  amount: Money;
  created_at: string;
}

export interface FinancialTransaction {
  id: UUID;
  trans_date: string;
  trans_type: TransType;
  category: TransCategory | string;
  description: string;
  amount: Money;
  related_sale_id?: UUID | null;
  related_purchase_id?: UUID | null;
  payment_method?: string | null;
  status: 'PENDENTE' | 'CONFIRMADO' | 'CANCELADO';
  due_date?: string | null;
  created_by?: UUID | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Setting {
  id: UUID;
  key: string;
  value: any;
  description?: string | null;
  updated_at: string;
}

export interface AuditLog {
  id: UUID;
  user_id?: UUID | null;
  action: string;
  entity: string;
  entity_id?: UUID | null;
  metadata?: any;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      categories: { Row: Category; Insert: Partial<Category>; Update: Partial<Category> };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product> };
      product_variants: { Row: ProductVariant; Insert: Partial<ProductVariant>; Update: Partial<ProductVariant> };
      packaging_components: { Row: PackagingComponent; Insert: Partial<PackagingComponent>; Update: Partial<PackagingComponent> };
      packaging_types: { Row: PackagingType; Insert: Partial<PackagingType>; Update: Partial<PackagingType> };
      payment_providers: { Row: PaymentProvider; Insert: Partial<PaymentProvider>; Update: Partial<PaymentProvider> };
      payment_modalities: { Row: PaymentModality; Insert: Partial<PaymentModality>; Update: Partial<PaymentModality> };
      payment_fee_rules: { Row: PaymentFeeRule; Insert: Partial<PaymentFeeRule>; Update: Partial<PaymentFeeRule> };
      coupons: { Row: Coupon; Insert: Partial<Coupon>; Update: Partial<Coupon> };
      inventory_batches: { Row: InventoryBatch; Insert: Partial<InventoryBatch>; Update: Partial<InventoryBatch> };
      inventory_movements: { Row: InventoryMovement; Insert: Partial<InventoryMovement>; Update: Partial<InventoryMovement> };
      purchase_entries: { Row: PurchaseEntry; Insert: Partial<PurchaseEntry>; Update: Partial<PurchaseEntry> };
      purchase_entry_items: { Row: PurchaseEntryItem; Insert: Partial<PurchaseEntryItem>; Update: Partial<PurchaseEntryItem> };
      purchase_costs: { Row: PurchaseCost; Insert: Partial<PurchaseCost>; Update: Partial<PurchaseCost> };
      sales: { Row: Sale; Insert: Partial<Sale>; Update: Partial<Sale> };
      sale_items: { Row: SaleItem; Insert: Partial<SaleItem>; Update: Partial<SaleItem> };
      sale_payments: { Row: SalePayment; Insert: Partial<SalePayment>; Update: Partial<SalePayment> };
      sale_packaging: { Row: SalePackaging; Insert: Partial<SalePackaging>; Update: Partial<SalePackaging> };
      sale_costs: { Row: SaleCost; Insert: Partial<SaleCost>; Update: Partial<SaleCost> };
      financial_transactions: { Row: FinancialTransaction; Insert: Partial<FinancialTransaction>; Update: Partial<FinancialTransaction> };
      settings: { Row: Setting; Insert: Partial<Setting>; Update: Partial<Setting> };
      audit_logs: { Row: AuditLog; Insert: Partial<AuditLog> };
    };
    Views: {
      products_with_stock: { Row: Product };
    };
    Functions: {
      get_admin_role: { Args: { p_user_id: UUID }; Returns: string };
      finalize_sale: {
        Args: {
          p_source: string;
          p_items: any;
          p_general_discount?: number;
          p_coupon_id?: UUID | null;
          p_coupon_code?: string | null;
          p_pix_discount?: number;
          p_payment?: any;
          p_packaging?: any;
          p_extra_costs?: any;
          p_customer_name?: string | null;
          p_customer_phone?: string | null;
          p_user_id?: UUID | null;
        };
        Returns: any;
      };
      cancel_sale: {
        Args: { p_sale_id: UUID; p_reason: string; p_user_id: UUID | null };
        Returns: any;
      };
      create_purchase_entry: {
        Args: {
          p_entry_date?: string | null;
          p_supplier?: string | null;
          p_origin?: string | null;
          p_cost_allocation_method?: string;
          p_items?: any;
          p_shipping_cost?: number;
          p_other_costs?: any;
          p_notes?: string | null;
          p_user_id?: UUID | null;
        };
        Returns: any;
      };
    };
  };
}

export interface DashboardStockSummary {
  total_units: number
  total_stock_cost: number
  total_sales_potential: number
  total_skus: number
  out_of_stock_skus: number
}

export interface DashboardSaleRow {
  sale_id?: UUID | string
  sale_date: string
  revenue: number
  pieces_sold: number
  amount_received: number
  amount_receivable: number
  payment_fees: number
  items_cost: number
  allocated_purchase_cost?: number
  packaging_cost: number
  extra_costs: number
  total_discounts: number
  friendly_number?: number | null
  customer_name?: string | null
  source_snapshot?: string | null
  status?: string | null
  payment_method_snapshot?: string | null
  payment_provider_snapshot?: string | null
  installments_snapshot?: number | null
  real_profit?: number
  total_customer?: number
  total_items?: number
}

export interface DashboardFinancialRow {
  financial_transaction_id?: UUID | string
  trans_date: string
  trans_type: 'ENTRADA' | 'SAIDA' | string
  status: 'PENDENTE' | 'CONFIRMADO' | 'CANCELADO' | string
  amount: number
  category?: string | null
  description?: string | null
  payment_method?: string | null
}
