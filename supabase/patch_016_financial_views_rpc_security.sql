-- PATCH 016 - corrige RPC de edicao, exposicao financeira e seguranca
-- Schema validado em 25/09/2026. Nao altera linhas historicas.
-- EXECUCAO MANUAL: revisar e executar uma unica vez no SQL Editor.

begin;

-- Views devem respeitar RLS das tabelas-base.
alter view public.products_with_stock set (security_invoker = true);
alter view public.v_cash_eveline_summary set (security_invoker = true);
alter view public.v_dashboard_sales set (security_invoker = true);
alter view public.v_dashboard_receivables set (security_invoker = true);
alter view public.v_dashboard_obligations set (security_invoker = true);
alter view public.v_dashboard_stock set (security_invoker = true);
alter view public.v_dashboard_stock_summary set (security_invoker = true);

-- A view anterior omitia payment_source e tornava impossivel classificar corretamente.
create or replace view public.v_dashboard_financial
with (security_invoker = true)
as
select
  id,
  trans_date,
  trans_type,
  category,
  description,
  amount,
  status,
  payment_method,
  related_sale_id,
  related_purchase_id,
  notes,
  payment_source,
  due_date,
  created_at,
  updated_at,
  id as financial_transaction_id
from public.financial_transactions;

grant select on public.v_dashboard_financial to authenticated;
revoke all on public.v_dashboard_financial from anon;

create or replace function public.__resolve_sale_payment_source(
  p_total_received numeric,
  p_provider_names text[],
  p_methods text[]
) returns text
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_text text := lower(concat_ws(' ', array_to_string(p_provider_names, ' '), array_to_string(p_methods, ' ')));
begin
  if coalesce(p_total_received, 0) <= 0 then return null; end if;
  if v_text like '%infinite%' then return 'INFINITEPAY'; end if;
  if v_text like '%mercado%pago%' or v_text like '%mercadopago%' then return 'MERCADO_PAGO'; end if;
  if v_text like '%fabiana%' then return 'FABIANA'; end if;
  if v_text like '%dona%' then return 'DONA'; end if;
  if v_text like '%outro%' then return 'OUTRO'; end if;
  return 'CAIXA_EVELINE';
end;
$$;

create or replace function public.update_sale_with_financial_sync(
  p_sale_id uuid,
  p_sale_patch jsonb default '{}'::jsonb,
  p_payment_patch jsonb default null::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sale public.sales%rowtype;
  v_payment_id uuid;
  v_total_received numeric := 0;
  v_fee_expected numeric := 0;
  v_fee_real numeric := 0;
  v_fee_amount numeric := 0;
  v_providers text[] := array[]::text[];
  v_methods text[] := array[]::text[];
  v_source text;
  v_fin_status text;
  v_venda_id uuid;
  v_taxa_id uuid;
  v_has_repasse boolean := false;
  v_warning text;
begin
  if auth.uid() is null then
    raise exception 'Acesso negado: autenticacao obrigatoria' using errcode = '42501';
  end if;
  if p_sale_id is null then raise exception 'sale_id obrigatorio'; end if;

  -- Serializa edicoes concorrentes da mesma venda.
  perform pg_advisory_xact_lock(hashtextextended(p_sale_id::text, 0));

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Venda nao encontrada'; end if;

  if coalesce(p_sale_patch, '{}'::jsonb) <> '{}'::jsonb then
    update public.sales s set
      customer_name = case when p_sale_patch ? 'customer_name' then nullif(btrim(p_sale_patch->>'customer_name'), '') else s.customer_name end,
      customer_phone = case when p_sale_patch ? 'customer_phone' then nullif(btrim(p_sale_patch->>'customer_phone'), '') else s.customer_phone end,
      sale_date = case when p_sale_patch ? 'sale_date' then (p_sale_patch->>'sale_date')::timestamptz else s.sale_date end,
      source = case when p_sale_patch ? 'source' then upper(p_sale_patch->>'source') else s.source end,
      status = case when p_sale_patch ? 'status' then upper(p_sale_patch->>'status') else s.status end,
      total_customer = case when p_sale_patch ? 'total_customer' then greatest((p_sale_patch->>'total_customer')::numeric, 0) else s.total_customer end,
      notes = case when p_sale_patch ? 'notes' then nullif(btrim(p_sale_patch->>'notes'), '') else s.notes end,
      updated_at = now()
    where s.id = p_sale_id;
  end if;

  -- O fluxo de inclusao continua sendo record_remaining_payment/finalize_sale.
  -- Esta RPC edita somente um pagamento existente e usa apenas colunas reais.
  if p_payment_patch is not null and jsonb_typeof(p_payment_patch) = 'object' then
    if not (p_payment_patch ? 'id') then
      raise exception 'Edicao de pagamento exige id; use record_remaining_payment para adicionar';
    end if;
    v_payment_id := (p_payment_patch->>'id')::uuid;
    update public.sale_payments sp set
      method = case when p_payment_patch ? 'method' then upper(p_payment_patch->>'method') else sp.method end,
      provider_snapshot = case when p_payment_patch ? 'provider_snapshot' then nullif(btrim(p_payment_patch->>'provider_snapshot'), '') else sp.provider_snapshot end,
      modality_snapshot = case when p_payment_patch ? 'modality_snapshot' then nullif(btrim(p_payment_patch->>'modality_snapshot'), '') else sp.modality_snapshot end,
      amount = case when p_payment_patch ? 'amount' then greatest((p_payment_patch->>'amount')::numeric, 0) else sp.amount end,
      fee_expected_snapshot = case when p_payment_patch ? 'fee_expected_snapshot' then greatest((p_payment_patch->>'fee_expected_snapshot')::numeric, 0) else sp.fee_expected_snapshot end,
      fee_real_snapshot = case when p_payment_patch ? 'fee_real_snapshot' then greatest((p_payment_patch->>'fee_real_snapshot')::numeric, 0) else sp.fee_real_snapshot end,
      fee_percent_snapshot = case when p_payment_patch ? 'fee_percent_snapshot' then greatest((p_payment_patch->>'fee_percent_snapshot')::numeric, 0) else sp.fee_percent_snapshot end,
      installments = case when p_payment_patch ? 'installments' then greatest((p_payment_patch->>'installments')::integer, 1) else sp.installments end,
      updated_at = now()
    where sp.id = v_payment_id and sp.sale_id = p_sale_id;
    if not found then raise exception 'Pagamento nao encontrado para esta venda'; end if;
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  select
    coalesce(sum(sp.amount), 0),
    coalesce(sum(sp.fee_expected_snapshot), 0),
    coalesce(sum(sp.fee_real_snapshot), 0),
    coalesce(array_agg(sp.provider_snapshot order by sp.created_at) filter (where sp.provider_snapshot is not null), array[]::text[]),
    coalesce(array_agg(sp.method order by sp.created_at), array[]::text[])
  into v_total_received, v_fee_expected, v_fee_real, v_providers, v_methods
  from public.sale_payments sp where sp.sale_id = p_sale_id;

  v_source := public.__resolve_sale_payment_source(v_total_received, v_providers, v_methods);
  if upper(v_sale.status) in ('CANCELADA', 'REEMBOLSADA') then
    v_fin_status := 'CANCELADO'; v_source := null;
  elsif v_total_received <= 0 then
    v_fin_status := 'PENDENTE'; v_source := null;
  else
    v_fin_status := 'CONFIRMADO';
  end if;

  select exists(
    select 1 from public.financial_transactions
    where related_sale_id = p_sale_id and category = 'REPASSE_INFINITEPAY'
      and status = 'CONFIRMADO' and payment_source = 'CAIXA_EVELINE'
  ) into v_has_repasse;
  if v_has_repasse and v_source <> 'INFINITEPAY' then
    v_source := 'INFINITEPAY';
    v_warning := 'Venda possui repasse InfinitePay confirmado; origem mantida em INFINITEPAY para evitar dupla entrada.';
  end if;

  select id into v_venda_id
  from public.financial_transactions
  where related_sale_id = p_sale_id and category = 'VENDA' and trans_type = 'ENTRADA'
    and status in ('PENDENTE', 'CONFIRMADO')
  order by case when status = 'CONFIRMADO' then 0 else 1 end, updated_at desc, created_at desc
  limit 1 for update;

  if v_venda_id is not null then
    update public.financial_transactions set
      trans_date = v_sale.sale_date::date,
      description = format('Venda #%s - %s', v_sale.friendly_number, coalesce(v_sale.customer_name, 'Cliente nao identificado')),
      amount = greatest(v_total_received, 0), status = v_fin_status,
      payment_source = v_source, payment_method = v_methods[1],
      due_date = case when v_fin_status = 'PENDENTE' then v_sale.sale_date::date + 30 else null end,
      updated_at = now()
    where id = v_venda_id;
  elsif v_total_received > 0 then
    insert into public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, payment_method, status, payment_source, created_by)
    values
      (v_sale.sale_date::date, 'ENTRADA', 'VENDA', format('Venda #%s - %s', v_sale.friendly_number, coalesce(v_sale.customer_name, 'Cliente nao identificado')),
       v_total_received, p_sale_id, v_methods[1], v_fin_status, v_source, auth.uid())
    returning id into v_venda_id;
  end if;

  v_fee_amount := coalesce(nullif(v_fee_real, 0), nullif(v_fee_expected, 0), 0);
  select id into v_taxa_id from public.financial_transactions
  where related_sale_id = p_sale_id and category = 'TAXA' and trans_type = 'SAIDA'
  order by case when status = 'CONFIRMADO' then 0 else 1 end, updated_at desc, created_at desc
  limit 1 for update;

  if v_fee_amount > 0 and v_taxa_id is not null then
    update public.financial_transactions set
      trans_date = v_sale.sale_date::date, amount = v_fee_amount, status = v_fin_status,
      payment_source = v_source, updated_at = now()
    where id = v_taxa_id;
  elsif v_fee_amount > 0 then
    insert into public.financial_transactions
      (trans_date, trans_type, category, description, amount, related_sale_id, status, payment_source, created_by)
    values
      (v_sale.sale_date::date, 'SAIDA', 'TAXA', format('Taxa venda #%s', v_sale.friendly_number),
       v_fee_amount, p_sale_id, v_fin_status, v_source, auth.uid())
    returning id into v_taxa_id;
  elsif v_taxa_id is not null then
    update public.financial_transactions set amount = 0, status = 'CANCELADO', payment_source = null, updated_at = now()
    where id = v_taxa_id;
  end if;

  update public.sales set
    fee_actual = v_fee_real,
    fee_expected = v_fee_expected,
    real_profit = total_customer - items_cost - allocated_purchase_cost - packaging_cost - extra_costs - v_fee_real,
    real_margin = case when total_customer > 0 then
      ((total_customer - items_cost - allocated_purchase_cost - packaging_cost - extra_costs - v_fee_real) / total_customer) * 100 else 0 end,
    updated_at = now()
  where id = p_sale_id;

  return jsonb_build_object(
    'ok', true, 'sale_id', p_sale_id, 'total_received', v_total_received,
    'total_customer', v_sale.total_customer,
    'amount_receivable', greatest(v_sale.total_customer - v_total_received, 0),
    'total_fee_real', v_fee_real, 'warning', v_warning,
    'financial', jsonb_build_object('payment_source', v_source, 'status', v_fin_status,
      'venda_amount', greatest(v_total_received, 0), 'taxa_amount', v_fee_amount)
  );
end;
$$;

-- Evita novas duplicidades por INSERT, sem tocar nas duplicidades historicas existentes.
create or replace function public.prevent_duplicate_active_sale_financial()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.category = 'VENDA' and new.trans_type = 'ENTRADA'
     and new.status in ('PENDENTE', 'CONFIRMADO') and new.related_sale_id is not null
     and exists (
       select 1 from public.financial_transactions ft
       where ft.related_sale_id = new.related_sale_id and ft.category = 'VENDA'
         and ft.trans_type = 'ENTRADA' and ft.status in ('PENDENTE', 'CONFIRMADO')
     ) then
    raise exception 'Ja existe transacao VENDA ativa para esta venda';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_active_sale_financial on public.financial_transactions;
create trigger trg_prevent_duplicate_active_sale_financial
before insert on public.financial_transactions
for each row execute function public.prevent_duplicate_active_sale_financial();

revoke execute on function public.update_sale_with_financial_sync(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.__resolve_sale_payment_source(numeric, text[], text[]) from public, anon;
revoke execute on function public.prevent_duplicate_active_sale_financial() from public, anon;
grant execute on function public.update_sale_with_financial_sync(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.__resolve_sale_payment_source(numeric, text[], text[]) to authenticated;

commit;

-- POS-EXECUCAO (somente leitura): deve retornar zero linhas para novas vendas.
-- Existem duas duplicidades historicas conhecidas; este patch NAO as altera.
-- select related_sale_id, count(*) from public.financial_transactions
-- where category='VENDA' and trans_type='ENTRADA' and status in ('PENDENTE','CONFIRMADO')
-- group by related_sale_id having count(*) > 1;