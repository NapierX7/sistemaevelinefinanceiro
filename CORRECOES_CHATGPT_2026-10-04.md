# Correções aplicadas — 04/10/2026

- Removidas referências inexistentes `inventory_batches.supplier_id` e `inventory_batches.notes` no recebimento/listagem de lotes.
- Modal padrão: removido `backdrop-blur-sm` do backdrop global; modal continua acima do overlay via z-index/portal quando utilizado.
- Dashboard: contador de produtos sem/com estoque renderizado explicitamente para impedir duplicação visual.
- Venda: removido rótulo "Cortesia / Gratuita" da apresentação de embalagem. Novas vendas continuam registrando embalagem como custo gerencial (`is_free: false`), sem nova saída de caixa.
- Financeiro: texto de ajuda esclarece que compra de embalagens é desembolso; consumo por venda é custo gerencial e não deve gerar segunda saída.
- `SalePayment`: removida dependência frontend de `trans_date` inexistente; histórico usa `created_at` para exibição.
- PATCH 015 v2: removida atualização de `sale_payments.trans_date` e corrigido comentário de schema.
- Demo storage ajustado para não tentar editar `SalePayment.trans_date`.

## Validação

`tsc -b` concluiu sem erros durante `npm run build`.
A etapa Vite não pôde concluir neste ambiente porque o `node_modules` enviado no ZIP não contém a dependência opcional nativa Linux `@rollup/rollup-linux-x64-gnu`. Isso é problema do `node_modules` transportado entre ambientes, não erro TypeScript do projeto.

No ambiente local, prefira instalar dependências novamente (`npm ci`) antes do build.

## Atenção

O arquivo `supabase/patch_015_v2_update_sale_financial_sync.sql` foi corrigido quanto à coluna inexistente `sale_payments.trans_date`, mas qualquer SQL financeiro deve ser revisado contra o schema real antes de execução em produção. Nenhum dado do Supabase foi alterado por estas correções.
