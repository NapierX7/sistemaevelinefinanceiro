-- ==============================================================================
-- PATCH 014 — CORREÇÃO INFINITEPAY: payment_source = INFINITEPAY no momento da venda
-- EXECUTAR APENAS UMA VEZ NO SQL EDITOR DO SUPABASE.
-- NÃO ALTERA DADOS HISTÓRICOS EXISTENTES (conciliação, Venda #43 etc intactos).
-- Objetivo: Próximas vendas InfinitePay → VENDA payment_source INFINITEPAY (não CAIXA_EVELINE).
--           O dinheiro só entra em CAIXA_EVELINE via REPASSE_INFINITEPAY quando usuário confirmar.
-- ==============================================================================
BEGIN;

-- 1. Expandir CHECK constraint para aceitar intermediadores (INFINITEPAY / MERCADO_PAGO)
--    Idempotente: drop e re-cria.
ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_payment_source_check;

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_payment_source_check
  CHECK (payment_source IS NULL OR payment_source IN (
    'CAIXA_EVELINE','FABIANA','DONA','OUTRO','INFINITEPAY','MERCADO_PAGO'
  ));

-- 2. Recriar WRAPPER public.finalize_sale com NOVO parâmetro p_payment_source_hint
--    (frontend services/index.ts já envia esse parâmetro calculado).
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
  p_user_id UUID DEFAULT NULL,
  p_payment_source_hint TEXT DEFAULT 'CAIXA_EVELINE'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.hist_finalize_sale(
    p_source               := p_source,
    p_items                := p_items,
    p_general_discount     := p_general_discount,
    p_coupon_code          := p_coupon_code,
    p_pix_discount         := p_pix_discount,
    p_payment              := p_payment,
    p_packaging            := p_packaging,
    p_extra_costs          := p_extra_costs,
    p_customer_name        := p_customer_name,
    p_customer_phone       := p_customer_phone,
    p_user_id              := p_user_id,
    p_payment_source_hint  := p_payment_source_hint
  );
END;$$;

-- 3. Recriar BODY public.hist_finalize_sale com o novo parâmetro.
--    ATENÇÃO: Este é apenas o TRECHO relevante (FINANCIAL TRANSACTIONS payment_source).
--    COPIE E COLE este bloco APENAS se você já tem o hist_finalize_sale completo do SCRIPT_UNICO.
--    Caso prefira, edite o bloco "FINANCIAL TRANSACTIONS" do seu hist_finalize_sale EXISTENTE
--    para usar v_payment_source (abaixo) em vez de hardcoded 'CAIXA_EVELINE'.
--
--    REGRAS INTERNAS payment_source BLOCO VENDA:
--      · InfinitePay → payment_source = 'INFINITEPAY' (não cai direto no caixa)
--      · Mercado Pago → payment_source = 'MERCADO_PAGO'
--      · PIX direto / Dinheiro / Cartão sem intermediador → 'CAIXA_EVELINE'
--      · Fabiana / Dona → 'FABIANA' / 'DONA'
--      · VENDA PENDENTE (sem pagamento informado / valor 0) → payment_source NULL + status PENDENTE
--      · TAXA usa a MESMA payment_source da venda (não debita CAIXA_EVELINE se venda está em intermediador)
--      · OUTRA_DESPESA (entrega/motoboy) → sempre CAIXA_EVELINE (são pagos diretamente por Eveline)
--
-- DO:
--   3a. Adicionar parâmetro p_payment_source_hint TEXT DEFAULT 'CAIXA_EVELINE' na assinatura
--       de public.hist_finalize_sale.
--   3b. No DECLARE do bloco FINANCIAL TRANSACTIONS, adicionar:
--         v_payment_source TEXT := CASE
--           WHEN btrim(COALESCE(p_payment_source_hint,'')) = '' THEN 'CAIXA_EVELINE'
--           WHEN upper(p_payment_source_hint) IN ('CAIXA_EVELINE','FABIANA','DONA','OUTRO','INFINITEPAY','MERCADO_PAGO')
--             THEN upper(p_payment_source_hint)
--           ELSE 'CAIXA_EVELINE'
--         END;
--         v_has_payment BOOLEAN := (p_payment IS NOT NULL AND COALESCE((p_payment->>'amount')::numeric, v_total_customer) > 0);
--         v_tx_status TEXT := CASE WHEN v_has_payment THEN 'CONFIRMADO' ELSE 'PENDENTE' END;
--         v_tx_ps TEXT := CASE WHEN v_has_payment THEN v_payment_source ELSE NULL END;
--   3c. Substituir TODOS os hardcoded 'CAIXA_EVELINE' em:
--         · INSERT VENDA → payment_source = v_tx_ps
--         · INSERT VENDA EXCEPTION fallback → payment_source = v_tx_ps
--         · INSERT TAXA → payment_source = v_tx_ps
--         · INSERT TAXA EXCEPTION fallback → payment_source = v_tx_ps
--         · INSERT OUTRA_DESPESA → CONTINUA hardcoded 'CAIXA_EVELINE' (é despesa direta).
COMMIT;
