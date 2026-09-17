-- ============================================================
-- PATCH 005 — EXPANDIR CHECK CONSTRAINT status em public.sales
-- Motivo: ERRO 23514: new row for relation "sales" violates check constraint "sales_status_check"
-- Causa raiz:
--   Constraint original (criado no schema.sql) SÓ ACEITAVA:
--   CHECK (status IN ('PENDENTE','CONCLUIDA','CANCELADA','REEMBOLSADA'))
--   → NÃO ACEITAVA 'PARCIAL' (vendas Day / Cristina / Francisca — parcialmente pagas)
-- Solução:
--   Expande a lista de valores permitidos para incluir 'PARCIAL'.
-- SEGURO: NÃO apaga NENHUM dado existente. Só relaxa a restrição.
-- RODAR 1 ÚNICA VEZ ANTES do patch_historico_02_vendas.sql
-- ============================================================

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_status_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_status_check
  CHECK (
    status IN (
      'PENDENTE',
      'CONCLUIDA',
      'CANCELADA',
      'REEMBOLSADA',
      'PARCIAL'
    )
  );

COMMENT ON CONSTRAINT sales_status_check ON public.sales IS
  'Status permitidos: PENDENTE (não pago), CONCLUIDA (100% paga),
   CANCELADA (cancelada), REEMBOLSADA (reembolso total ou parcial),
   PARCIAL (recebido parcialmente — tem SALDO A RECEBER em financial_transactions status PENDENTE)';

DO $$ BEGIN
  RAISE NOTICE '✔ Constraint sales_status_check: EXPANDIDA COM SUCESSO. Agora ACEITA PARCIAL.';
END $$;
