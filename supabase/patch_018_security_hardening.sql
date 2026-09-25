-- PATCH 018 - endurecimento de views e RPCs publicas
-- Aplicado e validado em 25/09/2026. Nao altera dados.

begin;

alter view public.v_dashboard_payments set (security_invoker = true);
alter view public.v_cash_eveline set (security_invoker = true);

revoke execute on function public.cancel_sale(uuid,text,uuid) from public, anon;
revoke execute on function public.create_purchase_entry(date,text,text,text,jsonb,numeric,jsonb,text,uuid) from public, anon;
revoke execute on function public.finalize_sale(text,jsonb,numeric,text,numeric,jsonb,jsonb,jsonb,text,text,uuid) from public, anon;
revoke execute on function public.finalize_sale(text,jsonb,numeric,uuid,text,numeric,jsonb,jsonb,jsonb,text,text,uuid) from public, anon;
revoke execute on function public.finalize_sale(text,jsonb,numeric,uuid,text,numeric,jsonb,jsonb,jsonb,text,text,uuid,text) from public, anon;
revoke execute on function public.get_admin_role(uuid) from public, anon;
revoke execute on function public.record_remaining_payment(uuid,jsonb,numeric,timestamptz,uuid,text) from public, anon;

grant execute on function public.cancel_sale(uuid,text,uuid) to authenticated;
grant execute on function public.create_purchase_entry(date,text,text,text,jsonb,numeric,jsonb,text,uuid) to authenticated;
grant execute on function public.finalize_sale(text,jsonb,numeric,text,numeric,jsonb,jsonb,jsonb,text,text,uuid) to authenticated;
grant execute on function public.finalize_sale(text,jsonb,numeric,uuid,text,numeric,jsonb,jsonb,jsonb,text,text,uuid) to authenticated;
grant execute on function public.finalize_sale(text,jsonb,numeric,uuid,text,numeric,jsonb,jsonb,jsonb,text,text,uuid,text) to authenticated;
grant execute on function public.get_admin_role(uuid) to authenticated;
grant execute on function public.record_remaining_payment(uuid,jsonb,numeric,timestamptz,uuid,text) to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.hist_create_purchase_entry(date,text,text,text,jsonb,numeric,jsonb,text,uuid) from public, anon, authenticated;
revoke execute on function public.hist_finalize_sale(text,jsonb,numeric,text,numeric,jsonb,jsonb,jsonb,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.hist_record_remaining_payment(uuid,jsonb,numeric,timestamptz,uuid,text) from public, anon, authenticated;
alter function public.handle_new_user() set search_path = public, pg_temp;

commit;