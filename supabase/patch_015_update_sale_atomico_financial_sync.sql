-- ==============================================================================
-- PATCH 015 — SINCRONIZAÇÃO ATÔMICA EDIÇÃO DE VENDA
-- EXECUTAR APENAS UMA VEZ NO SQL EDITOR DO SUPABASE.
-- NÃO ALTERA DADOS HISTÓRICOS EXISTENTES (conciliação, Venda #43 etc intactos).
--
-- Objetivo: Ao editar uma venda no Histórico (sales + sale_payments),
-- sincronizar de forma atômica as financial_transactions (VENDA + TAXA).
-- Corrige bug onde a venda aparecia CONCLUIDA/PIX mas a FT continuava
-- PENDENTE / payment_source NULL (não compunha v_cash_eveline_summary).
--
-- Regras (igual documento frontend):
--  1. PIX direto / Dinheiro / Pagamento direto Eveline = VENDA CONFIRMADO + payment_source CAIXA_EVELINE
--  2. InfinitePay = VENDA CONFIRMADO + payment_source INFINITEPAY (não cai direto no caixa)
--  3. Mercado Pago = VENDA CONFIRMADO + payment_source MERCADO_PAGO
--  4. Venda pendente / não paga = status PENDENTE + payment_source NULL
--  5. Alteração de valor: ATUALIZA a VENDA + TAXA existentes por related_sale_id. NÃO DUPLICA.
--  6. Alteração de forma de pagamento: anti-duplicação (se IP → Pix, verifica repasse já existe)
--  7. Taxas: atualiza categoria=TAXA existente. NÃO DUPLICA. Modalidade sem taxa → ZERA taxa existente.
--  8. Embalagem: NÃO cria SAÍDA de embalagem ao editar.
--  9. REPASSE_INFINITEPAY: NÃO é criado nem duplicado aqui. Intocado.
-- 10. AJUSTE_CONCILIACAO: Nunca é tocado.
-- ==============================================================================
BEGIN;

-- ==========================================================================
-- FUNÇÃO INTERNA — Resolve payment_source a partir dos pagamentos consolidados.
-- Retorna 'CAIXA_EVELINE' | 'INFINITEPAY' | 'MERCADO_PAGO' | 'FABIANA' | 'DONA' | 'OUTRO' | NULL
-- Prioriza InfinitePay / Mercado Pago / Fabiana / Dona se qualquer pagamento for daquele provider.
-- Senão, cai para CAIXA_EVELINE se houver pagamento confirmado.
-- NULL se não há pagamentos ou o total recebido é zero (pendente).
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.__resolve_sale_payment_source(
  p_total_received NUMERIC,
  p_provider_names TEXT[],
  p_methods TEXT[]
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_any_infinite BOOLEAN;
  v_any_mp BOOLEAN;
  v_any_fabiana BOOLEAN;
  v_any_dona BOOLEAN;
  v_any_outro BOOLEAN;
  v_method_str TEXT;
  v_name TEXT;
  i INTEGER;
BEGIN
  IF p_total_received IS NULL OR p_total_received <= 0 THEN
    RETURN NULL;
  END IF;

  v_any_infinite := FALSE;
  v_any_mp := FALSE;
  v_any_fabiana := FALSE;
  v_any_dona := FALSE;
  v_any_outro := FALSE;

  IF p_provider_names IS NOT NULL THEN
    FOR i IN 1 .. array_length(p_provider_names, 1) LOOP
      v_name := btrim(COALESCE(lower(p_provider_names[i]), ''));
      IF v_name <> '' THEN
        IF v_name LIKE '%infinite%' OR v_name LIKE '%infinitpay%' THEN v_any_infinite := TRUE; END IF;
        IF v_name LIKE '%mercado%pago%' OR v_name LIKE '%mercadopago%' OR v_name LIKE '% mp %' OR v_name = 'mp' THEN v_any_mp := TRUE; END IF;
        IF v_name LIKE '%fabiana%' THEN v_any_fabiana := TRUE; END IF;
        IF v_name LIKE '%dona%' THEN v_any_dona := TRUE; END IF;
      END IF;
    END LOOP;
  END IF;

  IF p_methods IS NOT NULL THEN
    FOR i IN 1 .. array_length(p_methods, 1) LOOP
      v_method_str := upper(btrim(COALESCE(p_methods[i], '')));
      IF v_method_str = 'INFINITEPAY' THEN v_any_infinite := TRUE; END IF;
      IF v_method_str = 'MERCADOPAGO' OR v_method_str = 'MERCADO_PAGO' THEN v_any_mp := TRUE; END IF;
      IF v_method_str = 'FABIANA' THEN v_any_fabiana := TRUE; END IF;
      IF v_method_str = 'DONA' THEN v_any_dona := TRUE; END IF;
      IF v_method_str = 'OUTRO' THEN v_any_outro := TRUE; END IF;
    END LOOP;
  END IF;

  IF v_any_infinite THEN RETURN 'INFINITEPAY'; END IF;
  IF v_any_mp THEN RETURN 'MERCADO_PAGO'; END IF;
  IF v_any_fabiana THEN RETURN 'FABIANA'; END IF;
  IF v_any_dona THEN RETURN 'DONA'; END IF;
  IF v_any_outro THEN RETURN 'OUTRO'; END IF;
  RETURN 'CAIXA_EVELINE';
END;
$$;

-- ==========================================================================
-- RPC OFICIAL de edição atômica de venda.
--
-- Recebe patch de sales + OPCIONALMENTE um sale_payment individual a atualizar
-- (para o fluxo do frontend que edita apenas 1 pagamento por vez no SaleDetail).
--
-- Comportamento:
--  1. Atualiza public.sales com os campos permitidos.
--  2. Se p_payment_patch for informado, atualiza o sale_payments.id correspondente.
--  3. RECALCULA o estado financeiro a partir de (sales atualizada + TODOS sale_payments ativos).
--  4. FAZ UPSERT em financial_transactions para VENDA e TAXA por related_sale_id.
--  5. NÃO toca em REPASSE_INFINITEPAY, AJUSTE_CONCILIACAO, EMBALAGEM.
--
-- Idempotente: Chamar 10x com mesmo payload = 1 escrita efetiva.
-- ==========================================================================
DROP FUNCTION IF EXISTS public.update_sale_with_financial_sync(UUID, JSONB, JSONB);
CREATE OR REPLACE FUNCTION public.update_sale_with_financial_sync(
  p_sale_id UUID,
  p_sale_patch JSONB DEFAULT '{}'::jsonb,
  p_payment_patch JSONB DEFAULT NULL::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ---------------------------------------------------------------------------
  -- Variáveis da venda
  ---------------------------------------------------------------------------
  v_sale RECORD;
  v_sale_date DATE;
  v_status TEXT;
  v_total_customer NUMERIC;
  v_customer_name TEXT;

  ---------------------------------------------------------------------------
  -- Variáveis de consolidação pagamentos
  ---------------------------------------------------------------------------
  v_total_received NUMERIC := 0;
  v_total_fee_expected NUMERIC := 0;
  v_total_fee_real NUMERIC := 0;
  v_provider_names TEXT[] := ARRAY[]::TEXT[];
  v_methods TEXT[] := ARRAY[]::TEXT[];

  ---------------------------------------------------------------------------
  -- Financeiro derivado
  ---------------------------------------------------------------------------
  v_tx_ps TEXT;  -- payment_source (NULL, CAIXA_EVELINE, INFINITEPAY, MERCADO_PAGO…)
  v_tx_status TEXT;  -- 'PENDENTE' | 'CONFIRMADO'
  v_venda_amount NUMERIC;
  v_fee_amount NUMERIC;  -- Valor real da taxa a usar na transação TAXA (negativo)

  ---------------------------------------------------------------------------
  -- Anti-duplicação
  ---------------------------------------------------------------------------
  v_has_repasse_infinitepay BOOLEAN := FALSE;

  ---------------------------------------------------------------------------
  -- Ids existentes (para upsert por update, não insert+update)
  ---------------------------------------------------------------------------
  v_venda_ft_id UUID;
  v_taxa_ft_id UUID;

  ---------------------------------------------------------------------------
  -- Descrições
  ---------------------------------------------------------------------------
  v_desc_venda TEXT;
  v_desc_taxa TEXT;

  ---------------------------------------------------------------------------
  -- Controle (para mensagem de retorno)
  ---------------------------------------------------------------------------
  v_updated_sale BOOLEAN := FALSE;
  v_updated_payment BOOLEAN := FALSE;
  v_upserted_venda BOOLEAN := FALSE;
  v_upserted_taxa BOOLEAN := FALSE;
  v_removed_taxa BOOLEAN := FALSE;
  v_warning TEXT := NULL;
BEGIN
  -- -----------------------------------------------------------------------
  -- PASSO 0 — Validar venda existe
  -- -----------------------------------------------------------------------
  SELECT * INTO STRICT v_sale FROM public.sales WHERE id = p_sale_id LIMIT 1;

  -- -----------------------------------------------------------------------
  -- PASSO 1 — Atualizar sales (apenas campos permitidos)
  -- -----------------------------------------------------------------------
  IF p_sale_patch IS NOT NULL AND jsonb_typeof(p_sale_patch) = 'object' AND p_sale_patch <> '{}'::jsonb THEN
    WITH upd AS (
      UPDATE public.sales s
      SET
        customer_name    = COALESCE((p_sale_patch->>'customer_name')::TEXT,           s.customer_name),
        customer_phone   = COALESCE((p_sale_patch->>'customer_phone')::TEXT,          s.customer_phone),
        sale_date        = CASE
                             WHEN (p_sale_patch->>'sale_date') IS NOT NULL THEN
                               COALESCE(((p_sale_patch->>'sale_date')::TIMESTAMPTZ)::DATE, s.sale_date)
                             ELSE s.sale_date
                           END,
        source           = COALESCE(upper((p_sale_patch->>'source')::TEXT),           s.source),
        status           = COALESCE(upper((p_sale_patch->>'status')::TEXT),           s.status),
        total_customer   = COALESCE(NULLIF((p_sale_patch->>'total_customer')::NUMERIC, NULL), s.total_customer),
        notes            = CASE
                             WHEN (p_sale_patch ? 'notes') THEN
                               NULLIF(btrim((p_sale_patch->>'notes')::TEXT), '')
                             ELSE s.notes
                           END,
        updated_at       = now()
      WHERE s.id = p_sale_id
      RETURNING 1
    ) SELECT count(1) > 0 INTO v_updated_sale FROM upd;
    -- Recarregar venda pós-update
    SELECT * INTO STRICT v_sale FROM public.sales WHERE id = p_sale_id LIMIT 1;
  END IF;

  -- -----------------------------------------------------------------------
  -- PASSO 2 — Atualizar sale_payments (se informado)
  -- -----------------------------------------------------------------------
  IF p_payment_patch IS NOT NULL
     AND jsonb_typeof(p_payment_patch) = 'object'
     AND p_payment_patch ? 'id'
     AND (p_payment_patch->>'id')::UUID IS NOT NULL THEN

    WITH upd AS (
      UPDATE public.sale_payments sp
      SET
        method              = COALESCE(upper((p_payment_patch->>'method')::TEXT),               sp.method),
        provider_snapshot   = CASE
                                WHEN (p_payment_patch ? 'provider_snapshot') THEN
                                  NULLIF(btrim((p_payment_patch->>'provider_snapshot')::TEXT), '')
                                ELSE sp.provider_snapshot
                              END,
        modality_snapshot   = CASE
                                WHEN (p_payment_patch ? 'modality_snapshot') THEN
                                  NULLIF(btrim((p_payment_patch->>'modality_snapshot')::TEXT), '')
                                ELSE sp.modality_snapshot
                              END,
        amount              = COALESCE(NULLIF((p_payment_patch->>'amount')::NUMERIC, NULL),       sp.amount),
        fee_expected_snapshot = COALESCE((p_payment_patch->>'fee_expected_snapshot')::NUMERIC,   sp.fee_expected_snapshot),
        fee_real_snapshot   = COALESCE((p_payment_patch->>'fee_real_snapshot')::NUMERIC,         sp.fee_real_snapshot),
        fee_percent_snapshot= COALESCE((p_payment_patch->>'fee_percent_snapshot')::NUMERIC,      sp.fee_percent_snapshot),
        installments        = COALESCE(NULLIF((p_payment_patch->>'installments')::INTEGER, NULL), sp.installments),
        trans_date          = CASE
                                WHEN (p_payment_patch->>'trans_date') IS NOT NULL THEN
                                  COALESCE(((p_payment_patch->>'trans_date')::TIMESTAMPTZ)::DATE, sp.trans_date)
                                ELSE sp.trans_date
                              END,
        notes               = CASE
                                WHEN (p_payment_patch ? 'notes') THEN
                                  NULLIF(btrim((p_payment_patch->>'notes')::TEXT), '')
                                ELSE sp.notes
                              END,
        notes_snapshot      = CASE
                                WHEN (p_payment_patch ? 'notes_snapshot') THEN
                                  NULLIF(btrim((p_payment_patch->>'notes_snapshot')::TEXT), '')
                                ELSE sp.notes_snapshot
                              END,
        updated_at          = now()
      WHERE sp.id = (p_payment_patch->>'id')::UUID
        AND sp.sale_id = p_sale_id
      RETURNING 1
    ) SELECT count(1) > 0 INTO v_updated_payment FROM upd;
  END IF;

  -- -----------------------------------------------------------------------
  -- PASSO 3 — Consolidar TODOS os pagamentos ativos desta venda
  --            (baseado no estado ATUALIZADO do banco, não no patch).
  -- -----------------------------------------------------------------------
  SELECT
    COALESCE(sum(sp.amount), 0)::NUMERIC,
    COALESCE(sum(sp.fee_expected_snapshot), 0)::NUMERIC,
    COALESCE(sum(sp.fee_real_snapshot), 0)::NUMERIC,
    array_agg(sp.provider_snapshot ORDER BY sp.created_at) FILTER (WHERE sp.provider_snapshot IS NOT NULL AND btrim(sp.provider_snapshot::TEXT) <> ''),
    array_agg(sp.method::TEXT ORDER BY sp.created_at) FILTER (WHERE sp.method IS NOT NULL)
  INTO
    v_total_received,
    v_total_fee_expected,
    v_total_fee_real,
    v_provider_names,
    v_methods
  FROM public.sale_payments sp
  WHERE sp.sale_id = p_sale_id;

  v_sale_date        := v_sale.sale_date::DATE;
  v_status           := upper(v_sale.status::TEXT);
  v_total_customer   := COALESCE(v_sale.total_customer, 0)::NUMERIC;
  v_customer_name    := COALESCE(v_sale.customer_name, 'Cliente não identificado')::TEXT;

  -- -----------------------------------------------------------------------
  -- PASSO 4 — Determinar payment_source e status financeiro
  --            (Regras 1, 2, 3, 4 do documento)
  -- -----------------------------------------------------------------------
  v_tx_ps := public.__resolve_sale_payment_source(
    p_total_received => v_total_received,
    p_provider_names => v_provider_names,
    p_methods        => v_methods
  );

  -- Status financeiro depende de: venda cancelada / status sale / pagamentos recebidos.
  IF v_status = 'CANCELADA' THEN
    v_tx_status := 'CANCELADO';
  ELSIF v_total_received <= 0 THEN
    v_tx_status := 'PENDENTE';
  ELSIF v_status = 'PENDENTE' AND v_total_received < v_total_customer - 0.005 THEN
    -- Cliente pagou parcialmente mas venda marcada manualmente como pendente.
    -- Mantemos como PENDENTE financeiro se for menor que o total.
    v_tx_status := 'PENDENTE';
  ELSIF v_status = 'PARCIAL' THEN
    v_tx_status := 'PENDENTE';  -- Parcial = entrada ainda não está consolidada 100% no caixa.
  ELSE
    v_tx_status := 'CONFIRMADO';
  END IF;

  -- Se a transação for PENDENTE ou CANCELADA, payment_source SEMPRE é NULL.
  IF v_tx_status <> 'CONFIRMADO' THEN
    v_tx_ps := NULL;
  END IF;

  -- -----------------------------------------------------------------------
  -- PASSO 5 — Valor das transações VENDA e TAXA
  -- -----------------------------------------------------------------------
  -- Transação VENDA: é o total RECEBIDO (amount de sale_payments), NÃO o total_customer.
  -- Porque é o dinheiro que entrou (ou vai entrar) no caixa / intermediador.
  v_venda_amount := GREATEST(0, v_total_received);

  -- Transação TAXA: usa fee_real_snapshot (valor real cobrado).
  -- Se fee_real for 0, mas fee_expected estiver preenchido, mantemos fee_expected
  -- por compatibilidade histórica (para não perder informação de taxa planejada).
  v_fee_amount := COALESCE(
    NULLIF(v_total_fee_real, 0),
    NULLIF(v_total_fee_expected, 0),
    0
  );

  -- -----------------------------------------------------------------------
  -- PASSO 6 — ANTI-DUPLICAÇÃO (Regra 6): troca InfinitePay → PIX/Direto
  --            Se já existe REPASSE_INFINITEPAY CONFIRMADO, NÃO deixamos
  --            cair de novo o bruto em CAIXA_EVELINE. Bloqueamos e avisamos.
  -- -----------------------------------------------------------------------
  SELECT EXISTS(
    SELECT 1 FROM public.financial_transactions ft
    WHERE ft.related_sale_id = p_sale_id
      AND ft.category         = 'REPASSE_INFINITEPAY'
      AND ft.status           = 'CONFIRMADO'
      AND ft.payment_source   = 'CAIXA_EVELINE'
      AND (ft.amount IS NULL OR ft.amount > 0)
    LIMIT 1
  ) INTO v_has_repasse_infinitepay;

  IF v_has_repasse_infinitepay THEN
    -- Venda já foi repassada para CAIXA_EVELINE via REPASSE_INFINITEPAY.
    -- Qualquer tentativa de jogar a VENDA novamente em CAIXA_EVELINE duplica o dinheiro.
    -- Forçamos a VENDA a continuar como payment_source = INFINITEPAY / CONFIRMADO.
    -- O caixa continua correto (já recebeu pelo repasse).
    IF v_tx_ps = 'CAIXA_EVELINE' OR v_tx_ps = 'FABIANA' OR v_tx_ps = 'DONA' OR v_tx_ps = 'OUTRO' THEN
      v_tx_ps := 'INFINITEPAY';
      v_warning := '⚠️ Venda já possui REPASSE_INFINITEPAY CONFIRMADO em caixa. Venda foi mantida como payment_source=INFINITEPAY para evitar dupla entrada no caixa. O saldo já está correto via repasse.';
    END IF;
  END IF;

  -- -----------------------------------------------------------------------
  -- PASSO 7 — UPSERT FINANCIAL_TRANSACTIONS VENDA
  --            (Regra 5: atualiza por related_sale_id, NÃO duplica.)
  -- -----------------------------------------------------------------------
  SELECT ft.id INTO v_venda_ft_id
  FROM public.financial_transactions ft
  WHERE ft.related_sale_id = p_sale_id
    AND ft.category = 'VENDA'
    AND ft.trans_type = 'ENTRADA'
    AND ft.id NOT IN (
      -- Não usar rows de conciliação ou repasse
      SELECT id FROM public.financial_transactions
      WHERE related_sale_id = p_sale_id
        AND (category = 'AJUSTE_CONCILIACAO' OR category = 'REPASSE_INFINITEPAY')
    )
  ORDER BY
    CASE WHEN ft.status = v_tx_status THEN 0 ELSE 1 END,
    ft.created_at DESC
  LIMIT 1;

  v_desc_venda := format(
    'Venda #%s — %s (atualizado em %s)',
    lpad(COALESCE(v_sale.friendly_number::TEXT, '----'), 4, '0'),
    v_customer_name,
    to_char(now(), 'DD/MM/YYYY HH24:MI')
  );

  IF v_venda_ft_id IS NOT NULL THEN
    UPDATE public.financial_transactions ft
    SET
      trans_date     = v_sale_date,
      description    = v_desc_venda,
      amount         = v_venda_amount,
      status         = v_tx_status,
      payment_source = v_tx_ps,
      due_date       = CASE WHEN v_tx_status = 'PENDENTE' THEN (v_sale_date + INTERVAL '30 days')::DATE ELSE NULL END,
      updated_at     = now()
    WHERE ft.id = v_venda_ft_id;
    v_upserted_venda := TRUE;
  ELSE
    INSERT INTO public.financial_transactions (
      trans_date, trans_type, category, description, amount,
      related_sale_id, status, payment_source, due_date,
      created_by, updated_at
    ) VALUES (
      v_sale_date,
      'ENTRADA',
      'VENDA',
      v_desc_venda,
      v_venda_amount,
      p_sale_id,
      v_tx_status,
      v_tx_ps,
      CASE WHEN v_tx_status = 'PENDENTE' THEN (v_sale_date + INTERVAL '30 days')::DATE ELSE NULL END,
      v_sale.created_by,
      now()
    );
    v_upserted_venda := TRUE;
  END IF;

  -- -----------------------------------------------------------------------
  -- PASSO 8 — UPSERT / REMOVE FINANCIAL_TRANSACTIONS TAXA
  --            (Regra 7: atualiza existente; NÃO duplica; zera se não há taxa.)
  --            Regra 8: NÃO cria EMBALAGEM.
  -- -----------------------------------------------------------------------
  SELECT ft.id INTO v_taxa_ft_id
  FROM public.financial_transactions ft
  WHERE ft.related_sale_id = p_sale_id
    AND ft.category = 'TAXA'
  ORDER BY ft.created_at DESC
  LIMIT 1;

  v_desc_taxa := format(
    'Taxa operadora #%s — %s (atualizado em %s)',
    lpad(COALESCE(v_sale.friendly_number::TEXT, '----'), 4, '0'),
    v_customer_name,
    to_char(now(), 'DD/MM/YYYY HH24:MI')
  );

  IF v_fee_amount > 0 THEN
    -- Taxa > 0: Garante 1 transação TAXA SAÍDA.
    -- Usa MESMO payment_source da VENDA (se venda está em intermediador,
    -- taxa debitou lá, não em CAIXA_EVELINE).
    IF v_taxa_ft_id IS NOT NULL THEN
      UPDATE public.financial_transactions ft
      SET
        trans_date     = v_sale_date,
        description    = v_desc_taxa,
        amount         = v_fee_amount,
        status         = v_tx_status,
        payment_source = v_tx_ps,
        updated_at     = now()
      WHERE ft.id = v_taxa_ft_id;
      v_upserted_taxa := TRUE;
    ELSE
      INSERT INTO public.financial_transactions (
        trans_date, trans_type, category, description, amount,
        related_sale_id, status, payment_source,
        created_by, updated_at
      ) VALUES (
        v_sale_date,
        'SAIDA',
        'TAXA',
        v_desc_taxa,
        v_fee_amount,
        p_sale_id,
        v_tx_status,
        v_tx_ps,
        v_sale.created_by,
        now()
      );
      v_upserted_taxa := TRUE;
    END IF;
  ELSE
    -- Taxa = 0 (ex: PIX Direto, Dinheiro).
    -- Se existia taxa, ZERAMOS ela (para manter o id mas sem impacto financeiro).
    -- Não deletamos para manter histórico (audit).
    IF v_taxa_ft_id IS NOT NULL THEN
      UPDATE public.financial_transactions ft
      SET
        trans_date = v_sale_date,
        description = v_desc_taxa || ' (cancelada: modalidade sem taxa)',
        amount = 0,
        status = 'CANCELADO',
        payment_source = NULL,
        updated_at = now()
      WHERE ft.id = v_taxa_ft_id;
      v_removed_taxa := TRUE;
    END IF;
  END IF;

  -- -----------------------------------------------------------------------
  -- PASSO 9 — Atualizar snapshots de taxa em sales (campo fee_actual)
  --            para manter v_dashboard_sales e lucro consistentes.
  -- -----------------------------------------------------------------------
  UPDATE public.sales s
  SET
    fee_actual   = v_total_fee_real,
    fee_expected = v_total_fee_expected,
    updated_at   = now()
  WHERE s.id = p_sale_id
    AND (
      COALESCE(s.fee_actual, 0)   <> v_total_fee_real
      OR
      COALESCE(s.fee_expected, 0) <> v_total_fee_expected
    );

  -- -----------------------------------------------------------------------
  -- RETORNO
  -- -----------------------------------------------------------------------
  RETURN jsonb_build_object(
    'ok', TRUE,
    'sale_id', p_sale_id,
    'updated_sale', v_updated_sale,
    'updated_payment', v_updated_payment,
    'upserted_venda_ft', v_upserted_venda,
    'upserted_taxa_ft', v_upserted_taxa,
    'removed_taxa_ft', v_removed_taxa,
    'has_repasse_infinitepay', v_has_repasse_infinitepay,
    'warning', v_warning,
    'total_received', v_total_received,
    'total_customer', v_total_customer,
    'total_fee_real', v_total_fee_real,
    'financial', jsonb_build_object(
      'payment_source', v_tx_ps,
      'status', v_tx_status,
      'venda_amount', v_venda_amount,
      'taxa_amount', v_fee_amount
    )
  );
END;
$$;

COMMIT;
