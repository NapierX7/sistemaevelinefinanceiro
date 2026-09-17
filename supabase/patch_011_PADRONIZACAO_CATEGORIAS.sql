BEGIN;

-- ============================================================
-- PATCH 011 — PADRONIZAÇÃO DE CATEGORIAS DOS PRODUTOS
-- Data: 17/09/2026
-- Autor: Eveline Gestão
--
-- O que faz:
--   0) UPSERT das 5 categorias oficiais (por nome)
--   1) Atribui category_id correto para 19 SKUs
--   2) Não altera: estoque, custos, vendas, financeiro, lotes, pagamentos
--   3) Mantém updated_at = NOW() em products e categories
--
-- Como usar:
--   Abrir SQL Editor Supabase → colar → RUN.
--   É idempotente: pode rodar quantas vezes quiser sem duplicar nada.
-- ============================================================

-- ============================================================
-- 0) CRIAR/ATUALIZAR CATEGORIAS OFICIAIS (UPSERT POR ID)
-- ============================================================
INSERT INTO public.categories (id, name, slug, created_at, updated_at)
VALUES
  ('cd942746-6f71-48ad-955c-aac120f04456', 'Blusas',    'blusas',    NOW(), NOW()),
  ('cc3da3ae-747a-4765-b61a-3bb4e7dc69fa', 'Calcas',    'calcas',    NOW(), NOW()),
  ('39a4e944-c889-4436-8480-4ff998cdada6', 'Conjuntos', 'conjuntos', NOW(), NOW()),
  ('3b7d2c9a-f524-4af4-aac6-b6ec7569bb7e', 'Regatas',   'regatas',   NOW(), NOW()),
  ('04fe6c68-3960-4c33-b1fd-82590de61d85', 'Vestidos',  'vestidos',  NOW(), NOW())
ON CONFLICT (id) DO UPDATE
  SET
    name       = EXCLUDED.name,
    slug       = EXCLUDED.slug,
    updated_at = EXCLUDED.updated_at;

-- Garante nome/slug consistentes mesmo se a categoria já existia com
-- um nome/slug antigo:
UPDATE public.categories
SET
  name = CASE id
    WHEN 'cd942746-6f71-48ad-955c-aac120f04456' THEN 'Blusas'
    WHEN 'cc3da3ae-747a-4765-b61a-3bb4e7dc69fa' THEN 'Calcas'
    WHEN '39a4e944-c889-4436-8480-4ff998cdada6' THEN 'Conjuntos'
    WHEN '3b7d2c9a-f524-4af4-aac6-b6ec7569bb7e' THEN 'Regatas'
    WHEN '04fe6c68-3960-4c33-b1fd-82590de61d85' THEN 'Vestidos'
  END,
  slug = CASE id
    WHEN 'cd942746-6f71-48ad-955c-aac120f04456' THEN 'blusas'
    WHEN 'cc3da3ae-747a-4765-b61a-3bb4e7dc69fa' THEN 'calcas'
    WHEN '39a4e944-c889-4436-8480-4ff998cdada6' THEN 'conjuntos'
    WHEN '3b7d2c9a-f524-4af4-aac6-b6ec7569bb7e' THEN 'regatas'
    WHEN '04fe6c68-3960-4c33-b1fd-82590de61d85' THEN 'vestidos'
  END,
  updated_at = NOW()
WHERE id IN (
  'cd942746-6f71-48ad-955c-aac120f04456',
  'cc3da3ae-747a-4765-b61a-3bb4e7dc69fa',
  '39a4e944-c889-4436-8480-4ff998cdada6',
  '3b7d2c9a-f524-4af4-aac6-b6ec7569bb7e',
  '04fe6c68-3960-4c33-b1fd-82590de61d85'
);

-- ============================================================
-- 1) ATRIBUI category_id CORRETO PARA CADA SKU
-- ============================================================
UPDATE public.products
SET    category_id = 'cd942746-6f71-48ad-955c-aac120f04456', updated_at = NOW()
WHERE  sku IN ('BLUSA-001','BLUSA-002','BLUSA-003','BLUSA-004');

UPDATE public.products
SET    category_id = 'cc3da3ae-747a-4765-b61a-3bb4e7dc69fa', updated_at = NOW()
WHERE  sku IN ('CALCA-001','CALCA-002','CALCA-003');

UPDATE public.products
SET    category_id = '39a4e944-c889-4436-8480-4ff998cdada6', updated_at = NOW()
WHERE  sku IN ('CONJ-001','CONJ-002','CONJ-003','CONJ-004','CONJ-005','CONJ-006','CONJ-007','CONJ-008');

UPDATE public.products
SET    category_id = '3b7d2c9a-f524-4af4-aac6-b6ec7569bb7e', updated_at = NOW()
WHERE  sku IN ('REGATA-001');

UPDATE public.products
SET    category_id = '04fe6c68-3960-4c33-b1fd-82590de61d85', updated_at = NOW()
WHERE  sku IN ('VESTIDO-001','VESTIDO-002','VESTIDO-003');

-- ============================================================
-- 2) RESUMO — quantos SKUs por categoria?
-- ============================================================
WITH mapping AS (
  SELECT 'Blusas'    AS categoria, sku FROM public.products WHERE category_id = 'cd942746-6f71-48ad-955c-aac120f04456'
  UNION ALL
  SELECT 'Calcas'    AS categoria, sku FROM public.products WHERE category_id = 'cc3da3ae-747a-4765-b61a-3bb4e7dc69fa'
  UNION ALL
  SELECT 'Conjuntos' AS categoria, sku FROM public.products WHERE category_id = '39a4e944-c889-4436-8480-4ff998cdada6'
  UNION ALL
  SELECT 'Regatas'   AS categoria, sku FROM public.products WHERE category_id = '3b7d2c9a-f524-4af4-aac6-b6ec7569bb7e'
  UNION ALL
  SELECT 'Vestidos'  AS categoria, sku FROM public.products WHERE category_id = '04fe6c68-3960-4c33-b1fd-82590de61d85'
)
SELECT categoria,
       COUNT(*)              AS total_skus,
       STRING_AGG(sku, ', ' ORDER BY sku) AS skus
FROM   mapping
GROUP  BY categoria
ORDER  BY categoria;

-- ============================================================
-- 3) RELATÓRIO FINAL (categoria · SKU · produto · atualizado em)
-- ============================================================
SELECT
  c.name    AS categoria,
  p.sku     AS sku,
  p.name    AS produto,
  p.active  AS ativo,
  TO_CHAR(p.updated_at, 'DD/MM/YYYY HH24:MI:SS') AS atualizado_em
FROM      public.products    p
LEFT JOIN public.categories  c ON c.id = p.category_id
ORDER BY  c.name NULLS LAST, p.sku;

COMMIT;
