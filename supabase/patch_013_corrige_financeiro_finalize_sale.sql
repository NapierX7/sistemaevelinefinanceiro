-- ==============================================================================
-- PATCH 013 — CORREÇÃO FINANCEIRA NA FINALIZAÇÃO DE VENDA
-- Objetivo:
--   1. payment_source NÃO fica mais NULL nem hardcoded 'CAIXA_EVELINE'.
--      Agora é determinado a partir de p_payment->>'provider_snapshot' e
--      p_payment->>'method':
--        · Mercado Pago      → MERCADO_PAGO
--        · InfinitePay       → INFINITEPAY
--        · Fabiana / Dona    → FABIANA / DONA
--        · (default) Pix/dinheiro direto na conta → CAIXA_EVELINE
--   2. TAXA passa a ter o MESMO payment_source da venda (reduz resultado
--      mas NÃO toca em CAIXA_EVELINE se a venda ainda está no intermediador).
--   3. NUNCA mais insere financial_transaction SAIDA / category=EMBALAGEM
--      (sacolas já saíram quando foram compradas; aqui só reduz lucro
--      gerencial via sales.packaging_cost).
--   4. Venda SEM pagamento informado / amount 0 → status = 'PENDENTE'
--      e payment_source = NULL (não aumenta caixa; fica em A RECEBER).
--
-- NÃO ALTERA NENHUM DADO HISTÓRICO. NÃO cria/remove tabelas/RLS/indexes.
-- Apenas substitui o CORPO das funções public.hist_finalize_sale e
-- public.finalize_sale (wrapper). Execute 1 vez no SQL Editor do Supabase.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.hist_finalize_sale(
  p_source TEXT DEFAULT 'PRESENCIAL',
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

  c_batches CURSOR (pid UUID) FOR
    SELECT b.* FROM public.inventory_batches b
    WHERE b.product_id = pid AND b.quantity_available > 0
    ORDER BY b.received_at, b.id
    FOR UPDATE;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'Nenhum item informado na venda';
  END IF;

  SELECT (COALESCE((value #>> '{}')::INT,0) + 1) INTO v_friendly FROM public.counters WHERE key='sale_friendly_number';
  IF NOT FOUND THEN
    v_friendly := 1;
    INSERT INTO public.counters(key,value) VALUES ('sale_friendly_number',to_jsonb(1)) ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.counters SET value = to_jsonb(v_friendly) WHERE key='sale_friendly_number';
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
          SET quantity_available = quantity_available - v_this_qty
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
    THEN ROUND((v_real_profit / v_total_customer) * 100, 4) ELSE 0 END;

  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      UPDATE public.sales SET
        status = 'CONCLUIDA',
        items_subtotal = v_items_subtotal,
        product_discounts = v_product_discounts,
        general_discount = COALESCE(p_general_discount, 0),
        pix_discount = COALESCE(p_pix_discount, 0),
        total_discounts = v_total_discounts,
        total_customer = v_total_customer,
        packaging_cost = v_packaging_cost,
        items_cost = v_items_cost,
        fee_actual = v_fee_actual,
        updated_at = now()
      WHERE id = v_sale_id;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        UPDATE public.sales SET
          status = 'CONCLUIDA',
          total_customer = v_total_customer,
          updated_at = now()
        WHERE id = v_sale_id;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END;

  -- ============================================================================
  -- BLOCO FINANCEIRO CORRIGIDO (PATCH 013)
  --   · payment_source dinâmico (provider_snapshot + method)
  --   · Venda sem pagamento → status PENDENTE, payment_source NULL
  --   · Taxa = mesma payment_source da venda
  --   · NUNCA insere SAIDA EMBALAGEM (custo apenas gerencial)
  -- ============================================================================
  DECLARE
    _friendly  TEXT := lpad(COALESCE(v_friendly,0)::text,6,'0');
    _paym_met  TEXT := CASE WHEN p_payment IS NOT NULL THEN COALESCE(upper(trim(p_payment->>'method')),'OUTRO') ELSE 'OUTRO' END;
    _prov_name TEXT := CASE WHEN p_payment IS NOT NULL THEN lower(trim(COALESCE(p_payment->>'provider_snapshot',''))) ELSE '' END;
    _ps_hint   TEXT := CASE WHEN p_payment IS NOT NULL THEN COALESCE(p_payment->>'payment_source_hint','') ELSE '' END;
    _amt_payd  NUMERIC := COALESCE((p_payment->>'amount')::NUMERIC, v_total_customer);
    _has_pay   BOOLEAN := p_payment IS NOT NULL AND _amt_payd > 0;
    _v_ps      TEXT := 'CAIXA_EVELINE';
    _tx_status TEXT;
    _tx_ps     TEXT;
  BEGIN
    -- 1) Determina payment_source (prioridade: hint do frontend → provider_snapshot → method)
    IF _ps_hint <> '' THEN
      _v_ps := upper(trim(_ps_hint));
    ELSIF _prov_name LIKE '%mercado%' OR _prov_name LIKE 'mp%' OR _prov_name LIKE '%mercadopago%' OR _paym_met = 'MERCADOPAGO' THEN
      _v_ps := 'MERCADO_PAGO';
    ELSIF _prov_name LIKE '%infinite%' OR _prov_name LIKE '%infinitepay%' OR _paym_met = 'INFINITEPAY' THEN
      _v_ps := 'INFINITEPAY';
    ELSIF _paym_met = 'FABIANA' THEN
      _v_ps := 'FABIANA';
    ELSIF _paym_met = 'DONA' THEN
      _v_ps := 'DONA';
    END IF;

    -- 2) Venda PENDENTE (sem pagamento / valor 0) → status PENDENTE + payment_source NULL
    _tx_status := CASE WHEN _has_pay THEN 'CONFIRMADO' ELSE 'PENDENTE' END;
    _tx_ps     := CASE WHEN _has_pay THEN _v_ps ELSE NULL END;

    -- 3) ENTRADA VENDA
    BEGIN
      INSERT INTO public.financial_transactions
        (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, created_by, payment_source)
      VALUES (
        CURRENT_DATE, 'ENTRADA', 'VENDA',
        'Venda #' || _friendly,
        v_total_customer, v_sale_id, _paym_met, _tx_status, p_user_id, _tx_ps
      );
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO public.financial_transactions (trans_date, trans_type, category, description, amount, related_sale_id, status, payment_source)
          VALUES (CURRENT_DATE, 'ENTRADA', 'VENDA', 'Venda #' || _friendly, v_total_customer, v_sale_id, _tx_status, _tx_ps);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;

    -- 4) SAÍDA TAXA (mesma payment_source da venda)
    IF v_fee_actual > 0 THEN
      BEGIN
        INSERT INTO public.financial_transactions
          (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by, payment_source)
        VALUES (CURRENT_DATE, 'SAIDA', 'TAXA', 'Taxa pagamento Venda #' || _friendly,
          v_fee_actual, v_sale_id, _tx_status, p_user_id, _tx_ps);
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.financial_transactions (trans_date, trans_type, category, description, amount, related_sale_id, status, payment_source)
            VALUES (CURRENT_DATE, 'SAIDA', 'TAXA', 'Taxa Venda', v_fee_actual, v_sale_id, _tx_status, _tx_ps);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END IF;

    -- 5) EMBALAGEM — NÃO INSERIR NUNSA (custo gerencial apenas em sales.packaging_cost).
    --    O dinheiro real já saiu na compra de sacolas/adesivos anteriormente.

    -- 6) CUSTOS EXTRAS (normalmente são pagos diretos da Eveline → CAIXA_EVELINE)
    IF v_extra_costs_total > 0 THEN
      DECLARE
        _ex_ps TEXT := CASE WHEN _has_pay THEN 'CAIXA_EVELINE' ELSE NULL END;
        _ex_st TEXT := CASE WHEN _has_pay THEN 'CONFIRMADO' ELSE 'PENDENTE' END;
      BEGIN
        INSERT INTO public.financial_transactions
          (trans_date, trans_type, category, description, amount, related_sale_id, status, created_by, payment_source)
        VALUES (CURRENT_DATE, 'SAIDA', 'OUTRA_DESPESA', 'Custos extras Venda #' || _friendly,
          v_extra_costs_total, v_sale_id, _ex_st, p_user_id, _ex_ps);
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.financial_transactions (trans_date, trans_type, category, description, amount, related_sale_id, status, payment_source)
            VALUES (CURRENT_DATE, 'SAIDA', 'OUTRA_DESPESA', 'Custos extras', v_extra_costs_total, v_sale_id, _ex_st, _ex_ps);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END IF;
  END;

  BEGIN
    INSERT INTO public.audit_logs (user_id, action, entity, entity_id, metadata)
    VALUES (p_user_id, 'FINALIZE', 'SALE', v_sale_id,
      jsonb_build_object(
        'friendly_number', v_friendly,
        'items_count', v_items_count,
        'total_customer', v_total_customer,
        'real_profit', v_real_profit,
        'source', p_source
      ));
  EXCEPTION WHEN OTHERS THEN NULL; END;

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

-- ==============================================================================
-- Wrapper finalize_sale — mantém a mesma interface da chamada RPC feita
-- pelo frontend. Simplesmente delega para hist_finalize_sale corrigida.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.finalize_sale(
  p_source TEXT DEFAULT 'PRESENCIAL',
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
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.hist_finalize_sale(
    p_source           := p_source,
    p_items            := p_items,
    p_general_discount := p_general_discount,
    p_coupon_code      := p_coupon_code,
    p_pix_discount     := p_pix_discount,
    p_payment          := p_payment,
    p_packaging        := p_packaging,
    p_extra_costs      := p_extra_costs,
    p_customer_name    := p_customer_name,
    p_customer_phone   := p_customer_phone,
    p_user_id          := p_user_id
  );
END;$$;
