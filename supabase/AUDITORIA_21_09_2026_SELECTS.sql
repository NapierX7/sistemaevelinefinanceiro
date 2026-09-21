-- ============================================================================
-- AUDITORIA FINANCEIRA / ESTOQUE — SUPABASE SQL EDITOR
-- Data: 21/09/2026
-- Instruções: Executar BLOCO por BLOCO. NÃO executar o arquivo inteiro de uma vez.
-- Cada BLOCO é um SELECT de diagnóstico. NENHUM UPDATE / DELETE nesta primeira rodada.
-- Os resultados dos SELECTs serão usados para propor correções.
-- ============================================================================

-- ============================================================================
-- BLOCO A · AUDITORIA ALLOCATED_PURCHASE_COST (R$ 12,55 e R$ 25,09)
-- Objetivo: descobrir EXATAMENTE a origem do rateio em cada venda.
-- ============================================================================

-- A.1 — Encontrar VENDAS com allocated_purchase_cost PRÓXIMO a R$ 12,55 ou R$ 25,09
-- (Margem de R$ 0,02 para arredondamentos.)
SELECT
  id                                            AS sale_id,
  friendly_number,
  sale_date,
  total_customer,
  items_cost,
  allocated_purchase_cost,
  packaging_cost,
  fee_actual,
  extra_costs,
  real_profit,
  real_margin,
  status,
  source_snapshot,
  customer_name
FROM public.sales
WHERE status IN ('CONCLUIDA', 'PENDENTE', 'PARCIAL')
  AND allocated_purchase_cost BETWEEN 12.50 AND 12.60
ORDER BY sale_date DESC, friendly_number DESC;

SELECT
  id                                            AS sale_id,
  friendly_number,
  sale_date,
  total_customer,
  items_cost,
  allocated_purchase_cost,
  packaging_cost,
  fee_actual,
  extra_costs,
  real_profit,
  real_margin,
  status,
  source_snapshot,
  customer_name
FROM public.sales
WHERE status IN ('CONCLUIDA', 'PENDENTE', 'PARCIAL')
  AND allocated_purchase_cost BETWEEN 25.00 AND 25.20
ORDER BY sale_date DESC, friendly_number DESC;

-- ============================================================================
-- A.2 — Para cada venda encontrada, rodar este SELECT substituindo SEU_SALE_ID.
-- Mostra a origem de cada item (lote + compra + allocated unitário)
-- ============================================================================
-- Descomente e substitua o UUID:
-- SELECT
--   si.id                                                         AS sale_item_id,
--   si.quantity,
--   si.unit_cost_snapshot,                                        -- custo mercadoria no lote
--   si.allocated_purchase_cost_snapshot,                          -- rateio por item
--   (si.unit_cost_snapshot + si.allocated_purchase_cost_snapshot) -- CMV total por item
--       AS cmv_unitario_total,
--   si.quantity * si.unit_cost_snapshot                           AS items_cost_subtotal,
--   si.quantity * si.allocated_purchase_cost_snapshot             AS alloc_subtotal,
--   p.name                                                        AS produto,
--   p.sku,
--   ib.id                                                         AS batch_id,
--   ib.unit_cost                                                  AS batch_unit_cost,
--   ib.allocated_purchase_cost                                    AS batch_alloc,
--   ib.unit_cost + ib.allocated_purchase_cost                    AS batch_cmv_total_unit,
--   pe.id                                                         AS purchase_id,
--   pe.entry_date,
--   pe.supplier,
--   pe.funding_source,
--   pe.shipping_cost,
--   pe.other_costs,
--   pe.total_cost,
--   pei.unit_cost                                                 AS pei_unit_cost_item_compra,
--   pei.quantity                                                  AS pei_qty_compra
-- FROM public.sale_items si
-- LEFT JOIN public.products p              ON p.id = si.product_id
-- LEFT JOIN public.inventory_batches ib    ON ib.id = si.batch_ids_used[1]
-- LEFT JOIN public.purchase_entry_items pei ON pei.id = ib.purchase_item_id
-- LEFT JOIN public.purchase_entries pe     ON pe.id = pei.purchase_entry_id
-- WHERE si.sale_id = 'SEU_SALE_ID_AQUI'
-- ORDER BY si.id;

-- ============================================================================
-- A.3 — Verificar se allocated_purchase_cost TAMBÉM já está dentro de unit_cost
-- (risco de DUPLICIDADE). Compara unit_cost (lote) vs (unit_cost do item de compra).
-- Se forem DIFERENTES, provavelmente o unit_cost já contém frete e o allocated seria
-- uma duplicidade. Se forem IGUAIS, allocated é limpo (separado).
-- ============================================================================
SELECT
  ib.id                                                         AS batch_id,
  p.name                                                        AS produto,
  p.sku,
  pei.unit_cost                                                 AS custo_compra_item,
  ib.unit_cost                                                  AS custo_unitario_lote,
  (ib.unit_cost - pei.unit_cost)                                AS diff,
  CASE
    WHEN ABS(ib.unit_cost - pei.unit_cost) < 0.001 THEN 'IGUAL (unit_cost é só mercadoria)'
    WHEN (ib.unit_cost - pei.unit_cost) > 0 THEN 'MAIOR (unit_cost já tem parte do frete)'
    ELSE 'MENOR (investigar)'
  END                                                           AS conclusao,
  ib.allocated_purchase_cost                                    AS rateio_separado_lote,
  pei.quantity                                                  AS qty_compra,
  pe.shipping_cost,
  pe.other_costs,
  pe.cost_allocation_method,
  pe.id                                                         AS purchase_id,
  pe.entry_date,
  pe.supplier
FROM public.inventory_batches ib
LEFT JOIN public.products p                ON p.id = ib.product_id
LEFT JOIN public.purchase_entry_items pei  ON pei.id = ib.purchase_item_id
LEFT JOIN public.purchase_entries pe       ON pe.id = pei.purchase_entry_id
WHERE ib.quantity_received > 0
ORDER BY pe.entry_date DESC, p.name
LIMIT 50;

-- ============================================================================
-- A.4 — Cálculo matemático do rateio na compra (como foi dividido)
-- Mostra o total de frete/outros, total de itens e rateio por unidade.
-- ============================================================================
SELECT
  pe.id                                                         AS purchase_id,
  pe.entry_date,
  pe.supplier,
  pe.cost_allocation_method,
  pe.shipping_cost,
  pe.other_costs,
  (COALESCE(pe.shipping_cost,0) + COALESCE(pe.other_costs,0))   AS total_rateio,
  pe.subtotal                                                   AS subtotal_mercadoria,
  SUM(pei.quantity)                                             AS total_pecas_compra,
  CASE
    WHEN pe.cost_allocation_method = 'quantity' AND SUM(pei.quantity) > 0
      THEN ROUND((COALESCE(pe.shipping_cost,0)+COALESCE(pe.other_costs,0)) / SUM(pei.quantity), 4)
    WHEN pe.cost_allocation_method = 'value' AND pe.subtotal > 0
      THEN ROUND((COALESCE(pe.shipping_cost,0)+COALESCE(pe.other_costs,0)) / pe.subtotal, 6)
    ELSE 0
  END                                                           AS rateio_base_divisor,
  pe.total_cost                                                 AS total_gravado
FROM public.purchase_entries pe
LEFT JOIN public.purchase_entry_items pei ON pei.purchase_entry_id = pe.id
GROUP BY pe.id, pe.entry_date, pe.supplier, pe.cost_allocation_method,
         pe.shipping_cost, pe.other_costs, pe.subtotal, pe.total_cost
ORDER BY pe.entry_date DESC
LIMIT 30;

-- ============================================================================
-- BLOCO B · AUDITORIA R$ 450 — 3ª REMESSA (NAO_INFORMADO → CAIXA_EVELINE)
-- ============================================================================

-- B.1 — Localizar registro exato. Descrição contém "3ª remessa" OU "3a remessa"
-- e valor = 450.00 (margem 0,02).
SELECT
  id,
  trans_date,
  trans_type,
  category,
  description,
  amount,
  status,
  payment_source,
  related_purchase_id,
  related_sale_id,
  related_obligation_id,
  payment_method,
  created_by,
  created_at,
  updated_at
FROM public.financial_transactions
WHERE status = 'CONFIRMADO'
  AND trans_type = 'SAIDA'
  AND amount BETWEEN 449.98 AND 450.02
  AND (
    UPPER(description) LIKE UPPER('%3%remessa%') OR
    UPPER(description) LIKE UPPER('%3a remessa%') OR
    UPPER(description) LIKE UPPER('%3ª remessa%') OR
    UPPER(description) LIKE UPPER('%animal print%') OR
    UPPER(description) LIKE UPPER('%calca%')
  )
ORDER BY trans_date DESC, created_at DESC;

-- B.2 — Busca mais ampla por payment_source NULL/vazio e valor em torno de 450
-- (caso B.1 não encontre — descrever o que apareceu)
SELECT
  id,
  trans_date,
  trans_type,
  category,
  description,
  amount,
  status,
  payment_source,
  related_purchase_id,
  related_sale_id,
  related_obligation_id,
  payment_method
FROM public.financial_transactions
WHERE status = 'CONFIRMADO'
  AND trans_type = 'SAIDA'
  AND amount BETWEEN 440.00 AND 460.00
  AND (
    payment_source IS NULL
    OR TRIM(COALESCE(payment_source,'')) = ''
    OR UPPER(TRIM(payment_source)) IN ('NAO_INFORMADO', 'DESCONHECIDO')
  )
ORDER BY trans_date DESC, amount DESC;

-- B.3 — Busca TODAS saídas sem payment_source (para verificar contexto de 450)
SELECT
  id,
  trans_date,
  trans_type,
  category,
  description,
  amount,
  payment_source,
  related_purchase_id,
  related_sale_id
FROM public.financial_transactions
WHERE status = 'CONFIRMADO'
  AND trans_type = 'SAIDA'
  AND (
    payment_source IS NULL
    OR TRIM(COALESCE(payment_source,'')) = ''
    OR UPPER(TRIM(payment_source)) IN ('NAO_INFORMADO','DESCONHECIDO')
  )
ORDER BY trans_date DESC, amount DESC;

-- ============================================================================
-- BLOCO C · AUDITORIA ESTOQUE TEÓRICO vs 7 UNIDADES FÍSICAS
-- ============================================================================

-- C.1 — Resumo geral do estoque (para comparar com 7 unidades)
SELECT
  COUNT(DISTINCT p.id)                                          AS skus_cadastrados,
  COUNT(DISTINCT CASE WHEN ib.quantity_available > 0 THEN p.id END) AS skus_com_estoque,
  SUM(ib.quantity_available)                                    AS total_unidades_disponiveis,
  ROUND(SUM(ib.quantity_available * (ib.unit_cost + ib.allocated_purchase_cost)), 2) AS custo_total_estoque,
  ROUND(SUM(ib.quantity_available * COALESCE(p.price, p.cost_price * 2)), 2) AS potencial_venda_preco_atual
FROM public.inventory_batches ib
LEFT JOIN public.products p ON p.id = ib.product_id
WHERE (p.active IS NULL OR p.active = true)
  AND ib.quantity_available > 0;

-- C.2 — Detalhamento por SKU/produto (para conferir 1 a 1)
SELECT
  p.id                                                          AS product_id,
  p.name                                                        AS produto,
  p.sku,
  COALESCE(v.name, 'Cor / tamanho padrão')                      AS variante,
  SUM(ib.quantity_available)                                    AS qtd_disponivel,
  ROUND(AVG(ib.unit_cost + ib.allocated_purchase_cost), 2)      AS custo_medio_unitario,
  ROUND(COALESCE(p.price, 0), 2)                                AS preco_venda_atual,
  ROUND(SUM(ib.quantity_available) * COALESCE(p.price, 0), 2)   AS valor_potencial_produto,
  p.active
FROM public.inventory_batches ib
LEFT JOIN public.products p             ON p.id = ib.product_id
LEFT JOIN public.product_variants v     ON v.id = ib.variant_id
WHERE (p.active IS NULL OR p.active = true)
GROUP BY p.id, p.name, p.sku, v.name, p.price, p.active
HAVING SUM(ib.quantity_available) > 0
ORDER BY qtd_disponivel DESC, produto ASC;

-- C.3 — Histórico de movimentos recente (últimos 30 dias)
-- Para identificar ajustes manuais que podem ter causado diferença.
SELECT
  im.created_at::date                                           AS data,
  im.movement_type,
  im.reason,
  p.name                                                        AS produto,
  im.quantity,
  im.unit_cost,
  im.related_sale_id,
  im.related_purchase_id,
  im.created_by,
  im.notes
FROM public.inventory_movements im
LEFT JOIN public.products p ON p.id = im.product_id
WHERE im.created_at >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY im.created_at DESC
LIMIT 100;

-- ============================================================================
-- BLOCO D · AUDITORIA SAÍDA EMBALAGEM HISTÓRICA (confirma se existem lançamentos antigos)
-- Objetivo: quantificar quantas SAIDA/EMBALAGEM existem hoje.
-- NÃO remover automaticamente nesta rodada.
-- ============================================================================
SELECT
  COUNT(*)                                                      AS qtd_lancamentos_embalagem,
  SUM(amount)                                                   AS valor_total_embalagem,
  MIN(trans_date)                                               AS primeira_data,
  MAX(trans_date)                                               AS ultima_data
FROM public.financial_transactions
WHERE category = 'EMBALAGEM'
  AND trans_type = 'SAIDA'
  AND status = 'CONFIRMADO';

-- D.2 — Lista detalhada (para auditoria futura individual)
SELECT
  id,
  trans_date,
  description,
  amount,
  related_sale_id,
  created_at
FROM public.financial_transactions
WHERE category = 'EMBALAGEM'
  AND trans_type = 'SAIDA'
  AND status = 'CONFIRMADO'
ORDER BY trans_date DESC;

-- ============================================================================
-- BLOCO E · AUDITORIA SALDO CAIXA vs CONTAS A RECEBER vs OBRIGAÇÕES
-- Resumo do dashboard pela visão do BANCO (independente do frontend).
-- ============================================================================

-- E.1 — Saldo do Caixa Eveline estrito (REGRA DEFINITIVA item 3)
SELECT
  COUNT(*)                                                      AS qtd_mov,
  SUM(CASE WHEN trans_type = 'ENTRADA' AND amount > 0 THEN amount ELSE 0 END) AS entradas,
  SUM(CASE WHEN trans_type = 'SAIDA' THEN amount ELSE 0 END)    AS saidas,
  SUM(CASE WHEN trans_type = 'ENTRADA' AND amount > 0 THEN amount ELSE 0 END)
  - SUM(CASE WHEN trans_type = 'SAIDA' THEN amount ELSE 0 END)  AS saldo_caixa_eveline
FROM public.financial_transactions
WHERE status = 'CONFIRMADO'
  AND UPPER(TRIM(COALESCE(payment_source,''))) = 'CAIXA_EVELINE';

-- E.2 — Movimentações NAO_INFORMADO (a classificar)
SELECT
  COUNT(*)                                                      AS qtd,
  trans_type,
  SUM(amount)                                                   AS valor_total
FROM public.financial_transactions
WHERE status = 'CONFIRMADO'
  AND (
    payment_source IS NULL
    OR TRIM(COALESCE(payment_source,'')) = ''
    OR UPPER(TRIM(payment_source)) IN ('NAO_INFORMADO','DESCONHECIDO')
  )
GROUP BY trans_type
ORDER BY trans_type;

-- E.3 — Contas a receber (valor não recebido de vendas concluídas/parciais)
SELECT
  COUNT(*)                                                      AS qtd_vendas_com_saldo,
  SUM(amount_receivable)                                        AS total_a_receber
FROM public.v_dashboard_sales_summary          -- usar v_dashboard_sales ou sales
WHERE amount_receivable > 0.001
  AND status IN ('PENDENTE','PARCIAL');

-- Fallback se a view não existir:
-- SELECT COUNT(*) qtd, SUM(total_customer - amount_received) total
-- FROM public.sales WHERE status IN ('PENDENTE','PARCIAL')
--   AND (total_customer - amount_received) > 0.001;

-- E.4 — Obrigações pendentes
SELECT
  COUNT(*)                                                      AS qtd_obrigacoes,
  creditor_name,
  SUM(COALESCE(amount, original_amount) - COALESCE(amount_paid, 0)) AS pendente_por_credor
FROM public.obligations
WHERE status IN ('PENDENTE','PARCIAL')
  AND (COALESCE(amount, original_amount) - COALESCE(amount_paid, 0)) > 0.001
GROUP BY creditor_name
ORDER BY pendente_por_credor DESC;

-- ============================================================================
-- BLOCO F · FÓRMULA DO LUCRO (venda a venda para investigar divergência
-- 189,90 - 109,66 = 80,24 vs lucro exibido 70,74)
-- ============================================================================

-- F.1 — Últimas 10 vendas com breakdown completo (cruzar com UI)
SELECT
  id                                                            AS sale_id,
  friendly_number,
  sale_date,
  total_customer,
  items_subtotal,
  product_discounts,
  general_discount,
  coupon_discount,
  pix_discount,
  total_discounts,
  items_cost,
  allocated_purchase_cost,
  packaging_cost,
  fee_actual,
  extra_costs,
  real_profit,
  real_margin,
  ROUND(
    total_customer
    - items_cost
    - allocated_purchase_cost
    - packaging_cost
    - fee_actual
    - extra_costs
  , 2)                                                          AS lucro_calculado_manual,
  ROUND(
    (
      total_customer
      - items_cost
      - allocated_purchase_cost
      - packaging_cost
      - fee_actual
      - extra_costs
    ) - real_profit
  , 2)                                                          AS diferenca_esperado_vs_gravado
FROM public.sales
WHERE status IN ('CONCLUIDA','PENDENTE','PARCIAL')
  AND total_customer > 0
ORDER BY sale_date DESC, friendly_number DESC
LIMIT 10;
