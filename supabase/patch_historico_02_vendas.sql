-- ============================================================
-- PATCH 2: 18 VENDAS HISTÓRICAS + CORREÇÕES PENDENTE/PARCIAL
-- ============================================================
-- Pré-requisito: RODAR PRIMEIRO patch_historico_01_estoque.sql
--   (precisa dos 38 peças de estoque criadas para FIFO baixar)
--
-- ESTRATÉGIA por venda:
--   a) monta items[{unit_sale_price = preço catálogo, unit_actual_price = preço cobrado, discount = unit_sale_price - unit_actual_price}]
--   b) soma subtotal = Σ (quantity * unit_sale_price)
--   c) soma cobrado = Σ (quantity * unit_actual_price)
--   d) diferença (subtotal - cobrado) vem de 2 fontes:
--      (d1) desconto produto (já no discount do item) + (d2) pix_discount (se método=PIX E pix_enabled=10% habilitado)
--   e) sobra não explicada → general_discount (ex: arredondamento para fechar cobrado exato)
--   f) pagamento = Infinity LINK / Infinity TAP PIX / MP / Pix Direto.
-- ============================================================

BEGIN;

-- Tipos auxiliares (sessão)
DO $$ BEGIN
  CREATE TYPE __import_line AS (sku_s TEXT, qty INTEGER, actual NUMERIC(12,2));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- VALIDAÇÃO FAIL-FAST: TODOS OS SKUs USADOS NAS 18 VENDAS
--   Devem existir em public.products. Se faltar um, ABORTA AQUI
--   (não deixa passar pra depois dar erro genérico "Nenhum item")
-- ============================================================
DO $$
DECLARE
  _need TEXT[] := ARRAY[
    'BLUSA-001','BLUSA-002','BLUSA-003','BLUSA-004',
    'CALCA-001','CALCA-002','CALCA-003',
    'CONJ-001','CONJ-002','CONJ-003','CONJ-004','CONJ-005','CONJ-006','CONJ-007',
    'REGATA-001','VESTIDO-001','VESTIDO-002','VESTIDO-003'
  ];
  _miss TEXT[] := ARRAY[]::TEXT[];
  _s TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products LIMIT 1) THEN
    RAISE EXCEPTION 'public.products está VAZIO. RODE PRIMEIRO patch_historico_01_estoque.sql!';
  END IF;
  FOREACH _s IN ARRAY _need LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.sku = _s) THEN
      _miss := array_append(_miss, _s);
    END IF;
  END LOOP;
  IF array_length(_miss, 1) > 0 THEN
    RAISE EXCEPTION E'ATENÇÃO: SKUs obrigatórios NÃO EXISTEM no banco: %\nRODE PRIMEIRO patch_historico_01_estoque.sql (ele cria BLUSA-004, CONJ-006, CONJ-007 e garante os 15 antigos).', array_to_string(_miss, ', ');
  END IF;
  RAISE NOTICE '✔ VALIDAÇÃO OK: 18 SKUs obrigatórios existem no banco public.products';
END $$;


DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  -- Providers
  v_prov_infinite UUID := (SELECT id FROM public.payment_providers WHERE code = 'INFINITEPAY' ORDER BY created_at LIMIT 1);
  v_prov_mp       UUID := (SELECT id FROM public.payment_providers WHERE code = 'MERCADOPAGO' ORDER BY created_at LIMIT 1);
  v_prov_pixdir   UUID := (SELECT id FROM public.payment_providers WHERE code = 'PIX_DIRETO' ORDER BY created_at LIMIT 1);
  -- Modalities
  v_mod_link UUID := (SELECT id FROM public.payment_modalities m WHERE m.provider_id = v_prov_infinite AND code = 'LINK' ORDER BY created_at LIMIT 1);
  v_mod_tap  UUID := (SELECT id FROM public.payment_modalities m WHERE m.provider_id = v_prov_infinite AND code = 'TAP'  ORDER BY created_at LIMIT 1);
  v_mod_pixd UUID := (SELECT id FROM public.payment_modalities m WHERE m.provider_id = v_prov_pixdir   AND code = 'DIRETO' ORDER BY created_at LIMIT 1);
  v_mod_mpco UUID := (SELECT id FROM public.payment_modalities m WHERE m.provider_id = v_prov_mp       AND code = 'CHECKOUT' ORDER BY created_at LIMIT 1);
  -- SKUs
  sku RECORD; -- cache produto por sku
  i RECORD;    -- iterador jsonb (usado nos FOR IN SELECT jsonb_array_elements
  r RECORD;    -- iterador para queries VALUES
  oc RECORD;     -- (mantém back-compat nome antigo
  v_ext TEXT;
  v_customer TEXT;
  v_date TIMESTAMPTZ;
  v_payment JSONB;
  v_packaging JSONB := NULL;
  v_source TEXT;
  v_items JSONB;
  v_installments INTEGER;
  v_method TEXT;
  v_status TEXT;
  v_charged NUMERIC(12,2);
  v_paid NUMERIC(12,2);
  v_subtotal NUMERIC(12,2);
  v_items_discount NUMERIC(12,2);
  v_estimated_pix_discount NUMERIC(12,2);
  v_general_discount NUMERIC(12,2);
  v_pix_enabled BOOLEAN;
  v_pix_percent NUMERIC;
  v_tmp NUMERIC;
  v_tmp2 NUMERIC;
  v_line JSONB;
  v_lines JSONB[];
  _line JSONB;
  v_sale_id UUID;
  v_sale_friendly INTEGER;
  v_real_fee NUMERIC(12,4);
  v_expected_fee NUMERIC(12,4);
  v_fee_percent NUMERIC(8,4);
BEGIN
  -- Pix settings
  v_pix_enabled := COALESCE((SELECT value::jsonb->>'value' FROM public.settings s WHERE key='pix_discount_enabled')::BOOLEAN, true);
  v_pix_percent := COALESCE((SELECT value::jsonb->>'value' FROM public.settings s WHERE key='pix_discount_percent')::NUMERIC, 10);

  -- Helper helper inline
  -- Variáveis de trabalho
  -- ------------- FUNÇÃO HELPER: adicionar linha (SKU, qtd, preço cobrado) ---------------
  --

  -- ================================================================================
  -- 1. VENDA Maria Luísa | 22/08/2026 | 3 peças | LINK 2x | R$218,21 PAGO | CONCLUIDA
  -- 2x BLUSA-002 | 1x BLUSA-001
  -- ================================================================================
  v_ext := 'HIST-VENDA-001-MARIA-LUISA-220826';
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name = 'Maria Luísa' AND s.source = 'DISTANCIA' AND s.sale_date::DATE = '2026-08-22'::DATE)
 THEN

    v_lines := ARRAY[]::JSONB[];
    -- linha: 2x BLUSA-002 (cat 69,90). Quanto cobrou? Total cobrado 218,21. BLUSA-001 cat 99,90.
    -- Vamos distribuir: 2x BLUSA-002 cobrado (218,21-99,90)/2 = 59,155 -> 59,16 + 59,15 (arredonda pra bater).
    FOR sku IN SELECT p.id, p.sku, p.sale_price FROM public.products p WHERE p.sku='BLUSA-002' LOOP
      v_line := JSONB_BUILD_OBJECT(
        'product_id', sku.id, 'variant_id', NULL, 'product_name', 'Blusa assimétrica (histórico Maria Luísa #1/2)',
        'variant', NULL, 'sku', sku.sku, 'quantity', 1,
        'unit_sale_price', sku.sale_price, 'unit_actual_price', 59.16, 'discount', ROUND(sku.sale_price - 59.16, 2)
      );
      v_lines := array_append(v_lines, v_line);
      v_line := JSONB_BUILD_OBJECT(
        'product_id', sku.id, 'variant_id', NULL, 'product_name', 'Blusa assimétrica (histórico Maria Luísa #2/2)',
        'variant', NULL, 'sku', sku.sku, 'quantity', 1,
        'unit_sale_price', sku.sale_price, 'unit_actual_price', 59.15, 'discount', ROUND(sku.sale_price - 59.15, 2)
      );
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id, p.sku, p.sale_price FROM public.products p WHERE p.sku='BLUSA-001' LOOP
      v_line := JSONB_BUILD_OBJECT(
        'product_id', sku.id, 'variant_id', NULL, 'product_name', 'Blusa de renda',
        'variant', NULL, 'sku', sku.sku, 'quantity', 1,
        'unit_sale_price', sku.sale_price, 'unit_actual_price', 99.90, 'discount', ROUND(sku.sale_price - 99.90, 2)
      );
      v_lines := array_append(v_lines, v_line);
    END LOOP;

    -- Calcula totais
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER  * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 218.21;
    -- desconto PIX? não (pagamento é credito 2x LINK)
    v_estimated_pix_discount := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix_discount);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;

    v_method := 'CREDITO'; v_installments := 2; v_source := 'DISTANCIA'; v_date := '2026-08-22 14:00:00-03'; v_status := 'CONCLUIDA'; v_paid := 218.21;
    -- taxa LINK 2x = 6.09%
    v_fee_percent := 6.09; v_expected_fee := ROUND(v_charged * v_fee_percent / 100, 2); v_real_fee := v_expected_fee;
    v_payment := JSONB_BUILD_OBJECT(
      'provider_id', v_prov_infinite, 'modality_id', v_mod_link, 'method', v_method,
      'installments', v_installments, 'amount', v_paid,
      'fee_percent', v_fee_percent, 'fee_expected', v_expected_fee, 'fee_actual', v_real_fee,
      'provider_snapshot', 'InfinitePay', 'modality_snapshot', 'Link de Pagamento'
    );
    v_items := array_to_json(v_lines)::jsonb;
    v_customer := 'Maria Luísa';
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA Maria Luísa: 0 itens criados. SKUs procurados: BLUSA-002 (2x), BLUSA-001 (1x). Verifique se existem em public.products';
    END IF;
    v_sale_id := (public.finalize_sale(
      p_source := v_source, p_items := v_items, p_general_discount := v_general_discount,
      p_coupon_id := NULL, p_coupon_code := NULL, p_pix_discount := v_estimated_pix_discount,
      p_payment := v_payment, p_packaging := NULL, p_extra_costs := '[]'::jsonb,
      p_customer_name := v_customer, p_customer_phone := NULL, p_user_id := v_admin
    )->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;

    RAISE NOTICE 'OK Venda 1 % #%', v_customer, v_sale_friendly;
  END IF;

  -- ================================================================================
  -- 2. VENDA Amanda | 22/08/2026 | 1x BLUSA-002 | PIX 60,00 PAGO | CONCLUIDA
  -- ================================================================================
  v_ext := 'HIST-VENDA-002-AMANDA-220826';
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Amanda' AND s.sale_date::DATE='2026-08-22')
     THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-002' LOOP
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica','variant',NULL,'sku',sku.sku,'quantity',1,
        'unit_sale_price',sku.sale_price,'unit_actual_price',60.00,'discount',ROUND(sku.sale_price-60.00,2));
      v_lines := array_append(v_lines,v_line);
    END LOOP;
    v_subtotal:=0; v_items_discount:=0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 60.00;
    -- desconto Pix: 10% sobre subtotal - descontos itens => (69.90 - 9.90) * 10% = 6? espera, total cobrado 60.00.
    -- Cat 69.90, cobrado 60.00 => desconto item 9.90 (porque 69.90 * 0.9 = 62.91 → cobrado 60.00, não é 10% puro)
    -- Vamos usar: pix_discount = 0 se já bate com desconto item.
    -- (69.90 subtotal) - 9.90 desconto item = 60.00. Bate exato. Então pix_discount = 0.
    v_estimated_pix_discount := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix_discount);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-08-22 15:00:00-03'; v_paid := 60.00;
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := JSONB_BUILD_OBJECT('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method',v_method,'installments',1,'amount',v_paid,
      'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA Amanda: 0 itens criados. SKUs procurados: CALCA-001 (1x) R$60. Verifique public.products';
    END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=v_estimated_pix_discount,
      p_payment:=v_payment,p_customer_name:='Amanda',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;

    RAISE NOTICE 'OK Venda 2 Amanda #%', v_sale_friendly;
  END IF;

  -- ================================================================================
  -- 3. VENDA Lorrany | 23/08/26 | 4 itens | LINK 3x | 399,90 | CONCLUIDA
  --    1x CONJ-004 (cat 189,90) | 1x BLUSA-003 (assimétrica com renda cat 99,90) | 1x REGATA-001 (69,90) | 1x BLUSA-002 (69,90)
  --    Total catálogo = 429,60. Cobrado 399,90. Desconto total = 29,70.
  -- ================================================================================
  v_ext := 'HIST-VENDA-003-LORRANY-230826';
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE customer_name='Lorrany' AND sale_date::DATE='2026-08-23')
  THEN
    v_lines := ARRAY[]::JSONB[];
    -- Rateio do desconto de 29,70 proporcional ao valor cobrado
    -- Valores cobrados (estimados): CONJ004 180 + BLUSA003 95 + REGATA 60 + BLUSA002 64,90 = 399,90
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku IN ('CONJ-004','BLUSA-003','REGATA-001','BLUSA-002') ORDER BY p.sku LOOP
      v_tmp := CASE sku.sku
        WHEN 'CONJ-004' THEN 180.00
        WHEN 'BLUSA-003' THEN 95.00
        WHEN 'REGATA-001' THEN 60.00
        WHEN 'BLUSA-002' THEN 64.90
      END;
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name',(SELECT name FROM public.products WHERE id=sku.id),
        'variant',NULL,'sku',sku.sku,'quantity',1,
        'unit_sale_price',sku.sale_price,'unit_actual_price',v_tmp,'discount',ROUND(sku.sale_price - v_tmp,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal:=0; v_items_discount:=0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 399.90; v_estimated_pix_discount := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method:='CREDITO'; v_installments:=3; v_date:='2026-08-23 16:00:00-03'; v_paid := 399.90;
    -- LINK 3x não tem taxa informada (usuário informou só 1x/2x). Mantemos 7,19 do default antigo (não informado pelo usuário).
    v_fee_percent := 7.19; v_expected_fee := ROUND(v_charged*7.19/100,2); v_real_fee := v_expected_fee;
    v_payment := JSONB_BUILD_OBJECT('provider_id',v_prov_infinite,'modality_id',v_mod_link,'method','CREDITO','installments',3,'amount',v_paid,
      'fee_percent',7.19,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,
      'provider_snapshot','InfinitePay','modality_snapshot','Link de Pagamento');
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA Lorrany: 0 itens criados. SKUs procurados: CONJ-002, CONJ-003, CONJ-004 (3 conj R$120).';
    END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_payment:=v_payment,
      p_customer_name:='Lorrany',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date=v_date WHERE id=v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date=v_date::DATE WHERE related_sale_id=v_sale_id;

    RAISE NOTICE 'OK Venda 3 Lorrany #%', v_sale_friendly;
  END IF;

  -- ================================================================================
  -- 4. Eduarda Neri | 24/08 | 1x BLUSA-004 (umbro só) | PIX R$65,00 | CONCLUIDA
  -- 5. Rebeca     | 02/09 | 1x BLUSA-004 | PIX R$59,90 | CONCLUIDA
  -- 6. Ruth       | 03/09 | 2x BLUSA-002 | PIX R$119,80 (59,90 cada) | CONCLUIDA
  -- 7. Ana Larissa| 04/09 | 1x BLUSA-002 | PIX R$65,00 | CONCLUIDA
  -- 8. Ingrid     | 09/09 | 1x BLUSA-002 | PIX R$59,90 | CONCLUIDA
  -- ================================================================================
  -- TODO: simplifica aqui: usa 5 blocos iguais com loop
  <<vendaspixsimples>>
  DECLARE
    r RECORD;
    v_discount NUMERIC(12,2);
    v_actual NUMERIC(12,2);
  BEGIN
    FOR r IN SELECT * FROM (VALUES
      ('HIST-VENDA-004-EDUARDA-NERI-240826','Eduarda Neri','BLUSA-004',1,65.00,'2026-08-24 14:00:00-03'::TIMESTAMPTZ),
      ('HIST-VENDA-005-REBECA-020926','Rebeca','BLUSA-004',1,59.90,'2026-09-02 14:00:00-03'::TIMESTAMPTZ),
      ('HIST-VENDA-006-RUTH-030926','Ruth','BLUSA-002',2,119.80,'2026-09-03 14:00:00-03'::TIMESTAMPTZ),
      ('HIST-VENDA-007-ANA-LARISSA-040926','Ana Larissa','BLUSA-002',1,65.00,'2026-09-04 14:00:00-03'::TIMESTAMPTZ),
      ('HIST-VENDA-008-INGRID-090926','Ingrid','BLUSA-002',1,59.90,'2026-09-09 14:00:00-03'::TIMESTAMPTZ)
    ) t(ext, cust, sku_s, qtd, charged, dt)
    LOOP
      IF EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name = r.cust AND s.sale_date::DATE = r.dt::DATE) THEN CONTINUE; END IF;
      v_lines := ARRAY[]::JSONB[];
      FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku = r.sku_s LOOP
        v_actual := ROUND(r.charged / r.qtd, 2);
        v_discount := ROUND(sku.sale_price - v_actual, 2);
        v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name',(SELECT name FROM public.products WHERE id=sku.id),
          'variant',NULL,'sku',sku.sku,'quantity',r.qtd,
          'unit_sale_price',sku.sale_price,'unit_actual_price',v_actual,'discount',v_discount);
        v_lines := array_append(v_lines, v_line);
      END LOOP;
      v_subtotal:=0; v_items_discount:=0;
      FOREACH _line IN ARRAY v_lines LOOP
        v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
        v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
      END LOOP;
      v_charged := r.charged;
      -- cobrado bate com items - descontos items?
      v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged);
      IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
      v_payment := JSONB_BUILD_OBJECT('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_charged,
        'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
      v_items := array_to_json(v_lines)::jsonb;
      IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
        RAISE EXCEPTION 'VENDA % (SKU % qtd %): 0 itens criados. Verifique se esse SKU existe em public.products.', r.cust, r.sku_s, r.qtd;
      END IF;
      v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_payment:=v_payment,
        p_customer_name:=r.cust,p_user_id:=v_admin)->>'sale_id')::UUID;
      UPDATE public.sales SET sale_date=r.dt WHERE id=v_sale_id RETURNING friendly_number INTO v_sale_friendly;
      UPDATE public.financial_transactions SET trans_date=r.dt::DATE WHERE related_sale_id=v_sale_id;
      RAISE NOTICE 'OK Venda %', r.cust;
    END LOOP;
  END vendaspixsimples;

  -- ================================================================================
  -- 9. Emilly Gabrielly | 09/09 | 1x REGATA + 1x BLUSA-003 (assimétrica com renda, não BLUSA-001 renda) | PIX R$139,30
  --    cat: 69,90 + 99,90 = 169,80. Desconto total = 30,50. Cobrado 139,30.
  -- ================================================================================
  v_ext := 'HIST-VENDA-009-EMILLY-090926';
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE customer_name='Emilly Gabrielly')  THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='REGATA-001' LOOP
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name','Regata alça fina','variant',NULL,'sku',sku.sku,'quantity',1,
        'unit_sale_price',sku.sale_price,'unit_actual_price',60.00,'discount',ROUND(sku.sale_price-60.00,2));
      v_lines := array_append(v_lines,v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-003' LOOP
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica com renda (histórico Emilly)','variant',NULL,'sku',sku.sku,'quantity',1,
        'unit_sale_price',sku.sale_price,'unit_actual_price',79.30,'discount',ROUND(sku.sale_price-79.30,2));
      v_lines := array_append(v_lines,v_line);
    END LOOP;
    v_subtotal:=0; v_items_discount:=0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 139.30;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged);
    IF v_general_discount<0 THEN v_general_discount := 0; END IF;
    v_payment := JSONB_BUILD_OBJECT('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_charged,
      'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA Emilly Gabrielly: 0 itens criados. SKUs: REGATA-001, BLUSA-003 (assimétrica com renda).';
    END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_payment:=v_payment,
      p_customer_name:='Emilly Gabrielly',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date='2026-09-09 15:00:00-03' WHERE id=v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date='2026-09-09'::DATE WHERE related_sale_id=v_sale_id;

    RAISE NOTICE 'OK Venda 9 Emilly Gabrielly #%', v_sale_friendly;
  END IF;

  -- ================================================================================
  -- 10. Maria Clara | 11/09 | 1x CALCA-003 (animal print / "jeans") + 1x REGATA-001
  --                     PIX R$229,80. Cat: 189,90 + 69,90 = 259,80. Desconto 30,00.
  -- ================================================================================
  v_ext := 'HIST-VENDA-010-MARIA-CLARA-110926';
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE customer_name='Maria Clara')  THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CALCA-003' LOOP
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name','Calça animal print (histórico: calça jeans)','variant',NULL,'sku',sku.sku,'quantity',1,
        'unit_sale_price',sku.sale_price,'unit_actual_price',169.90,'discount',ROUND(sku.sale_price-169.90,2));
      v_lines := array_append(v_lines,v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='REGATA-001' LOOP
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name','Regata alça fina','variant',NULL,'sku',sku.sku,'quantity',1,
        'unit_sale_price',sku.sale_price,'unit_actual_price',59.90,'discount',ROUND(sku.sale_price-59.90,2));
      v_lines := array_append(v_lines,v_line);
    END LOOP;
    v_subtotal:=0; v_items_discount:=0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged:=229.80; v_general_discount:=GREATEST(0,v_subtotal-v_items_discount-v_charged);
    IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_payment := JSONB_BUILD_OBJECT('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_charged,
      'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA Maria Clara: 0 itens criados. SKUs: CONJ-005, CALCA-002.';
    END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_payment:=v_payment,
      p_customer_name:='Maria Clara',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date='2026-09-11 14:00:00-03' WHERE id=v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date='2026-09-11'::DATE WHERE related_sale_id=v_sale_id;

    RAISE NOTICE 'OK Venda 10 Maria Clara #%', v_sale_friendly;
  END IF;

  -- ================================================================================
  -- 11. Júlia Caetano | 12/09 | 1x VESTIDO-001 (longo amarelo) | PIX R$169,90 (cat 189,90 => -20)
  -- 12. Matheus Lima   | 16/09 | 1x CALCA-003 (animal print) | PIX R$180,00 (cat 189,90)
  -- 13. Leticia clínica| 16/09 | 1x CALCA-003 | LINK R$189,90 | CONCLUIDA (PAGO 1x? default 1x = 4.2%)
  -- ================================================================================
  <<vendas11a13>>
  DECLARE r RECORD;
  BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('HIST-VENDA-011-JULIA-CAETANO-120926','Júlia Caetano','VESTIDO-001',1,169.90,'2026-09-12 14:00:00-03'::TIMESTAMPTZ,'PIX',v_prov_pixdir,v_mod_pixd,0.00::NUMERIC,1,true),
    ('HIST-VENDA-012-MATHEUS-LIMA-160926','Matheus Lima','CALCA-003',1,180.00,'2026-09-16 09:00:00-03'::TIMESTAMPTZ,'PIX',v_prov_pixdir,v_mod_pixd,0.00,1,true),
    ('HIST-VENDA-013-LETICIA-CLINICA-160926','Leticia (clínica)','CALCA-003',1,189.90,'2026-09-16 10:00:00-03'::TIMESTAMPTZ,'CREDITO',v_prov_infinite,v_mod_link,4.20,1,true)
  ) t(ext, cust, sku_s, qtd, charged, dt, meth, prov, modl, fee_pct, ins, pay)
  LOOP
    IF EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name=r.cust AND s.sale_date::DATE=r.dt::DATE) THEN CONTINUE; END IF;
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku=r.sku_s LOOP
      v_tmp := ROUND(r.charged / r.qtd, 2);
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name',(SELECT name FROM public.products WHERE id=sku.id),
        'variant',NULL,'sku',sku.sku,'quantity',r.qtd,
        'unit_sale_price',sku.sale_price,'unit_actual_price',v_tmp,'discount',ROUND(sku.sale_price-v_tmp,2));
      v_lines := array_append(v_lines,v_line);
    END LOOP;
    v_subtotal:=0; v_items_discount:=0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := r.charged;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged);
    IF v_general_discount<0 THEN v_general_discount := 0; END IF;
    v_expected_fee := ROUND(v_charged * r.fee_pct / 100, 2); v_real_fee := v_expected_fee;
    v_payment := JSONB_BUILD_OBJECT('provider_id',r.prov,'modality_id',r.modl,'method',r.meth,'installments',r.ins,'amount',CASE WHEN r.pay THEN v_charged ELSE 0 END,
      'fee_percent',r.fee_pct,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,
      'provider_snapshot',CASE WHEN r.prov = v_prov_infinite THEN 'InfinitePay' WHEN r.prov=v_prov_pixdir THEN 'Pix Direto' ELSE 'Outro' END,
      'modality_snapshot',CASE WHEN r.modl = v_mod_link THEN 'Link de Pagamento' ELSE 'Pix à vista' END);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA % (SKU único % qtd %): 0 itens criados. Verifique public.products.', r.cust, r.sku_s, r.qtd;
    END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_payment:=v_payment,
      p_customer_name:=r.cust,p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date=r.dt WHERE id=v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date=r.dt::DATE WHERE related_sale_id=v_sale_id;
    RAISE NOTICE 'OK Venda % #%', r.cust, v_sale_friendly;
  END LOOP;
  END vendas11a13;

  -- ================================================================================
  -- 14. Evelyn | PENDENTE | 1x CALCA-001 + 1x BLUSA-002 | TOTAL 240,00 | PAGO 0
  -- 15. Day    | 15/09 | PARCIAL | 1x CALCA-001 + 1x BLUSA-003 (assimétrica com renda, não era BLUSA-001 renda normal) | TOTAL 260 | PIX 130
  -- 16. Cristina| 14/09 | PARCIAL | 2x REGATA-001 | TOTAL 139,80 | PIX 69,90
  -- 17. Francisca | 16/09 | PARCIAL | 1x VESTIDO-003 (preto) | TOTAL 149,90 | RECEBIDO 80
  -- ================================================================================
  <<pendentes>>
  DECLARE r RECORD;
  BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('HIST-VENDA-014-EVELYN-PENDENTE','Evelyn',
      ARRAY[ROW('CALCA-001'::TEXT,1,NULL::NUMERIC),ROW('BLUSA-002',1,NULL)]::__import_line[],
      240.00, 0.00, NULL::TIMESTAMPTZ, 'PENDENTE', 'OUTRO'::TEXT, NULL::UUID, NULL::UUID, 0::NUMERIC, 1),
    ('HIST-VENDA-015-DAY-150926-PARCIAL','Day',
      ARRAY[ROW('CALCA-001',1,NULL),ROW('BLUSA-003',1,NULL)]::__import_line[],
      260.00, 130.00, '2026-09-15 14:00:00-03'::TIMESTAMPTZ, 'PARCIAL','PIX', v_prov_pixdir, v_mod_pixd, 0.00, 1),
    ('HIST-VENDA-016-CRISTINA-140926-PARCIAL','Cristina',
      ARRAY[ROW('REGATA-001',2,69.90::NUMERIC)]::__import_line[], -- valor cobrado c/u 69.90 * 2 = 139,80
      139.80, 69.90, '2026-09-14 14:00:00-03'::TIMESTAMPTZ, 'PARCIAL','PIX',v_prov_pixdir,v_mod_pixd,0.00,1),
    ('HIST-VENDA-017-FRANCISCA-160926-PARCIAL','Francisca',
      ARRAY[ROW('VESTIDO-003',1,149.90::NUMERIC)]::__import_line[],
      149.90, 80.00, '2026-09-16 14:00:00-03'::TIMESTAMPTZ, 'PARCIAL','OUTRO',NULL,NULL,0.00,1)
  ) t(ext, cust, lines, charged, paid, dt, status_, method_, prov, modl, fee_pct, ins)
  LOOP
    IF r.dt IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name=r.cust AND s.sale_date::DATE=r.dt::DATE) THEN CONTINUE; END IF;
    -- Monta linhas
    v_lines := ARRAY[]::JSONB[];
    v_tmp := 0; -- soma dos cobrados unitários, para distribuir o que não é preenchido
    v_tmp2 := 0;
    FOR i IN SELECT 1 AS idx, (a).sku_s, (a).qty, (a).actual FROM (SELECT UNNEST(r.lines) a) x LOOP
      FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku = i.sku_s LOOP
        IF i.actual IS NOT NULL THEN
          v_tmp := v_tmp + (i.qty * i.actual);
          v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name',(SELECT name FROM public.products WHERE id=sku.id),
            'variant',NULL,'sku',sku.sku,'quantity',i.qty,
            'unit_sale_price',sku.sale_price,'unit_actual_price',i.actual,'discount',ROUND(sku.sale_price - i.actual,2));
        ELSE
          v_tmp2 := v_tmp2 + i.qty; -- placeholders (não preenchemos ainda)
          v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,'product_name',(SELECT name FROM public.products WHERE id=sku.id),
            'variant',NULL,'sku',sku.sku,'quantity',i.qty,
            'unit_sale_price',sku.sale_price,'unit_actual_price',0,'discount',0);
        END IF;
        v_lines := array_append(v_lines,v_line);
      END LOOP;
    END LOOP;
    -- Preenche placeholders (Evelyn / Day): rateio proporcional (charged - v_tmp) dividido por v_tmp2
    IF v_tmp2 > 0 THEN
      v_tmp2 := ROUND((r.charged - v_tmp) / v_tmp2, 2); -- valor unitário médio por item
      -- Refazer lines com placeholders substituídos
      DECLARE
        new_lines JSONB[] := ARRAY[]::JSONB[];
        idx INTEGER := 0;
        place_actual NUMERIC := v_tmp2;
      BEGIN
        FOREACH _line IN ARRAY v_lines LOOP
          idx := idx + 1;
          IF (_line->>'unit_actual_price')::NUMERIC = 0 AND (_line->>'discount')::NUMERIC = 0 THEN
            v_tmp := COALESCE((SELECT sale_price FROM public.products WHERE id=(_line->>'product_id')::UUID),0);
            new_lines := array_append(new_lines, _line || JSONB_BUILD_OBJECT(
              'unit_actual_price', place_actual, 'discount', ROUND(v_tmp - place_actual,2)
            ));
          ELSE
            new_lines := array_append(new_lines, _line);
          END IF;
        END LOOP;
        v_lines := new_lines;
      END;
    END IF;
    -- Totais
    v_subtotal:=0; v_items_discount:=0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := r.charged; v_paid := r.paid;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged);
    IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_expected_fee := CASE WHEN r.prov IS NOT NULL THEN ROUND(v_paid * r.fee_pct / 100, 2) ELSE 0 END; v_real_fee := v_expected_fee;
    IF r.prov IS NOT NULL THEN
      v_payment := JSONB_BUILD_OBJECT('provider_id',r.prov,'modality_id',r.modl,'method',r.method_,'installments',r.ins,'amount',v_paid,
        'fee_percent',r.fee_pct,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,
        'provider_snapshot',CASE WHEN r.prov=v_prov_pixdir THEN 'Pix Direto' ELSE 'Outro' END,
        'modality_snapshot',CASE WHEN r.modl=v_mod_pixd THEN 'Pix à vista' ELSE 'Outro' END);
    ELSE
      v_payment := NULL; -- Evelyn: não tem pagamento nem info do método; Vamos colocar pagamento 0 para poder rodar finalize_sale
      v_payment := JSONB_BUILD_OBJECT('method','OUTRO','installments',1,'amount',0,
        'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Não informado','modality_snapshot','Não informado');
    END IF;
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA Pendente %: 0 itens criados. Verifique public.products (SKUs no array % na linha VALUES do bloco).', r.cust, r.lines::TEXT;
    END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_payment:=v_payment,
      p_customer_name:=r.cust,p_user_id:=v_admin)->>'sale_id')::UUID;
    -- Atualiza status CONCLUIDA -> PARCIAL ou PENDENTE
    UPDATE public.sales SET status = r.status_,
      sale_date = COALESCE(r.dt, '2026-09-16 18:00:00-03'::TIMESTAMPTZ)
      WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    -- Financeiro: finalize_sale lançou amount = total venda como entrada CONFIRMADO se for CONCLUIDA (linha 909).
    -- Vamos ajustar para: entrada = valor PAGO (CONFIRMADO) + SALDO A RECEBER = (total - pago) como PENDENTE.
    -- Step 1: apaga transações financeiras automáticas desta venda e recria manualmente
    DELETE FROM public.financial_transactions WHERE related_sale_id = v_sale_id;
    -- Entrada CONFIRMADA do que foi pago (se > 0)
    IF v_paid > 0 THEN
      INSERT INTO public.financial_transactions
        (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, created_by)
      VALUES (COALESCE(r.dt::DATE,CURRENT_DATE),'ENTRADA','VENDA',
        'Pagamento parcial Venda #'||lpad(v_sale_friendly::TEXT,6,'0')||' - '||r.cust,
        v_paid, v_sale_id, r.method_, 'CONFIRMADO', v_admin);
    END IF;
    -- Conta a receber (PENDENTE)
    IF (v_charged - v_paid) > 0 THEN
      INSERT INTO public.financial_transactions
        (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, due_date, created_by)
      VALUES (COALESCE(r.dt::DATE,CURRENT_DATE),'ENTRADA','VENDA',
        'Conta a receber Venda #'||lpad(v_sale_friendly::TEXT,6,'0')||' - '||r.cust||' ('||r.status_||')',
        (v_charged - v_paid), v_sale_id, r.method_, 'PENDENTE', COALESCE(r.dt::DATE + 30, CURRENT_DATE+30), v_admin);
    END IF;
    RAISE NOTICE 'OK Venda % #% (%)', r.cust, v_sale_friendly, r.status_;
  END LOOP;
  END pendentes;

  -- ================================================================================
  -- 18. Evellyn Luísa (fono) | PENDENTE | 1x Conjunto longo top e saia POÁ amarelo
  --     TOTAL 189,90 | RECEBIDO 0
  --     SKU REAL: CONJ-007 (cadastrado agora especificamente para este modelo)
  -- ================================================================================
  v_ext := 'HIST-VENDA-018-EVELLYN-LUISA-FONO-PENDENTE-POA';
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE customer_name LIKE 'Evellyn%' AND customer_name LIKE '%fono%')
     THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CONJ-007' LOOP
      v_line := JSONB_BUILD_OBJECT('product_id',sku.id,'variant_id',NULL,
        'product_name','Conjunto longo top e saia poá amarelo (modelo teste, não gostaram mas vendido)',
        'variant',NULL,'sku',sku.sku,'quantity',1,
        'unit_sale_price',sku.sale_price,'unit_actual_price',189.90,'discount',ROUND(sku.sale_price-189.90,2));
      v_lines := array_append(v_lines,v_line);
    END LOOP;
    v_subtotal:=0; v_items_discount:=0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INTEGER*(_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INTEGER*COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 189.90; v_paid := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged);
    IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_payment := JSONB_BUILD_OBJECT('method','OUTRO','installments',1,'amount',0,
      'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Não informado','modality_snapshot','Não informado');
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VENDA Evellyn Luísa (fono): 0 itens criados. SKU procurado: CONJ-007. RODE PRIMEIRO patch_01_estoque.sql (cria CONJ-007).';
    END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_payment:=v_payment,
      p_customer_name:='Evellyn Luísa (fono)',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET status='PENDENTE', sale_date='2026-09-16 17:00:00-03' WHERE id=v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    DELETE FROM public.financial_transactions WHERE related_sale_id = v_sale_id;
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, due_date, created_by)
    VALUES ('2026-09-16'::DATE,'ENTRADA','VENDA',
      'Conta a receber Venda #'||lpad(v_sale_friendly::TEXT,6,'0')||' - Evellyn Luísa (fono) - Conjunto poá amarelo (CONJ-007)',
      189.90, v_sale_id, 'OUTRO', 'PENDENTE', '2026-10-16'::DATE, v_admin);

    RAISE NOTICE 'OK Venda 18 Evellyn Luísa (fono, POÁ CONJ-007) #%', v_sale_friendly;
  END IF;

END $$;

COMMIT;
