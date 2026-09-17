-- ============================================================
-- EVELINE GESTÃO — SUPABASE SCHEMA (V1)
-- Objetivo: Substituir a planilha financeira da loja Eveline.
-- Stack: PostgreSQL + Supabase Auth + RLS
-- Regra financeira: Tudo monetário usa NUMERIC(não FLOAT).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA public;

-- ============================================================
-- 1. PROFILES (extensão de auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','owner','staff')),
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (auth.uid() = id OR (auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Trigger copia dados do auth.users para profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)), 'admin', NEW.raw_user_meta_data ->> 'phone')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RPC: verificar perfil admin (usado no login)
CREATE OR REPLACE FUNCTION public.get_admin_role(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  r TEXT;
BEGIN
  SELECT role INTO r FROM public.profiles WHERE id = p_user_id LIMIT 1;
  RETURN COALESCE(r, 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 2. CATEGORIAS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categories para usuários autenticados" ON public.categories FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 3. PRODUTOS + VARIANTES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT,
  name TEXT NOT NULL,
  slug TEXT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  default_packaging_type_id UUID,
  current_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Products para usuários autenticados" ON public.products FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color TEXT,
  size TEXT,
  sku TEXT,
  current_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Variants para usuários autenticados" ON public.product_variants FOR ALL USING (auth.role() = 'authenticated');

-- NOTA: A VIEW products_with_stock DEPENDE de inventory_batches.
-- Ela é criada MAIS TARDE, APÓS a seção 6 (lotes + movimentos), para
-- evitar "relation does not exist" na primeira execução do schema.

-- ============================================================
-- 4. EMBALAGENS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.packaging_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.packaging_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Packaging components para auth" ON public.packaging_components FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.packaging_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- "Sacola Grande", "Sacola Pequena", "Sem embalagem", "Outra"
  code TEXT, -- GRANDE, PEQUENA, NENHUMA, OUTRA
  components JSONB DEFAULT '[]'::jsonb, -- [{component_id, qty}]
  unit_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.packaging_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Packaging types para auth" ON public.packaging_types FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 5. COMPRAS / ENTRADAS DE MERCADORIA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchase_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier TEXT,
  origin TEXT,
  items_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_allocation_method TEXT NOT NULL DEFAULT 'quantity' CHECK (cost_allocation_method IN ('quantity','value','none')),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Purchase entries para auth" ON public.purchase_entries FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.purchase_entry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_entry_id UUID NOT NULL REFERENCES public.purchase_entries(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_snapshot TEXT NOT NULL,
  unit_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  allocated_share NUMERIC(12,4) NOT NULL DEFAULT 0,
  effective_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_entry_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Purchase items para auth" ON public.purchase_entry_items FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.purchase_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_entry_id UUID REFERENCES public.purchase_entries(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT, -- FRETE, GASOLINA, ESTACIONAMENTO, OUTRO
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Purchase costs para auth" ON public.purchase_costs FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 6. LOTES DE ESTOQUE (FIFO) + MOVIMENTAÇÕES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  purchase_entry_id UUID REFERENCES public.purchase_entries(id) ON DELETE SET NULL,
  purchase_item_id UUID REFERENCES public.purchase_entry_items(id) ON DELETE SET NULL,
  unit_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  allocated_purchase_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Batches para auth" ON public.inventory_batches FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_batches_fifo ON public.inventory_batches (product_id, received_at, id);
-- Obs: antes era partial WHERE quantity_available > 0.
-- Motivo da alteração: Supabase Cloud em algumas versões reporta
-- erro 42P17 "predicate must be IMMUTABLE" mesmo com coluna INTEGER.
-- Indexar a tabela toda não tem impacto perceptível e é 100% compatível.

-- ============================================================
-- 6b. VIEW products_with_stock (AGORA APÓS inventory_batches EXISTIR)
-- ============================================================
CREATE OR REPLACE VIEW public.products_with_stock AS
SELECT p.*,
  COALESCE((SELECT SUM(b.quantity_available) FROM public.inventory_batches b WHERE b.product_id = p.id), 0) AS total_stock,
  COALESCE((SELECT ROUND(AVG(b.unit_cost),4) FROM public.inventory_batches b WHERE b.product_id = p.id AND b.quantity_available > 0), p.current_cost) AS weighted_cost
FROM public.products p;

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('ENTRADA','SAIDA','AJUSTE_POS','AJUSTE_NEG','PERDA','DEVOLUCAO')),
  reason TEXT NOT NULL, -- COMPRA, VENDA, AJUSTE, PERDA, DEVOLUCAO_CLIENTE, CANCELAMENTO_VENDA
  quantity INTEGER NOT NULL,
  unit_cost NUMERIC(12,4),
  related_sale_id UUID,
  related_purchase_id UUID,
  created_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Movimentos para auth" ON public.inventory_movements FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 7. PAGAMENTOS: PROVIDERS, MODALIDADES, REGRAS DE TAXA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- "Mercado Pago", "InfinitePay", "Pix Direto"
  code TEXT UNIQUE NOT NULL, -- MERCADO_PAGO, INFINITEPAY, PIX_DIRETO
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Providers para auth" ON public.payment_providers FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.payment_modalities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.payment_providers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- "Checkout", "InfiniteTap / Maquininha", "Link de Pagamento"
  code TEXT NOT NULL, -- CHECKOUT, TAP, LINK, DIRETO
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id, code)
);
ALTER TABLE public.payment_modalities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Modalidades para auth" ON public.payment_modalities FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.payment_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.payment_providers(id) ON DELETE CASCADE,
  modality_id UUID REFERENCES public.payment_modalities(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('PIX','CREDITO','DEBITO','BOLETO','OUTRO')),
  installments INTEGER NOT NULL DEFAULT 1, -- 1=à vista, 2..12
  receipt_term TEXT, -- "1 dia útil", "30 dias", etc.
  revenue_tier TEXT, -- Plano / faixa
  brand TEXT, -- bandeira (opcional)
  fee_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
  fixed_fee NUMERIC(12,4) NOT NULL DEFAULT 0,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_fee_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fee rules para auth" ON public.payment_fee_rules FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_fee_lookup ON public.payment_fee_rules (provider_id, modality_id, method, installments, valid_until);
-- Obs: antes era partial com WHERE valid_until IS NULL OR valid_until >= CURRENT_DATE.
-- Motivo da alteração: CURRENT_DATE é função STABLE (não IMMUTABLE),
-- acionando o erro 42P17 "functions in index predicate must be marked IMMUTABLE"
-- no Supabase Cloud. Solução: índice completo incluindo valid_until como última
-- coluna; as consultas continuam performáticas e compatíveis.

-- ============================================================
-- 8. CUPONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('PERCENT','FIXED')),
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_discount NUMERIC(12,2),
  min_order_value NUMERIC(12,2),
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  valid_from DATE,
  valid_until DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coupons para auth" ON public.coupons FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 9. VENDAS (coração financeiro — NUNCA DELETAR, só status)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  friendly_number SERIAL,
  sale_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','CONCLUIDA','CANCELADA','REEMBOLSADA','PARCIAL')),
  source TEXT NOT NULL CHECK (source IN ('SITE','PRESENCIAL','DISTANCIA','OUTRO')),
  customer_name TEXT,
  customer_phone TEXT,
  items_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  product_discounts NUMERIC(12,2) NOT NULL DEFAULT 0,
  general_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  coupon_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  pix_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_discounts NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_customer NUMERIC(12,2) NOT NULL DEFAULT 0,
  packaging_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  extra_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  items_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  allocated_purchase_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  fee_expected NUMERIC(12,4) NOT NULL DEFAULT 0,
  fee_actual NUMERIC(12,4) NOT NULL DEFAULT 0,
  real_profit NUMERIC(12,4) NOT NULL DEFAULT 0,
  real_margin NUMERIC(8,4) NOT NULL DEFAULT 0,
  coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  coupon_snapshot TEXT,
  cancel_reason TEXT,
  cancelled_by UUID REFERENCES public.profiles(id),
  cancelled_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendas para auth" ON public.sales FOR ALL USING (auth.role() = 'authenticated');
CREATE INDEX IF NOT EXISTS idx_sales_date ON public.sales (sale_date DESC);

CREATE SEQUENCE IF NOT EXISTS public.sales_friendly_number_seq START WITH 1;
ALTER TABLE public.sales ALTER COLUMN friendly_number SET DEFAULT nextval('public.sales_friendly_number_seq'::regclass);

-- itens da venda com SNAPSHOTS OBRIGATÓRIOS (requisito 27 do PDF)
CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_snapshot TEXT,
  sku_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0,
  allocated_purchase_cost_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit_sale_price_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_actual_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  batch_ids_used UUID[] DEFAULT '{}'::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sale items para auth" ON public.sale_items FOR ALL USING (auth.role() = 'authenticated');

-- pagamentos (uma venda pode ter múltiplos pagamentos? vamos permitir)
CREATE TABLE IF NOT EXISTS public.sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.payment_providers(id) ON DELETE SET NULL,
  modality_id UUID REFERENCES public.payment_modalities(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('PIX','CREDITO','DEBITO','BOLETO','DINHEIRO','OUTRO')),
  installments INTEGER NOT NULL DEFAULT 1,
  provider_snapshot TEXT,
  modality_snapshot TEXT,
  fee_rule_id UUID,
  fee_percent_snapshot NUMERIC(8,4) NOT NULL DEFAULT 0,
  fee_expected_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0,
  fee_real_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sale payments para auth" ON public.sale_payments FOR ALL USING (auth.role() = 'authenticated');

-- embalagem usada na venda (com snapshot)
CREATE TABLE IF NOT EXISTS public.sale_packaging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID UNIQUE NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  packaging_type_id UUID REFERENCES public.packaging_types(id) ON DELETE SET NULL,
  tipo_snapshot TEXT,
  custo_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0,
  custom_cost NUMERIC(12,4),
  is_free BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_packaging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sale packaging para auth" ON public.sale_packaging FOR ALL USING (auth.role() = 'authenticated');

-- custos extras da venda
CREATE TABLE IF NOT EXISTS public.sale_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT, -- ENTREGA, MOTOBOY, EMBALAGEM_ESPECIAL, OUTRO
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sale costs para auth" ON public.sale_costs FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 10. MOVIMENTOS FINANCEIROS (Caixa — NÃO MISTURA COM LUCRO)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trans_date DATE NOT NULL DEFAULT CURRENT_DATE,
  trans_type TEXT NOT NULL CHECK (trans_type IN ('ENTRADA','SAIDA')),
  category TEXT NOT NULL, -- VENDA, COMPRA_ESTOQUE, FRETE, TAXA, EMBALAGEM, ENTREGA, OUTRA_RECEITA, OUTRA_DESPESA
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  related_sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  related_purchase_id UUID REFERENCES public.purchase_entries(id) ON DELETE SET NULL,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMADO' CHECK (status IN ('PENDENTE','CONFIRMADO','CANCELADO')),
  due_date DATE,
  created_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Transacoes financeiras para auth" ON public.financial_transactions FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 11. CONFIGURAÇÕES GERAIS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Settings para auth" ON public.settings FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 12. AUDITORIA (financeiro: regista ações críticas)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- CREATE, UPDATE, DELETE, CANCEL, FINALIZE
  entity TEXT NOT NULL, -- SALE, PRODUCT, STOCK, FEE_RULE, PURCHASE, COST
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit logs select insert" ON public.audit_logs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Audit logs insert" ON public.audit_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 13. SEED INICIAL (REQUISITO 4 DO PDF: PRODUTOS EXISTENTES)
-- ============================================================
INSERT INTO public.categories (name, slug) VALUES
  ('Vestidos','vestidos'),
  ('Blusas','blusas'),
  ('Calças','calcas'),
  ('Conjuntos','conjuntos'),
  ('Regatas','regatas')
ON CONFLICT (slug) DO NOTHING;

-- Embalagens (requisito 7)
INSERT INTO public.packaging_components (name, cost) VALUES
  ('Sacola Grande', 7.50),
  ('Sacola Pequena', 6.30),
  ('Lacre', 0.043),
  ('Etiqueta', 0.62),
  ('Adesivo', 0.15)
ON CONFLICT DO NOTHING;

INSERT INTO public.packaging_types (name, code, unit_cost, is_default) VALUES
  ('Sacola Grande', 'GRANDE', 8.313, false),
  ('Sacola Pequena', 'PEQUENA', 7.113, true),
  ('Sem embalagem', 'NENHUMA', 0.00, false),
  ('Outra', 'OUTRA', 0.00, false)
ON CONFLICT DO NOTHING;

-- Pagamentos (requisitos 14,15,16,17)
INSERT INTO public.payment_providers (name, code) VALUES
  ('Mercado Pago', 'MERCADO_PAGO'),
  ('InfinitePay', 'INFINITEPAY'),
  ('Pix Direto', 'PIX_DIRETO')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.payment_modalities (provider_id, name, code)
SELECT id, 'Checkout', 'CHECKOUT' FROM public.payment_providers WHERE code = 'MERCADO_PAGO'
ON CONFLICT DO NOTHING;
INSERT INTO public.payment_modalities (provider_id, name, code)
SELECT id, 'InfiniteTap / Maquininha', 'TAP' FROM public.payment_providers WHERE code = 'INFINITEPAY'
ON CONFLICT DO NOTHING;
INSERT INTO public.payment_modalities (provider_id, name, code)
SELECT id, 'Link de Pagamento', 'LINK' FROM public.payment_providers WHERE code = 'INFINITEPAY'
ON CONFLICT DO NOTHING;
INSERT INTO public.payment_modalities (provider_id, name, code)
SELECT id, 'Direto', 'DIRETO' FROM public.payment_providers WHERE code = 'PIX_DIRETO'
ON CONFLICT DO NOTHING;

-- Taxas de referência (podem ser editadas na tela de configurações)
-- InfinitePay Link: taxa pública aproximada — todas podem ser ajustadas
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'PIX', 1, '1 dia útil', 'Plano atual', 1.49
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='LINK' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='PIX' AND fr.installments=1 AND fr.valid_until IS NULL
);

INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'CREDITO', 1, '1 dia útil', 'Plano atual', 4.99
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='LINK' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='CREDITO' AND fr.installments=1 AND fr.valid_until IS NULL
);
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'CREDITO', 2, '1 dia útil', 'Plano atual', 6.09
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='LINK' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='CREDITO' AND fr.installments=2 AND fr.valid_until IS NULL
);
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'CREDITO', 3, '1 dia útil', 'Plano atual', 7.19
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='LINK' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='CREDITO' AND fr.installments=3 AND fr.valid_until IS NULL
);
-- InfiniteTap (maquininha): taxas diferentes
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'PIX', 1, '1 dia útil', 'Plano atual', 0.99
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='TAP' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='PIX' AND fr.installments=1 AND fr.valid_until IS NULL
);
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'DEBITO', 1, '1 dia útil', 'Plano atual', 1.89
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='TAP' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='DEBITO' AND fr.installments=1 AND fr.valid_until IS NULL
);
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'CREDITO', 1, '1 dia útil', 'Plano atual', 3.79
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='TAP' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='CREDITO' AND fr.installments=1 AND fr.valid_until IS NULL
);
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'CREDITO', 2, '1 dia útil', 'Plano atual', 4.89
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='INFINITEPAY' AND m.code='TAP' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='CREDITO' AND fr.installments=2 AND fr.valid_until IS NULL
);
-- Mercado Pago Checkout: aproximado
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'PIX', 1, '24h', 'Plano atual', 0.99
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='MERCADO_PAGO' AND m.code='CHECKOUT' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='PIX' AND fr.installments=1 AND fr.valid_until IS NULL
);
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'CREDITO', 1, '14 dias', 'Plano atual', 4.49
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='MERCADO_PAGO' AND m.code='CHECKOUT' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='CREDITO' AND fr.installments=1 AND fr.valid_until IS NULL
);
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'CREDITO', 2, '14 dias', 'Plano atual', 5.49
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='MERCADO_PAGO' AND m.code='CHECKOUT' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='CREDITO' AND fr.installments=2 AND fr.valid_until IS NULL
);
-- Pix Direto: taxa 0
INSERT INTO public.payment_fee_rules
  (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent)
SELECT p.id, m.id, 'PIX', 1, 'Instantâneo', 'N/A', 0
FROM public.payment_providers p, public.payment_modalities m
WHERE p.code='PIX_DIRETO' AND m.code='DIRETO' AND NOT EXISTS (
  SELECT 1 FROM public.payment_fee_rules fr WHERE fr.provider_id=p.id AND fr.modality_id=m.id AND fr.method='PIX' AND fr.installments=1 AND fr.valid_until IS NULL
);

-- Configuração Desconto Pix (requisito 18)
INSERT INTO public.settings (key, value, description) VALUES
  ('pix_discount_enabled', true::jsonb, 'Habilita/desabilita desconto Pix à vista'),
  ('pix_discount_percent', '10'::jsonb, 'Percentual de desconto Pix à vista (padrão: 10%)')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 14. SEED: PRODUTOS INICIAIS DA PLANILHA (requisito 4)
-- ============================================================
INSERT INTO public.products (sku, name, slug, category_id, current_cost, sale_price, default_packaging_type_id)
SELECT
  seed.sku, seed.name, seed.slug, c.id, seed.cost, seed.price, pt.id
FROM (VALUES
  ('REGATA-001', 'Regata alça fina', 'regata-alca-fina', 'regatas', 25.00, 69.90, 'PEQUENA'),
  ('VESTIDO-001', 'Vestido longo amarelo', 'vestido-longo-amarelo', 'vestidos', 59.90, 189.90, 'GRANDE'),
  ('CALCA-001', 'Calça pantalona', 'calca-pantalona', 'calcas', 89.90, 189.90, 'GRANDE'),
  ('BLUSA-001', 'Blusa de renda', 'blusa-de-renda', 'blusas', 50.00, 99.90, 'PEQUENA'),
  ('BLUSA-002', 'Blusa assimétrica', 'blusa-assimetrica', 'blusas', 20.00, 69.90, 'PEQUENA'),
  ('BLUSA-003', 'Blusa assimétrica com renda', 'blusa-assimetrica-renda', 'blusas', 20.00, 69.90, 'PEQUENA'),
  ('BLUSA-004', 'Blusa um ombro só', 'blusa-um-ombro-so', 'blusas', 20.00, 69.90, 'PEQUENA'),
  ('VESTIDO-002', 'Vestido longo rosa', 'vestido-longo-rosa', 'vestidos', 59.90, 189.90, 'GRANDE'),
  ('VESTIDO-003', 'Vestido longo preto', 'vestido-longo-preto', 'vestidos', 59.90, 189.90, 'GRANDE'),
  ('CONJ-001', 'Conjunto saia e top amarelo', 'conjunto-saia-top-amarelo', 'conjuntos', 90.00, 199.90, 'GRANDE'),
  ('CONJ-002', 'Conjunto branco', 'conjunto-branco', 'conjuntos', 75.00, 189.90, 'GRANDE'),
  ('CONJ-003', 'Conjunto preto', 'conjunto-preto', 'conjuntos', 75.00, 189.90, 'GRANDE'),
  ('CONJ-004', 'Conjunto rosa', 'conjunto-rosa', 'conjuntos', 75.00, 189.90, 'GRANDE'),
  ('CONJ-005', 'Conjunto saia e top bege', 'conjunto-saia-top-bege', 'conjuntos', 90.00, 199.90, 'GRANDE'),
  ('CONJ-006', 'Conjunto camisa e short', 'conjunto-camisa-short', 'conjuntos', 75.00, 159.90, 'GRANDE'),
  ('CONJ-007', 'Conjunto saia e top poá amarelo', 'conjunto-saia-top-poa-amarelo', 'conjuntos', 75.00, 189.90, 'GRANDE'),
  ('CALCA-002', 'Calça marrom com lenço', 'calca-marrom-lenco', 'calcas', 90.00, 189.90, 'GRANDE'),
  ('CALCA-003', 'Calça animal print', 'calca-animal-print', 'calcas', 90.00, 189.90, 'GRANDE')
) AS seed(sku, name, slug, cat_slug, cost, price, pkg_code)
JOIN public.categories c ON c.slug = seed.cat_slug
LEFT JOIN public.packaging_types pt ON pt.code = seed.pkg_code
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE products.slug = seed.slug);

-- ============================================================
-- 15. RPC TRANSAÇIONAL: FINALIZAR VENDA (requisito 29)
--     Executa em uma única transação:
--       1. Cria a venda + itens com snapshots
--       2. Atualiza estoque/lotes (FIFO)
--       3. Registra movimentações
--       4. Registra pagamento
--       5. Registra embalagem + custos extras
--       6. Lança movimento financeiro
--       7. Auditoria
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_sale(
  p_source TEXT,
  p_items JSONB, -- [{product_id, variant_id, product_name, variant, sku, quantity, unit_sale_price, unit_actual_price, discount}]
  p_general_discount NUMERIC DEFAULT 0,
  p_coupon_id UUID DEFAULT NULL,
  p_coupon_code TEXT DEFAULT NULL,
  p_pix_discount NUMERIC DEFAULT 0,
  p_payment JSONB DEFAULT NULL, -- {provider_id, modality_id, method, installments, amount, fee_percent, fee_expected, fee_actual, provider_snapshot, modality_snapshot, fee_rule_id}
  p_packaging JSONB DEFAULT NULL, -- {packaging_type_id, tipo_snapshot, custo_snapshot, custom_cost, is_free}
  p_extra_costs JSONB DEFAULT '[]'::jsonb, -- [{description, category, amount}]
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_sale_id UUID;
  v_friendly INTEGER;
  v_items_count INTEGER := 0;
  v_items_subtotal NUMERIC(12,2) := 0;
  v_product_discounts NUMERIC(12,2) := 0;
  v_total_discounts NUMERIC(12,2) := 0;
  v_total_customer NUMERIC(12,2) := 0;
  v_items_cost NUMERIC(12,4) := 0;
  v_allocated_purchase_cost NUMERIC(12,4) := 0;
  v_fee_expected NUMERIC(12,4) := 0;
  v_fee_actual NUMERIC(12,4) := 0;
  v_packaging_cost NUMERIC(12,4) := 0;
  v_extra_costs_total NUMERIC(12,2) := 0;
  v_real_profit NUMERIC(12,4);
  v_real_margin NUMERIC(8,4);
  i JSONB;
  item RECORD;
  qty_needed INTEGER;
  bat RECORD;
  take INTEGER;
  v_batch_ids UUID[];
  v_current_cost NUMERIC(12,4);
  v_alloc_cost NUMERIC(12,4);
  v_line_unit_cost NUMERIC(12,4) := 0;
  v_line_alloc NUMERIC(12,4) := 0;
  v_line_total NUMERIC(12,2) := 0;
  v_line_discount NUMERIC(12,2) := 0;
  v_line_sub NUMERIC(12,2) := 0;
BEGIN
  -- 0. Validações básicas
  IF p_source IS NULL OR p_source NOT IN ('SITE','PRESENCIAL','DISTANCIA','OUTRO') THEN
    RAISE EXCEPTION 'Origem (source) inválida';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum item informado na venda';
  END IF;

  -- 1. Criar cabeçalho (inicialmente status provisório — atualiza no fim)
  INSERT INTO public.sales (
    status, source, customer_name, customer_phone,
    created_by, coupon_id, coupon_snapshot
  ) VALUES (
    'PENDENTE', p_source, p_customer_name, p_customer_phone,
    p_user_id, p_coupon_id, p_coupon_code
  ) RETURNING id, friendly_number INTO v_sale_id, v_friendly;

  -- 2. Processar itens + FIFO nos lotes
  FOR i IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    item := jsonb_populate_record(null::record, i);
    v_current_cost := COALESCE((SELECT current_cost FROM public.products WHERE id = (i->>'product_id')::UUID), 0);
    qty_needed := (i->>'quantity')::INTEGER;
    IF qty_needed <= 0 THEN CONTINUE; END IF;

    v_batch_ids := ARRAY[]::UUID[];
    v_line_unit_cost := 0;
    v_line_alloc := 0;

    -- Tenta consumir lotes FIFO
    FOR bat IN
      SELECT * FROM public.inventory_batches b
      WHERE b.product_id = (i->>'product_id')::UUID
        AND b.quantity_available > 0
      ORDER BY b.received_at ASC, b.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN qty_needed <= 0;
      take := LEAST(qty_needed, bat.quantity_available);
      qty_needed := qty_needed - take;

      UPDATE public.inventory_batches
      SET quantity_available = quantity_available - take
      WHERE id = bat.id;

      v_line_unit_cost := v_line_unit_cost + (bat.unit_cost * take);
      v_line_alloc := v_line_alloc + (bat.allocated_purchase_cost * take);
      v_batch_ids := array_append(v_batch_ids, bat.id);

      -- Movimentação de saída por lote
      INSERT INTO public.inventory_movements
        (product_id, variant_id, batch_id, movement_type, reason, quantity, unit_cost, related_sale_id, created_by)
      VALUES (
        (i->>'product_id')::UUID,
        (i->>'variant_id')::UUID,
        bat.id,
        'SAIDA',
        'VENDA',
        take,
        bat.unit_cost,
        v_sale_id,
        p_user_id
      );
    END LOOP;

    -- Se ainda tem quantidade pendente (sem lote), usa custo atual do produto e registra movimento (mas avisa com ajuste)
    IF qty_needed > 0 THEN
      v_line_unit_cost := v_line_unit_cost + (v_current_cost * qty_needed);
      INSERT INTO public.inventory_movements
        (product_id, variant_id, batch_id, movement_type, reason, quantity, unit_cost, related_sale_id, created_by, notes)
      VALUES (
        (i->>'product_id')::UUID,
        (i->>'variant_id')::UUID,
        NULL,
        'SAIDA',
        'VENDA_SEM_LOTE',
        qty_needed,
        v_current_cost,
        v_sale_id,
        p_user_id,
        'Venda sem lote disponível — custo base usado'
      );
    END IF;

    -- Calcula custos por linha
    v_line_sub := COALESCE((i->>'unit_sale_price')::NUMERIC, 0) * COALESCE((i->>'quantity')::INTEGER, 0);
    v_line_discount := COALESCE((i->>'discount')::NUMERIC, 0);
    v_line_total := v_line_sub - v_line_discount;

    v_items_count := v_items_count + COALESCE((i->>'quantity')::INTEGER, 0);
    v_items_subtotal := v_items_subtotal + v_line_sub;
    v_product_discounts := v_product_discounts + v_line_discount;
    v_items_cost := v_items_cost + v_line_unit_cost;
    v_allocated_purchase_cost := v_allocated_purchase_cost + v_line_alloc;

    INSERT INTO public.sale_items (
      sale_id, product_id, variant_id, product_name_snapshot, variant_snapshot, sku_snapshot,
      quantity, unit_cost_snapshot, allocated_purchase_cost_snapshot,
      unit_sale_price_snapshot, unit_actual_price, discount, total,
      batch_ids_used
    ) VALUES (
      v_sale_id,
      (i->>'product_id')::UUID,
      (i->>'variant_id')::UUID,
      COALESCE(i->>'product_name', 'Produto sem nome'),
      i->>'variant',
      i->>'sku',
      COALESCE((i->>'quantity')::INTEGER, 0),
      CASE WHEN COALESCE((i->>'quantity')::INTEGER,0) > 0
        THEN ROUND(v_line_unit_cost / (i->>'quantity')::INTEGER, 4) ELSE 0 END,
      CASE WHEN COALESCE((i->>'quantity')::INTEGER,0) > 0
        THEN ROUND(v_line_alloc / (i->>'quantity')::INTEGER, 4) ELSE 0 END,
      COALESCE((i->>'unit_sale_price')::NUMERIC, 0),
      COALESCE((i->>'unit_actual_price')::NUMERIC, 0),
      v_line_discount,
      v_line_total,
      v_batch_ids
    );
  END LOOP;

  -- 3. Calcular totais
  v_total_discounts := v_product_discounts
                     + COALESCE(p_general_discount, 0)
                     + COALESCE(p_coupon_discount, 0)
                     + COALESCE(p_pix_discount, 0);
  v_total_customer := v_items_subtotal - v_total_discounts;
  IF v_total_customer < 0 THEN v_total_customer := 0; END IF;

  -- 4. Pagamento (um pagamento por venda por enquanto; pode ser extendido)
  IF p_payment IS NOT NULL AND jsonb_typeof(p_payment) = 'object' THEN
    v_fee_expected := COALESCE((p_payment->>'fee_expected')::NUMERIC, 0);
    v_fee_actual := COALESCE((p_payment->>'fee_actual')::NUMERIC, 0);
    INSERT INTO public.sale_payments (
      sale_id, provider_id, modality_id, method, installments,
      provider_snapshot, modality_snapshot, fee_rule_id,
      fee_percent_snapshot, fee_expected_snapshot, fee_real_snapshot, amount
    ) VALUES (
      v_sale_id,
      (p_payment->>'provider_id')::UUID,
      (p_payment->>'modality_id')::UUID,
      COALESCE(p_payment->>'method','OUTRO'),
      COALESCE((p_payment->>'installments')::INTEGER, 1),
      p_payment->>'provider_snapshot',
      p_payment->>'modality_snapshot',
      (p_payment->>'fee_rule_id')::UUID,
      COALESCE((p_payment->>'fee_percent')::NUMERIC, 0),
      v_fee_expected,
      v_fee_actual,
      COALESCE((p_payment->>'amount')::NUMERIC, v_total_customer)
    );
  END IF;

  -- 5. Embalagem
  IF p_packaging IS NOT NULL AND jsonb_typeof(p_packaging) = 'object' THEN
    v_packaging_cost := COALESCE((p_packaging->>'custo_snapshot')::NUMERIC, 0);
    IF (p_packaging->>'is_free')::BOOLEAN = true THEN
      v_packaging_cost := 0;
    ELSIF (p_packaging->>'custom_cost') IS NOT NULL THEN
      v_packaging_cost := COALESCE((p_packaging->>'custom_cost')::NUMERIC, 0);
    END IF;
    INSERT INTO public.sale_packaging (
      sale_id, packaging_type_id, tipo_snapshot, custo_snapshot, custom_cost, is_free
    ) VALUES (
      v_sale_id,
      (p_packaging->>'packaging_type_id')::UUID,
      COALESCE(p_packaging->>'tipo_snapshot', 'Embalagem'),
      COALESCE((p_packaging->>'custo_snapshot')::NUMERIC, 0),
      (p_packaging->>'custom_cost')::NUMERIC,
      COALESCE((p_packaging->>'is_free')::BOOLEAN, false)
    );
  END IF;

  -- 6. Custos extras
  IF p_extra_costs IS NOT NULL THEN
    FOR i IN SELECT * FROM jsonb_array_elements(p_extra_costs) LOOP
      v_extra_costs_total := v_extra_costs_total + COALESCE((i->>'amount')::NUMERIC, 0);
      INSERT INTO public.sale_costs (sale_id, description, category, amount)
      VALUES (
        v_sale_id,
        COALESCE(i->>'description','Custo extra'),
        COALESCE(i->>'category','OUTRO'),
        COALESCE((i->>'amount')::NUMERIC, 0)
      );
    END LOOP;
  END IF;

  -- 7. Lucro real (regra crítica do requisito 26)
  -- RECEITA = valor efetivamente pago (v_total_customer)
  -- CUSTOS = mercadoria + rateio compra + taxa real + embalagem + extras
  v_real_profit := v_total_customer
                 - (v_items_cost + v_allocated_purchase_cost)
                 - v_fee_actual
                 - v_packaging_cost
                 - v_extra_costs_total;
  v_real_margin := CASE WHEN v_total_customer > 0
    THEN ROUND((v_real_profit / v_total_customer) * 100, 4) ELSE 0 END;

  -- 8. Atualiza o cabeçalho da venda
  UPDATE public.sales SET
    status = 'CONCLUIDA',
    items_subtotal = v_items_subtotal,
    product_discounts = v_product_discounts,
    general_discount = COALESCE(p_general_discount, 0),
    coupon_discount = COALESCE(p_coupon_discount, 0),
    pix_discount = COALESCE(p_pix_discount, 0),
    total_discounts = v_total_discounts,
    total_customer = v_total_customer,
    packaging_cost = v_packaging_cost,
    extra_costs = v_extra_costs_total,
    items_cost = v_items_cost,
    allocated_purchase_cost = v_allocated_purchase_cost,
    fee_expected = v_fee_expected,
    fee_actual = v_fee_actual,
    real_profit = v_real_profit,
    real_margin = v_real_margin,
    updated_at = now()
  WHERE id = v_sale_id;

  -- 9. Movimento financeiro — entrada de venda
  INSERT INTO public.financial_transactions
    (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, created_by)
  VALUES (
    CURRENT_DATE,
    'ENTRADA',
    'VENDA',
    'Venda #' || lpad(v_friendly::text, 6, '0'),
    v_total_customer,
    v_sale_id,
    CASE WHEN p_payment IS NOT NULL THEN COALESCE(p_payment->>'method','OUTRO') ELSE 'OUTRO' END,
    'CONFIRMADO',
    p_user_id
  );
  -- Taxa (saída)
  IF v_fee_actual > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'SAIDA', 'TAXA',
      'Taxa pagamento Venda #' || lpad(v_friendly::text, 6, '0'),
      v_fee_actual, v_sale_id, 'CONFIRMADO', p_user_id
    );
  END IF;
  -- Embalagem (saída)
  IF v_packaging_cost > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'SAIDA', 'EMBALAGEM',
      'Embalagem Venda #' || lpad(v_friendly::text, 6, '0'),
      v_packaging_cost, v_sale_id, 'CONFIRMADO', p_user_id
    );
  END IF;
  -- Custos extras (saída)
  IF v_extra_costs_total > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'SAIDA', 'OUTRA_DESPESA',
      'Custos extras Venda #' || lpad(v_friendly::text, 6, '0'),
      v_extra_costs_total, v_sale_id, 'CONFIRMADO', p_user_id
    );
  END IF;

  -- 10. Auditoria
  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, metadata)
  VALUES (p_user_id, 'FINALIZE', 'SALE', v_sale_id,
    jsonb_build_object(
      'friendly_number', v_friendly,
      'items_count', v_items_count,
      'total_customer', v_total_customer,
      'real_profit', v_real_profit,
      'source', p_source
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', v_sale_id,
    'friendly_number', v_friendly,
    'total_customer', v_total_customer,
    'real_profit', v_real_profit,
    'real_margin', v_real_margin
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 16. RPC: CANCELAR VENDA (requisito 31)
--     Não deleta; devolve lotes, marca status, registra auditoria.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_sale(
  p_sale_id UUID,
  p_reason TEXT,
  p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  i RECORD;
  j INTEGER;
  v_batch_id UUID;
  v_qty INTEGER;
  v_unit_cost NUMERIC(12,4);
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_sale.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'Venda já está cancelada';
  END IF;

  -- Devolve lotes / adiciona estoque
  FOR i IN SELECT * FROM public.sale_items WHERE sale_id = v_sale.id LOOP
    IF i.batch_ids_used IS NOT NULL AND array_length(i.batch_ids_used, 1) > 0 THEN
      -- Simplificação: devolve ao primeiro lote consumido, ou cria ajuste
      v_qty := i.quantity;
      FOREACH v_batch_id IN ARRAY i.batch_ids_used LOOP
        UPDATE public.inventory_batches
        SET quantity_available = quantity_available + v_qty
        WHERE id = v_batch_id;
        -- Movimentação entrada de devolução
        v_unit_cost := i.unit_cost_snapshot;
        INSERT INTO public.inventory_movements
          (product_id, variant_id, batch_id, movement_type, reason, quantity, unit_cost, related_sale_id, created_by)
        VALUES (
          i.product_id, i.variant_id, v_batch_id,
          'ENTRADA', 'CANCELAMENTO_VENDA', v_qty,
          v_unit_cost, v_sale.id, p_user_id
        );
        v_qty := 0; -- já devolveu tudo no primeiro lote encontrado (simplificado)
        EXIT WHEN v_qty = 0;
      END LOOP;
    ELSE
      -- Sem lote registrado: cria movimento e ajuste
      INSERT INTO public.inventory_movements
        (product_id, variant_id, batch_id, movement_type, reason, quantity, unit_cost, related_sale_id, created_by)
      VALUES (
        i.product_id, i.variant_id, NULL,
        'AJUSTE_POS', 'CANCELAMENTO_VENDA', i.quantity,
        i.unit_cost_snapshot, v_sale.id, p_user_id
      );
    END IF;
  END LOOP;

  -- Marca venda como cancelada
  UPDATE public.sales SET
    status = 'CANCELADA',
    cancel_reason = p_reason,
    cancelled_by = p_user_id,
    cancelled_at = now(),
    updated_at = now()
  WHERE id = v_sale.id;

  -- Lança estorno no caixa
  INSERT INTO public.financial_transactions
    (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
  VALUES (
    CURRENT_DATE, 'SAIDA', 'VENDA',
    'Estorno Venda #' || lpad(v_sale.friendly_number::text, 6, '0'),
    v_sale.total_customer, v_sale.id, 'CONFIRMADO', p_user_id
  );
  IF v_sale.fee_actual > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'ENTRADA', 'TAXA',
      'Estorno taxa Venda #' || lpad(v_sale.friendly_number::text, 6, '0'),
      v_sale.fee_actual, v_sale.id, 'CONFIRMADO', p_user_id
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, metadata)
  VALUES (p_user_id, 'CANCEL', 'SALE', v_sale.id, jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'sale_id', v_sale.id, 'friendly_number', v_sale.friendly_number);
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 17. RPC: CRIAR ENTRADA DE MERCADORIA (requisito 8)
--     Lança compra + itens + custos + lotes + movimentações + financeiro
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_purchase_entry(
  p_entry_date DATE DEFAULT CURRENT_DATE,
  p_supplier TEXT DEFAULT NULL,
  p_origin TEXT DEFAULT NULL,
  p_cost_allocation_method TEXT DEFAULT 'quantity', -- quantity | value | none
  p_items JSONB DEFAULT '[]'::jsonb, -- [{product_id, product_name, unit_cost, quantity}]
  p_shipping_cost NUMERIC DEFAULT 0,
  p_other_costs JSONB DEFAULT '[]'::jsonb, -- [{description, category, amount}]
  p_notes TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_entry_id UUID;
  v_items_total NUMERIC(12,2) := 0;
  v_others_total NUMERIC(12,2) := 0;
  v_total_cost NUMERIC(12,2);
  i JSONB;
  item RECORD;
  v_alloc_base NUMERIC := 0;
  v_share NUMERIC;
  v_line_allocated NUMERIC(12,4);
  v_effective_cost NUMERIC(12,4);
  v_line_total NUMERIC(12,2);
  v_qty INTEGER;
  v_cost NUMERIC(12,4);
  oc RECORD;
BEGIN
  -- Valida método
  IF p_cost_allocation_method NOT IN ('quantity','value','none') THEN
    RAISE EXCEPTION 'Método de rateio inválido';
  END IF;

  INSERT INTO public.purchase_entries
    (entry_date, supplier, origin, cost_allocation_method, notes, created_by)
  VALUES (
    COALESCE(p_entry_date, CURRENT_DATE), p_supplier, p_origin,
    p_cost_allocation_method, p_notes, p_user_id
  ) RETURNING id INTO v_entry_id;

  -- Insere custos extras
  IF p_other_costs IS NOT NULL THEN
    FOR i IN SELECT * FROM jsonb_array_elements(p_other_costs) LOOP
      v_others_total := v_others_total + COALESCE((i->>'amount')::NUMERIC, 0);
      INSERT INTO public.purchase_costs (purchase_entry_id, description, category, amount)
      VALUES (v_entry_id,
        COALESCE(i->>'description','Outro custo'),
        COALESCE(i->>'category','OUTRO'),
        COALESCE((i->>'amount')::NUMERIC, 0));
    END LOOP;
  END IF;

  -- 1a passada: itens + cálculo subtotal + base rateio
  FOR i IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((i->>'quantity')::INTEGER, 0);
    v_cost := COALESCE((i->>'unit_cost')::NUMERIC, 0);
    v_line_total := ROUND(v_qty * v_cost, 2);
    v_items_total := v_items_total + v_line_total;

    IF p_cost_allocation_method = 'quantity' THEN
      v_alloc_base := v_alloc_base + v_qty;
    ELSIF p_cost_allocation_method = 'value' THEN
      v_alloc_base := v_alloc_base + v_line_total;
    END IF;

    -- Insere item com valores provisórios (rateio vem na 2a passagem)
    INSERT INTO public.purchase_entry_items
      (purchase_entry_id, product_id, product_snapshot, unit_cost, quantity, line_total)
    VALUES (
      v_entry_id,
      (i->>'product_id')::UUID,
      COALESCE(i->>'product_name','Produto'),
      v_cost,
      v_qty,
      v_line_total
    );
  END LOOP;

  v_total_cost := v_items_total + COALESCE(p_shipping_cost, 0) + v_others_total;

  -- 2a passada: aplica rateio + cria lotes
  FOR item IN SELECT pei.*, p.current_cost FROM public.purchase_entry_items pei
               LEFT JOIN public.products p ON p.id = pei.product_id
              WHERE pei.purchase_entry_id = v_entry_id LOOP
    v_line_allocated := 0;
    IF p_cost_allocation_method = 'none' OR v_alloc_base = 0 THEN
      v_line_allocated := 0;
    ELSIF p_cost_allocation_method = 'quantity' THEN
      v_share := item.quantity / v_alloc_base;
      v_line_allocated := ROUND((COALESCE(p_shipping_cost,0) + v_others_total) * v_share, 4);
    ELSIF p_cost_allocation_method = 'value' THEN
      v_share := item.line_total / v_alloc_base;
      v_line_allocated := ROUND((COALESCE(p_shipping_cost,0) + v_others_total) * v_share, 4);
    END IF;

    IF item.quantity > 0 THEN
      v_effective_cost := item.unit_cost + ROUND(v_line_allocated / item.quantity, 4);
    ELSE
      v_effective_cost := item.unit_cost;
    END IF;

    UPDATE public.purchase_entry_items SET
      allocated_share = v_line_allocated,
      effective_cost = v_effective_cost
    WHERE id = item.id;

    -- Atualiza custo atual do produto (se for maior que zero)
    IF item.product_id IS NOT NULL AND item.unit_cost > 0 THEN
      UPDATE public.products SET
        current_cost = item.unit_cost,
        updated_at = now()
      WHERE id = item.product_id;
    END IF;

    -- Cria lote
    IF item.quantity > 0 THEN
      INSERT INTO public.inventory_batches
        (product_id, purchase_entry_id, purchase_item_id,
         unit_cost, allocated_purchase_cost, quantity_received, quantity_available)
      VALUES (
        item.product_id, v_entry_id, item.id,
        item.unit_cost,
        CASE WHEN item.quantity > 0 THEN ROUND(v_line_allocated / item.quantity, 4) ELSE 0 END,
        item.quantity,
        item.quantity
      );
      -- Movimentação de entrada
      INSERT INTO public.inventory_movements
        (product_id, movement_type, reason, quantity, unit_cost, related_purchase_id, created_by)
      VALUES (
        item.product_id, 'ENTRADA', 'COMPRA', item.quantity,
        item.unit_cost, v_entry_id, p_user_id
      );
    END IF;
  END LOOP;

  UPDATE public.purchase_entries SET
    items_total = v_items_total,
    shipping_cost = COALESCE(p_shipping_cost, 0),
    other_costs = v_others_total,
    total_cost = v_total_cost
  WHERE id = v_entry_id;

  -- Financeiro: saída compra (estoque), saída frete separado se houver
  INSERT INTO public.financial_transactions
    (trans_date, trans_type, category, description, amount, related_purchase_id, status, created_by)
  VALUES (
    CURRENT_DATE, 'SAIDA', 'COMPRA_ESTOQUE',
    'Mercadoria compra ' || COALESCE(p_supplier, p_origin, p_entry_date::text),
    v_items_total, v_entry_id, 'CONFIRMADO', p_user_id
  );
  IF COALESCE(p_shipping_cost, 0) > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_purchase_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'SAIDA', 'FRETE',
      'Frete/deslocamento compra',
      p_shipping_cost, v_entry_id, 'CONFIRMADO', p_user_id
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, metadata)
  VALUES (p_user_id, 'CREATE', 'PURCHASE', v_entry_id,
    jsonb_build_object('items_total', v_items_total, 'total_cost', v_total_cost));

  RETURN jsonb_build_object('ok', true, 'purchase_entry_id', v_entry_id, 'total_cost', v_total_cost);
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- FIM DO SCHEMA V1
-- ============================================================

-- ============================================================
-- ANEXO: FOREIGN KEYS PENDENTES (resolução de dependências circulares)
-- Objetivo: Não recriar tabelas. Usamos ALTER TABLE ADD CONSTRAINT
-- NOT VALID (não trava write em tabelas já populadas) e depois
-- VALIDATE CONSTRAINT (opcional, rodar em horário de baixo movimento).
-- Motivo: algumas tabelas são declaradas ANTES das referenciadas
-- para evitar erro na primeira execução; agora amarramos tudo.
-- ============================================================

DO $$ BEGIN
  -- 1) products.default_packaging_type_id → packaging_types(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_packaging_type') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT fk_products_packaging_type
      FOREIGN KEY (default_packaging_type_id)
      REFERENCES public.packaging_types(id) ON DELETE SET NULL NOT VALID;
  END IF;

  -- 2) inventory_movements.related_sale_id → sales(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inv_mov_sale') THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT fk_inv_mov_sale
      FOREIGN KEY (related_sale_id)
      REFERENCES public.sales(id) ON DELETE SET NULL NOT VALID;
  END IF;

  -- 3) inventory_movements.related_purchase_id → purchase_entries(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inv_mov_purchase') THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT fk_inv_mov_purchase
      FOREIGN KEY (related_purchase_id)
      REFERENCES public.purchase_entries(id) ON DELETE SET NULL NOT VALID;
  END IF;

  -- 4) sales.packaging_default_type (se coluna existir) → packaging_types(id)
  -- Obs: a coluna foi removida na modelagem atual; manter bloco apenas
  -- para referência futura.
END $$;

-- ============================================================
-- ANEXO 2: ÍNDICES DE PERFORMANCE
-- Atenção: CREATE INDEX [IF NOT EXISTS] com predicado WHERE **NÃO**
-- pode ser executado dentro de DO $$ (PL/pgSQL). O erro 42P17
-- "functions in index predicate must be marked IMMUTABLE" acontece
-- porque o parser trata a execução dinâmica do bloco como VOLÁTIL.
-- SOLUÇÃO: executar os CREATEs fora do PL/pgSQL, no SQL plain.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_products_default_packaging
  ON public.products(default_packaging_type_id);

-- Obs sobre os 2 índices abaixo: antes eram parciais (WHERE ... IS NOT NULL).
-- Motivo da alteração: compatibilidade 100% com Supabase Cloud.
-- Erro 42P17 "predicate must be IMMUTABLE" ocorre em algumas versões,
-- mesmo com predicado trivial. Solução: índice completo, impacto desprezível.
CREATE INDEX IF NOT EXISTS idx_inv_mov_related_sale
  ON public.inventory_movements(related_sale_id);

CREATE INDEX IF NOT EXISTS idx_inv_mov_related_purchase
  ON public.inventory_movements(related_purchase_id);

-- (Opcional) Em ambiente Supabase: rodar VALIDATE separadamente depois
-- ALTER TABLE public.products VALIDATE CONSTRAINT fk_products_packaging_type;
-- ALTER TABLE public.inventory_movements VALIDATE CONSTRAINT fk_inv_mov_sale;
-- ALTER TABLE public.inventory_movements VALIDATE CONSTRAINT fk_inv_mov_purchase;

-- ============================================================
-- ANEXO 3: ATUALIZAÇÃO DE TAXAS REAIS E CONFIGS DEFAULT
-- (Valores informados pelo cliente em 16/09/2026)
-- Roda com segurança: se regra existir atualiza; se não, cria.
-- ============================================================
DO $$ DECLARE
  v_prov_infinite UUID;
  v_prov_mp UUID;
  v_prov_pixdireto UUID;
  v_mod_link UUID;
  v_mod_tap UUID;
  v_mod_checkout UUID;
  v_mod_direto UUID;
  v_brand_elo TEXT := 'ELO';
BEGIN
  SELECT id INTO v_prov_infinite  FROM public.payment_providers WHERE code = 'INFINITEPAY';
  SELECT id INTO v_prov_mp        FROM public.payment_providers WHERE code = 'MERCADO_PAGO';
  SELECT id INTO v_prov_pixdireto FROM public.payment_providers WHERE code = 'PIX_DIRETO';
  SELECT id INTO v_mod_link       FROM public.payment_modalities WHERE provider_id = v_prov_infinite  AND code = 'LINK';
  SELECT id INTO v_mod_tap        FROM public.payment_modalities WHERE provider_id = v_prov_infinite  AND code = 'TAP';
  SELECT id INTO v_mod_checkout   FROM public.payment_modalities WHERE provider_id = v_prov_mp        AND code = 'CHECKOUT';
  SELECT id INTO v_mod_direto     FROM public.payment_modalities WHERE provider_id = v_prov_pixdireto AND code = 'DIRETO';

  -- ============ PIX: 0% EM TODOS OS PROVIDERS (cliente = sem taxa pix) ============
  UPDATE public.payment_fee_rules SET fee_percent = 0
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_link     AND method = 'PIX' AND installments = 1 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_link, 'PIX', 1, '1 dia útil', 'Plano atual', 0, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  UPDATE public.payment_fee_rules SET fee_percent = 0
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_tap      AND method = 'PIX' AND installments = 1 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_tap, 'PIX', 1, '1 dia útil', 'Plano atual', 0, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  UPDATE public.payment_fee_rules SET fee_percent = 0
  WHERE provider_id = v_prov_mp       AND modality_id = v_mod_checkout AND method = 'PIX' AND installments = 1 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_mp, v_mod_checkout, 'PIX', 1, '24h', 'Plano atual', 0, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  UPDATE public.payment_fee_rules SET fee_percent = 0
  WHERE provider_id = v_prov_pixdireto AND modality_id = v_mod_direto  AND method = 'PIX' AND installments = 1 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_pixdireto, v_mod_direto, 'PIX', 1, 'Instantâneo', 'N/A', 0, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  -- ============ InfinitePay LINK de Pagamento ============
  -- Crédito 1x: 4,2%
  UPDATE public.payment_fee_rules SET fee_percent = 4.2
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_link AND method = 'CREDITO' AND installments = 1 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_link, 'CREDITO', 1, '1 dia útil', 'Plano atual', 4.2, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  -- Crédito 2x: 6,09%
  UPDATE public.payment_fee_rules SET fee_percent = 6.09
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_link AND method = 'CREDITO' AND installments = 2 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_link, 'CREDITO', 2, '1 dia útil', 'Plano atual', 6.09, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  -- ============ InfinitePay InfinityTap (maquininha) ============
  -- Visa/Mastercard (brand NULL): Crédito 1x 3,15% / 2x 5,39%
  UPDATE public.payment_fee_rules SET fee_percent = 3.15
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_tap AND method = 'CREDITO' AND installments = 1 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_tap, 'CREDITO', 1, '1 dia útil', 'Plano atual', 3.15, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  UPDATE public.payment_fee_rules SET fee_percent = 5.39
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_tap AND method = 'CREDITO' AND installments = 2 AND brand IS NULL;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_tap, 'CREDITO', 2, '1 dia útil', 'Plano atual', 5.39, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  -- ELO (brand = ELO): Crédito 1x 4,91% / 2x 6,47%
  UPDATE public.payment_fee_rules SET fee_percent = 4.91
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_tap AND method = 'CREDITO' AND installments = 1 AND brand = v_brand_elo;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, brand, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_tap, 'CREDITO', 1, v_brand_elo, '1 dia útil', 'Plano atual', 4.91, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  UPDATE public.payment_fee_rules SET fee_percent = 6.47
  WHERE provider_id = v_prov_infinite AND modality_id = v_mod_tap AND method = 'CREDITO' AND installments = 2 AND brand = v_brand_elo;
  IF NOT FOUND THEN INSERT INTO public.payment_fee_rules (provider_id, modality_id, method, installments, brand, receipt_term, revenue_tier, fee_percent, valid_from) VALUES (v_prov_infinite, v_mod_tap, 'CREDITO', 2, v_brand_elo, '1 dia útil', 'Plano atual', 6.47, CURRENT_DATE) ON CONFLICT DO NOTHING; END IF;

  -- ============ Configuração: Desconto PIX padrão = 10% (habilitado) ============
  INSERT INTO public.settings (key, value, description)
  VALUES ('pix_discount_enabled', true::jsonb, 'Habilita/desabilita desconto Pix à vista')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

  INSERT INTO public.settings (key, value, description)
  VALUES ('pix_discount_percent', '10'::jsonb, 'Percentual de desconto Pix à vista (padrão: 10%)')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;
END $$;
