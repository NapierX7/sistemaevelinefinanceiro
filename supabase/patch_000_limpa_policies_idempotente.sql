-- ============================================================
-- HELPER: TORNA schema.sql IDEMPOTENTE (roda múltiplas vezes sem erro)
-- ============================================================
-- OBJETIVO: aplicar este arquivo UMA VEZ no banco já existente
-- antes de NÃO RODAR MAIS O schema.sql completo!
-- Este arquivo aplica DROP IF EXISTS em todos os 25 CREATE POLICY
-- (que era o ponto que estava quebrando com 42710).
-- Também garante DROP TRIGGER / DROP FUNCTION (com CASCADE se houver)
-- para recriar limpo caso você queira rodar o schema integral futuro.
--
-- AVISO 1: NÃO apaga nenhuma tabela/linha/dado, só POLICIES/TRIGGERS/FUNCTIONS
-- que depois são RECRIADOS pelo próprio schema.sql.
--
-- AVISO 2: MESMO ASSIM — NÃO UTILIZE MAIS O schema.sql EM BANCO POVOADO!
-- Utilize somente os 3 patches:
--   1) patch_historico_01_estoque.sql
--   2) patch_historico_02_vendas.sql
--   3) patch_historico_03_auditoria.sql
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Dropa TODAS as policies da schema public (depois são recriadas se rodar schema)
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'DROP POLICY % ON %.% (ok)', r.policyname, r.schemaname, r.tablename;
  END LOOP;
END $$;

-- Dropa FUNCTIONs e TRIGGERs que o schema.sql recria (CASCADE remove gatilhos anexos)
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.get_admin_role(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.finalize_sale(TEXT,JSONB,NUMERIC,UUID,TEXT,NUMERIC,JSONB,JSONB,JSONB,TEXT,TEXT,UUID) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_sale(UUID,TEXT,UUID) CASCADE;
DROP FUNCTION IF EXISTS public.create_purchase_entry(DATE,TEXT,TEXT,TEXT,JSONB,NUMERIC,JSONB,TEXT,UUID) CASCADE;

-- Dropa TRIGGERs que o schema.sql cria nomeados explicitamente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Dropa VIEWs (recriadas pelo schema.sql)
DROP VIEW IF EXISTS public.products_with_stock;

-- Dropa TYPEs temporários usados nos patches
DROP TYPE IF EXISTS public.__import_line;

RAISE NOTICE 'OK: Todas POLICIES/FUNCTIONS/TRIGGERS foram apagadas. Pronto para rodar os patches 01, 02, 03 em ORDEM. NÃO RODE MAIS O schema.sql completo.';
