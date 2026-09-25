-- PATCH 017 - policy de leitura para obrigacoes
-- Necessario apos tornar v_dashboard_obligations SECURITY INVOKER no PATCH 016.
-- Nao altera dados.

begin;

grant select on table public.obligations to authenticated;
grant select on table public.v_dashboard_obligations to authenticated;
revoke all on table public.obligations from anon;
revoke all on table public.v_dashboard_obligations from anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'obligations'
      and policyname = 'obligations_select_authenticated'
  ) then
    create policy obligations_select_authenticated
      on public.obligations
      for select
      to authenticated
      using ((select auth.uid()) is not null);
  end if;
end
$$;

commit;