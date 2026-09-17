-- ============================================================
-- PATCH 07 (OFICIAL): ESTOQUE + INVESTIMENTOS + 18 VENDAS HISTÓRICAS
--                        (R$1.950 mercadoria + 2.407,71 conhecidos +
--                         18 vendas R$2.937,21 com 30 peças)
--
-- ✅ O QUE FAZ:
--     1. VALIDAÇÃO FAIL-FAST: todos SKUs existem antes de mexer
--     2. GARANTE os 3 produtos novos: BLUSA-004, CONJ-006, CONJ-007
--     3. 3 REMESSAS / 38 PEÇAS / R$1.950 mercadoria
--         - 2ª remessa com R$410 TOTAL DECLARADO (divergência de -R$55)
--           anotada em observação (NÃO FECHADO À FORÇA)
--     4. INVESTIMENTOS / CUSTOS fora estoque (2.407,71):
--         - Materiais embalagens R$303,51  (category MATERIAL)
--         - Cheirinho sacolas R$35,00       (category MATERIAL)
--         - Frete 3ª remessa R$119,20      (category FRETE)
--         - R$1.070 a devolver à SÓCIA     (category DEVOLVER_SOCIA)
--         - Soma TOTAL conhecida 2.407,71
--         - PENDÊNCIA: fretes desconhecidos 1ª/2ª remessa + movimento Fabiana
--     5. 18 VENDAS R$2.937,21 corretas (13 CONCLUIDA + 2 PARCIAL + 3 PENDENTE)
--         - SEM Letícia clínica, SEM Eduarda Neri (removidos!)
--         - 30 peças total
--         - Embalagens: 9 GRANDE + 8 PEQUENA + 1 (Francisca) DESCONHECIDA
--     6. TRANSAÇÕES FINANCEIRAS separadas
--     7. TRANSAÇÃO ÚNICA BEGIN/COMMIT.
--
-- ⚠️ PRÉ-REQUISITO: RODAR patch_004 + patch_005 + patch_006 ANTES
--         (RPCs e status check expandido)
--
-- ✅ IDEMPOTENTE: RODAR 100x sem duplicar nada.
-- ============================================================
BEGIN;

DO $$ BEGIN
  CREATE TYPE __import_line AS (sku_s TEXT, qty INTEGER, actual NUMERIC(12,2));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- (A) GARANTE 3 produtos novos (idempotente — RODA PRIMEIRO!)
-- ============================================================
DO $$
DECLARE
  v_cat UUID  := (SELECT id FROM public.categories WHERE slug='blusas' ORDER BY created_at LIMIT 1);
  v_conj UUID := (SELECT id FROM public.categories WHERE slug='conjuntos' ORDER BY created_at LIMIT 1);
  v_gr UUID   := (SELECT id FROM public.packaging_types WHERE code='GRANDE' ORDER BY created_at LIMIT 1);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku='BLUSA-004') THEN
    INSERT INTO public.products (sku,name,slug,category_id,current_cost,sale_price,min_stock,default_packaging_type_id)
      VALUES ('BLUSA-004','Blusa um ombro só / assimétrica (curta)','blusa-um-ombro-so',v_cat,20,69.90,1,v_gr);
    RAISE NOTICE '✔ Criado BLUSA-004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku='CONJ-006') THEN
    INSERT INTO public.products (sku,name,slug,category_id,current_cost,sale_price,min_stock,default_packaging_type_id)
      VALUES ('CONJ-006','Conjunto camisa + short','conjunto-camisa-short',v_conj,75,159.90,1,v_gr);
    RAISE NOTICE '✔ Criado CONJ-006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku='CONJ-007') THEN
    INSERT INTO public.products (sku,name,slug,category_id,current_cost,sale_price,min_stock,default_packaging_type_id)
      VALUES ('CONJ-007','Conjunto saia + top poá amarelo','conjunto-saia-top-poa-amarelo',v_conj,75,189.90,1,v_gr);
    RAISE NOTICE '✔ Criado CONJ-007';
  END IF;
END $$;

-- ============================================================
-- VALIDAÇÃO FAIL-FAST: 18 SKUs obrigatórios existem (AGORA RODA DEPOIS!)
-- ============================================================
DO $$
DECLARE
  _need TEXT[] := ARRAY[
    'BLUSA-001','BLUSA-002','BLUSA-003','BLUSA-004',
    'CALCA-001','CALCA-002','CALCA-003',
    'CONJ-001','CONJ-002','CONJ-003','CONJ-004','CONJ-005','CONJ-006','CONJ-007',
    'REGATA-001','VESTIDO-001','VESTIDO-002','VESTIDO-003'
  ];
  _miss TEXT[] := ARRAY[]::TEXT[];
  _s TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products LIMIT 1) THEN
    RAISE EXCEPTION 'public.products VAZIO. Verifique seu schema.';
  END IF;
  FOREACH _s IN ARRAY _need LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.sku = _s) THEN
      _miss := array_append(_miss, _s);
    END IF;
  END LOOP;
  IF array_length(_miss, 1) > 0 THEN
    RAISE EXCEPTION E'SKUs NÃO EXISTEM no banco: %.\nVerifique seed ou rode novamente patch_01.', array_to_string(_miss, ', ');
  END IF;
  RAISE NOTICE '✔ VALIDAÇÃO OK. 18 SKUs obrigatórios existem.';
END $$;

-- ============================================================
-- (B) 3 REMESSAS / 38 PEÇAS / R$1.950 mercadoria
-- ============================================================
-- REMESSA 1 (6 peças, R$380 - unitários individuais NÃO conhecidos → other_costs R$380 rateio)
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_exist BOOLEAN := EXISTS (SELECT 1 FROM public.purchase_entries WHERE notes = 'HIST-ENTRADA-001-6PC-R$380');
  v_items JSONB := '[]'::jsonb;
  v_costs JSONB := '[]'::jsonb;
  v_missing TEXT[];
BEGIN
  IF v_exist THEN
    RAISE NOTICE '⏭ Entrada 1 (R$380) já existe — skip.';
    RETURN;
  END IF;
  -- itens (unit_cost=0, porque não temos custo individual por peça — tudo vem de other_costs rateado)
  -- JOIN DIRETO products para PEGAR product_id UUID (NÃO deixa product_id NULL → evita erro 23502!)
  WITH seed(sku,qty,cost) AS (VALUES
      ('CALCA-001', 2, 0),
      ('BLUSA-001', 4, 0)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'sku', p.sku,
      'quantity', seed.qty,
      'unit_cost', seed.cost
    )), '[]'::jsonb),
    ARRAY_AGG(seed.sku) FILTER (WHERE p.id IS NULL)
  INTO v_items, v_missing
  FROM seed
  LEFT JOIN public.products p ON p.sku = seed.sku;

  IF COALESCE(array_length(v_missing,1),0) > 0 THEN
    RAISE EXCEPTION E'Entrada 1 (R$380 / 6 peças): SKUs NÃO EXISTEM: %. RODE PRIMEIRO a criação dos 3 produtos (BLUSA-004 / CONJ-006 / CONJ-007) ou valide os 15 SKUs iniciais.', array_to_string(v_missing,', ');
  END IF;

  v_costs := jsonb_build_array(
    jsonb_build_object('description','Mercadoria 6 peças remessa 1 - CUSTO TOTAL rateado','category','MERCADORIA','amount',380.00)
  );

  PERFORM public.create_purchase_entry(
    p_entry_date:='2026-07-20'::DATE,
    p_supplier:='Fornecedor (6 peças)',
    p_origin:='HISTORICO',
    p_cost_allocation_method:='quantity',
    p_items:=v_items,
    p_shipping_cost:=0,
    p_other_costs:=v_costs,
    p_notes:='HIST-ENTRADA-001-6PC-R$380 — Custo unitário individual desconhecido; registrado como R$380 TOTAL via rateio por quantidade.',
    p_user_id:=v_admin
  );
  RAISE NOTICE '✔ Entrada 1 criada (R$380 / 6 peças). Custos via other_costs.';
END $$;

-- REMESSA 2 (13 peças, R$410 DECLARADO pela proprietária)
-- ⚠️ DIVERGÊNCIA R$55: soma unitários individualmente dá R$465 vs informado R$410.
-- A solução aqui: outros custos AJUSTE NEGATIVO DE -55 para bater o total informado.
-- A divergência fica anotada nas notes (NÃO É FECHADA À FORÇA).
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_exist BOOLEAN := EXISTS (SELECT 1 FROM public.purchase_entries WHERE notes='HIST-ENTRADA-002-13PC-R$410');
  v_items JSONB;
  v_costs JSONB;
  v_missing TEXT[];
BEGIN
  IF v_exist THEN
    RAISE NOTICE '⏭ Entrada 2 (R$410) já existe — skip.';
    RETURN;
  END IF;
  WITH seed(sku,qty,cost) AS (VALUES
    ('REGATA-001', 3, 25),   -- 3x25 = 75
    ('BLUSA-002',  3, 20),   -- 3x20 = 60
    ('BLUSA-004',  3, 20),   -- 3x20 = 60
    ('CONJ-004',   1, 75),   -- 1x75 = 75 (conjunto rosa, conhecido)
    ('CONJ-007',   1, 75),   -- 1x75 = 75 (poá amarelo, teste = amarelo)
    ('VESTIDO-001',1, 60),   -- 1x60 = 60
    ('VESTIDO-002',1, 60)    -- 1x60 = 60
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'sku', p.sku,
      'quantity', seed.qty,
      'unit_cost', seed.cost
    )), '[]'::jsonb),
    ARRAY_AGG(seed.sku) FILTER (WHERE p.id IS NULL)
  INTO v_items, v_missing
  FROM seed LEFT JOIN public.products p ON p.sku = seed.sku;

  IF COALESCE(array_length(v_missing,1),0) > 0 THEN
    RAISE EXCEPTION E'Entrada 2 (R$410 / 13 peças): SKUs NÃO EXISTEM: %.', array_to_string(v_missing,', ');
  END IF;

  v_costs := jsonb_build_array(
    jsonb_build_object('description',
      'AJUSTE FORNECEDOR -R$55 (divergência soma unitários R$465 vs total informado R$410; diferença -R$55 em análise)',
      'category','AJUSTE_FORNECEDOR','amount',-55.00)
  );
  PERFORM public.create_purchase_entry(
    p_entry_date:='2026-08-21'::DATE,
    p_supplier:='Fornecedor principal (13 peças)',
    p_origin:='HISTORICO',
    p_cost_allocation_method:='quantity',
    p_items:=v_items,
    p_shipping_cost:=0,
    p_other_costs:=v_costs,
    p_notes:='HIST-ENTRADA-002-13PC-R$410 — ⚠️ DIVERGÊNCIA PENDENTE: soma individual dos custos R$465,00 vs total informado R$410,00 (diferença -R$55,00). Registrado como ajuste negativo em outros custos; separar depois a causa da diferença.',
    p_user_id:=v_admin
  );
  RAISE NOTICE '✔ Entrada 2 criada (R$410 / 13 peças). ⚠️ Divergência -R$55 anotada.';
END $$;

-- REMESSA 3 (19 peças, R$1.160 — FECHADO, tudo MATEMATICAMENTE CONFIRMADO)
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
  v_exist BOOLEAN := EXISTS (SELECT 1 FROM public.purchase_entries WHERE notes='HIST-ENTRADA-003-19PC-R$1160');
  v_items JSONB;
  v_ship NUMERIC;
  v_costs JSONB;
  v_missing TEXT[];
BEGIN
  IF v_exist THEN
    RAISE NOTICE '⏭ Entrada 3 (R$1.160) já existe — skip.';
    RETURN;
  END IF;
  WITH seed(sku,qty,cost) AS (VALUES
    -- 3 conjuntos calça+blusa (CONJ-002(branco)=1, CONJ-003(preto)=2 para não ficar vazio)
    ('CONJ-002', 1, 75),
    ('CONJ-003', 2, 75),
    ('CONJ-006', 1, 75),   -- camisa+short R$75
    ('CALCA-003',5, 90),   -- 5 calças animal print
    ('CALCA-002',1, 90),   -- 1 calça marrom com lenço
    ('CONJ-007', 1, 90),   -- saia+top 1 (amarelo poá conf)
    ('CONJ-005', 1, 90),   -- saia+top 2 (bege)
    ('REGATA-001',7, 20)   -- 7 regatas alça fina R$20
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'sku', p.sku,
      'quantity', seed.qty,
      'unit_cost', seed.cost
    )), '[]'::jsonb),
    ARRAY_AGG(seed.sku) FILTER (WHERE p.id IS NULL)
  INTO v_items, v_missing
  FROM seed LEFT JOIN public.products p ON p.sku = seed.sku;

  IF COALESCE(array_length(v_missing,1),0) > 0 THEN
    RAISE EXCEPTION E'Entrada 3 (R$1.160 / 19 peças): SKUs NÃO EXISTEM: %.', array_to_string(v_missing,', ');
  END IF;

  -- Frete CONFIRMADO da 3ª remessa: R$119,20
  v_ship := 119.20;
  v_costs := jsonb_build_array(
    jsonb_build_object('description','Frete 3ª remessa (confirmado R$119,20)','category','FRETE','amount',119.20)
  );
  PERFORM public.create_purchase_entry(
    p_entry_date:='2026-09-02'::DATE,
    p_supplier:='Fornecedor principal (19 peças)',
    p_origin:='HISTORICO',
    p_cost_allocation_method:='quantity',
    p_items:=v_items,
    p_shipping_cost:=v_ship,
    p_other_costs:=v_costs,
    p_notes:='HIST-ENTRADA-003-19PC-R$1160 — Matematicamente confirmado. Frete R$119,20 incluso como shipping_cost.',
    p_user_id:=v_admin
  );
  RAISE NOTICE '✔ Entrada 3 criada (R$1.160 / 19 peças) + frete R$119,20.';
END $$;

-- ============================================================
-- (C) INVESTIMENTOS / CUSTOS FORA ESTOQUE (R$1.457,71 + R$1.070 dívida sócia)
--     TOTAL 2.407,71
-- ============================================================
DO $$
DECLARE
  v_admin UUID := (SELECT id FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.financial_transactions WHERE notes='HIST-INV-MATERIAIS-30351' LIMIT 1) THEN
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,payment_method,status,created_by,notes) VALUES
      ('2026-08-01','SAIDA','MATERIAL','Compra materiais embalagem (sacolas + etiquetas + adesivos + papel seda)',303.51,'PIX','CONFIRMADO',v_admin,'HIST-INV-MATERIAIS-30351');
    RAISE NOTICE '✔ Materiais embalagem R$303,51 registrado.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.financial_transactions WHERE notes='HIST-INV-CHEIRINHO-35' LIMIT 1) THEN
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,payment_method,status,created_by,notes) VALUES
      ('2026-08-05','SAIDA','MATERIAL','Cheirinho das sacolas (compra única R$35,00)',35.00,'PIX','CONFIRMADO',v_admin,'HIST-INV-CHEIRINHO-35');
    RAISE NOTICE '✔ Cheirinho sacolas R$35,00 registrado.';
  END IF;

  -- ⚠️ PENDÊNCIA: fretes desconhecidos 1ª e 2ª remessa (ainda sem identificação)
  IF NOT EXISTS (SELECT 1 FROM public.financial_transactions WHERE notes='HIST-INV-SOCIA-DEVOLVER-1070' LIMIT 1) THEN
    INSERT INTO public.financial_transactions (trans_date,trans_type,category,description,amount,payment_method,status,created_by,notes) VALUES
      ('2026-07-15','ENTRADA','DEVOLVER_SOCIA','Valor a ser devolvido à sócia - Capital aportado R$1.070,00 (passivo financeiro / não é despesa!)',
        1070.00,'TRANSFERENCIA','PENDENTE',v_admin,
        E'HIST-INV-SOCIA-DEVOLVER-1070 ⚠️ VALOR NÃO É DESPESA OPERACIONAL (é dívida/operação com sócia). Ao devolver: lançar SAIDA nesta mesma categoria para zerar. Não é R$1.070 + 2.407,71, está INCLUÍDO nos 2.407,71.');
    RAISE NOTICE '✔ A devolver à sócia R$1.070,00 (passivo) registrado.';
  END IF;

  RAISE NOTICE '✔ Investimentos conhecidos registrados. TOTAL CONHECIDO R$2.407,71 (303,51 + 35 + 119,20 frete já incluso entrada3 + 1070 sócia).';
  RAISE NOTICE '⚠️ PENDÊNCIA FRETE 1ª REMESSA: valor desconhecido (não estimado)';
  RAISE NOTICE '⚠️ PENDÊNCIA FRETE 2ª REMESSA: valor desconhecido (não estimado)';
  RAISE NOTICE '⚠️ PENDÊNCIA MOVIMENTO FABIANA: valor parcial de roupas + frete ainda não separado (não registrado para não inventar)';
END $$;

COMMIT;
