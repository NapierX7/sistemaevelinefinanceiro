-- ============================================================
-- PATCH 10 — CONCILIAÇÃO DE ESTOQUE 17/09/2026
-- ============================================================
-- SCRIPT ÚNICO E SEGURO:
-- 1) TRANSAÇÃO ATÔMICA (BEGIN ... COMMIT / ROLLBACK automático em erro)
-- 2) IDEMPOTENTE (já rodou = SKIP tudo)
-- 3) NÃO apaga histórico: cria AJUSTE_POS / AJUSTE_NEG registrados
-- 4) Preserva financeiro, vendas, clientes, contas receber 100%
-- 5) Proteções item 7: bloqueia venda sem estoque e cancelamento protegido
-- ============================================================
-- MAPEAMENTO OFICIAL 13 PEÇAS (FÍSICO 17/09/2026):
--   REGATA-001     : Regata alça fina            5 un  × R$20 = R$100
--   CALCA-003      : Calça animal print          2 un  × R$90 = R$180
--   CALCA-002      : Calça marrom com lenço      1 un  × R$90 = R$90
--   CONJ-005       : Conjunto saia+top bege      1 un  × R$90 = R$90  <- escolha do usuário (B)
--   CONJ-006       : Conjunto camisa+short       1 un  × R$75 = R$75
--   CONJ-002       : Conjunto branco (calça+bl)  1 un  × R$75 = R$75
--   CONJ-003       : Conjunto preto (calça+bl)   1 un  × R$75 = R$75
--   CONJ-004       : Conjunto rosa (calça+bl)    1 un  × R$75 = R$75
--                          TOTAL:  13 PEÇAS  /  CUSTO: R$760,00
-- ============================================================
-- ZERADOS FORÇADOS (histórico inconsistente):
--   BLUSA-001, BLUSA-002, BLUSA-003, BLUSA-004, CALCA-001,
--   CONJ-001, CONJ-007, VESTIDO-001/002/003
-- ============================================================

BEGIN;

-- ============================================================
-- 0) FAIL-FAST: verifica 18 SKUs obrigatórios existem
-- ============================================================
DO $$
DECLARE
  _skus TEXT[] := ARRAY[
    'REGATA-001','VESTIDO-001','CALCA-001','BLUSA-001','BLUSA-002','BLUSA-003','BLUSA-004',
    'VESTIDO-002','VESTIDO-003','CONJ-001','CONJ-002','CONJ-003','CONJ-004','CONJ-005',
    'CONJ-006','CONJ-007','CALCA-002','CALCA-003'
  ];
  _miss TEXT[];
BEGIN
  SELECT ARRAY_AGG(s) INTO _miss
  FROM UNNEST(_skus) AS s
  WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.sku = s);
  IF COALESCE(ARRAY_LENGTH(_miss,1),0) > 0 THEN
    RAISE EXCEPTION 'SKUs obrigatórios NÃO EXISTEM no banco: %%. Rode seed/schema primeiro.', ARRAY_TO_STRING(_miss,', ')
      USING HINT = 'Patch 10 depende de todos os 18 SKUs originais do catálogo estarem em public.products';
  END IF;
END $$;

-- ============================================================
-- 1) IDEMPOTÊNCIA: se já rodou, aborta suavemente
-- ============================================================
DO $$
DECLARE
  _exec INTEGER;
BEGIN
  SELECT COUNT(*) INTO _exec
  FROM public.inventory_movements
  WHERE notes LIKE 'CONC_INV_17_09_2026%%';

  IF _exec > 0 THEN
    RAISE NOTICE '✅ Patch 10 JÁ FOI EXECUTADO anteriormente (%% movimentos conciliação encontrados). SKIP sem duplicatas.', _exec;
  END IF;
END $$;

-- Continua SÓ se não rodou ainda (não faz nada se já executou)
DO $$
DECLARE
  _exec INTEGER;
BEGIN
  SELECT COUNT(*) INTO _exec
  FROM public.inventory_movements
  WHERE notes LIKE 'CONC_INV_17_09_2026%%';

  IF _exec > 0 THEN
    RETURN;  -- pula o resto do bloco
  END IF;

  -- ============================================================
  -- 2) PASSO A: ZERA TODOS OS LOTES EXISTENTES (inventory_batches)
  --    com AJUSTE_NEG registrado em inventory_movements
  -- ============================================================
  -- CTE temporário não existe em DO; usamos loop anônimo por cursor
  DECLARE
    _admin UUID;
    _b RECORD;
    _total_zerados INTEGER := 0;
    _sku_name TEXT;
  BEGIN
    -- Admin fallback (igual outros patches)
    SELECT COALESCE(
      (SELECT id FROM public.profiles WHERE role IN ('ADMIN','ADMINISTRADOR') ORDER BY created_at LIMIT 1),
      (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1),
      (SELECT id FROM auth.users ORDER BY created_at LIMIT 1),
      gen_random_uuid()::UUID
    ) INTO _admin;

    -- Cursor: TODOS os lotes com quantity_available > 0
    FOR _b IN SELECT b.*, p.sku, p.name AS pname
              FROM public.inventory_batches b
              JOIN public.products p ON p.id = b.product_id
              WHERE b.quantity_available > 0
              ORDER BY p.sku, b.received_at, b.id
              FOR UPDATE OF b
    LOOP
      -- Zera o lote
      UPDATE public.inventory_batches
      SET quantity_available = 0, updated_at = now()
      WHERE id = _b.id;

      -- Registra o movimento AJUSTE_NEG
      _sku_name := COALESCE(_b.sku,'???') || ' ' || COALESCE(_b.pname,'');
      INSERT INTO public.inventory_movements
        (product_id, batch_id, movement_type, reason, quantity, unit_cost,
         created_by, notes, created_at)
      VALUES
        (_b.product_id, _b.id, 'AJUSTE_NEG',
         'CONCILIACAO_INVENTARIO_17_09_2026',
         _b.quantity_available,  -- quantidade que ERA disponível (foi zerada)
         _b.unit_cost,
         _admin,
         'CONC_INV_17_09_2026: Zerando lote histórico divergente | ' || _sku_name,
         now()::TIMESTAMPTZ);

      _total_zerados := _total_zerados + 1;
    END LOOP;

    RAISE NOTICE '✅ PASSO A OK: %% lotes antigos zerados via AJUSTE_NEG registrados.', _total_zerados;
  END;

  -- ============================================================
  -- 3) PASSO B: CRIA 8 NOVOS LOTES CONCILIADOS (13 peças R$760)
  --    + movimentos AJUSTE_POS
  -- ============================================================
  DECLARE
    _admin UUID;
    _pid UUID;
    _b_id UUID;
    _row RECORD;
  BEGIN
    SELECT COALESCE(
      (SELECT id FROM public.profiles WHERE role IN ('ADMIN','ADMINISTRADOR') ORDER BY created_at LIMIT 1),
      (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1),
      (SELECT id FROM auth.users ORDER BY created_at LIMIT 1),
      gen_random_uuid()::UUID
    ) INTO _admin;

    -- Tabela temporária virtual (loop implícito) com o mapeamento:
    FOR _row IN
      SELECT 'REGATA-001' AS sku, 5  AS qty, 20.00::NUMERIC(12,4) AS cost
      UNION ALL SELECT 'CALCA-003', 2, 90.00
      UNION ALL SELECT 'CALCA-002', 1, 90.00
      UNION ALL SELECT 'CONJ-005',  1, 90.00
      UNION ALL SELECT 'CONJ-006',  1, 75.00
      UNION ALL SELECT 'CONJ-002',  1, 75.00
      UNION ALL SELECT 'CONJ-003',  1, 75.00
      UNION ALL SELECT 'CONJ-004',  1, 75.00
    LOOP
      -- Busca product_id
      SELECT id INTO STRICT _pid FROM public.products WHERE sku = _row.sku;

      -- Cria lote conciliado
      INSERT INTO public.inventory_batches
        (product_id, variant_id, purchase_entry_id, purchase_item_id,
         unit_cost, allocated_purchase_cost,
         quantity_received, quantity_available, received_at, created_at)
      VALUES
        (_pid, NULL, NULL, NULL,
         _row.cost, 0,
         _row.qty, _row.qty,
         '2026-09-17 08:00:00-03'::TIMESTAMPTZ,
         now()::TIMESTAMPTZ)
      RETURNING id INTO _b_id;

      -- Registra movimento AJUSTE_POS
      INSERT INTO public.inventory_movements
        (product_id, batch_id, movement_type, reason, quantity, unit_cost,
         created_by, notes, created_at)
      VALUES
        (_pid, _b_id, 'AJUSTE_POS',
         'CONCILIACAO_INVENTARIO_17_09_2026',
         _row.qty, _row.cost,
         _admin,
         'CONC_INV_17_09_2026: Inventário físico 17/09/2026 | SKU ' || _row.sku || ' | ' || _row.qty || ' un | R$' || TRIM(TO_CHAR(_row.cost,'FM90D90')),
         now()::TIMESTAMPTZ);
    END LOOP;

    RAISE NOTICE '✅ PASSO B OK: 8 novos lotes conciliados criados via AJUSTE_POS (13 peças / R$760).';
  END;

  -- ============================================================
  -- 4) PASSO C: Atualiza current_cost em products (REGATA-001: R$25→R$20)
  --    Demais já estão corretos no seed (verificado)
  -- ============================================================
  DECLARE
  BEGIN
    UPDATE public.products
    SET current_cost = 20.00, updated_at = now()
    WHERE sku = 'REGATA-001' AND current_cost <> 20.00;

    IF FOUND THEN
      RAISE NOTICE '✅ PASSO C OK: current_cost REGATA-001 ajustado R$25,00 → R$20,00 (FIFO).';
    ELSE
      RAISE NOTICE 'ℹ️  PASSO C: REGATA-001 já possuía current_cost R$20,00 — sem alteração.';
    END IF;
  END;

END $$;

-- ============================================================
-- 5) PROTEÇÕES ITEM 7: MELHORIAS EM RPCs EXISTENTES
-- ============================================================

-- 5a) hist_finalize_sale agora BLOQUEIA venda quando ESTOQUE_TOTAL < QTD_PEDIDA
--     (Antes permitia "VENDA_SEM_LOTE" silenciosa — usuário pediu item 7:
--      "estoque nunca fique negativo por uma venda normal")
CREATE OR REPLACE FUNCTION public.hist_finalize_sale(
  p_source TEXT DEFAULT 'LOJA',
  p_items JSONB DEFAULT '[]'::jsonb,
  p_general_discount NUMERIC DEFAULT 0,
  p_coupon_code TEXT DEFAULT NULL,
  p_pix_discount NUMERIC DEFAULT 0,
  p_payment JSONB DEFAULT NULL,
  p_packaging JSONB DEFAULT NULL,
  p_extra_costs JSONB DEFAULT NULL,
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
  v_coupon_discount NUMERIC(12,2) := 0;
  v_total_discounts NUMERIC(12,2) := 0;
  v_total_customer NUMERIC(12,2) := 0;
  v_packaging_cost NUMERIC(12,4) := 0;
  v_extra_costs_total NUMERIC(12,2) := 0;
  v_items_cost NUMERIC(12,4) := 0;
  v_allocated_purchase_cost NUMERIC(12,4) := 0;
  v_fee_expected NUMERIC(12,2) := 0;
  v_fee_actual NUMERIC(12,2) := 0;
  v_real_profit NUMERIC(12,2) := 0;
  v_real_margin NUMERIC(10,4) := 0;

  _item JSONB;
  _extra JSONB;

  v_qty INTEGER;
  v_sale_price NUMERIC(12,2);
  v_actual_price NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_line_unit_cost NUMERIC(12,4) := 0;
  v_line_alloc NUMERIC(12,4) := 0;
  v_line_sub NUMERIC(12,2);
  v_line_total NUMERIC(12,2);
  v_current_cost NUMERIC(12,4);

  v_product_id UUID;
  v_lot RECORD;
  v_qty_needed INTEGER;
  v_this_qty INTEGER;
  v_batch_ids UUID[] := ARRAY[]::UUID[];
  v_cost_this_line NUMERIC(12,4);
  v_alloc_this_line NUMERIC(12,4);
  v_stock_total INTEGER;  -- NOVA: proteção item 7

  c_batches CURSOR (pid UUID) FOR
    SELECT b.* FROM public.inventory_batches b
    WHERE b.product_id = pid AND b.quantity_available > 0
    ORDER BY b.received_at, b.id
    FOR UPDATE;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'Nenhum item informado na venda'
      USING HINT = 'p_items JSONB deve conter pelo menos 1 produto com quantity >= 1';
  END IF;

  -- ================ NOVA PROTEÇÃO ITEM 7 =================
  -- Fail-fast por item: ESTOQUE TOTAL SOMADO DEVE SER >= QTD
  -- (Impede venda sem estoque, mesmo que queira "fallback")
  FOR _item IN SELECT v FROM jsonb_array_elements(p_items) AS t(v) LOOP
    v_qty        := COALESCE((_item->>'quantity')::INTEGER, 0);
    v_product_id := (_item->>'product_id')::UUID;
    IF v_product_id IS NULL AND (_item->>'sku') IS NOT NULL THEN
      SELECT id INTO v_product_id FROM public.products WHERE sku = (_item->>'sku') LIMIT 1;
    END IF;
    IF v_qty > 0 AND v_product_id IS NOT NULL THEN
      SELECT COALESCE(SUM(b.quantity_available),0) INTO STRICT v_stock_total
      FROM public.inventory_batches b
      WHERE b.product_id = v_product_id;

      IF v_stock_total < v_qty THEN
        RAISE EXCEPTION 'Estoque insuficiente para %% unids do produto %% (disponível: %% unids).',
          v_qty,
          COALESCE((SELECT sku FROM public.products WHERE id = v_product_id)::TEXT, v_product_id::TEXT),
          v_stock_total
          USING HINT = 'Conciliação em 17/09/2026 ativou proteção anti-venda-sem-estoque. Verifique o saldo atual no dashboard antes de vender.';
      END IF;
    END IF;
  END LOOP;
  -- ================ FIM PROTEÇÃO =========================

  SELECT (COALESCE(value::INT,0) + 1) INTO v_friendly FROM public.counters WHERE key='sale_friendly_number';
  IF NOT FOUND THEN
    v_friendly := 1;
    INSERT INTO public.counters(key,value) VALUES ('sale_friendly_number',1) ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.counters SET value = v_friendly WHERE key='sale_friendly_number';
  END IF;

  INSERT INTO public.sales
    (friendly_number, sale_date, status, source, customer_name, customer_phone, created_by)
  VALUES
    (v_friendly, now()::TIMESTAMPTZ, 'PENDENTE', p_source, p_customer_name, p_customer_phone, p_user_id)
  RETURNING id INTO v_sale_id;

  FOR _item IN SELECT v FROM jsonb_array_elements(p_items) AS t(v) LOOP
    v_qty          := COALESCE((_item->>'quantity')::INTEGER, 0);
    v_sale_price   := COALESCE((_item->>'unit_sale_price')::NUMERIC, 0);
    v_actual_price := COALESCE(NULLIF((_item->>'unit_actual_price')::NUMERIC, 0), v_sale_price);
    v_discount     := COALESCE((_item->>'discount')::NUMERIC, 0);
    v_product_id   := (_item->>'product_id')::UUID;

    IF v_product_id IS NULL AND (_item->>'sku') IS NOT NULL THEN
      SELECT id INTO v_product_id FROM public.products WHERE sku = (_item->>'sku') LIMIT 1;
    END IF;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Item sem product_id e sem sku válido na venda'
        USING HINT = 'JSON do item recebido: ' || LEFT(_item::TEXT, 200);
    END IF;
    IF v_qty < 1 THEN CONTINUE; END IF;

    v_current_cost := COALESCE((SELECT p.current_cost FROM public.products p WHERE p.id = v_product_id), 0);

    v_qty_needed := v_qty;
    v_batch_ids := ARRAY[]::UUID[];
    v_cost_this_line := 0;
    v_alloc_this_line := 0;
    OPEN c_batches(v_product_id);
    LOOP
      FETCH c_batches INTO v_lot; EXIT WHEN NOT FOUND;
      EXIT WHEN v_qty_needed <= 0;
      v_this_qty := LEAST(v_qty_needed, v_lot.quantity_available);
      IF v_this_qty > 0 THEN
        UPDATE public.inventory_batches
          SET quantity_available = quantity_available - v_this_qty, updated_at = now()
          WHERE CURRENT OF c_batches;
        v_cost_this_line  := v_cost_this_line  + ROUND(v_this_qty * v_lot.unit_cost, 4);
        v_alloc_this_line := v_alloc_this_line + ROUND(v_this_qty * COALESCE(v_lot.allocated_purchase_cost,0), 4);
        v_batch_ids := array_append(v_batch_ids, v_lot.id);
        INSERT INTO public.inventory_movements
          (product_id, movement_type, reason, quantity, unit_cost, related_sale_id, batch_id, created_by)
        VALUES (v_product_id, 'SAIDA', 'VENDA', v_this_qty, v_lot.unit_cost, v_sale_id, v_lot.id, p_user_id);
      END IF;
      v_qty_needed := v_qty_needed - v_this_qty;
    END LOOP;
    CLOSE c_batches;

    -- Devido à NOVA PROTEÇÃO ACIMA, v_qty_needed deve ser sempre 0.
    -- Mantemos fallback de segurança (nunca deve acontecer), mas registramos WARNING
    IF v_qty_needed > 0 THEN
      v_cost_this_line  := v_cost_this_line  + ROUND(v_qty_needed * v_current_cost, 4);
      v_alloc_this_line := v_alloc_this_line + 0;
      INSERT INTO public.inventory_movements
        (product_id, movement_type, reason, quantity, unit_cost, related_sale_id, batch_id, created_by, notes)
      VALUES
        (v_product_id, 'SAIDA', 'VENDA_SEM_LOTE_FALLBACK', v_qty_needed, v_current_cost, v_sale_id, NULL, p_user_id,
         'ATENÇÃO: Proteção de estoque falhou para esta linha. Verifique concorrência.');
      RAISE WARNING 'VENDA_SEM_LOTE_FALLBACK acionado (produto %% / %% unids). Proteção item 7 falhou. Investigar.',
        COALESCE(v_product_id::TEXT,'?'), v_qty_needed;
    END IF;

    v_line_unit_cost := v_cost_this_line;
    v_line_alloc     := v_alloc_this_line;
    v_line_sub       := v_sale_price * v_qty;
    v_line_total     := v_line_sub - v_discount;

    v_items_count     := v_items_count + v_qty;
    v_items_subtotal  := v_items_subtotal + v_line_sub;
    v_product_discounts := v_product_discounts + v_discount;
    v_items_cost       := v_items_cost + v_line_unit_cost;
    v_allocated_purchase_cost := v_allocated_purchase_cost + v_line_alloc;

    INSERT INTO public.sale_items (
      sale_id, product_id, variant_id, product_name_snapshot, variant_snapshot, sku_snapshot,
      quantity, unit_cost_snapshot, allocated_purchase_cost_snapshot,
      unit_sale_price_snapshot, unit_actual_price, discount, total,
      batch_ids_used
    ) VALUES (
      v_sale_id, v_product_id, (_item->>'variant_id')::UUID,
      COALESCE(_item->>'product_name','Produto sem nome'),
      _item->>'variant', _item->>'sku',
      v_qty,
      CASE WHEN v_qty>0 THEN ROUND(v_line_unit_cost / v_qty, 4) ELSE 0 END,
      CASE WHEN v_qty>0 THEN ROUND(v_line_alloc / v_qty, 4) ELSE 0 END,
      v_sale_price, v_actual_price, v_discount, v_line_total, v_batch_ids
    );
  END LOOP;

  v_total_discounts := v_product_discounts
                     + COALESCE(p_general_discount, 0)
                     + COALESCE(v_coupon_discount, 0)
                     + COALESCE(p_pix_discount, 0);
  v_total_customer := v_items_subtotal - v_total_discounts;
  IF v_total_customer < 0 THEN v_total_customer := 0; END IF;

  IF p_payment IS NOT NULL AND jsonb_typeof(p_payment) = 'object' THEN
    v_fee_expected := COALESCE((p_payment->>'fee_expected')::NUMERIC, 0);
    v_fee_actual   := COALESCE((p_payment->>'fee_actual')::NUMERIC, 0);
    DECLARE
      _amt NUMERIC := COALESCE((p_payment->>'amount')::NUMERIC, v_total_customer);
      _pid UUID    := (p_payment->>'provider_id')::UUID;
      _mid UUID    := (p_payment->>'modality_id')::UUID;
      _met TEXT    := COALESCE(p_payment->>'method','OUTRO');
      _ins INTEGER := COALESCE((p_payment->>'installments')::INTEGER, 1);
      _ps  TEXT    := p_payment->>'provider_snapshot';
      _ms  TEXT    := p_payment->>'modality_snapshot';
      _fr  UUID    := (p_payment->>'fee_rule_id')::UUID;
      _fp  NUMERIC := COALESCE((p_payment->>'fee_percent')::NUMERIC, 0);
    BEGIN
      INSERT INTO public.sale_payments (
        sale_id, provider_id, modality_id, method, installments,
        provider_snapshot, modality_snapshot, fee_rule_id,
        fee_percent_snapshot, fee_expected_snapshot, fee_real_snapshot, amount
      ) VALUES (v_sale_id,_pid,_mid,_met,_ins,_ps,_ms,_fr,_fp,v_fee_expected,v_fee_actual,_amt);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO public.sale_payments (sale_id, amount, method, installments, provider_snapshot, modality_snapshot)
          VALUES (v_sale_id,_amt,_met,_ins,_ps,_ms);
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.sale_payments (sale_id, amount, method) VALUES (v_sale_id,_amt,_met);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END;
  END IF;

  IF p_packaging IS NOT NULL AND jsonb_typeof(p_packaging) = 'object' THEN
    v_packaging_cost := COALESCE((p_packaging->>'custo_snapshot')::NUMERIC, 0);
    IF (p_packaging->>'is_free')::BOOLEAN = true THEN
      v_packaging_cost := 0;
    ELSIF (p_packaging->>'custom_cost') IS NOT NULL THEN
      v_packaging_cost := COALESCE((p_packaging->>'custom_cost')::NUMERIC, 0);
    END IF;
    DECLARE
      _ptid UUID   := (p_packaging->>'packaging_type_id')::UUID;
      _ts   TEXT   := COALESCE(p_packaging->>'tipo_snapshot','Embalagem');
      _cs   NUMERIC:= COALESCE((p_packaging->>'custo_snapshot')::NUMERIC, 0);
      _cc   NUMERIC:= (p_packaging->>'custom_cost')::NUMERIC;
      _isf  BOOLEAN:= COALESCE((p_packaging->>'is_free')::BOOLEAN, false);
    BEGIN
      INSERT INTO public.sale_packaging (
        sale_id, packaging_type_id, tipo_snapshot, custo_snapshot, custom_cost, is_free
      ) VALUES (v_sale_id,_ptid,_ts,_cs,_cc,_isf);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO public.sale_packaging (sale_id, tipo_snapshot, custo_snapshot, is_free)
          VALUES (v_sale_id,_ts,_cs,_isf);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END IF;

  IF p_extra_costs IS NOT NULL THEN
    FOR _extra IN SELECT v FROM jsonb_array_elements(p_extra_costs) AS t(v) LOOP
      DECLARE
        _e_desc TEXT    := COALESCE(_extra->>'description','Custo extra');
        _e_cat  TEXT    := COALESCE(_extra->>'category','OUTRO');
        _e_amt  NUMERIC := COALESCE((_extra->>'amount')::NUMERIC, 0);
      BEGIN
        v_extra_costs_total := v_extra_costs_total + _e_amt;
        INSERT INTO public.sale_costs (sale_id, description, category, amount)
        VALUES (v_sale_id, _e_desc, _e_cat, _e_amt);
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.sale_costs (sale_id, description, amount)
          VALUES (v_sale_id, _e_desc, _e_amt);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END LOOP;
  END IF;

  v_real_profit := v_total_customer
                 - (v_items_cost + v_allocated_purchase_cost)
                 - v_fee_actual
                 - v_packaging_cost
                 - v_extra_costs_total;
  v_real_margin := CASE WHEN v_total_customer > 0
                        THEN ROUND(100.0 * v_real_profit / v_total_customer, 4)
                        ELSE 0 END;
  IF v_real_profit IS NULL THEN v_real_profit := 0; END IF;

  DECLARE
    _st TEXT := CASE WHEN COALESCE((p_payment->>'amount')::NUMERIC,0) >= v_total_customer THEN 'CONCLUIDA'
                     WHEN COALESCE((p_payment->>'amount')::NUMERIC,0) > 0 THEN 'PARCIAL'
                     ELSE 'PENDENTE' END;
  BEGIN
    IF _st IS NOT NULL THEN
      UPDATE public.sales SET
        status = _st,
        items_subtotal = v_items_subtotal,
        product_discounts = v_product_discounts,
        general_discount = COALESCE(p_general_discount,0),
        coupon_discount = v_coupon_discount,
        pix_discount = COALESCE(p_pix_discount,0),
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
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      UPDATE public.sales SET
        status = CASE WHEN COALESCE((p_payment->>'amount')::NUMERIC,0) >= v_total_customer THEN 'CONCLUIDA'
                      WHEN COALESCE((p_payment->>'amount')::NUMERIC,0) > 0 THEN 'PARCIAL' ELSE 'PENDENTE' END,
        items_subtotal = v_items_subtotal,
        total_customer = v_total_customer,
        updated_at = now()
      WHERE id = v_sale_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', v_sale_id,
    'friendly', v_friendly,
    'status', (SELECT status FROM public.sales WHERE id = v_sale_id),
    'total_customer', v_total_customer,
    'items_count', v_items_count,
    'real_profit', v_real_profit,
    'notice', 'Concluída com proteção estoque mínimo (PATCH 10 item 7).'
  );
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5b) RPC auxiliar: CANCELA VENDA e DEVOLVE ESTOQUE (com proteção duplicata)
--     Item 7: "cancelar venda não devolva estoque duas vezes"
DROP FUNCTION IF EXISTS public.cancel_sale_restore_stock(UUID,UUID);
CREATE OR REPLACE FUNCTION public.cancel_sale_restore_stock(
  p_sale_id UUID,
  p_user_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  _sale public.sales%%ROWTYPE;
  _si RECORD;
  _admin UUID;
  _restored INTEGER := 0;
  _already BOOLEAN;
  v_line RECORD;
BEGIN
  -- Admin fallback
  SELECT COALESCE(
    p_user_id,
    (SELECT id FROM public.profiles WHERE role IN ('ADMIN','ADMINISTRADOR') ORDER BY created_at LIMIT 1),
    (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1),
    gen_random_uuid()
  ) INTO _admin;

  SELECT * INTO STRICT _sale FROM public.sales WHERE id = p_sale_id;

  -- Proteção 1: Duplicata — se já existem movimentos DEVOLUCAO/CANCELAMENTO_VENDA para esta venda
  SELECT EXISTS(
    SELECT 1 FROM public.inventory_movements
    WHERE related_sale_id = p_sale_id AND reason = 'CANCELAMENTO_VENDA'
  ) INTO _already;
  IF _already THEN
    RAISE EXCEPTION 'Venda %% já foi cancelada anteriormente. Nenhuma devolução duplicata permitida (item 7).',
      COALESCE('#'||_sale.friendly::TEXT, p_sale_id::TEXT)
      USING HINT = 'Proteção item 7: movimentação CANCELAMENTO_VENDA já existe para esta venda em inventory_movements';
  END IF;

  -- Proteção 2: Só cancela se status ainda não é CANCELADA/REEMBOLSADA
  IF _sale.status IN ('CANCELADA','REEMBOLSADA') THEN
    RAISE EXCEPTION 'Venda %% já está com status "%%". Não alterar novamente.',
      COALESCE('#'||_sale.friendly::TEXT, p_sale_id::TEXT), _sale.status
      USING HINT = 'Verifique o status atual da venda antes de cancelar.';
  END IF;

  -- Percorre itens da venda: devolve por batch se batch_ids_used existir
  FOR _si IN
    SELECT si.*, p.sku, p.name AS pname
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
  LOOP
    -- Estratégia: devolve quantidade em lotes, do MAIS ANTIGO primeiro
    -- Se houver batch_ids_used, preferimos restituir aos mesmos lotes
    IF COALESCE(JSONB_ARRAY_LENGTH(_si.batch_ids_used),0) > 0 THEN
      DECLARE
        _bid UUID;
        _idx INTEGER;
        _qty_per INTEGER;
        _n INTEGER;
      BEGIN
        _n := JSONB_ARRAY_LENGTH(_si.batch_ids_used);
        FOR _idx IN 0 .. (_n - 1) LOOP
          _bid := (_si.batch_ids_used->>_idx)::UUID;
          -- Distribui igualitariamente (na prática costuma ser 1 batch por 1 item, mas garantimos divisão)
          SELECT CASE WHEN _idx = (_n - 1) THEN _si.quantity - (_si.quantity / _n) * (_n - 1)
                      ELSE _si.quantity / _n END INTO _qty_per;
          IF _qty_per > 0 AND _bid IS NOT NULL THEN
            UPDATE public.inventory_batches
              SET quantity_available = quantity_available + _qty_per,
                  updated_at = now()
              WHERE id = _bid;

            INSERT INTO public.inventory_movements
              (product_id, batch_id, movement_type, reason, quantity, unit_cost,
               related_sale_id, created_by, notes, created_at)
            VALUES
              (_si.product_id, _bid, 'ENTRADA', 'CANCELAMENTO_VENDA', _qty_per,
               COALESCE(_si.unit_cost_snapshot,0), p_sale_id, _admin,
               'CANC_SALE_PROTECT: Devolução por cancelamento | SKU '||COALESCE(_si.sku,'?')||' | '||COALESCE(_si.pname,'')||' | R$'||TRIM(TO_CHAR(_si.unit_cost_snapshot,'FM90D90')),
               now());
            _restored := _restored + _qty_per;
          END IF;
        END LOOP;
      END;
    ELSE
      -- Sem batch_ids: devolve ao primeiro lote FIFO disponível (mais antigo)
      DECLARE
        _need INTEGER := _si.quantity;
        _lb RECORD;
        _take INTEGER;
        _cb CURSOR (pid UUID) FOR
          SELECT b.* FROM public.inventory_batches b
          WHERE b.product_id = pid
          ORDER BY b.received_at, b.id
          FOR UPDATE;
      BEGIN
        OPEN _cb(_si.product_id);
        LOOP
          FETCH _cb INTO _lb; EXIT WHEN NOT FOUND;
          EXIT WHEN _need <= 0;
          _take := GREATEST(_need,1); -- no máximo tudo que foi vendido; não nos preocupamos com capacidade do lote (incremento ok)
          UPDATE public.inventory_batches
            SET quantity_available = quantity_available + _take,
                updated_at = now()
            WHERE CURRENT OF _cb;
          INSERT INTO public.inventory_movements
            (product_id, batch_id, movement_type, reason, quantity, unit_cost,
             related_sale_id, created_by, notes, created_at)
          VALUES
            (_si.product_id, _lb.id, 'AJUSTE_POS', 'CANCELAMENTO_VENDA', _take,
             COALESCE(_si.unit_cost_snapshot,_lb.unit_cost), p_sale_id, _admin,
             'CANC_SALE_FALLBACK: Sem batch_ids_used — repôs em lote FIFO | SKU '||COALESCE(_si.sku,'?'),
             now());
          _restored := _restored + _take;
          _need := _need - _take;
        END LOOP;
        CLOSE _cb;
      END;
    END IF;
  END LOOP;

  -- Atualiza status da venda
  UPDATE public.sales SET status = 'CANCELADA', updated_at = now() WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', p_sale_id,
    'friendly', _sale.friendly,
    'status', 'CANCELADA',
    'items_restored', _restored,
    'notice', 'Cancelamento protegido item 7 aplicado: sem duplicatas.'
  );
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ============================================================
-- 6) AUDITORIA FINAL (SELECTs de conferência)
-- ============================================================

DO $$
DECLARE
  _total_units INTEGER;
  _total_cost NUMERIC(12,2);
BEGIN
  RAISE NOTICE E'\\n========================================\\n📊 AUDITORIA FINAL — PATCH 10 CONCILIAÇÃO 17/09/2026\\n========================================';
END $$;

-- 01) Estoque por produto (SKU, Nome, Qtd, CustoUnit, CustoTotal)
SELECT
  p.sku,
  p.name AS produto,
  COALESCE(SUM(b.quantity_available),0) AS qtd_disponivel,
  COALESCE(ROUND(AVG(b.unit_cost),2),0) AS custo_medio,
  COALESCE(SUM(b.quantity_available * b.unit_cost),0) AS custo_total
FROM public.products p
LEFT JOIN public.inventory_batches b ON b.product_id = p.id
GROUP BY p.sku, p.name
ORDER BY
  CASE WHEN COALESCE(SUM(b.quantity_available),0) > 0 THEN 0 ELSE 1 END,
  p.sku;

-- 02) TOTAL GERAL: 13 PEÇAS + R$760,00
SELECT
  SUM(qtd_disponivel) AS total_unidades_disponiveis,
  SUM(custo_total) AS custo_total_estoque,
  CASE WHEN SUM(qtd_disponivel) = 13 THEN '✅ TOTAL 13 OK'
       ELSE '❌ TOTAL DIVERGENTE — esperado 13 peças' END AS valida_qtd,
  CASE WHEN ROUND(SUM(custo_total),2) = 760.00 THEN '✅ CUSTO R$760,00 OK'
       ELSE '❌ CUSTO DIVERGENTE — esperado R$760,00' END AS valida_custo
FROM (
  SELECT
    p.id,
    COALESCE(SUM(b.quantity_available),0) AS qtd_disponivel,
    COALESCE(SUM(b.quantity_available * b.unit_cost),0) AS custo_total
  FROM public.products p
  LEFT JOIN public.inventory_batches b ON b.product_id = p.id
  GROUP BY p.id
) t;

-- 03) Produtos históricos ZERADOS: lista aqueles com saldo ≠ 0 que NÃO estão na lista 13
--     Se esta consulta retornar QUALQUER linha, a conciliação está QUEBRADA.
SELECT
  '⚠️ PRODUTO NÃO-ZERADO FORA DA LISTA 13' AS problema,
  p.sku,
  p.name,
  COALESCE(SUM(b.quantity_available),0) AS saldo_indevido
FROM public.products p
LEFT JOIN public.inventory_batches b ON b.product_id = p.id
WHERE p.sku NOT IN ('REGATA-001','CALCA-003','CALCA-002','CONJ-005','CONJ-006','CONJ-002','CONJ-003','CONJ-004')
GROUP BY p.sku, p.name
HAVING COALESCE(SUM(b.quantity_available),0) <> 0
ORDER BY p.sku;

-- 04) Movimentações de conciliação criadas (AJUSTE_NEG + AJUSTE_POS)
SELECT
  m.movement_type,
  m.reason,
  COUNT(*) AS quantidade_movimentos,
  COALESCE(SUM(CASE WHEN m.movement_type = 'AJUSTE_POS' THEN m.quantity ELSE 0 END),0) AS total_ajuste_positivo_peças,
  COALESCE(SUM(CASE WHEN m.movement_type = 'AJUSTE_NEG' THEN m.quantity ELSE 0 END),0) AS total_ajuste_negativo_peças
FROM public.inventory_movements m
WHERE m.notes LIKE 'CONC_INV_17_09_2026%%'
GROUP BY m.movement_type, m.reason
ORDER BY m.movement_type;

-- 05) Distribuição correta das 13 peças (linha a linha validação)
SELECT
  categoria_inventario,
  sku,
  qtd_esperada,
  qtd_disponivel,
  custo_unit_esperado,
  custo_unit_atual,
  CASE WHEN qtd_disponivel = qtd_esperada THEN '✅ Qtd OK' ELSE '❌ QTD ERRADA' END AS val_qtd,
  CASE WHEN ABS(custo_unit_atual - custo_unit_esperado) < 0.01 THEN '✅ Custo OK' ELSE '❌ CUSTO ERRADO' END AS val_custo
FROM (
  SELECT
    CASE
      WHEN p.sku='REGATA-001' THEN 'Regatas'
      WHEN p.sku='CALCA-003' THEN 'Calças jeans/animal print'
      WHEN p.sku='CALCA-002' THEN 'Calça marrom com lenço'
      WHEN p.sku='CONJ-005'  THEN 'Conjunto saia+top'
      WHEN p.sku='CONJ-006'  THEN 'Conjunto short+camisa'
      WHEN p.sku='CONJ-002'  THEN 'Conjuntos calça+blusa (branco)'
      WHEN p.sku='CONJ-003'  THEN 'Conjuntos calça+blusa (preto)'
      WHEN p.sku='CONJ-004'  THEN 'Conjuntos calça+blusa (rosa)'
      ELSE '(demais — deve ser 0)' END AS categoria_inventario,
    p.sku,
    CASE p.sku
      WHEN 'REGATA-001' THEN 5
      WHEN 'CALCA-003' THEN 2
      WHEN 'CALCA-002' THEN 1
      WHEN 'CONJ-005'  THEN 1
      WHEN 'CONJ-006'  THEN 1
      WHEN 'CONJ-002'  THEN 1
      WHEN 'CONJ-003'  THEN 1
      WHEN 'CONJ-004'  THEN 1
      ELSE 0 END AS qtd_esperada,
    COALESCE(SUM(b.quantity_available),0) AS qtd_disponivel,
    CASE p.sku
      WHEN 'REGATA-001' THEN 20.00::NUMERIC(12,2)
      WHEN 'CALCA-003' THEN 90.00
      WHEN 'CALCA-002' THEN 90.00
      WHEN 'CONJ-005'  THEN 90.00
      WHEN 'CONJ-006'  THEN 75.00
      WHEN 'CONJ-002'  THEN 75.00
      WHEN 'CONJ-003'  THEN 75.00
      WHEN 'CONJ-004'  THEN 75.00
      ELSE 0 END AS custo_unit_esperado,
    COALESCE(AVG(b.unit_cost),0)::NUMERIC(12,2) AS custo_unit_atual
  FROM public.products p
  LEFT JOIN public.inventory_batches b ON b.product_id = p.id
  GROUP BY p.sku
) t
ORDER BY
  CASE categoria_inventario
    WHEN 'Regatas' THEN 1
    WHEN 'Calças jeans/animal print' THEN 2
    WHEN 'Calça marrom com lenço' THEN 3
    WHEN 'Conjunto saia+top' THEN 4
    WHEN 'Conjunto short+camisa' THEN 5
    ELSE 6 END,
  sku;

-- ============================================================
-- FIM PATCH 10
-- ============================================================
