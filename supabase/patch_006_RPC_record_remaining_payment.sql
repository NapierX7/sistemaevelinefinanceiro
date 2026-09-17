-- ============================================================
-- PATCH 006 — CRIAR RPC record_remaining_payment
-- Permite QUITAR o restante de uma venda status PARCIAL ou PENDENTE.
--   - Se pagamento recebido: cria nova sale_payment (2ª parcela)
--   - Marca transação financeira PENDENTE (a receber) como CONFIRMADO
--   - Atualiza status da venda: PARCIAL→CONCLUIDA, PENDENTE→CONCLUIDA
--   - Atualiza totais fee_actual acumulado na sale
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_remaining_payment(
  p_sale_id UUID,
  p_payment JSONB,         -- mesma estrutura do finalize_sale:
                            -- { method, provider_id, modality_id, installments,
                            --   amount, fee_percent, fee_expected, fee_actual,
                            --   provider_snapshot, modality_snapshot, fee_rule_id }
  p_amount NUMERIC DEFAULT NULL,  -- valor RECEBIDO agora (se NULL = total pendente)
  p_trans_date TIMESTAMPTZ DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
  v_trans_new UUID;
  v_uid UUID;
  v_dt TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda % não encontrada', p_sale_id;
  END IF;
  IF v_sale.status NOT IN ('PARCIAL','PENDENTE') THEN
    RAISE EXCEPTION 'Venda com status % não pode receber pagamento restante. Use CONCLUIDA para finalizar nova venda.', v_sale.status;
  END IF;

  v_uid := COALESCE(p_user_id, auth.uid());
  v_dt := COALESCE(p_trans_date, clock_timestamp());
  v_total := v_sale.total_customer;

  -- Valor já recebido via sale_payments
  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
    FROM public.sale_payments p WHERE p.sale_id = p_sale_id;

  v_pending := ROUND((v_total - v_paid)::NUMERIC, 2);
  v_amount := ROUND(COALESCE(p_amount, v_pending)::NUMERIC, 2);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Valor recebido deve ser maior que zero (pendente R$%).', to_char(v_pending, 'FM999990D00');
  END IF;
  IF v_amount > (v_pending + 0.01) THEN
    RAISE EXCEPTION 'Valor informado R$% > saldo pendente R$%. Receba no máximo o pendente.',
      to_char(v_amount, 'FM999990D00'), to_char(v_pending, 'FM999990D00');
  END IF;

  -- Extrai dados do pagamento
  v_method         := COALESCE(NULLIF((p_payment->>'method')::TEXT,''), 'PIX');
  v_installments   := COALESCE(NULLIF((p_payment->>'installments')::INTEGER, NULL), 1);
  v_provider_id    := (p_payment->>'provider_id')::UUID;
  v_modality_id    := (p_payment->>'modality_id')::UUID;
  v_provider_snap  := (p_payment->>'provider_snapshot')::TEXT;
  v_modality_snap  := (p_payment->>'modality_snapshot')::TEXT;
  v_fee_rule_id    := (p_payment->>'fee_rule_id')::UUID;
  v_fee_percent    := COALESCE((p_payment->>'fee_percent')::NUMERIC, 0);
  v_fee_expected   := ROUND(COALESCE((p_payment->>'fee_expected')::NUMERIC, v_amount * v_fee_percent / 100, 0)::NUMERIC, 4);
  v_fee_actual     := ROUND(COALESCE(NULLIF((p_payment->>'fee_actual')::NUMERIC, NULL), v_fee_expected, 0)::NUMERIC, 4);

  -- 1) Cria a sale_payment da 2a parcela (baixa complementar)
  INSERT INTO public.sale_payments (
    sale_id, method, installments,
    provider_id, modality_id, fee_rule_id,
    fee_percent_snapshot, fee_expected_snapshot, fee_real_snapshot,
    amount, provider_snapshot, modality_snapshot
  ) VALUES (
    p_sale_id, v_method, v_installments,
    v_provider_id, v_modality_id, v_fee_rule_id,
    v_fee_percent, v_fee_expected, v_fee_actual,
    v_amount, v_provider_snap, v_modality_snap
  ) RETURNING id INTO v_sale_pay;

  -- 2) Cria transação financeira ENTRADA da 2a parcela (RECEBIDO)
  INSERT INTO public.financial_transactions (
    trans_date, trans_type, category, description,
    amount, related_sale_id, payment_method,
    status, due_date, created_by, notes
  ) VALUES (
    v_dt::DATE, 'ENTRADA', 'VENDA',
    format('Pagamento complementar venda #%s (%s/%s parcela)',
      v_sale.friendly_number,
      COALESCE(NULLIF(v_modality_snap,''), v_method),
      v_installments||'x'
    ),
    v_amount, p_sale_id, v_method,
    'CONFIRMADO', NULL, v_uid,
    COALESCE(p_notes, '')
  ) RETURNING id INTO v_trans_new;

  -- 3) Transação de TAXA (se houver fee_actual)
  IF v_fee_actual > 0 THEN
    INSERT INTO public.financial_transactions (
      trans_date, trans_type, category, description,
      amount, related_sale_id, payment_method,
      status, created_by, notes
    ) VALUES (
      v_dt::DATE, 'SAIDA', 'TAXA',
      format('Taxa pagamento complementar venda #%s (%s)', v_sale.friendly_number, COALESCE(v_provider_snap, v_method)),
      v_fee_actual, p_sale_id, v_method,
      'CONFIRMADO', v_uid, ''
    );
  END IF;

  -- 4) Transação PENDENTE anterior (a receber): SE existir transação PENDENTE
  --    para essa venda com due_date = data original, pode marcar CONFIRMADO ou APAGAR
  --    Aqui marcamos CONFIRMADO referenciando o pagamento novo.
  UPDATE public.financial_transactions
    SET status = 'CONFIRMADO',
        updated_at = clock_timestamp(),
        notes = COALESCE(notes,'') || ' [quitado por pagamento complementar]'
    WHERE related_sale_id = p_sale_id
      AND status = 'PENDENTE'
      AND trans_type = 'ENTRADA'
      AND category = 'VENDA';

  -- 5) Atualiza totais da venda e status para CONCLUIDA (se agora pago tudo)
  v_paid := v_paid + v_amount;
  v_pending := ROUND((v_total - v_paid)::NUMERIC, 2);

  UPDATE public.sales
    SET status = CASE WHEN v_pending <= 0.00 THEN 'CONCLUIDA' ELSE 'PARCIAL' END,
        fee_actual = fee_actual + v_fee_actual,
        fee_expected = fee_expected + v_fee_expected,
        real_profit = real_profit - v_fee_actual,
        real_margin = CASE
          WHEN total_customer = 0 THEN 0
          ELSE ((total_customer - (items_cost + allocated_purchase_cost + fee_actual + v_fee_actual
                                  + packaging_cost + extra_costs)) / total_customer) * 100 END,
        updated_at = clock_timestamp()
    WHERE id = p_sale_id;

  RAISE NOTICE 'Pagamento complementar R$% adicionado à venda #%. Novo status: %',
    to_char(v_amount, 'FM999990D00'),
    v_sale.friendly_number,
    CASE WHEN v_pending <= 0 THEN 'CONCLUIDA' ELSE 'PARCIAL' END;

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', p_sale_id,
    'amount', v_amount,
    'fee_actual', v_fee_actual,
    'new_status', CASE WHEN v_pending <= 0 THEN 'CONCLUIDA' ELSE 'PARCIAL' END,
    'pending_after', ROUND(CASE WHEN v_pending <= 0 THEN 0 ELSE v_pending END, 2),
    'sale_payment_id', v_sale_pay,
    'financial_transaction_id', v_trans_new
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_remaining_payment(UUID,JSONB,NUMERIC,TIMESTAMPTZ,UUID,TEXT) TO authenticated, service_role;
