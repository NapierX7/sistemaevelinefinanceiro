-- ============================================================================
-- CORREÇÃO HISTÓRICA · COMPRAS PAGAS PELA FABIANA (R$ 1.070,00)
-- ============================================================================
-- OBJETIVO:  Remover saídas financeiras indevidas do CAIXA_EVELINE de compras
--            que foram pagas pela Fabiana (dinheiro que NUNCA saiu da conta
--            operacional da Eveline) e registrar o valor correspondente como
--            obrigação a restituir.
--
-- REGRAS INQUEBRÁVEIS:
--   1. NUNCA executar em lote. Cada compra é conferida e processada
--      INDIVIDUALMENTE por um operador humano.
--   2. Se houver DÚVIDA sobre quem pagou, NÃO execute.
--   3. Não inventar valores. Tudo vem da consulta abaixo.
--   4. Não alterar estoque, FIFO, CMV, lote ou custo.
--      Apenas a origem do dinheiro e o financeiro mudam.
--   5. O total a ser corrigido é no máximo R$ 1.070,00.
--      Não ultrapasse esse valor somando compras marcadas como "FABIANA".
--
-- ============================================================================
-- PASSO 1 · DIAGNÓSTICO (apenas SELECT, nenhuma alteração)
-- ============================================================================
-- Cole este bloco no SQL Editor e anote o resultado em uma planilha/folha.
-- Você vai usar a coluna "Paga por Fabiana? Sim/Não" para marcar 1 a 1.

/*

SELECT
  pe.id                                          AS compra_id,
  pe.entry_date                                  AS data_compra,
  pe.supplier                                    AS fornecedor,
  pe.total_cost                                  AS valor_total,
  pe.notes                                       AS observacoes_originais,
  pe.payment_method                              AS metodo_original,
  -- Lista SAÍDAS financeiras atreladas a esta compra
  ARRAY(
    SELECT json_build_object(
      'id', ft.id,
      'data', ft.transaction_date,
      'tipo', ft.trans_type,
      'categoria', ft.category,
      'valor', ft.amount,
      'status', ft.status,
      'payment_source', ft.payment_source
    )
    FROM financial_transactions ft
    WHERE ft.related_purchase_id = pe.id
    ORDER BY ft.transaction_date
  )                                              AS saidas_financeiras_atreladas,
  -- Soma das saídas já atreladas (todas devem ser SAIDA/CONFIRMADO)
  (
    SELECT COALESCE(SUM(ft.amount), 0::numeric)
    FROM financial_transactions ft
    WHERE ft.related_purchase_id = pe.id
      AND ft.trans_type = 'SAIDA'
      AND ft.status = 'CONFIRMADO'
  )                                              AS saidas_confirmadas_soma,
  -- Campo auditoria (marcar manualmente)
  ''::text                                       AS paga_por_fabiana_SIM_ou_NAO
FROM purchase_entries pe
ORDER BY pe.entry_date DESC;

*/

-- ============================================================================
-- PASSO 2 · MARCAÇÃO MANUAL (operador)
-- ============================================================================
-- Para CADA linha retornada no PASSO 1, o operador responde:
--   Essa compra foi realmente paga pela Fabiana (dinheiro próprio dela,
--   sem usar a conta da Eveline)?
--
-- Respostas possíveis:
--   ✅ SIM →  Prosseguir ao PASSO 3 com SQL modelo individual.
--   ❌ NÃO →  Ignorar. Já está correta como saída CAIXA_EVELINE.
--   ❓ DÚVIDA →  Não executar nada até confirmar com extrato/faturas.
--
-- Soma de controle: a soma dos `valor_total` das linhas marcadas SIM
-- deve ser IGUAL A R$ 1.070,00 (ou menos, se parte já foi corrigida).
--
-- ============================================================================
-- PASSO 3 · APLICAR CORREÇÃO POR COMPRA (SQL modelo individual)
-- ============================================================================
-- Copie este modelo UMA VEZ POR COMPRA marcada SIM no PASSO 2.
-- Substitua os placeholders entre < > pelos valores reais da compra.
--
-- Cada execução é atômica (BEGIN/COMMIT). Se algo falhar, o rollback é
-- automático e nenhuma alteração fica aplicada.

/*

--------------------------------------------------------------------------
--- COMPRA: <fornecedor> · <data_compra> · R$ <valor_total>
--- compra_id = '<cole o UUID aqui>'
--------------------------------------------------------------------------
BEGIN;

  -- 3a. Marcar a compra com funding_source = FABIANA
  --     creditor_name = 'Fabiana'
  --     Não mexe em custo, fornecedor, data nem nada mais.
  UPDATE public.purchase_entries
  SET
    funding_source  = 'FABIANA',
    creditor_name   = 'Fabiana'
  WHERE id = '<COLE O UUID DA COMPRA AQUI>';

  -- 3b. Criar obrigação PENDENTE de R$ <valor_total> com Fabiana
  --     Vinculada à compra através de related_purchase_id.
  --     Se a obrigação JÁ existir (ou parcial), pule este passo
  --     e apenas atualize purchase_entries.related_obligation_id.
  INSERT INTO public.obligations (
    id,
    creditor_name,
    category,
    original_amount,
    amount_paid,
    status,
    issue_date,
    due_date,
    description,
    notes,
    related_purchase_id,
    created_at,
    created_by
  )
  VALUES (
    gen_random_uuid(),
    'Fabiana',
    'ESTOQUE_FINANCIADO',
    (<VALOR_TOTAL_NUMERICO_AQUI>),   -- ex: 250.00  SEM aspas
    0::numeric,
    'PENDENTE',
    CURRENT_DATE,
    CURRENT_DATE,
    'Correção histórica: compra paga pela Fabiana. Valor original já contabilizado em estoque/FIFO/CMV. Obrigação a restituir.',
    'Compra: <fornecedor> - <data_compra>. Pagamento original indevidamente lançado como saída CAIXA_EVELINE; corrigido em ' || CURRENT_DATE,
    '<COLE O UUID DA COMPRA AQUI>',
    NOW(),
    auth.uid()
  )
  RETURNING id AS _new_obligation_id;

  -- Guarde o _new_obligation_id retornado. Use-o abaixo.

  -- 3c. Atrelar a obrigação criada de volta na compra
  UPDATE public.purchase_entries
  SET related_obligation_id = '<COLE O UUID DA OBRIGAÇÃO RETORNADO ACIMA>'
  WHERE id = '<COLE O UUID DA COMPRA AQUI>';

  -- 3d. APAGAR saídas financeiras INDEVIDAS atreladas a esta compra
  --     CUIDADO: Apague SOMENTE as linhas que correspondem a COMPRA_ESTOQUE,
  --     FRETE ou OUTRA_DESPESA relacionadas a esta compra.
  --     Se alguma saída for LEGÍTIMA (ex: frete realmente saiu da conta),
  --     DELETE apenas as CATEGORIAS erradas ou NÃO DELETE e ajuste manualmente.
  --
  --     Para segurança, primeiro rode um SELECT com o mesmo WHERE para
  --     conferir o que será apagado.

  -- SELECT * FROM public.financial_transactions
  -- WHERE related_purchase_id = '<COLE O UUID DA COMPRA AQUI>'
  --   AND trans_type = 'SAIDA';

  DELETE FROM public.financial_transactions
  WHERE related_purchase_id = '<COLE O UUID DA COMPRA AQUI>'
    AND trans_type = 'SAIDA'
    -- opcional: restringir categorias específicas
    AND category IN ('COMPRA_ESTOQUE', 'FRETE', 'OUTRA_DESPESA');

  -- 3e. (Opcional) Se a compra tiver apenas parte financiada pela Fabiana
  --     e parte realmente saiu da conta, ajuste manualmente o DELETE
  --     para remover só a parte indevida, ou faça um UPDATE parcial
  --     amount nas saídas correspondentes. NÃO USE ESTE MODELO.

COMMIT;
--------------------------------------------------------------------------

*/

-- ============================================================================
-- PASSO 4 · VALIDAÇÃO APÓS CADA COMPRA
-- ============================================================================
-- Depois de COMMIT de cada compra:
--
-- 1. Rode a view v_cash_eveline_summary e confira:
--    - Saídas CAIXA_EVELINE diminuíram pelo valor da compra.
--    - Entradas permanecem inalteradas.
--
-- 2. Rode v_dashboard_obligations e confira:
--    - Fabiana ganhou nova linha PENDENTE com o valor da compra.
--    - Soma Fabiana se aproxima de R$ 1.070,00.
--
-- 3. Rode Dashboard de Estoque:
--    - Quantidades e custos das compras NÃO mudaram.
--    - FIFO intacto.
--
-- ============================================================================
-- PASSO 5 · LIMITE R$ 1.070,00
-- ============================================================================
-- Quando a soma das novas obrigações Fabiana chegar em R$ 1.070,00, PARE.
--
-- Se ficar abaixo: o restante das compras marcadas NÃO deve ser corrigido,
-- ou alguma compra já tinha sido parcialmente corrigida antes.
--
-- Se ficar acima: você marcou compras a mais.
-- Rollback a última e revise a marcação do PASSO 2.
--
-- ============================================================================
-- AUDITORIA FINAL (quando todas estiverem feitas)
-- ============================================================================
/*

-- Saldo correto de caixa após toda correção:
SELECT
  'ENTRADAS'           AS coluna,
  COALESCE(SUM(amount), 0::numeric) AS total
FROM public.financial_transactions
WHERE trans_type = 'ENTRADA'
  AND status = 'CONFIRMADO'
  AND (payment_source = 'CAIXA_EVELINE' OR payment_source IS NULL)
UNION ALL
SELECT
  'SAIDAS',
  COALESCE(SUM(amount), 0::numeric)
FROM public.financial_transactions
WHERE trans_type = 'SAIDA'
  AND status = 'CONFIRMADO'
  AND (payment_source = 'CAIXA_EVELINE' OR payment_source IS NULL);

-- Obrigações Fabiana (deve dar R$ 1.070,00 PENDENTE)
SELECT
  creditor_name,
  SUM(original_amount) AS total_original,
  SUM(COALESCE(amount_paid, 0)) AS total_pago,
  SUM(original_amount - COALESCE(amount_paid, 0)) AS saldo_pendente,
  status
FROM public.obligations
WHERE creditor_name = 'Fabiana'
GROUP BY creditor_name, status;

*/
