import { useEffect, useMemo, useState } from 'react'
import {
  DollarSign, TrendingUp, Wallet, ArrowUpRight, ArrowDownRight,
  Calendar, ChevronDown, Filter
} from 'lucide-react'
import {
  formatCurrency, formatDate, rangePresets, inRange,
  cn, pluralize, paymentMethodLabel
} from '@/lib/format'
import {
  listFinancialTransactions, listSales
} from '@/services'
import type { FinancialTransaction, Sale } from '@/types/supabase'

type PresetKey = keyof ReturnType<typeof rangePresets> | 'PERSONALIZADO'

export default function FinancePage() {
  const presets = rangePresets()
  const [preset, setPreset] = useState<PresetKey>('ESTE_MES')
  const [from, setFrom] = useState<string>(presets.ESTE_MES.from.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(presets.ESTE_MES.to.toISOString().slice(0, 10))
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (preset !== 'PERSONALIZADO') {
      const p = presets[preset as Exclude<PresetKey, 'PERSONALIZADO'>]
      setFrom(p.from.toISOString().slice(0, 10))
      setTo(p.to.toISOString().slice(0, 10))
    }
  }, [preset])

  const load = async () => {
    setLoading(true)
    try {
      const [t, s] = await Promise.all([listFinancialTransactions(), listSales()])
      setTransactions(t)
      setSales(s)
    } catch (e) {
      console.error(e)
      alert('Erro ao carregar financeiro.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const { fromDate, toDate } = useMemo(() => ({
    fromDate: new Date(from + 'T00:00:00'),
    toDate: new Date(to + 'T23:59:59'),
  }), [from, to])

  const periodSales = useMemo(
    () => sales.filter(s => inRange(s.sale_date ?? s.created_at, fromDate, toDate) && s.status !== 'CANCELADA'),
    [sales, fromDate, toDate]
  )
  const periodTrans = useMemo(
    () => transactions.filter(t => inRange(t.trans_date, fromDate, toDate)),
    [transactions, fromDate, toDate]
  )

  const kpis = useMemo(() => {
    const faturamento = periodSales.reduce((s, v) => s + Number(v.total_customer ?? 0), 0)
    const lucro = periodSales.reduce((s, v) => s + Number(v.real_profit ?? 0), 0)
    const entradas = periodTrans
      .filter(t => t.trans_type === 'ENTRADA')
      .reduce((s, v) => s + Number(v.amount ?? 0), 0)
    const saidas = periodTrans
      .filter(t => t.trans_type === 'SAIDA')
      .reduce((s, v) => s + Number(v.amount ?? 0), 0)
    const saldo = entradas - saidas
    return { faturamento, lucro, entradas, saidas, saldo }
  }, [periodSales, periodTrans])

  const catLabel = (c: string) => {
    const map: Record<string, string> = {
      VENDA: 'Venda',
      COMPRA_ESTOQUE: 'Compra estoque',
      FRETE: 'Frete',
      TAXA: 'Taxa',
      EMBALAGEM: 'Embalagem',
      ENTREGA: 'Entrega',
      OUTRA_RECEITA: 'Outra receita',
      OUTRA_DESPESA: 'Outra despesa',
    }
    return map[c] || c
  }

  return (
    <div className="space-y-5 pb-4 sm:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900">Financeiro</h1>
          <p className="text-sm text-ink-500 mt-0.5">Faturamento, lucro e fluxo de caixa.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative">
            <select
              value={preset}
              onChange={e => setPreset(e.target.value as PresetKey)}
              className="select pr-10"
            >
              {Object.entries(presets).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
              <option value="PERSONALIZADO">Personalizado</option>
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-ink-200">
              <Calendar className="w-4 h-4 text-ink-500" />
              <input type="date" value={from}
                onChange={e => { setFrom(e.target.value); setPreset('PERSONALIZADO') }}
                className="bg-transparent text-sm outline-none w-[110px]" />
            </div>
            <span className="text-ink-400 text-sm">à</span>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-ink-200">
              <Calendar className="w-4 h-4 text-ink-500" />
              <input type="date" value={to}
                onChange={e => { setTo(e.target.value); setPreset('PERSONALIZADO') }}
                className="bg-transparent text-sm outline-none w-[110px]" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-5 border-t-4 !border-t-emerald-500">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="kpi-label">FATURAMENTO</div>
              <div className="text-[11px] text-ink-400 mt-0.5">receita bruta das vendas</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black num text-emerald-800">{formatCurrency(kpis.faturamento)}</div>
          <div className="mt-2 text-xs text-ink-500">{pluralize(periodSales.length, 'venda', 'vendas')} no período</div>
        </div>

        <div className="card p-5 border-t-4 !border-t-brand-700">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="kpi-label">LUCRO</div>
              <div className="text-[11px] text-ink-400 mt-0.5">receita − todos os custos</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-brand-50 ring-1 ring-brand-100 flex items-center justify-center text-brand-700">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className={cn(
            'text-2xl sm:text-3xl font-black num',
            kpis.lucro >= 0 ? 'text-brand-900' : 'text-rose-700'
          )}>
            {kpis.lucro >= 0 ? '' : '− '}{formatCurrency(Math.abs(kpis.lucro))}
          </div>
          <div className="mt-2 text-xs text-ink-500">
            Margem: {kpis.faturamento > 0 ? `${((kpis.lucro / kpis.faturamento) * 100).toFixed(1)}%` : '—'}
          </div>
        </div>

        <div className="card p-5 border-t-4 !border-t-violet-500">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="kpi-label">SALDO EM CAIXA</div>
              <div className="text-[11px] text-ink-400 mt-0.5">entradas − saídas (movimento real)</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-violet-50 ring-1 ring-violet-100 flex items-center justify-center text-violet-700">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className={cn(
            'text-2xl sm:text-3xl font-black num',
            kpis.saldo >= 0 ? 'text-violet-900' : 'text-rose-700'
          )}>
            {kpis.saldo >= 0 ? '' : '− '}{formatCurrency(Math.abs(kpis.saldo))}
          </div>
          <div className="mt-2 text-xs text-ink-500">
            {pluralize(periodTrans.length, 'transação', 'transações')}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-ink-800">Movimentações do período</h3>
            <p className="text-xs text-ink-500 mt-0.5">
              Todas as entradas e saídas financeiras no intervalo selecionado.
            </p>
          </div>
          <span className="chip bg-ink-100 text-ink-700">
            {loading ? 'Carregando…' : pluralize(periodTrans.length, 'lançamento', 'lançamentos')}
          </span>
        </div>
        <div className="table-wrap">
          <table className="table-base min-w-[640px]">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Categoria</th>
                <th>Descrição</th>
                <th className="text-right">Valor R$</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-ink-500">Carregando...</td></tr>
              ) : periodTrans.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-ink-500">
                  <Filter className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                  Nenhuma movimentação no período.
                </td></tr>
              ) : periodTrans.map(t => {
                const isEntrada = t.trans_type === 'ENTRADA'
                const valorAbs = Math.abs(Number(t.amount ?? 0))
                return (
                  <tr key={t.id} className="hover:bg-ink-50/50 transition">
                    <td className="num text-ink-700 whitespace-nowrap">{formatDate(t.trans_date)}</td>
                    <td>
                      <span className={cn(
                        'chip ring-1 flex w-fit items-center gap-1',
                        isEntrada
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : 'bg-rose-50 text-rose-700 ring-rose-200'
                      )}>
                        {isEntrada ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {isEntrada ? 'Entrada' : 'Saída'}
                      </span>
                    </td>
                    <td>
                      <span className="chip bg-ink-100 text-ink-700">
                        {catLabel(t.category)}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm text-ink-800 font-medium">{t.description}</div>
                      {t.payment_method && (
                        <div className="text-[11px] text-ink-400 mt-0.5">
                          {paymentMethodLabel(t.payment_method)}
                          {t.status === 'PENDENTE' && <span className="ml-2 text-amber-600">· Pendente</span>}
                        </div>
                      )}
                    </td>
                    <td className={cn(
                      'text-right num font-bold whitespace-nowrap',
                      isEntrada ? 'text-emerald-700' : 'text-rose-700'
                    )}>
                      {isEntrada ? '+' : '−'} {formatCurrency(valorAbs)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-ink-50/80 sticky bottom-0">
                <td colSpan={3} className="font-bold text-ink-800 text-sm border-t-2 border-ink-200 py-4">
                  Totalizador do período
                </td>
                <td className="text-sm text-ink-500 border-t-2 border-ink-200 py-4">
                  {pluralize(periodTrans.length, 'lançamento')}
                </td>
                <td className="border-t-2 border-ink-200 py-4">
                  <div className="space-y-1.5 text-right">
                    <div className="flex items-center justify-end gap-2 text-sm">
                      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-ink-600">Entradas:</span>
                      <span className="num font-bold text-emerald-700">{formatCurrency(kpis.entradas)}</span>
                    </div>
                    <div className="flex items-center justify-end gap-2 text-sm">
                      <ArrowDownRight className="w-3.5 h-3.5 text-rose-600" />
                      <span className="text-ink-600">Saídas:</span>
                      <span className="num font-bold text-rose-700">{formatCurrency(kpis.saidas)}</span>
                    </div>
                    <div className="pt-2 mt-1 border-t border-ink-200 flex items-center justify-end gap-2">
                      <span className="font-bold text-ink-800 text-sm">Saldo:</span>
                      <span className={cn(
                        'num font-black text-lg',
                        kpis.saldo >= 0 ? 'text-violet-800' : 'text-rose-700'
                      )}>
                        {kpis.saldo >= 0 ? '+' : '−'} {formatCurrency(Math.abs(kpis.saldo))}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="px-1">
        <p className="text-[11px] text-ink-500 leading-relaxed max-w-3xl">
          <span className="font-semibold text-ink-600">Obs:</span> Saldo em caixa ≠ Lucro.
          Compras de mercadoria são despesa de caixa hoje, mas o custo só é reconhecido no lucro no momento da venda.
          Taxas, embalagens e fretes também impactam os dois indicadores em momentos diferentes.
        </p>
      </div>
    </div>
  )
}
