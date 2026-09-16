-- ============================================================
-- AUDITORIA PÓS IMPORTAÇÃO
-- ============================================================
-- Rode após aplicar patch_historico_01_estoque.sql e patch_historico_02_vendas.sql

-- 1. Resumo Geral
SELECT
  (SELECT COUNT(*) FROM public.purchase_entries pe
    WHERE pe.notes LIKE 'HIST-ENTRADA-%') AS entradas_historicas,
  (SELECT SUM(pe.total_cost) FROM public.purchase_entries pe
    WHERE pe.notes LIKE 'HIST-ENTRADA-%') AS investimento_total,
  (SELECT SUM(pei.quantity)
     FROM public.purchase_entries pe
     JOIN public.purchase_entry_items pei ON pei.purchase_entry_id = pe.id
    WHERE pe.notes LIKE 'HIST-ENTRADA-%') AS total_pecas_compradas,
  (SELECT COUNT(*) FROM public.sales s
    LEFT JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Eduarda Neri','Rebeca','Ruth','Ana Larissa',
      'Ingrid','Emilly Gabrielly','Maria Clara','Júlia Caetano','Matheus Lima',
      'Leticia (clínica)','Evelyn','Day','Cristina','Francisca','Evellyn Luísa (fono)'
    )) AS vendas_historicas,
  (SELECT SUM(quantity) FROM public.sale_items si
     JOIN public.sales s ON s.id = si.sale_id
    WHERE s.customer_name IN (
      'Maria Luísa','Amanda','Lorrany','Eduarda Neri','Rebeca','Ruth','Ana Larissa',
      'Ingrid','Emilly Gabrielly','Maria Clara','Júlia Caetano','Matheus Lima',
      'Leticia (clínica)','Evelyn','Day','Cristina','Francisca','Evellyn Luísa (fono)'
    )) AS pecas_vendidas_total;

-- 2. Estoque atual por SKU (VIEW products_with_stock)
SELECT
  p.sku,
  p.name AS produto,
  COALESCE(pws.total_stock, 0) AS estoque_atual,
  CASE WHEN COALESCE(pws.total_stock, 0) < 0 THEN '🚨 NEGATIVO' ELSE 'OK' END AS status_estoque
FROM public.products p
LEFT JOIN public.products_with_stock pws ON pws.id = p.id
WHERE p.sku IS NOT NULL
ORDER BY p.sku;

-- 3. SKUs com estoque NEGATIVO (se houver)
SELECT
  p.sku, p.name,
  COALESCE(pws.total_stock, 0) AS saldo,
  (SELECT COALESCE(SUM(pei.quantity),0)
     FROM public.purchase_entry_items pei WHERE pei.product_id = p.id) AS comprado,
  (SELECT COALESCE(SUM(si.quantity),0)
     FROM public.sale_items si
     JOIN public.sales s ON s.id = si.sale_id
    WHERE si.product_id = p.id
      AND s.status IN ('PENDENTE','CONCLUIDA','PARCIAL')) AS baixado
FROM public.products p
LEFT JOIN public.products_with_stock pws ON pws.id = p.id
WHERE COALESCE(pws.total_stock, 0) < 0
ORDER BY p.sku;

-- 4. Vendas por status (verificar PENDENTE / PARCIAL / CONCLUIDA)
SELECT s.status, COUNT(*) AS qtde, SUM(s.total_customer) AS total
FROM public.sales s
WHERE s.customer_name IN (
  'Maria Luísa','Amanda','Lorrany','Eduarda Neri','Rebeca','Ruth','Ana Larissa',
  'Ingrid','Emilly Gabrielly','Maria Clara','Júlia Caetano','Matheus Lima',
  'Leticia (clínica)','Evelyn','Day','Cristina','Francisca','Evellyn Luísa (fono)'
)
GROUP BY s.status ORDER BY s.status;

-- 5. Contas a receber (transações PENDENTES)
SELECT
  s.friendly_number,
  s.customer_name,
  s.status,
  s.total_customer AS total_venda,
  (SELECT COALESCE(SUM(ft.amount),0) FROM public.financial_transactions ft
    WHERE ft.related_sale_id = s.id AND ft.status='CONFIRMADO' AND ft.trans_type='ENTRADA') AS recebido,
  (SELECT COALESCE(SUM(ft.amount),0) FROM public.financial_transactions ft
    WHERE ft.related_sale_id = s.id AND ft.status='PENDENTE' AND ft.trans_type='ENTRADA') AS a_receber,
  s.sale_date
FROM public.sales s
WHERE s.customer_name IN (
  'Maria Luísa','Amanda','Lorrany','Eduarda Neri','Rebeca','Ruth','Ana Larissa',
  'Ingrid','Emilly Gabrielly','Maria Clara','Júlia Caetano','Matheus Lima',
  'Leticia (clínica)','Evelyn','Day','Cristina','Francisca','Evellyn Luísa (fono)'
)
ORDER BY s.sale_date;

-- 6. Correspondências pendentes / produtos suspeitos
SELECT
  s.customer_name,
  si.product_name_snapshot AS item,
  si.sku_snapshot AS sku,
  'Verificar correspondência do modelo' AS observacao
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE si.product_name_snapshot LIKE '%[CORRESPONDÊNCIA PENDENTE]%'
   OR si.sku_snapshot LIKE 'POÁ-PENDENTE%'
ORDER BY s.sale_date;

-- 7. Itens não vinculados (product_id = NULL)
SELECT s.customer_name, si.product_name_snapshot, si.sku_snapshot
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE si.product_id IS NULL;
