-- ============================================================
-- PATCH 004 — CORRIGE ERRO 0A000 (record ->> unknown)
-- Causa raiz:
--   1) DECLARE "i JSONB" mas atribui FOR i IN SELECT * FROM jsonb_array_elements
--      (isso retorna RECORD com 1 coluna "value" JSONB, NÃO JSONB puro)
--   2) jsonb_populate_record(NULL::record, i) — tipagem RECORD indeterminada
--      em versões recentes PostgreSQL / Supabase.
-- Solução:
--   - Trocar loops por FOR elem IN SELECT value AS v FROM jsonb_array_elements()
--     (elem é RECORD; JSONB fica em elem.v)
--   - Remover jsonb_populate_record inútil.
-- Roda com segurança: DROP + CREATE OR REPLACE, NÃO apaga dados.
-- ============================================================

-- ------------------------------------------------------------
-- 1) CORRIGE RPC public.finalize_sale
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_sale(
  p_source TEXT,
  p_items JSONB,
  p_general_discount NUMERIC DEFAULT 0,
  p_coupon_id UUID DEFAULT NULL,
  p_coupon_code TEXT DEFAULT NULL,
  p_pix_discount NUMERIC DEFAULT 0,
  p_payment JSONB DEFAULT NULL,
  p_packaging JSONB DEFAULT NULL,
  p_extra_costs JSONB DEFAULT '[]'::jsonb,
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
  _item JSONB;
  _extra JSONB;
  v_coupon_discount NUMERIC(12,2) := 0;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('SITE','PRESENCIAL','DISTANCIA','OUTRO') THEN
    RAISE EXCEPTION 'Origem (source) inválida';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum item informado na venda';
  END IF;

  INSERT INTO public.sales (
    status, source, customer_name, customer_phone,
    created_by, coupon_id, coupon_snapshot
  ) VALUES (
    'PENDENTE', p_source, p_customer_name, p_customer_phone,
    p_user_id, p_coupon_id, p_coupon_code
  ) RETURNING id, friendly_number INTO v_sale_id, v_friendly;

  -- 2. Processar itens + FIFO nos lotes
  FOR _item IN SELECT v FROM jsonb_array_elements(p_items) AS t(v) LOOP
    v_current_cost := COALESCE((SELECT current_cost FROM public.products WHERE id = (_item->>'product_id')::UUID), 0);
    qty_needed := (_item->>'quantity')::INTEGER;
    IF qty_needed <= 0 THEN CONTINUE; END IF;

    v_batch_ids := ARRAY[]::UUID[];
    v_line_unit_cost := 0;
    v_line_alloc := 0;

    FOR bat IN
      SELECT * FROM public.inventory_batches b
      WHERE b.product_id = (_item->>'product_id')::UUID
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

      INSERT INTO public.inventory_movements
        (product_id, variant_id, batch_id, movement_type, reason, quantity, unit_cost, related_sale_id, created_by)
      VALUES (
        (_item->>'product_id')::UUID,
        (_item->>'variant_id')::UUID,
        bat.id,
        'SAIDA',
        'VENDA',
        take,
        bat.unit_cost,
        v_sale_id,
        p_user_id
      );
    END LOOP;

    IF qty_needed > 0 THEN
      v_line_unit_cost := v_line_unit_cost + (v_current_cost * qty_needed);
      INSERT INTO public.inventory_movements
        (product_id, variant_id, batch_id, movement_type, reason, quantity, unit_cost, related_sale_id, created_by, notes)
      VALUES (
        (_item->>'product_id')::UUID,
        (_item->>'variant_id')::UUID,
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

    v_line_sub := COALESCE((_item->>'unit_sale_price')::NUMERIC, 0) * COALESCE((_item->>'quantity')::INTEGER, 0);
    v_line_discount := COALESCE((_item->>'discount')::NUMERIC, 0);
    v_line_total := v_line_sub - v_line_discount;

    v_items_count := v_items_count + COALESCE((_item->>'quantity')::INTEGER, 0);
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
      (_item->>'product_id')::UUID,
      (_item->>'variant_id')::UUID,
      COALESCE(_item->>'product_name', 'Produto sem nome'),
      _item->>'variant',
      _item->>'sku',
      COALESCE((_item->>'quantity')::INTEGER, 0),
      CASE WHEN COALESCE((_item->>'quantity')::INTEGER,0) > 0
        THEN ROUND(v_line_unit_cost / (_item->>'quantity')::INTEGER, 4) ELSE 0 END,
      CASE WHEN COALESCE((_item->>'quantity')::INTEGER,0) > 0
        THEN ROUND(v_line_alloc / (_item->>'quantity')::INTEGER, 4) ELSE 0 END,
      COALESCE((_item->>'unit_sale_price')::NUMERIC, 0),
      COALESCE((_item->>'unit_actual_price')::NUMERIC, 0),
      v_line_discount,
      v_line_total,
      v_batch_ids
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

  IF p_extra_costs IS NOT NULL THEN
    FOR _extra IN SELECT v FROM jsonb_array_elements(p_extra_costs) AS t(v) LOOP
      v_extra_costs_total := v_extra_costs_total + COALESCE((_extra->>'amount')::NUMERIC, 0);
      INSERT INTO public.sale_costs (sale_id, description, category, amount)
      VALUES (
        v_sale_id,
        COALESCE(_extra->>'description','Custo extra'),
        COALESCE(_extra->>'category','OUTRO'),
        COALESCE((_extra->>'amount')::NUMERIC, 0)
      );
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

-- ------------------------------------------------------------
-- 2) CORRIGE RPC public.create_purchase_entry
-- ------------------------------------------------------------
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
      VALUES (v_entry_id,
        COALESCE(_oc->>'description','Outro custo'),
        COALESCE(_oc->>'category','OUTRO'),
        COALESCE((_oc->>'amount')::NUMERIC, 0));
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

    INSERT INTO public.purchase_entry_items
      (purchase_entry_id, product_id, product_snapshot, unit_cost, quantity, line_total)
    VALUES (
      v_entry_id,
      (_item->>'product_id')::UUID,
      COALESCE(_item->>'product_name','Produto'),
      v_cost,
      v_qty,
      v_line_total
    );
  END LOOP;

  v_total_cost := v_items_total + COALESCE(p_shipping_cost, 0) + v_others_total;

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
        item.quantity,
        item.quantity
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
