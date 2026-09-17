-- ============================================================
-- AUDITORIA PRÉ-EXECUÇÃO — EVELINE GESTÃO (ITEM 11 da lista)
--        26 itens pedidos. NÃO INVENTA NADA.
-- ============================================================
BEGIN;

DO $$
DECLARE
  -- 3 remessas estoque (declarados)
  v_rem1 NUMERIC := 380.00;
  v_rem2 NUMERIC := 410.00;
  v_rem2_soma_unit NUMERIC := 465.00;  -- soma unitários (divergência)
  v_rem3 NUMERIC := 1160.00;
  v_pecas_rem INTEGER := 6+13+19;      -- 38
  v_mercadoria NUMERIC := 1950.00;

  -- Custos conhecidos fora estoque (não são despesa duplicada com sócia)
  v_mat NUMERIC := 303.51;
  v_cheirinho NUMERIC := 35.00;
  v_frete3 NUMERIC := 119.20;
  v_socia NUMERIC := 1070.00;
  v_total_conhecido NUMERIC := 303.51 + 35.00 + 119.20 + 1070.00; -- 2.407,71

  -- 18 vendas correto (NÃO É 3.133,90!)
  v_fat NUMERIC := 2937.21;
  v_rec NUMERIC := 2237.51;
  v_recb NUMERIC := 699.70;
  v_pecas_vendas INTEGER := 30;

  -- Embalagens 18 vendas
  v_sac_g INTEGER := 9;
  v_sac_p INTEGER := 8;
  v_sac_u INTEGER := 1;

  -- Etiquetas / Adesivos / Lacres
  v_etiq INTEGER := 30;
  v_ades INTEGER := 48;
  v_lacre INTEGER := 18;

  -- Estoque teórico (8 peças)
  v_estq_teor INTEGER := 8;
BEGIN
  RAISE NOTICE E'\n============================================================\n📊 AUDITORIA PRÉ-EXECUÇÃO — 26 ITENS\n============================================================\n';

  RAISE NOTICE '1. 3 REMESSAS / VALORES';
  RAISE NOTICE '   • 1ª Remessa: 6 peças / R$ %', to_char(v_rem1,'FM999990D00');
  RAISE NOTICE '   • 2ª Remessa: 13 peças / R$ %  (⚠️ DIVERGÊNCIA ABAIXO)', to_char(v_rem2,'FM999990D00');
  RAISE NOTICE '   • 3ª Remessa: 19 peças / R$ %', to_char(v_rem3,'FM999990D00');

  RAISE NOTICE '2. 38 PEÇAS COMPRADAS (6 + 13 + 19) → % peças', v_pecas_rem;

  RAISE NOTICE '3. R$ % DE MERCADORIA (TOTAL DECLARADO 380+410+1160 = %)',
    to_char(v_mercadoria,'FM999990D00'),
    to_char(v_rem1+v_rem2+v_rem3,'FM999990D00');

  RAISE NOTICE '4. ⚠️ DIVERGÊNCIA 2ª REMESSA (ALERTA PENDENTE)';
  RAISE NOTICE '      Soma dos custos unitários (25+25+25+20+20+20+20+20+20+75+75+60+60) = R$ %',
    to_char(v_rem2_soma_unit,'FM999990D00');
  RAISE NOTICE '      Total informado pela proprietária = R$ %', to_char(v_rem2,'FM999990D00');
  RAISE NOTICE '      ✂️  Diferença: - R$ % (registrada como ajuste NEGATIVO other_costs)',
    to_char(v_rem2_soma_unit-v_rem2,'FM999990D00');
  RAISE NOTICE '      ⏳ PENDENTE identificar a origem da diferença -R$55,00';

  RAISE NOTICE '5. R$ % INVESTIMENTO MATERIAIS (sacolas + etiquetas + adesivos + papel seda)',
    to_char(v_mat,'FM999990D00');

  RAISE NOTICE '6. R$ % CHEIRINHO de sacolas (investimento/compra)',
    to_char(v_cheirinho,'FM999990D00');

  RAISE NOTICE '7. R$ % FRETE CONFIRMADO (3ª remessa. Frete 1ª/2ª = PENDENTE)',
    to_char(v_frete3,'FM999990D00');

  RAISE NOTICE '8. R$ % INVESTIMENTOS/CUSTOS CONHECIDOS ATÉ AGORA',
    to_char(v_total_conhecido,'FM999990D00');
  RAISE NOTICE '      (Materiais R$303,51 + Cheirinho R$35,00 + Frete3 R$119,20 + Sócia R$1.070,00)';

  RAISE NOTICE '9. ⏳ OUTROS FRETES (PENDENTES IDENTIFICAÇÃO)';
  RAISE NOTICE '      • 1ª Remessa (6 peças) frete ainda não identificado → NÃO estimado';
  RAISE NOTICE '      • 2ª Remessa (13 peças) frete ainda não identificado → NÃO estimado';
  RAISE NOTICE '      Total frete pendente: NÃO FOI CRIADO valor estimado (conforme regra)';

  RAISE NOTICE '10. R$ % A DEVOLVER À SÓCIA  (CAPITAL / PASSIVO, não é despesa!)',
    to_char(v_socia,'FM999990D00');
  RAISE NOTICE '      ⚠️ NÃO SOMAR este R$1.070,00 como nova despesa!';
  RAISE NOTICE '      Quando devolver: diminuir CAIXA (-R$1.070) e reduzir esta categoria DEVOLVER_SOCIA. ';
  RAISE NOTICE '      Ainda não sabemos quais compras foram financiadas → NÃO inventar associação';

  RAISE NOTICE '11. 18 VENDAS HISTÓRICAS (SEM Eduarda Neri / SEM Letícia clínica!)';

  RAISE NOTICE '12. R$ % TOTAL VENDIDO (Faturamento) ', to_char(v_fat,'FM999990D00');

  RAISE NOTICE '13. R$ % TOTAL RECEBIDO ', to_char(v_rec,'FM999990D00');
  RAISE NOTICE '      (R$ 2.937,21 - R$ 699,70 = R$ 2.237,51)';

  RAISE NOTICE '14. R$ % TOTAL A RECEBER', to_char(v_recb,'FM999990D00');
  RAISE NOTICE '      • Day         R$ 130,00 (parcial — 260 - 130 PIX)';
  RAISE NOTICE '      • Cristina    R$  69,90 (parcial — 139,80 - 69,90 PIX)';
  RAISE NOTICE '      • Francisca  R$  69,90 (parcial — 149,90 - 80,00 PIX)';
  RAISE NOTICE '      • Evelyn     R$ 240,00 (pendente — nada pago)';
  RAISE NOTICE '      • Evellyn(L) R$ 189,90 (pendente — nada pago)';
  RAISE NOTICE '      Soma: 130 + 69,90 + 69,90 + 240 + 189,90 = R$ %',
    to_char(130+69.90+69.90+240+189.90,'FM999990D00');

  RAISE NOTICE '15. 30 PEÇAS VENDIDAS / RESERVADAS';
  RAISE NOTICE '      (3 + 1 + 4 + 1 + 1 + 2 + 1 + 2 + 2 + 2 + 3 + 1 + 1 + 2 + 2 + 2 + 1 + 1 = % esperado)', v_pecas_vendas;

  RAISE NOTICE '16. ESTOQUE TEÓRICO = % PEÇAS (38 - 30)', v_estq_teor;
  RAISE NOTICE '      ⚠️ VALIDADO DEPOIS POR SKU (por lote, NÃO FORÇADO!).';
  RAISE NOTICE '      Se ficar negativo, PATCH ABORTA com SKU e quantidades comprada/vendida/diferença';

  RAISE NOTICE '17. 30 ETIQUETAS (1 por peça vendida → 30)';
  RAISE NOTICE '18. 48 ADESIVOS  (30 peças + 18 sacolas = %  → exato!)', v_ades;
  RAISE NOTICE '19. 9 SACOLAS GRANDES (Maria Luísa, Ruth, Lorrany, Maria Clara, Júlia, Matheus, Evelyn, Day, + ? ) → %', v_sac_g;
  RAISE NOTICE '20. 8 SACOLAS PEQUENAS (Amanda, Ingrid, Rebeca, Ana Larissa, Emilly, Mirela, Cristina, Evellyn fono) → %', v_sac_p;
  RAISE NOTICE '21. 1 SACOLA DA FRANCISCA → TAMANHO DESCONHECIDO (NÃO foi inventado!)';
  RAISE NOTICE '22. CMV CONHECIDO — custos das peças efetivamente vendidas (FIFO lotes após execução) — calculado DEPOIS automaticamente';
  RAISE NOTICE '23. CUSTOS EMBALAGEM CONHECIDOS SEM ESTIMATIVA: — 0 calculado sem inventar unitários (R$303,51 investimento total, não sabemos custo unitário sacola/etiqueta)';
  RAISE NOTICE '24. TAXAS DE PAGAMENTO (reais): 0 para PIX / LINK 4,2% a 6,09% / TAP 3,15 a 5,39% / ELO 4,91 a 6,47% — calculado nas transações de cada venda';
  RAISE NOTICE '25. LUCRO BRUTO / LÍQUIDO (só dados conhecidos):';
  RAISE NOTICE '      • Receita: R$2.937,21';
  RAISE NOTICE '      • (-) CMV (peças vendidas): calculado na auditoria PÓS por lote';
  RAISE NOTICE '      • (-) Taxas pagamento (reais): calculado PÓS';
  RAISE NOTICE '      • (-) Embalagens (conhecidas, sem inventar): 0 unitário por enquanto';
  RAISE NOTICE '      • (-) Frete 3ª remessa R$119,20 já incluso lotes (shipping_cost rateado)';
  RAISE NOTICE '      • (-) Sócia R$1.070 NÃO entra aqui (passivo)';

  RAISE NOTICE '26. PENDÊNCIAS (impedem conciliação 100%):';
  RAISE NOTICE '   26.1) Divergência 2ª remessa -R$55,00 origem desconhecida';
  RAISE NOTICE '   26.2) Frete 1ª Remessa — valor e forma pagamento (PIX? boleto?) desconhecido';
  RAISE NOTICE '   26.3) Frete 2ª Remessa — idem';
  RAISE NOTICE '   26.4) MOVIMENTO FABIANA (⚠️ MUITO IMPORTANTE):';
  RAISE NOTICE '        • valor pago por Fabiana tem ROUPAS + FRETE juntos, precisa SEPARAR';
  RAISE NOTICE '        • frete de QUAL remessa pertence?';
  RAISE NOTICE '        • NÃO REGISTRADO como venda nem frete, só documentado neste patch';
  RAISE NOTICE '   26.5) Associação de quais compras foram financiadas com R$1.070 sócia não identificado';
  RAISE NOTICE '   26.6) Embalagem Francisca: tamanho G / P desconhecido';
  RAISE NOTICE '   26.7) CMV unitário das 6 peças da 1ª remessa é rateado (custo individual real não existe)';
  RAISE NOTICE '   26.8) Custo unitário sacolas / etiquetas / papel seda ainda não individualizado (investimento R$303,51 foi um valor fechado)';
  RAISE NOTICE '   26.9) Uso do cheirinho R$35: quanto consumido vs quanto sobrou? desconhecido';

  RAISE NOTICE E'\n============================================================\n🏁 FIM DA AUDITORIA PRÉ-EXECUÇÃO\n============================================================\n';
END $$;

COMMIT;
