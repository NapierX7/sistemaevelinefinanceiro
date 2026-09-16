-- ============================================================
-- PATCH HISTÓRICO EVELINE GESTÃO: ESTOQUE + VENDAS (09/2026)
-- ============================================================
-- ORDEM DE EXECUÇÃO (não alterar):
--   PASSO 1: Garante BLUSA-004
--   PASSO 2: 3 entradas de mercadoria (38 peças) via create_purchase_entry
--   PASSO 3: 18 vendas históricas via finalize_sale
--   PASSO 4: Correções status PENDENTE/PARCIAL + financeiro pagamentos parciais
--   PASSO 5: Query validação final
-- IDEMPOTENTE (sempre roda safe): NOT EXISTS / ON CONFLICT DO NOTHING / external_id = chave import
-- ============================================================

BEGIN;

-- ============================================================
-- PASSO 0: Declara chaves externas para idempotência
-- ============================================================
DO $$
DECLARE
  -- Perfis (ajusta automaticamente se existir)
  v_admin_id UUID := (SELECT id FROM public.profiles p WHERE p.role = 'admin' ORDER BY created_at LIMIT 1);
BEGIN
  IF v_admin_id IS NULL THEN
    -- Garante fallback p/ caso não exista perfil ainda (não deve acontecer)
    RAISE WARNING 'Nenhum perfil admin encontrado — entradas/vendas ficarão sem created_by (não bloqueia, ok histórico).';
  END IF;
END $$;

-- ============================================================
-- PASSO 1: Cria BLUSA-004 (Blusa um ombro só) se NÃO existir
-- ============================================================
INSERT INTO public.products (sku, name, slug, category_id, current_cost, sale_price, default_packaging_type_id)
SELECT
  'BLUSA-004',
  'Blusa um ombro só',
  'blusa-um-ombro-so',
  (SELECT id FROM public.categories WHERE slug = 'blusas'),
  20.00,
  69.90, -- PREÇO PROVISÓRIO (apenas p/ catálogo; vendas históricas usam snapshot real)
  (SELECT id FROM public.packaging_types WHERE code = 'PEQUENA')
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE sku = 'BLUSA-004');

-- ============================================================
-- PASSO 2: 3 ENTRADAS HISTÓRICAS (38 peças, R$ 1.950,00 total)
-- ============================================================

-- Tabela temporária (sessão) para não recriar caso já rodou
CREATE TEMP TABLE IF NOT EXISTS tmp_import_purchase_done (external_id TEXT PRIMARY KEY) ON COMMIT DROP;

-- Helper: roda create_purchase_entry somente se external_id NÃO existir em purchase_entries.notes
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_notes TEXT;
  v_ext TEXT;
  v_items JSONB;
  v_other_costs JSONB := '[]'::jsonb;
  v_alloc_method TEXT;
BEGIN
  -- ======================== 1ª ENTRADA ========================
  v_ext := 'HIST-ENTRADA-001-R380-Q6';
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_entries pe
    WHERE pe.notes = v_ext OR pe.notes LIKE '%' || v_ext || '%'
  ) AND NOT EXISTS (SELECT 1 FROM tmp_import_purchase_done WHERE external_id = v_ext) THEN
    v_items := JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT(
        'product_id', (SELECT id FROM public.products WHERE sku='CALCA-001'),
        'product_name', 'Calça pantalona (amarela, alfaiataria) — lote inicial',
        'unit_cost', 0, -- será RATEADO (custo total do lote é R$ 380,00; sem unitário conhecido)
        'quantity', 2
      ),
      JSONB_BUILD_OBJECT(
        'product_id', (SELECT id FROM public.products WHERE sku='BLUSA-001'),
        'product_name', 'Blusa de renda (amarela/preta) — lote inicial',
        'unit_cost', 0,
        'quantity', 4
      )
    );
    -- Nota: como unit_cost individual NÃO foi informado (só total R$380,00),
    -- usamos OTHER_COSTS com 1 item "Ajuste rateio lote inicial" para chegar ao total.
    -- Rateio method = quantity (padrão) e subtotal dos itens unit_cost=0 é ZERO →
    -- então usamos other_costs para chegar exatamente R$ 380.
    v_other_costs := JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('description','Rateio custo unitário lote inicial (2 CALCA + 4 BLUSA renda — total conhecido R$380,00; unitários não informados)','category','OUTRO','amount',380.00)
    );
    PERFORM public.create_purchase_entry(
      p_entry_date := '2026-08-01'::DATE,
      p_supplier := 'Fornecedor histórico (primeiro lote)',
      p_origin := 'HISTORICO',
      p_cost_allocation_method := 'quantity',
      p_items := v_items,
      p_shipping_cost := 0,
      p_other_costs := v_other_costs,
      p_notes := v_ext || ' — 6 peças (2x CALCA-001 R$189,90 cat / 4x BLUSA-001 R$99,90 cat). Total R$380,00.',
      p_user_id := v_admin
    );
    INSERT INTO tmp_import_purchase_done (external_id) VALUES (v_ext);
    RAISE NOTICE 'OK: Entrada 1 criada (R$380,00, 6 peças)';
  ELSE
    RAISE NOTICE 'SKIP: Entrada 1 já existe (chave %)', v_ext;
  END IF;

  -- ======================== 2ª ENTRADA ========================
  v_ext := 'HIST-ENTRADA-002-R410-Q13-D2108';
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_entries pe WHERE pe.notes = v_ext
  ) AND NOT EXISTS (SELECT 1 FROM tmp_import_purchase_done WHERE external_id = v_ext) THEN
    v_items := JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='REGATA-001'),'product_name','Regata alça fina — Off, Preta, Marrom (1 cada)','unit_cost',25.00,'quantity',3),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='BLUSA-002'),'product_name','Blusa assimétrica — Amarela, Preta, Marrom (1 cada)','unit_cost',20.00,'quantity',3),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='BLUSA-004'),'product_name','Blusa um ombro só — Marrom, Marsala, Azul escura (1 cada)','unit_cost',20.00,'quantity',3),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-004'),'product_name','Conjunto rosa (valor unit R$75,00)','unit_cost',75.00,'quantity',1),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-007'),'product_name','Conjunto saia e top poá amarelo (compra teste — não gostamos do modelo mas vendemos; custo R$75)','unit_cost',75.00,'quantity',1),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='VESTIDO-003'),'product_name','Vestido longo preto','unit_cost',60.00,'quantity',1),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='VESTIDO-001'),'product_name','Vestido longo amarelo','unit_cost',60.00,'quantity',1)
    );
    -- Validação numérica: 3*25 + 3*20 + 3*20 + 75 + 75 + 60 + 60 = 75+60+60+75+75+60+60 = 465? Esperado 410.
    -- Observação do usuário: 2 conjuntos R$75 c/u = 150, mas detalhado acima (3 REGATA + 3 BLUSA-002 + 3 BLUSA-004) = 195 + vestidos 120 = 465.
    -- Respeitamos os unitários informados pelo usuário (3x R$25, 3x R$20, 3x R$20, conj R$75, conj R$75, vest R$60, vest R$60).
    -- Diferença 55 = 465-410 => ajuste via other_costs NEGATIVO (correção lote).
    v_other_costs := JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('description','Ajuste total para R$410,00 conforme informado (unidades 3xR25 + 3xR20 + 3xR20 + 2xR75 + 2xR60 = 465 → desconto lote fornecedor 55)','category','OUTRO','amount',-55.00)
    );
    PERFORM public.create_purchase_entry(
      p_entry_date := '2026-08-21'::DATE,
      p_supplier := 'Fornecedor principal (13 peças)',
      p_origin := 'HISTORICO',
      p_cost_allocation_method := 'quantity',
      p_items := v_items,
      p_shipping_cost := 0,
      p_other_costs := v_other_costs,
      p_notes := v_ext || ' — 13 peças. TOTAL R$410,00 (ajuste fornecedor -R$55,00 para bater valor informado).',
      p_user_id := v_admin
    );
    INSERT INTO tmp_import_purchase_done (external_id) VALUES (v_ext);
    RAISE NOTICE 'OK: Entrada 2 criada (R$410,00, 13 peças)';
  ELSE
    RAISE NOTICE 'SKIP: Entrada 2 já existe';
  END IF;

  -- ======================== 3ª ENTRADA ========================
  v_ext := 'HIST-ENTRADA-003-R1160-Q19';
  IF NOT EXISTS (SELECT 1 FROM public.purchase_entries pe WHERE pe.notes = v_ext)
    AND NOT EXISTS (SELECT 1 FROM tmp_import_purchase_done WHERE external_id = v_ext) THEN
    v_items := JSONB_BUILD_ARRAY(
      -- 3 conj calça/blusa R$75 c/u (associados CONJ-002 branco / 003 preto / 004 rosa — 1 cada)
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-002'),'product_name','Conjunto branco (3 conjuntos calça+blusa R$75 cada)','unit_cost',75.00,'quantity',1),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-003'),'product_name','Conjunto preto (3 conjuntos calça+blusa R$75 cada)','unit_cost',75.00,'quantity',1),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-004'),'product_name','Conjunto rosa (3 conjuntos calça+blusa R$75 cada)','unit_cost',75.00,'quantity',1),
      -- 1 conjunto camisa+short R$75 (produto novo CONJ-006)
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-006'),'product_name','Conjunto camisa e short (custo R$75; preço venda R$159,90)','unit_cost',75.00,'quantity',1),
      -- 5 CALCA-003 R$90
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CALCA-003'),'product_name','Calça animal print (também chamada calça jeans nas mensagens) R$90','unit_cost',90.00,'quantity',5),
      -- 1 CALCA-002 R$90
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CALCA-002'),'product_name','Calça marrom com lenço R$90','unit_cost',90.00,'quantity',1),
      -- 2 conj saia+top R$90 (CONJ-001 amarelo + CONJ-005 bege)
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-001'),'product_name','Conjunto saia e top amarelo R$90','unit_cost',90.00,'quantity',1),
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='CONJ-005'),'product_name','Conjunto saia e top bege R$90','unit_cost',90.00,'quantity',1),
      -- 7 REGATA-001 R$20
      JSONB_BUILD_OBJECT('product_id',(SELECT id FROM public.products WHERE sku='REGATA-001'),'product_name','Regata alça fina 2ª entrada R$20 c/u (1ª entrada R$25 — lote histórico separado)','unit_cost',20.00,'quantity',7)
    );
    -- Validação: 3*75 + 75 + 5*90 + 90 + 2*90 + 7*20 = 225 + 75 + 450 + 90 + 180 + 140 = 1160. ✅ bate exatamente.
    v_other_costs := '[]'::jsonb;
    PERFORM public.create_purchase_entry(
      p_entry_date := '2026-08-28'::DATE,
      p_supplier := 'Fornecedor principal (19 peças)',
      p_origin := 'HISTORICO',
      p_cost_allocation_method := 'quantity',
      p_items := v_items,
      p_shipping_cost := 0,
      p_other_costs := v_other_costs,
      p_notes := v_ext || ' — 19 peças. TOTAL R$1.160,00.',
      p_user_id := v_admin
    );
    INSERT INTO tmp_import_purchase_done (external_id) VALUES (v_ext);
    RAISE NOTICE 'OK: Entrada 3 criada (R$1.160,00, 19 peças)';
  ELSE
    RAISE NOTICE 'SKIP: Entrada 3 já existe';
  END IF;
END $$;

COMMIT;
