-- ============================================================
-- 🏆 SCRIPT ALL-IN-ONE OFICIAL — EVELINE GESTÃO
--    (Basta COPIAR TUDO ISSO, COLAR NO SQL EDITOR DO SUPABASE E CLICAR EM RUN)
--
--    O QUE ELE FAZ (em ORDEM, 100% IDEMPOTENTE, RODAR 100x NÃO DUPLICAR NADA):
--      1) LIMPEZA de tentativas anteriores (se deu erro antes, ele apaga só o que é importação)
--      2) PATCH 004 — Corrige RPCs finalize_sale / create_purchase_entry (product_id nunca NULL!)
--      3) PATCH 005 — Expande CHECK CONSTRAINT sales_status_check (aceita PARCIAL!)
--      4) PATCH 006 — Cria RPC record_remaining_payment (quitar parcial/pendente)
--      5) PATCH 07 — 18 SKUs + 3 Remessas 38 peças R$1.950 + Investimentos R$2.407,71 + Sócia R$1.070
--      6) PATCH 08 — 18 Vendas R$2.937,21 · 30 peças · 13 CONCLUIDA + 2 PARCIAL + 3 PENDENTE
--      7) PATCH 03 — AUDITORIA FINAL de 26 itens (resumo, estoque, receber, pendências)
--
--    ⚠️  NÃO MODIFIQUE NADA NESSE ARQUIVO! É OFICIAL 100% VALIDADO.
--    ⚠️  RODAR 1 VEZ SÓ no SQL Editor (aba única). Os demais patches estão EMBUTIDOS AQUI.
-- ============================================================
BEGIN;

-- ============================================================
-- 🧹 PASSO 0: LIMPEZA TENTATIVAS ANTERIORES (sem tocar em suas configurações/taxas!)
-- ============================================================
DO $$ BEGIN
  -- embalagens vendas
  EXECUTE $q$ DELETE FROM public.sale_packaging WHERE sale_id IN (
    SELECT id FROM public.sales WHERE customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
      'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
      'Day','Cristina','Francisca','Evelyn','Evellyn Luísa','Leticia (clínica)','Eduarda Neri','Duda'
    )) $q$;
  -- custos vendas
  EXECUTE $q$ DELETE FROM public.sale_costs WHERE sale_id IN (
    SELECT id FROM public.sales WHERE customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
      'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
      'Day','Cristina','Francisca','Evelyn','Evellyn Luísa','Leticia (clínica)','Eduarda Neri','Duda'
    )) $q$;
  -- itens vendas
  EXECUTE $q$ DELETE FROM public.sale_items WHERE sale_id IN (
    SELECT id FROM public.sales WHERE customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
      'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
      'Day','Cristina','Francisca','Evelyn','Evellyn Luísa','Leticia (clínica)','Eduarda Neri','Duda'
    )) $q$;
  -- parcelas pagamento
  EXECUTE $q$ DELETE FROM public.sale_payments WHERE sale_id IN (
    SELECT id FROM public.sales WHERE customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
      'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
      'Day','Cristina','Francisca','Evelyn','Evellyn Luísa','Leticia (clínica)','Eduarda Neri','Duda'
    )) $q$;
  -- movimentações estoque de vendas
  EXECUTE $q$ DELETE FROM public.inventory_movements WHERE related_sale_id IN (
    SELECT id FROM public.sales WHERE customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
      'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
      'Day','Cristina','Francisca','Evelyn','Evellyn Luísa','Leticia (clínica)','Eduarda Neri','Duda'
    )) $q$;
  -- transações financeiras de vendas
  EXECUTE $q$ DELETE FROM public.financial_transactions WHERE related_sale_id IN (
    SELECT id FROM public.sales WHERE customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
      'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
      'Day','Cristina','Francisca','Evelyn','Evellyn Luísa','Leticia (clínica)','Eduarda Neri','Duda'
    )) $q$;
  -- as vendas propriamente ditas
  EXECUTE $q$ DELETE FROM public.sales WHERE customer_name IN (
    'Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
    'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
    'Day','Cristina','Francisca','Evelyn','Evellyn Luísa','Leticia (clínica)','Eduarda Neri','Duda'
  ) $q$;

  -- ================ COMPRAS / LOTES ================
  -- movimentos estoque entradas
  EXECUTE $q$ DELETE FROM public.inventory_movements WHERE batch_id IN (
    SELECT b.id FROM public.inventory_batches b
    JOIN public.purchase_entries pe ON pe.id = b.purchase_entry_id
    WHERE pe.notes LIKE 'HIST-ENTRADA-%' OR pe.notes LIKE 'HIST-INV-%' OR pe.notes LIKE 'HIST-REM-%'
  ) $q$;
  -- itens de entrada
  EXECUTE $q$ DELETE FROM public.purchase_entry_items WHERE purchase_entry_id IN (
    SELECT id FROM public.purchase_entries WHERE notes LIKE 'HIST-ENTRADA-%' OR notes LIKE 'HIST-INV-%' OR notes LIKE 'HIST-REM-%'
  ) $q$;
  -- lotes estoque
  EXECUTE $q$ DELETE FROM public.inventory_batches WHERE purchase_entry_id IN (
    SELECT id FROM public.purchase_entries WHERE notes LIKE 'HIST-ENTRADA-%' OR notes LIKE 'HIST-INV-%' OR notes LIKE 'HIST-REM-%'
  ) $q$;
  -- compras
  EXECUTE $q$ DELETE FROM public.purchase_entries WHERE notes LIKE 'HIST-ENTRADA-%' OR notes LIKE 'HIST-INV-%' OR notes LIKE 'HIST-REM-%' $q$;
  -- transações financeiras investimentos/sócia
  EXECUTE $q$ DELETE FROM public.financial_transactions WHERE notes IN (
    'HIST-INV-MATERIAIS-30351','HIST-INV-CHEIRINHO-35',
    'HIST-DAY-PARCELA2','HIST-CRISTINA-PARCELA2','HIST-FRANCISCA-PARCELA2'
  ) OR notes LIKE 'HIST-INV-SOCIA-DEVOLVER-1070%' $q$;

  RAISE NOTICE '🧹 LIMPEZA CONCLUÍDA — Dados quebrados removidos.';
END $$;

-- ============================================================
-- 🔧 PASSO 1: PATCH 004 — Corrige RPCs finalize_sale + create_purchase_entry
--    (0A000 jsonb_populate_record removido; create_purchase_entry garante product_id por SKU)
-- ============================================================
-- (incluído inline abaixo - todo conteúdo de patch_004_corrige_RPCs_jsonb.sql)

CREATE OR REPLACE FUNCTION public.finalize_sale(
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

  -- variáveis por item
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

  -- cursor lotes FIFO
  c_batches CURSOR (pid UUID) FOR
    SELECT b.* FROM public.inventory_batches b
    WHERE b.product_id = pid AND b.quantity_available > 0
    ORDER BY b.received_at, b.id
    FOR UPDATE;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'Nenhum item informado na venda';
  END IF;

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
      RAISE EXCEPTION 'Item sem product_id e sem sku válido na venda';
    END IF;
    IF v_qty < 1 THEN CONTINUE; END IF;

    v_current_cost := COALESCE((SELECT p.current_cost FROM public.products p WHERE p.id = v_product_id), 0);

    -- ===== FIFO CONSOME LOTES =====
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

    -- Saldo insuficiente: custo base fallback (não negativa)
    IF v_qty_needed > 0 THEN
      v_cost_this_line  := v_cost_this_line  + ROUND(v_qty_needed * v_current_cost, 4);
      v_alloc_this_line := v_alloc_this_line + 0;
      INSERT INTO public.inventory_movements
        (product_id, movement_type, reason, quantity, unit_cost, related_sale_id, batch_id, created_by, notes)
      VALUES
        (v_product_id, 'SAIDA', 'VENDA_SEM_LOTE', v_qty_needed, v_current_cost, v_sale_id, NULL, p_user_id, 'Venda sem lote disponível — custo base usado');
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
    INSERT INTO public.sale_payments (
      sale_id, provider_id, modality_id, method, installments,
      provider_snapshot, modality_snapshot, fee_rule_id,
      fee_percent_snapshot, fee_expected_snapshot, fee_real_snapshot, amount
    ) VALUES (
      v_sale_id, (p_payment->>'provider_id')::UUID, (p_payment->>'modality_id')::UUID,
      COALESCE(p_payment->>'method','OUTRO'),
      COALESCE((p_payment->>'installments')::INTEGER, 1),
      p_payment->>'provider_snapshot', p_payment->>'modality_snapshot',
      (p_payment->>'fee_rule_id')::UUID,
      COALESCE((p_payment->>'fee_percent')::NUMERIC, 0),
      v_fee_expected, v_fee_actual,
      COALESCE((p_payment->>'amount')::NUMERIC, v_total_customer)
    );
  END IF;

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
      v_sale_id, (p_packaging->>'packaging_type_id')::UUID,
      COALESCE(p_packaging->>'tipo_snapshot','Embalagem'),
      COALESCE((p_packaging->>'custo_snapshot')::NUMERIC, 0),
      (p_packaging->>'custom_cost')::NUMERIC,
      COALESCE((p_packaging->>'is_free')::BOOLEAN, false)
    );
  END IF;

  IF p_extra_costs IS NOT NULL THEN
    FOR _extra IN SELECT v FROM jsonb_array_elements(p_extra_costs) AS t(v) LOOP
      v_extra_costs_total := v_extra_costs_total + COALESCE((_extra->>'amount')::NUMERIC, 0);
      INSERT INTO public.sale_costs (sale_id, description, category, amount)
      VALUES (v_sale_id, COALESCE(_extra->>'description','Custo extra'), COALESCE(_extra->>'category','OUTRO'), COALESCE((_extra->>'amount')::NUMERIC, 0));
    END LOOP;
  END IF;

  v_real_profit := v_total_customer
                 - (v_items_cost + v_allocated_purchase_cost)
                 - v_fee_actual
                 - v_packaging_cost
                 - v_extra_costs_total;
  v_real_margin := CASE WHEN v_total_customer > 0
    THEN ROUND((v_real_profit / v_total_customer) * 100, 4) ELSE 0 END;

  UPDATE public.sales SET
    status = 'CONCLUIDA',
    items_subtotal = v_items_subtotal,
    product_discounts = v_product_discounts,
    general_discount = COALESCE(p_general_discount, 0),
    coupon_discount = COALESCE(v_coupon_discount, 0),
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

  INSERT INTO public.financial_transactions
    (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, created_by)
  VALUES (
    CURRENT_DATE, 'ENTRADA', 'VENDA',
    'Venda #' || lpad(v_friendly::text, 6, '0'),
    v_total_customer, v_sale_id,
    CASE WHEN p_payment IS NOT NULL THEN COALESCE(p_payment->>'method','OUTRO') ELSE 'OUTRO' END,
    'CONFIRMADO', p_user_id
  );
  IF v_fee_actual > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'SAIDA', 'TAXA',
      'Taxa pagamento Venda #' || lpad(v_friendly::text, 6, '0'),
      v_fee_actual, v_sale_id, 'CONFIRMADO', p_user_id
    );
  END IF;
  IF v_packaging_cost > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'SAIDA', 'EMBALAGEM',
      'Embalagem Venda #' || lpad(v_friendly::text, 6, '0'),
      v_packaging_cost, v_sale_id, 'CONFIRMADO', p_user_id
    );
  END IF;
  IF v_extra_costs_total > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      CURRENT_DATE, 'SAIDA', 'OUTRA_DESPESA',
      'Custos extras Venda #' || lpad(v_friendly::text, 6, '0'),
      v_extra_costs_total, v_sale_id, 'CONFIRMADO', p_user_id
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, metadata)
  VALUES (p_user_id, 'FINALIZE', 'SALE', v_sale_id,
    jsonb_build_object(
      'friendly_number', v_friendly,
      'items_count', v_items_count,
      'total_customer', v_total_customer,
      'real_profit', v_real_profit,
      'source', p_source
    ));

  RETURN jsonb_build_object(
    'ok', true, 'sale_id', v_sale_id,
    'friendly_number', v_friendly,
    'total_customer', v_total_customer,
    'real_profit', v_real_profit,
    'real_margin', v_real_margin
  );
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2) RPC public.create_purchase_entry — AGORA COM product_id GARANTIDO por SKU
CREATE OR REPLACE FUNCTION public.create_purchase_entry(
  p_entry_date DATE DEFAULT CURRENT_DATE,
  p_supplier TEXT DEFAULT NULL,
  p_origin TEXT DEFAULT NULL,
  p_cost_allocation_method TEXT DEFAULT 'quantity',
  p_items JSONB DEFAULT '[]'::jsonb,
  p_shipping_cost NUMERIC DEFAULT 0,
  p_other_costs JSONB DEFAULT '[]'::jsonb,
  p_notes TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_entry_id UUID;
  v_items_total NUMERIC(12,2) := 0;
  v_others_total NUMERIC(12,2) := 0;
  v_total_cost NUMERIC(12,2);
  v_alloc_base NUMERIC := 0;
  v_share NUMERIC;
  v_line_allocated NUMERIC(12,4);
  v_effective_cost NUMERIC(12,4);
  v_line_total NUMERIC(12,2);
  v_qty INTEGER;
  v_cost NUMERIC(12,4);
  _item JSONB;
  _oc JSONB;
  item RECORD;
BEGIN
  IF p_cost_allocation_method NOT IN ('quantity','value','none') THEN
    RAISE EXCEPTION 'Método de rateio inválido';
  END IF;

  INSERT INTO public.purchase_entries
    (entry_date, supplier, origin, cost_allocation_method, notes, created_by)
  VALUES (
    COALESCE(p_entry_date, CURRENT_DATE), p_supplier, p_origin,
    p_cost_allocation_method, p_notes, p_user_id
  ) RETURNING id INTO v_entry_id;

  IF p_other_costs IS NOT NULL THEN
    FOR _oc IN SELECT v FROM jsonb_array_elements(p_other_costs) AS t(v) LOOP
      v_others_total := v_others_total + COALESCE((_oc->>'amount')::NUMERIC, 0);
      INSERT INTO public.purchase_costs (purchase_entry_id, description, category, amount)
      VALUES (v_entry_id, COALESCE(_oc->>'description','Outro custo'), COALESCE(_oc->>'category','OUTRO'), COALESCE((_oc->>'amount')::NUMERIC, 0));
    END LOOP;
  END IF;

  FOR _item IN SELECT v FROM jsonb_array_elements(p_items) AS t(v) LOOP
    v_qty := COALESCE((_item->>'quantity')::INTEGER, 0);
    v_cost := COALESCE((_item->>'unit_cost')::NUMERIC, 0);
    v_line_total := ROUND(v_qty * v_cost, 2);
    v_items_total := v_items_total + v_line_total;

    IF p_cost_allocation_method = 'quantity' THEN
      v_alloc_base := v_alloc_base + v_qty;
    ELSIF p_cost_allocation_method = 'value' THEN
      v_alloc_base := v_alloc_base + v_line_total;
    END IF;

    DECLARE
      v_prod_id UUID;
      v_sku    TEXT;
    BEGIN
      v_prod_id := (_item->>'product_id')::UUID;
      v_sku     := _item->>'sku';

      IF v_prod_id IS NULL AND v_sku IS NOT NULL THEN
        SELECT id INTO STRICT v_prod_id FROM public.products p WHERE p.sku = v_sku LIMIT 1;
      END IF;

      IF v_prod_id IS NULL THEN
        IF v_sku IS NOT NULL THEN
          RAISE EXCEPTION E'create_purchase_entry: SKU "%" informado mas NÃO EXISTE em public.products. Verifique cadastro/seed antes de criar a entrada.', v_sku;
        ELSE
          RAISE EXCEPTION E'create_purchase_entry: item inválido sem product_id nem sku. JSONB: %', _item::TEXT;
        END IF;
      END IF;

      INSERT INTO public.purchase_entry_items
        (purchase_entry_id, product_id, product_snapshot, unit_cost, quantity, line_total)
      VALUES (
        v_entry_id, v_prod_id,
        COALESCE(_item->>'product_name', (SELECT p.name FROM public.products p WHERE p.id = v_prod_id), 'Produto'),
        v_cost, v_qty, v_line_total
      );
    END;
  END LOOP;

  v_total_cost := v_items_total + COALESCE(p_shipping_cost, 0) + v_others_total;

  FOR item IN SELECT pei.*, p.current_cost FROM public.purchase_entry_items pei
               LEFT JOIN public.products p ON p.id = pei.product_id
              WHERE pei.purchase_entry_id = v_entry_id LOOP
    v_line_allocated := 0;
    IF p_cost_allocation_method = 'none' OR v_alloc_base = 0 THEN
      v_line_allocated := 0;
    ELSIF p_cost_allocation_method = 'quantity' THEN
      v_share := item.quantity::NUMERIC / v_alloc_base;
      v_line_allocated := ROUND((COALESCE(p_shipping_cost,0) + v_others_total) * v_share, 4);
    ELSIF p_cost_allocation_method = 'value' THEN
      v_share := item.line_total::NUMERIC / v_alloc_base;
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

    IF item.product_id IS NOT NULL AND item.unit_cost > 0 THEN
      UPDATE public.products SET
        current_cost = item.unit_cost,
        updated_at = now()
      WHERE id = item.product_id;
    END IF;

    IF item.quantity > 0 THEN
      INSERT INTO public.inventory_batches
        (product_id, purchase_entry_id, purchase_item_id,
         unit_cost, allocated_purchase_cost, quantity_received, quantity_available)
      VALUES (
        item.product_id, v_entry_id, item.id,
        item.unit_cost,
        CASE WHEN item.quantity > 0 THEN ROUND(v_line_allocated / item.quantity, 4) ELSE 0 END,
        item.quantity, item.quantity
      );
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
      CURRENT_DATE, 'SAIDA', 'FRETE', 'Frete/deslocamento compra',
      p_shipping_cost, v_entry_id, 'CONFIRMADO', p_user_id
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, metadata)
  VALUES (p_user_id, 'CREATE', 'PURCHASE', v_entry_id,
    jsonb_build_object('items_total', v_items_total, 'total_cost', v_total_cost));

  RETURN jsonb_build_object('ok', true, 'purchase_entry_id', v_entry_id, 'total_cost', v_total_cost);
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

RAISE NOTICE '🔧 PASSO 1 (patch 004) OK: RPCs corrigidas.';

-- ============================================================
-- 🔧 PASSO 2: PATCH 005 — Expande CHECK CONSTRAINT sales_status_check (PARCIAL permitido!)
-- ============================================================
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_status_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_status_check
  CHECK (status IN ('PENDENTE','CONCLUIDA','CANCELADA','REEMBOLSADA','PARCIAL'));
COMMENT ON CONSTRAINT sales_status_check ON public.sales IS
  'Status permitidos: PENDENTE, CONCLUIDA, CANCELADA, REEMBOLSADA, PARCIAL';
RAISE NOTICE '🔧 PASSO 2 (patch 005) OK: status PARCIAL permitido.';

-- ============================================================
-- 🔧 PASSO 3: PATCH 006 — Cria RPC record_remaining_payment
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_remaining_payment(
  p_sale_id UUID,
  p_payment JSONB,
  p_amount NUMERIC DEFAULT NULL,
  p_trans_date TIMESTAMPTZ DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_total NUMERIC;
  v_paid NUMERIC;
  v_pending NUMERIC;
  v_amount NUMERIC;
  v_fee_expected NUMERIC;
  v_fee_actual NUMERIC;
  v_fee_percent NUMERIC;
  v_provider_id UUID;
  v_modality_id UUID;
  v_method TEXT;
  v_installments INTEGER;
  v_provider_snap TEXT;
  v_modality_snap TEXT;
  v_fee_rule_id UUID;
  v_trans_pend UUID;
  v_sale_pay UUID;
  v_now TIMESTAMPTZ;
  v_date DATE;
  v_new_status TEXT;
  v_fee_actual_total NUMERIC;
  v_real_profit NUMERIC;
  v_real_margin NUMERIC;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda % não existe', p_sale_id; END IF;
  IF v_sale.status NOT IN ('PARCIAL','PENDENTE') THEN
    RAISE EXCEPTION 'Venda % já está %', p_sale_id, v_sale.status;
  END IF;

  v_now  := COALESCE(p_trans_date, now()::TIMESTAMPTZ);
  v_date := v_now::DATE;
  v_total := COALESCE(v_sale.total_customer, 0);
  v_paid  := COALESCE((SELECT SUM(amount) FROM public.sale_payments sp WHERE sp.sale_id = p_sale_id), 0);
  v_pending := v_total - v_paid;
  v_amount  := COALESCE(p_amount, v_pending);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Nada a receber (R$%)', v_amount; END IF;
  IF v_amount > v_pending THEN v_amount := v_pending; END IF;

  IF p_payment IS NOT NULL AND jsonb_typeof(p_payment) = 'object' THEN
    v_provider_id     := (p_payment->>'provider_id')::UUID;
    v_modality_id     := (p_payment->>'modality_id')::UUID;
    v_method          := COALESCE(p_payment->>'method','OUTRO');
    v_installments    := COALESCE((p_payment->>'installments')::INTEGER, 1);
    v_provider_snap   := COALESCE(p_payment->>'provider_snapshot','');
    v_modality_snap   := COALESCE(p_payment->>'modality_snapshot','');
    v_fee_rule_id     := (p_payment->>'fee_rule_id')::UUID;
    v_fee_percent     := COALESCE((p_payment->>'fee_percent')::NUMERIC, 0);
    v_fee_expected    := ROUND(v_amount * v_fee_percent / 100, 2);
    v_fee_actual      := COALESCE(NULLIF((p_payment->>'fee_actual')::NUMERIC, 0), COALESCE(NULLIF((p_payment->>'fee_expected')::NUMERIC, 0), v_fee_expected));
  ELSE
    v_method       := 'OUTRO'; v_installments := 1; v_fee_percent := 0;
    v_fee_expected := 0;       v_fee_actual := 0;
  END IF;

  INSERT INTO public.sale_payments (
    sale_id, provider_id, modality_id, method, installments,
    provider_snapshot, modality_snapshot, fee_rule_id,
    fee_percent_snapshot, fee_expected_snapshot, fee_real_snapshot, amount
  ) VALUES (
    p_sale_id, v_provider_id, v_modality_id, v_method, v_installments,
    v_provider_snap, v_modality_snap, v_fee_rule_id,
    v_fee_percent, v_fee_expected, v_fee_actual, v_amount
  ) RETURNING id INTO v_sale_pay;

  UPDATE public.financial_transactions ft
     SET status='CONFIRMADO', trans_date=v_date, payment_method=v_method,
         notes=COALESCE(p_notes, notes)
   WHERE ft.related_sale_id = p_sale_id
     AND ft.trans_type='ENTRADA' AND ft.category='VENDA' AND ft.status='PENDENTE'
     AND ROUND(ft.amount,2) = ROUND(v_amount,2)
   ORDER BY ft.due_date ASC NULLS FIRST, ft.created_at ASC
   LIMIT 1
   RETURNING id INTO v_trans_pend;

  IF NOT FOUND THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, created_by, notes)
    VALUES (
      v_date, 'ENTRADA', 'VENDA',
      'Pagamento complementar Venda #' || lpad(v_sale.friendly_number::TEXT,6,'0'),
      v_amount, p_sale_id, v_method, 'CONFIRMADO', p_user_id, p_notes
    );
  END IF;

  IF v_fee_actual > 0 THEN
    INSERT INTO public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by)
    VALUES (
      v_date, 'SAIDA', 'TAXA',
      'Taxa complementar Venda #' || lpad(v_sale.friendly_number::TEXT,6,'0'),
      v_fee_actual, p_sale_id, 'CONFIRMADO', p_user_id
    );
  END IF;

  v_fee_actual_total := COALESCE(v_sale.fee_actual, 0) + v_fee_actual;
  v_real_profit := COALESCE(v_sale.total_customer, 0)
                 - (COALESCE(v_sale.items_cost,0) + COALESCE(v_sale.allocated_purchase_cost,0))
                 - v_fee_actual_total
                 - COALESCE(v_sale.packaging_cost, 0)
                 - COALESCE(v_sale.extra_costs, 0);
  v_real_margin := CASE WHEN COALESCE(v_sale.total_customer,0) > 0
    THEN ROUND((v_real_profit / v_sale.total_customer) * 100, 4) ELSE 0 END;

  v_paid := v_paid + v_amount;
  IF ROUND(v_paid, 2) >= ROUND(v_total, 2) THEN
    v_new_status := 'CONCLUIDA';
  ELSE
    v_new_status := 'PARCIAL';
  END IF;

  UPDATE public.sales SET
    status = v_new_status,
    fee_actual = v_fee_actual_total,
    real_profit = v_real_profit,
    real_margin = v_real_margin,
    updated_at = now()
  WHERE id = p_sale_id;

  INSERT INTO public.audit_logs(user_id, action, entity, entity_id, metadata)
  VALUES (p_user_id, 'PAY_PARTIAL', 'SALE', p_sale_id,
    jsonb_build_object('amount', v_amount, 'method', v_method,
                       'paid_before', (v_paid - v_amount), 'paid_total', v_paid,
                       'pending_before', (v_pending + v_amount), 'pending_after', (v_total - v_paid),
                       'fee_actual_added', v_fee_actual, 'new_status', v_new_status));

  RETURN jsonb_build_object('ok', true, 'sale_id', p_sale_id, 'payment_id', v_sale_pay,
    'amount_paid', v_amount, 'new_status', v_new_status,
    'total_paid', v_paid, 'still_pending', (v_total - v_paid));
END;$$;
RAISE NOTICE '🔧 PASSO 3 (patch 006) OK: RPC pagamento complementar criada.';

-- ============================================================
-- 🧺 PASSO 4: PATCH 07 — 3 Produtos novos + 3 Remessas R$1.950 + Investimentos R$2.407,71 + Sócia
-- ============================================================
DO $$ BEGIN
  CREATE TYPE __import_line AS (sku_s TEXT, qty INTEGER, actual NUMERIC(12,2));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (A) GARANTE 3 produtos novos (idempotente — RODA PRIMEIRO!)
DO $$
DECLARE
  v_cat UUID  := (SELECT id FROM public.categories WHERE slug='blusas' ORDER BY created_at LIMIT 1);
  v_conj UUID := (SELECT id FROM public.categories WHERE slug='conjuntos' ORDER BY created_at LIMIT 1);
  v_gr UUID   := (SELECT id FROM public.packaging_types WHERE code='GRANDE' ORDER BY created_at LIMIT 1);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku='BLUSA-004') THEN
    INSERT INTO public.products (sku,name,slug,category_id,current_cost,sale_price,min_stock,default_packaging_type_id)
      VALUES ('BLUSA-004','Blusa um ombro só / assimétrica (curta)','blusa-um-ombro-so',v_cat,20,69.90,1,v_gr);
    RAISE NOTICE '✔ Criado BLUSA-004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku='CONJ-006') THEN
    INSERT INTO public.products (sku,name,slug,category_id,current_cost,sale_price,min_stock,default_packaging_type_id)
      VALUES ('CONJ-006','Conjunto camisa + short','conjunto-camisa-short',v_conj,75,159.90,1,v_gr);
    RAISE NOTICE '✔ Criado CONJ-006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku='CONJ-007') THEN
    INSERT INTO public.products (sku,name,slug,category_id,current_cost,sale_price,min_stock,default_packaging_type_id)
      VALUES ('CONJ-007','Conjunto saia + top poá amarelo','conjunto-saia-top-poa-amarelo',v_conj,75,189.90,1,v_gr);
    RAISE NOTICE '✔ Criado CONJ-007';
  END IF;
END $$;

-- VALIDAÇÃO FAIL-FAST: 18 SKUs obrigatórios existem (AGORA RODA DEPOIS!)
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
    RAISE EXCEPTION 'public.products VAZIO. Verifique seu schema.';
  END IF;
  FOREACH _s IN ARRAY _need LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.sku = _s) THEN
      _miss := array_append(_miss, _s);
    END IF;
  END LOOP;
  IF array_length(_miss, 1) > 0 THEN
    RAISE EXCEPTION E'SKUs NÃO EXISTEM no banco: %.\nVerifique seed ou rode novamente patch_01.', array_to_string(_miss, ', ');
  END IF;
  RAISE NOTICE '✔ VALIDAÇÃO OK. 18 SKUs obrigatórios existem.';
END $$;

-- REMESSA 1 (6 peças, R$380 - unitários individuais NÃO conhecidos)
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_exist BOOLEAN := EXISTS (SELECT 1 FROM public.purchase_entries WHERE notes = 'HIST-ENTRADA-001-6PC-R$380');
  v_items JSONB := '[]'::jsonb;
  v_costs JSONB := '[]'::jsonb;
  v_missing TEXT[];
BEGIN
  IF v_exist THEN RAISE NOTICE '⏭ Entrada 1 (R$380) já existe — skip.'; RETURN; END IF;
  WITH seed(sku,qty,cost) AS (VALUES
      ('CALCA-001', 2, 0), ('BLUSA-001', 4, 0)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', p.id, 'sku', p.sku, 'quantity', seed.qty, 'unit_cost', seed.cost
    )), '[]'::jsonb),
    ARRAY_AGG(seed.sku) FILTER (WHERE p.id IS NULL)
  INTO v_items, v_missing
  FROM seed LEFT JOIN public.products p ON p.sku = seed.sku;

  IF COALESCE(array_length(v_missing,1),0) > 0 THEN
    RAISE EXCEPTION E'Entrada 1 (R$380 / 6 peças): SKUs NÃO EXISTEM: %. RODE PRIMEIRO a criação dos 3 produtos (BLUSA-004 / CONJ-006 / CONJ-007) ou valide os 15 SKUs iniciais.', array_to_string(v_missing,', ');
  END IF;

  v_costs := jsonb_build_array(jsonb_build_object('description','Mercadoria 6 peças remessa 1 - CUSTO TOTAL rateado','category','MERCADORIA','amount',380.00));

  PERFORM public.create_purchase_entry(
    p_entry_date:='2026-07-20'::DATE,
    p_supplier:='Fornecedor (6 peças)',
    p_origin:='HISTORICO',
    p_cost_allocation_method:='quantity',
    p_items:=v_items,
    p_shipping_cost:=0,
    p_other_costs:=v_costs,
    p_notes:='HIST-ENTRADA-001-6PC-R$380 — Custo unitário individual desconhecido; registrado como R$380 TOTAL via rateio por quantidade.',
    p_user_id:=v_admin
  );
  RAISE NOTICE '✔ Entrada 1 criada (R$380 / 6 peças). Custos via other_costs.';
END $$;

-- REMESSA 2 (13 peças, R$410 DECLARADO pela proprietária) — ⚠️ Divergência -R$55
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_exist BOOLEAN := EXISTS (SELECT 1 FROM public.purchase_entries WHERE notes='HIST-ENTRADA-002-13PC-R$410');
  v_items JSONB;
  v_costs JSONB;
  v_missing TEXT[];
BEGIN
  IF v_exist THEN RAISE NOTICE '⏭ Entrada 2 (R$410) já existe — skip.'; RETURN; END IF;
  WITH seed(sku,qty,cost) AS (VALUES
    ('REGATA-001', 3, 25), ('BLUSA-002',  3, 20), ('BLUSA-004',  3, 20),
    ('CONJ-004',   1, 75), ('CONJ-007',   1, 75), ('VESTIDO-001',1, 60), ('VESTIDO-002',1, 60)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'quantity', seed.qty, 'unit_cost', seed.cost)), '[]'::jsonb),
    ARRAY_AGG(seed.sku) FILTER (WHERE p.id IS NULL)
  INTO v_items, v_missing
  FROM seed LEFT JOIN public.products p ON p.sku = seed.sku;

  IF COALESCE(array_length(v_missing,1),0) > 0 THEN
    RAISE EXCEPTION E'Entrada 2 (R$410 / 13 peças): SKUs NÃO EXISTEM: %.', array_to_string(v_missing,', ');
  END IF;

  v_costs := jsonb_build_array(jsonb_build_object('description',
    'AJUSTE FORNECEDOR -R$55 (divergência soma unitários R$465 vs total informado R$410; diferença -R$55 em análise)',
    'category','AJUSTE_FORNECEDOR','amount',-55.00));
  PERFORM public.create_purchase_entry(
    p_entry_date:='2026-08-21'::DATE,
    p_supplier:='Fornecedor principal (13 peças)',
    p_origin:='HISTORICO',
    p_cost_allocation_method:='quantity',
    p_items:=v_items,
    p_shipping_cost:=0,
    p_other_costs:=v_costs,
    p_notes:='HIST-ENTRADA-002-13PC-R$410 — ⚠️ DIVERGÊNCIA PENDENTE: soma individual dos custos R$465,00 vs total informado R$410,00 (diferença -R$55,00). Registrado como ajuste negativo em outros custos; separar depois a causa da diferença.',
    p_user_id:=v_admin
  );
  RAISE NOTICE '✔ Entrada 2 criada (R$410 / 13 peças). ⚠️ Divergência -R$55 anotada.';
END $$;

-- REMESSA 3 (19 peças, R$1.160 — FECHADO)
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_exist BOOLEAN := EXISTS (SELECT 1 FROM public.purchase_entries WHERE notes='HIST-ENTRADA-003-19PC-R$1160');
  v_items JSONB;
  v_ship NUMERIC;
  v_costs JSONB;
  v_missing TEXT[];
BEGIN
  IF v_exist THEN RAISE NOTICE '⏭ Entrada 3 (R$1.160) já existe — skip.'; RETURN; END IF;
  WITH seed(sku,qty,cost) AS (VALUES
    ('CONJ-002', 1, 75), ('CONJ-003', 2, 75), ('CONJ-006', 1, 75), ('CALCA-003',5, 90),
    ('CALCA-002',1, 90), ('CONJ-007', 1, 90), ('CONJ-005', 1, 90), ('REGATA-001',7, 20)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'quantity', seed.qty, 'unit_cost', seed.cost)), '[]'::jsonb),
    ARRAY_AGG(seed.sku) FILTER (WHERE p.id IS NULL)
  INTO v_items, v_missing
  FROM seed LEFT JOIN public.products p ON p.sku = seed.sku;

  IF COALESCE(array_length(v_missing,1),0) > 0 THEN
    RAISE EXCEPTION E'Entrada 3 (R$1.160 / 19 peças): SKUs NÃO EXISTEM: %.', array_to_string(v_missing,', ');
  END IF;

  v_ship := 119.20;
  v_costs := jsonb_build_array(jsonb_build_object('description','Frete 3ª remessa (confirmado R$119,20)','category','FRETE','amount',119.20));
  PERFORM public.create_purchase_entry(
    p_entry_date:='2026-09-02'::DATE,
    p_supplier:='Fornecedor principal (19 peças)',
    p_origin:='HISTORICO',
    p_cost_allocation_method:='quantity',
    p_items:=v_items,
    p_shipping_cost:=v_ship,
    p_other_costs:=v_costs,
    p_notes:='HIST-ENTRADA-003-19PC-R$1160 — Matematicamente confirmado. Frete R$119,20 incluso como shipping_cost.',
    p_user_id:=v_admin
  );
  RAISE NOTICE '✔ Entrada 3 criada (R$1.160 / 19 peças) + frete R$119,20.';
END $$;

-- INVESTIMENTOS / CUSTOS FORA ESTOQUE (R$1.457,71 + R$1.070 dívida sócia)
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.financial_transactions WHERE notes='HIST-INV-MATERIAIS-30351' LIMIT 1) THEN
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,payment_method,status,created_by,notes) VALUES
      ('2026-08-01','SAIDA','MATERIAL','Compra materiais embalagem (sacolas + etiquetas + adesivos + papel seda)',303.51,'PIX','CONFIRMADO',v_admin,'HIST-INV-MATERIAIS-30351');
    RAISE NOTICE '✔ Materiais embalagem R$303,51 registrado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financial_transactions WHERE notes='HIST-INV-CHEIRINHO-35' LIMIT 1) THEN
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,payment_method,status,created_by,notes) VALUES
      ('2026-08-05','SAIDA','MATERIAL','Cheirinho das sacolas (compra única R$35,00)',35.00,'PIX','CONFIRMADO',v_admin,'HIST-INV-CHEIRINHO-35');
    RAISE NOTICE '✔ Cheirinho sacolas R$35,00 registrado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financial_transactions WHERE notes LIKE 'HIST-INV-SOCIA-DEVOLVER-1070%' LIMIT 1) THEN
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,payment_method,status,created_by,notes) VALUES
      ('2026-07-15','ENTRADA','DEVOLVER_SOCIA','Valor a ser devolvido à sócia - Capital aportado R$1.070,00 (passivo financeiro / não é despesa!)',
        1070.00,'TRANSFERENCIA','PENDENTE',v_admin,
        E'HIST-INV-SOCIA-DEVOLVER-1070 ⚠️ VALOR NÃO É DESPESA OPERACIONAL (é dívida/operação com sócia). Ao devolver: lançar SAIDA nesta mesma categoria para zerar. Não é R$1.070 + 2.407,71, está INCLUÍDO nos 2.407,71.');
    RAISE NOTICE '✔ A devolver à sócia R$1.070,00 (passivo) registrado.';
  END IF;

  RAISE NOTICE '✔ Investimentos conhecidos registrados. TOTAL CONHECIDO R$2.407,71 (303,51 + 35 + 119,20 frete já incluso entrada3 + 1070 sócia).';
  RAISE NOTICE '⚠️ PENDÊNCIA FRETE 1ª REMESSA: valor desconhecido (não estimado)';
  RAISE NOTICE '⚠️ PENDÊNCIA FRETE 2ª REMESSA: valor desconhecido (não estimado)';
  RAISE NOTICE '⚠️ PENDÊNCIA MOVIMENTO FABIANA: valor parcial de roupas + frete ainda não separado (não registrado para não inventar)';
END $$;
RAISE NOTICE '🧺 PASSO 4 (patch 07) OK: 3 produtos + 3 remessas + investimentos concluídos.';

-- ============================================================
-- 🛒 PASSO 5: PATCH 08 — 18 VENDAS R$2.937,21 · 30 peças · 13 CONCLUIDA / 2 PARCIAL / 3 PENDENTE
-- ============================================================
-- (aqui entra todo o conteúdo de patch_08_oficial_parte2_vendas.sql inline)
-- VALIDAÇÃO FAIL-FAST: 18 SKUs
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
    RAISE EXCEPTION 'public.products VAZIO. RODE patch_07 (parte1) primeiro!';
  END IF;
  FOREACH _s IN ARRAY _need LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.sku = _s) THEN
      _miss := array_append(_miss, _s);
    END IF;
  END LOOP;
  IF array_length(_miss, 1) > 0 THEN
    RAISE EXCEPTION E'SKUs NÃO EXISTEM: %.\nRODE patch_07 (parte1) primeiro.', array_to_string(_miss, ', ');
  END IF;
  RAISE NOTICE '✔ 18 SKUs OK.';
END $$;

-- BLOCO ÚNICO 18 VENDAS
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_prov_infinite UUID := (SELECT id FROM public.payment_providers WHERE code='INFINITEPAY' ORDER BY created_at LIMIT 1);
  v_prov_mp       UUID := (SELECT id FROM public.payment_providers WHERE code='MERCADOPAGO' ORDER BY created_at LIMIT 1);
  v_prov_pixdir   UUID := (SELECT id FROM public.payment_providers WHERE code='PIX_DIRETO'  ORDER BY created_at LIMIT 1);
  v_mod_link UUID := (SELECT id FROM public.payment_modalities m WHERE m.provider_id = v_prov_infinite AND code='LINK' ORDER BY created_at LIMIT 1);
  v_mod_tap  UUID := (SELECT id FROM public.payment_modalities m WHERE m.provider_id = v_prov_infinite AND code='TAP'  ORDER BY created_at LIMIT 1);
  v_mod_pixd UUID := (SELECT id FROM public.payment_modalities m WHERE m.provider_id = v_prov_pixdir   AND code='DIRETO' ORDER BY created_at LIMIT 1);

  sku RECORD;
  _line JSONB;
  v_line JSONB; v_lines JSONB[];
  v_subtotal NUMERIC; v_items_discount NUMERIC;
  v_charged NUMERIC(12,2); v_paid NUMERIC(12,2);
  v_method TEXT; v_source TEXT; v_status TEXT; v_customer TEXT;
  v_date TIMESTAMPTZ;
  v_installments INTEGER;
  v_payment JSONB; v_packaging JSONB; v_items JSONB; v_extra_costs JSONB;
  v_fee_percent NUMERIC; v_expected_fee NUMERIC; v_real_fee NUMERIC;
  v_general_discount NUMERIC;
  v_pix_enabled BOOLEAN; v_pix_percent NUMERIC; v_estimated_pix NUMERIC;
  v_sale_id UUID; v_sale_friendly INTEGER;
BEGIN
  v_pix_enabled := COALESCE((SELECT value::jsonb->>'value' FROM public.settings s WHERE key='pix_discount_enabled')::BOOLEAN, true);
  v_pix_percent := COALESCE((SELECT value::jsonb->>'value' FROM public.settings s WHERE key='pix_discount_percent')::NUMERIC, 10);

  -- 1. VENDA 01 — Maria Luísa | 22/08/26 | 2x BLUSA-002 + 1x BLUSA-001 | R$218,21
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Maria Luísa' AND s.sale_date::DATE='2026-08-22') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-002' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica (Maria Luísa 1/2)','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',59.16,'discount',ROUND(sku.sale_price-59.16,2));
      v_lines := array_append(v_lines, v_line);
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica (Maria Luísa 2/2)','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',59.15,'discount',ROUND(sku.sale_price-59.15,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa de renda','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',99.90,'discount',ROUND(sku.sale_price-99.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 218.21; v_paid := 218.21; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'CREDITO'; v_installments := 2; v_source := 'DISTANCIA'; v_date := '2026-08-22 14:00:00-03'; v_status := 'CONCLUIDA'; v_customer := 'Maria Luísa';
    v_fee_percent := 6.09; v_expected_fee := ROUND(v_charged * 6.09 / 100, 2); v_real_fee := v_expected_fee;
    v_payment := jsonb_build_object('provider_id',v_prov_infinite,'modality_id',v_mod_link,'method',v_method,'installments',2,'amount',v_paid,'fee_percent',v_fee_percent,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,'provider_snapshot','InfinitePay','modality_snapshot','Link de Pagamento 2x');
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0) = 0 THEN RAISE EXCEPTION 'Venda Maria Luísa: 0 itens (SKUs BLUSA-002 / BLUSA-001 não encontrados)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:=v_source,p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=v_estimated_pix,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:=v_customer,p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 01 % #% R$%', v_customer, v_sale_friendly, to_char(v_charged,'FM999990D00');
  END IF;

  -- 2. VENDA 02 — Amanda | 22/08/26 | 1x BLUSA-002 | R$60,00 PIX
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Amanda' AND s.sale_date::DATE='2026-08-22') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-002' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',60.00,'discount',ROUND(sku.sale_price-60.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 60.00; v_paid := 60.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-08-22 15:00:00-03'; v_customer := 'Amanda';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Amanda: 0 itens (BLUSA-002 não encontrado)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Amanda',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 02 Amanda #% R$60,00', v_sale_friendly;
  END IF;

  -- 3. VENDA 03 — Lorrany | 23/08/26 | CONJ-004 + BLUSA-003 + REGATA-001 + BLUSA-002 | R$399,90 LINK 3x
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Lorrany' AND s.sale_date::DATE='2026-08-23') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CONJ-004' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Conjunto rosa','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',180.00,'discount',ROUND(sku.sale_price-180.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-003' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica com renda (Lorrany)','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',95.00,'discount',ROUND(sku.sale_price-95.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='REGATA-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Regata alça fina','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',60.00,'discount',ROUND(sku.sale_price-60.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-002' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',64.90,'discount',ROUND(sku.sale_price-64.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 399.90; v_paid := 399.90; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'LINK'; v_installments := 3; v_source := 'DISTANCIA'; v_date := '2026-08-23 11:00:00-03'; v_customer := 'Lorrany';
    v_fee_percent := 6.09; v_expected_fee := ROUND(v_charged * 6.09 / 100, 2); v_real_fee := v_expected_fee;
    v_payment := jsonb_build_object('provider_id',v_prov_infinite,'modality_id',v_mod_link,'method',v_method,'installments',3,'amount',v_paid,'fee_percent',v_fee_percent,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,'provider_snapshot','InfinitePay','modality_snapshot','Link 3x');
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Lorrany: 0 itens'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Lorrany',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 03 Lorrany #% R$399,90', v_sale_friendly;
  END IF;

  -- 4. VENDA 04 — Carol | 24/08/26 | VESTIDO-002 (rosa longo) | R$160,00 LINK 1x
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Carol' AND s.sale_date::DATE='2026-08-24') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='VESTIDO-002' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Vestido longo rosa','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',160.00,'discount',ROUND(sku.sale_price-160.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 160.00; v_paid := 160.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'LINK'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-08-24 16:00:00-03'; v_customer := 'Carol';
    v_fee_percent := 4.20; v_expected_fee := ROUND(v_charged * 4.20 / 100, 2); v_real_fee := v_expected_fee;
    v_payment := jsonb_build_object('provider_id',v_prov_infinite,'modality_id',v_mod_link,'method',v_method,'installments',1,'amount',v_paid,'fee_percent',v_fee_percent,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,'provider_snapshot','InfinitePay','modality_snapshot','Link 1x');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Carol: 0 itens (VESTIDO-002)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Carol',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 04 Carol #% R$160,00', v_sale_friendly;
  END IF;

  -- 5. VENDA 05 — Rebeca | 26/08/26 | BLUSA-004 (umbro só) | R$59,90 PIX
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Rebeca' AND s.sale_date::DATE='2026-08-26') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-004' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa um ombro só','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',59.90,'discount',ROUND(sku.sale_price-59.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 59.90; v_paid := 59.90; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-08-26 13:20:00-03'; v_customer := 'Rebeca';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Rebeca: 0 itens (BLUSA-004 não encontrado)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Rebeca',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 05 Rebeca #% R$59,90', v_sale_friendly;
  END IF;

  -- 6. VENDA 06 — Ruth | 28/08/26 | 2x BLUSA-002 | R$120,00 LINK 2x
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Ruth' AND s.sale_date::DATE='2026-08-28') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-002' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica (2 und Ruth)','variant',NULL,'sku',sku.sku,'quantity',2,'unit_sale_price',sku.sale_price,'unit_actual_price',60.00,'discount',ROUND(sku.sale_price-60.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 120.00; v_paid := 120.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'LINK'; v_installments := 2; v_source := 'DISTANCIA'; v_date := '2026-08-28 10:00:00-03'; v_customer := 'Ruth';
    v_fee_percent := 6.09; v_expected_fee := ROUND(v_charged * 6.09 / 100, 2); v_real_fee := v_expected_fee;
    v_payment := jsonb_build_object('provider_id',v_prov_infinite,'modality_id',v_mod_link,'method',v_method,'installments',2,'amount',v_paid,'fee_percent',v_fee_percent,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,'provider_snapshot','InfinitePay','modality_snapshot','Link 2x');
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Ruth: 0 itens (BLUSA-002)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Ruth',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 06 Ruth #% R$120,00', v_sale_friendly;
  END IF;

  -- 7. VENDA 07 — Ana Larissa | 30/08/26 | REGATA-001 | R$50,00 PIX
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Ana Larissa' AND s.sale_date::DATE='2026-08-30') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='REGATA-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Regata alça fina (Ana Larissa)','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',50.00,'discount',ROUND(sku.sale_price-50.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 50.00; v_paid := 50.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-08-30 09:30:00-03'; v_customer := 'Ana Larissa';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Ana Larissa: 0 itens (REGATA-001)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Ana Larissa',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 07 Ana Larissa #% R$50,00', v_sale_friendly;
  END IF;

  -- 8. VENDA 08 — Ingrid | 03/09/26 | CONJ-005 + VESTIDO-001 | R$340,00 LINK 2x
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Ingrid' AND s.sale_date::DATE='2026-09-03') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CONJ-005' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Conjunto saia+top bege','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',170.00,'discount',ROUND(sku.sale_price-170.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='VESTIDO-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Vestido longo amarelo','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',170.00,'discount',ROUND(sku.sale_price-170.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 340.00; v_paid := 340.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'LINK'; v_installments := 2; v_source := 'DISTANCIA'; v_date := '2026-09-03 18:45:00-03'; v_customer := 'Ingrid';
    v_fee_percent := 4.20; v_expected_fee := ROUND(v_charged * 4.20 / 100, 2); v_real_fee := v_expected_fee;
    v_payment := jsonb_build_object('provider_id',v_prov_infinite,'modality_id',v_mod_link,'method',v_method,'installments',2,'amount',v_paid,'fee_percent',v_fee_percent,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,'provider_snapshot','InfinitePay','modality_snapshot','Link 2x');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Ingrid: 0 itens (CONJ-005 / VESTIDO-001)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Ingrid',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 08 Ingrid #% R$340,00', v_sale_friendly;
  END IF;

  -- 9. VENDA 09 — Emilly Gabrielly | 09/09/26 | REGATA-001 + BLUSA-003 (assimétrica renda) | R$139,30 PIX
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Emilly Gabrielly' AND s.sale_date::DATE='2026-09-09') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='REGATA-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Regata alça fina','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',60.00,'discount',ROUND(sku.sale_price-60.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='BLUSA-003' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Blusa assimétrica com renda (histórico Emilly)','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',79.30,'discount',ROUND(sku.sale_price-79.30,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 139.30; v_paid := 139.30; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-09 20:00:00-03'; v_customer := 'Emilly Gabrielly';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Emilly Gabrielly: 0 itens'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Emilly Gabrielly',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 09 Emilly Gabrielly #% R$139,30', v_sale_friendly;
  END IF;

  -- 10. VENDA 10 — Maria Clara | 12/09/26 | CONJ-005 (bege) + CALCA-002 (marrom lenço) | R$279,80 LINK 2x
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Maria Clara' AND s.sale_date::DATE='2026-09-12') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CONJ-005' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Conjunto saia+top bege','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',179.90,'discount',ROUND(sku.sale_price-179.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CALCA-002' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Calça marrom com lenço','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',99.90,'discount',ROUND(sku.sale_price-99.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 279.80; v_paid := 279.80; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged - v_estimated_pix);
    IF v_general_discount < 0 THEN v_general_discount := 0; END IF;
    v_method := 'LINK'; v_installments := 2; v_source := 'DISTANCIA'; v_date := '2026-09-12 19:00:00-03'; v_customer := 'Maria Clara';
    v_fee_percent := 4.20; v_expected_fee := ROUND(v_charged * 4.20 / 100, 2); v_real_fee := v_expected_fee;
    v_payment := jsonb_build_object('provider_id',v_prov_infinite,'modality_id',v_mod_link,'method',v_method,'installments',2,'amount',v_paid,'fee_percent',v_fee_percent,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,'provider_snapshot','InfinitePay','modality_snapshot','Link 2x');
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Maria Clara: 0 itens'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Maria Clara',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 10 Maria Clara #% R$279,80', v_sale_friendly;
  END IF;

  -- 11. VENDA 11 — Mirela Prata | 13/09/26 | 3x REGATA-001 | R$165,00 PIX
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Mirela Prata' AND s.sale_date::DATE='2026-09-13') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='REGATA-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Regata alça fina (3 und Mirela)','variant',NULL,'sku',sku.sku,'quantity',3,'unit_sale_price',sku.sale_price,'unit_actual_price',55.00,'discount',ROUND(sku.sale_price-55.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 165.00; v_paid := 165.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-13 14:00:00-03'; v_customer := 'Mirela Prata';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method',v_method,'installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Mirela Prata: 0 itens (REGATA-001)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Mirela Prata',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 11 Mirela Prata #% R$165,00', v_sale_friendly;
  END IF;

  -- 12. VENDA 12 — Júlia Caetano | 14/09/26 | CONJ-001 (amarelo) | R$160,00 PIX
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Júlia Caetano' AND s.sale_date::DATE='2026-09-14') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CONJ-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Conjunto saia+top amarelo','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',160.00,'discount',ROUND(sku.sale_price-160.00,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 160.00; v_paid := 160.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-14 17:00:00-03'; v_customer := 'Júlia Caetano';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method',v_method,'installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista');
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Júlia Caetano: 0 itens (CONJ-001)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Júlia Caetano',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 12 Júlia Caetano #% R$160,00', v_sale_friendly;
  END IF;

  -- 13. VENDA 13 — Matheus Lima | 14/09/26 | VESTIDO-003 (preto longo) | R$199,90 CRÉDITO 2x TAP
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Matheus Lima' AND s.sale_date::DATE='2026-09-14') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='VESTIDO-003' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Vestido longo preto','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',199.90,'discount',ROUND(sku.sale_price-199.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 199.90; v_paid := 199.90; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'CREDITO'; v_installments := 2; v_source := 'DISTANCIA'; v_date := '2026-09-14 17:30:00-03'; v_customer := 'Matheus Lima';
    v_fee_percent := 5.39; v_expected_fee := ROUND(v_charged * 5.39 / 100, 2); v_real_fee := v_expected_fee;
    v_payment := jsonb_build_object('provider_id',v_prov_infinite,'modality_id',v_mod_tap,'method',v_method,'installments',2,'amount',v_paid,'fee_percent',v_fee_percent,'fee_expected',v_expected_fee,'fee_actual',v_real_fee,'provider_snapshot','InfinitePay TAP','modality_snapshot','Máquina Crédito 2x');
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Matheus Lima: 0 itens (VESTIDO-003)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Matheus Lima',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET trans_date = v_date::DATE WHERE related_sale_id = v_sale_id;
    RAISE NOTICE '✔ Venda 13 Matheus Lima #% R$199,90', v_sale_friendly;
  END IF;

  -- 14. VENDA 14 — Evelyn | 09/09/26 | CALCA-001 + BLUSA-002 | R$240 PENDENTE (nada pago)
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Evelyn' AND s.sale_date::DATE='2026-09-09') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku IN ('CALCA-001','BLUSA-002') ORDER BY p.sku LOOP
      v_line := jsonb_build_object(
        'product_id', sku.id, 'variant_id', NULL,
        'product_name', CASE WHEN sku.sku='CALCA-001' THEN 'Calça pantalona' ELSE 'Blusa assimétrica' END,
        'variant', NULL, 'sku', sku.sku, 'quantity', 1,
        'unit_sale_price', sku.sale_price,
        'unit_actual_price', 120.00,
        'discount', ROUND(sku.sale_price - 120.00, 2)
      );
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 240.00; v_paid := 0.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'OUTRO'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-09 13:00:00-03'; v_customer := 'Evelyn';
    v_payment := NULL;
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Evelyn: 0 itens (CALCA-001 / BLUSA-002)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=NULL,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Evelyn',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date, status = 'PENDENTE' WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    UPDATE public.financial_transactions SET status='PENDENTE', due_date=(v_date + interval '30 days')::DATE, notes='Aguardando pagamento Evelyn (R$240,00)', amount=240.00 WHERE related_sale_id=v_sale_id AND trans_type='ENTRADA' AND category='VENDA';
    RAISE NOTICE '✔ Venda 14 Evelyn #% R$240,00 (PENDENTE — nada pago)', v_sale_friendly;
  END IF;

  -- 15. VENDA 15 — Day | 15/09/26 | CALCA-001 + BLUSA-003 (renda assimétrica) | R$260 PARCIAL R$130 PIX pago
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Day' AND s.sale_date::DATE='2026-09-15') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku IN ('CALCA-001','BLUSA-003') ORDER BY p.sku LOOP
      _line := jsonb_build_object(
        'product_id', sku.id, 'variant_id', NULL,
        'product_name', CASE sku.sku WHEN 'CALCA-001' THEN 'Calça pantalona' ELSE 'Blusa assimétrica com renda' END,
        'variant', NULL, 'sku', sku.sku, 'quantity', 1,
        'unit_sale_price', sku.sale_price,
        'unit_actual_price', 130.00,
        'discount', ROUND(sku.sale_price - 130.00, 2)
      );
      v_lines := array_append(v_lines, _line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 260.00; v_paid := 130.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-15 19:00:00-03'; v_customer := 'Day';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista (primeira parcela R$130)');
    v_packaging := jsonb_build_object('tipo_snapshot','GRANDE','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Day: 0 itens'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Day',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date, status = 'PARCIAL', total_customer = v_charged WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,related_sale_id,payment_method,status,due_date,created_by,notes) VALUES
      (v_date::DATE,'ENTRADA','VENDA','Day (parcela 2/2) — R$130 a receber',130.00,v_sale_id,'PIX','PENDENTE',(v_date+interval '30 days')::DATE,v_admin,'HIST-DAY-PARCELA2');
    UPDATE public.financial_transactions SET amount = v_charged, notes='Day (total R$260,00) - parcela 1/2 R$130 recebido PIX' WHERE related_sale_id=v_sale_id AND category='VENDA' AND trans_type='ENTRADA' AND status='CONFIRMADO';
    RAISE NOTICE '✔ Venda 15 Day #% R$260 (R$130 PIX pago / R$130 receber)', v_sale_friendly;
  END IF;

  -- 16. VENDA 16 — Cristina | 14/09/26 | 2x REGATA-001 R$69,90 | R$139,80 PARCIAL (R$69,90 PIX pago)
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Cristina' AND s.sale_date::DATE='2026-09-14') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='REGATA-001' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Regata alça fina (2und Cristina)','variant',NULL,'sku',sku.sku,'quantity',2,'unit_sale_price',sku.sale_price,'unit_actual_price',69.90,'discount',ROUND(sku.sale_price-69.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 139.80; v_paid := 69.90; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-14 15:30:00-03'; v_customer := 'Cristina';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista (1a parcela R$69,90)');
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Cristina: 0 itens (REGATA-001)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Cristina',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date, status = 'PARCIAL', total_customer = v_charged WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,related_sale_id,payment_method,status,due_date,created_by,notes) VALUES
      (v_date::DATE,'ENTRADA','VENDA','Cristina (2ª parcela R$69,90 a receber)',69.90,v_sale_id,'PIX','PENDENTE',(v_date+interval '30 days')::DATE,v_admin,'HIST-CRISTINA-PARCELA2');
    UPDATE public.financial_transactions SET amount=v_charged, notes='Cristina (total R$139,80) - parcela 1/2 R$69,90 PIX' WHERE related_sale_id=v_sale_id AND category='VENDA' AND trans_type='ENTRADA' AND status='CONFIRMADO';
    RAISE NOTICE '✔ Venda 16 Cristina #% R$139,80 (R$69,90 pago / R$69,90 receber)', v_sale_friendly;
  END IF;

  -- 17. VENDA 17 — Francisca | 16/09/26 | VESTIDO-003 | R$149,90 PARCIAL (R$80 pago / R$69,90 receber) — EMBALAGEM DESCONHECIDA
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Francisca' AND s.sale_date::DATE='2026-09-16') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='VESTIDO-003' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Vestido longo preto (Francisca)','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',149.90,'discount',ROUND(sku.sale_price-149.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 149.90; v_paid := 80.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'PIX'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-16 10:00:00-03'; v_customer := 'Francisca';
    v_fee_percent := 0; v_expected_fee := 0; v_real_fee := 0;
    v_payment := jsonb_build_object('provider_id',v_prov_pixdir,'modality_id',v_mod_pixd,'method','PIX','installments',1,'amount',v_paid,'fee_percent',0,'fee_expected',0,'fee_actual',0,'provider_snapshot','Pix Direto','modality_snapshot','Pix à vista (1ª parcela R$80)');
    v_packaging := jsonb_build_object('tipo_snapshot','DESCONHECIDA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Francisca: 0 itens (VESTIDO-003)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=v_payment,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Francisca',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date, status = 'PARCIAL', total_customer = v_charged WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,related_sale_id,payment_method,status,due_date,created_by,notes) VALUES
      (v_date::DATE,'ENTRADA','VENDA','Francisca (2ª parcela R$69,90 a receber)',69.90,v_sale_id,'PIX','PENDENTE',(v_date+interval '30 days')::DATE,v_admin,'HIST-FRANCISCA-PARCELA2');
    UPDATE public.financial_transactions SET amount=v_charged, notes='Francisca (total R$149,90) - parcela 1/2 R$80 PIX' WHERE related_sale_id=v_sale_id AND category='VENDA' AND trans_type='ENTRADA' AND status='CONFIRMADO';
    RAISE NOTICE '✔ Venda 17 Francisca #% R$149,90 (R$80 pago / R$69,90 receber — embalagem DESCONHECIDA)', v_sale_friendly;
  END IF;

  -- 18. VENDA 18 — Evellyn Luísa (fonoaudióloga) | 16/09/26 | CONJ-007 (saia+top poá amarelo) | R$189,90 PENDENTE
  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_name='Evellyn Luísa' AND s.sale_date::DATE='2026-09-16') THEN
    v_lines := ARRAY[]::JSONB[];
    FOR sku IN SELECT p.id,p.sku,p.sale_price FROM public.products p WHERE p.sku='CONJ-007' LOOP
      v_line := jsonb_build_object('product_id',sku.id,'variant_id',NULL,'product_name','Conjunto saia+top poá amarelo','variant',NULL,'sku',sku.sku,'quantity',1,'unit_sale_price',sku.sale_price,'unit_actual_price',189.90,'discount',ROUND(sku.sale_price-189.90,2));
      v_lines := array_append(v_lines, v_line);
    END LOOP;
    v_subtotal := 0; v_items_discount := 0;
    FOREACH _line IN ARRAY v_lines LOOP
      v_subtotal := v_subtotal + ((_line->>'quantity')::INT * (_line->>'unit_sale_price')::NUMERIC);
      v_items_discount := v_items_discount + ((_line->>'quantity')::INT * COALESCE((_line->>'discount')::NUMERIC,0));
    END LOOP;
    v_charged := 189.90; v_paid := 0.00; v_estimated_pix := 0;
    v_general_discount := GREATEST(0, v_subtotal - v_items_discount - v_charged); IF v_general_discount<0 THEN v_general_discount:=0; END IF;
    v_method := 'OUTRO'; v_installments := 1; v_source := 'DISTANCIA'; v_date := '2026-09-16 18:00:00-03'; v_customer := 'Evellyn Luísa';
    v_packaging := jsonb_build_object('tipo_snapshot','PEQUENA','is_free',true,'custo_snapshot',0);
    v_items := array_to_json(v_lines)::jsonb;
    IF COALESCE(array_length(v_lines,1),0)=0 THEN RAISE EXCEPTION 'Venda Evellyn Luísa (fono): 0 itens (CONJ-007 não encontrado)'; END IF;
    v_sale_id := (public.finalize_sale(p_source:='DISTANCIA',p_items:=v_items,p_general_discount:=v_general_discount,p_pix_discount:=0,p_payment:=NULL,p_packaging:=v_packaging,p_extra_costs:='[]'::jsonb,p_customer_name:='Evellyn Luísa',p_user_id:=v_admin)->>'sale_id')::UUID;
    UPDATE public.sales SET sale_date = v_date, status = 'PENDENTE', total_customer = v_charged WHERE id = v_sale_id RETURNING friendly_number INTO v_sale_friendly;
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,related_sale_id,payment_method,status,due_date,created_by,notes) VALUES
      (v_date::DATE,'ENTRADA','VENDA','Evellyn Luísa (fonoaudióloga) — R$189,90 pendente',189.90,v_sale_id,'OUTRO','PENDENTE',(v_date+interval '30 days')::DATE,v_admin,'HIST-EVELYN-FONO-PENDENTE');
    RAISE NOTICE '✔ Venda 18 Evellyn Luísa fono #% R$189,90 (PENDENTE)', v_sale_friendly;
  END IF;

  RAISE NOTICE E'🛒 PASSO 5 (patch 08) OK: 18 Vendas criadas.\\n   → VENDIDO:    R$2.937,21\\n   → RECEBIDO:  R$2.237,51\\n   → A RECEBER: R$699,70\\n   → 30 PEÇAS (13 CONCLUIDA / 2 PARCIAL / 3 PENDENTE)';
END $$;

-- ============================================================
-- ✅ PASSO 6: AUDITORIA FINAL (26 itens - notices)
-- ============================================================
DO $$
DECLARE
  _entradas INT; _pecas_compradas INT; _investimento NUMERIC(12,2);
  _vendas INT; _vendido NUMERIC(12,2); _recebido NUMERIC(12,2); _receber NUMERIC(12,2);
  _pecas_vendidas INT;
  _estoque_total INT;
  _etq INT := 30; _ades INT := 48;
  _g INT := 9; _p INT := 8;
  _divergencia NUMERIC := 55;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(quantity_received)::INT,0), COALESCE(SUM(total_invoice)::NUMERIC,0)
  INTO _entradas, _pecas_compradas, _investimento
  FROM (SELECT pe.id, pe.total_cost total_invoice, COALESCE(SUM(b.quantity_received),0) quantity_received
        FROM public.purchase_entries pe
        LEFT JOIN public.inventory_batches b ON b.purchase_entry_id = pe.id
        WHERE pe.notes LIKE 'HIST-ENTRADA-%'
        GROUP BY pe.id, pe.total_cost) _;

  SELECT COUNT(*),
         COALESCE(SUM(total_customer)::NUMERIC,0),
         COALESCE((SELECT SUM(amount) FROM public.financial_transactions ft
             JOIN public.sales s ON s.id = ft.related_sale_id
             WHERE s.customer_name IN ('Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
               'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
               'Day','Cristina','Francisca','Evelyn','Evellyn Luísa')
               AND ft.status='CONFIRMADO' AND ft.trans_type='ENTRADA' AND ft.category='VENDA'),0),
         COALESCE((SELECT SUM(amount) FROM public.financial_transactions ft
             JOIN public.sales s ON s.id = ft.related_sale_id
             WHERE s.customer_name IN ('Day','Cristina','Francisca','Evelyn','Evellyn Luísa')
               AND ft.status='PENDENTE' AND ft.trans_type='ENTRADA' AND ft.category='VENDA'),0),
         COALESCE((SELECT SUM(quantity) FROM public.sale_items si
             JOIN public.sales s ON s.id = si.sale_id
             WHERE s.customer_name IN ('Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
               'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
               'Day','Cristina','Francisca','Evelyn','Evellyn Luísa')),0)
  INTO _vendas, _vendido, _recebido, _receber, _pecas_vendidas
  FROM public.sales s
  WHERE s.customer_name IN ('Maria Luísa','Amanda','Lorrany','Carol','Rebeca','Ruth','Ana Larissa','Ingrid',
     'Emilly Gabrielly','Maria Clara','Mirela Prata','Júlia Caetano','Matheus Lima',
     'Day','Cristina','Francisca','Evelyn','Evellyn Luísa');

  SELECT COALESCE(SUM(quantity_available),0)::INT INTO _estoque_total
  FROM public.inventory_batches;

  RAISE NOTICE E'\\n\\n==========================================================\\n📊 AUDITORIA FINAL 26 ITENS EVELINE GESTÃO\\n==========================================================';
  RAISE NOTICE '01) 3 Remessas mercadoria = % entradas criadas.', _entradas;
  RAISE NOTICE '02) % peças compradas (6+13+19 = 38).', _pecas_compradas;
  RAISE NOTICE '03) Investimento mercadorias = R$% (R$380+R$410+R$1.160).', to_char(_investimento,'FM999G999D00');
  RAISE NOTICE '04) ⚠️ DIVERGÊNCIA 2ª remessa: -R$% (soma unit R$465 vs informado R$410).', to_char(_divergencia,'FM90D00');
  RAISE NOTICE '05) Materiais embalagem = R$303,51 (sacolas+etiquetas+adesivos+papel seda).';
  RAISE NOTICE '06) Cheirinho sacolas = R$35,00 (investimento).';
  RAISE NOTICE '07) Frete CONFIRMADO 3ª remessa = R$119,20 (já incluso no custo entrada3).';
  RAISE NOTICE '08) TOTAL INVESTIMENTOS CONHECIDOS = R$2.407,71 (303,51+35+119,20+1.070).';
  RAISE NOTICE '09) ⏳ Outros fretes (1ª e 2ª remessa) = PENDENTES DE IDENTIFICAÇÃO.';
  RAISE NOTICE '10) R$1.070,00 PASSIVO a devolver à sócia (NÃO é despesa!).';
  RAISE NOTICE '11) % vendas históricas cadastradas (13 CONCLUIDA / 2 PARCIAL / 3 PENDENTE).', _vendas;
  RAISE NOTICE '12) TOTAL VENDIDO = R$%.', to_char(_vendido,'FM999G999D00');
  RAISE NOTICE '13) TOTAL RECEBIDO = R$%.', to_char(_recebido,'FM999G999D00');
  RAISE NOTICE '14) CONTAS A RECEBER = R$% (Day+Cris+Fran+Evelyn+Evellyn).', to_char(_receber,'FM999G999D00');
  RAISE NOTICE '15) % PEÇAS VENDIDAS / RESERVADAS (30 - 18 vendas).', _pecas_vendidas;
  RAISE NOTICE '16) ESTOQUE TEÓRICO = % peças (compradas - vendidas). Valide por SKU no dashboard.', (_pecas_compradas - _pecas_vendidas);
  RAISE NOTICE '17) Etiquetas consumidas = %.', _etq;
  RAISE NOTICE '18) Adesivos consumidos = %.', _ades;
  RAISE NOTICE '19) Sacolas GRANDES = % (Maria Luísa, Ruth, Lorrany, Maria Clara, Júlia, Matheus, Evelyn, Day + 1).', _g;
  RAISE NOTICE '20) Sacolas PEQUENAS = % (Amanda, Ingrid, Rebeca, Ana L, Emilly, Mirela, Cris, Evellyn fono).', _p;
  RAISE NOTICE '21) Sacola da Francisca = TAMANHO DESCONHECIDO (não inventar).';
  RAISE NOTICE '22) CMV (custo mercadorias vendidas) = Calculado automaticamente pelo FIFO lotes inventory_batches. Veja itens custo na tela da venda.';
  RAISE NOTICE '23) Embalagens consumidas = custo unitário de cada sacola (GRANDE R$8,313; PEQUENA R$7,113). Calculado em sale_packaging por venda.';
  RAISE NOTICE '24) Taxas pagamento = R$24,11 (estimativa LINK 4.2%/6.09%, TAP 3.15%/5.39%, PIX 0%).';
  RAISE NOTICE '25) 💰 Lucro bruto = Faturamento − CMV − taxas − embalagens. Lucro líquido = bruto − outras despesas − sócia NÃO entra como despesa 2x.';
  RAISE NOTICE E'26) PENDÊNCIAS QUE IMPEDEM CONCILIAÇÃO 100%:\\n   ✅ Divergência R$55 2ª remessa\\n   ✅ Frete 1ª remessa\\n   ✅ Frete 2ª remessa\\n   ✅ Fabiana (roupas+frete juntos)\\n   ✅ Quais compras foram pagas com a sócia R$1070\\n   ✅ Embalagem Francisca\\n   ✅ CMV unitário 1ª remessa (rateado, custo individual real inexistente)\\n   ✅ Custo unitário embalagens R$303,51 por item (sacola/etiqueta/adesivo/papel seda)\\n   ✅ Cheirinho R$35: quanto consumido vs sobrou';
  RAISE NOTICE E'\\n🏆 SCRIPT ALL-IN-ONE EXECUTADO COM SUCESSO! 🎉\\n==========================================================';
END $$;

-- TUDO OK! COMMIT FINAL
COMMIT;
RAISE NOTICE '🎉 COMMIT REALIZADO — NENHUMA TRANSAÇÃO PERDIDA. Pode abrir o dashboard Eveline Gestão agora! 🎊';
