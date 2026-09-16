import { useEffect, useMemo, useState } from 'react'
import {
  CreditCard, Package, Zap, Store, Plus, Trash2, ChevronDown,
  Settings as SettingsIcon, X, Save, Check, Percent, Phone, MapPin, Building2
} from 'lucide-react'
import {
  formatCurrency, formatPercent, cn, parseBrl, paymentMethodLabel
} from '@/lib/format'
import {
  listPaymentProviders, listFeeRules, upsertFeeRule, deleteFeeRule,
  listPackagingTypes, getSetting, upsertSetting
} from '@/services'
import type { PaymentFeeRule, PackagingType } from '@/types/supabase'
import type { ProviderWithModalities } from '@/services'

type TabKey = 'pagamentos' | 'embalagens' | 'pix' | 'loja'

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('pagamentos')
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<ProviderWithModalities[]>([])
  const [feeRules, setFeeRules] = useState<PaymentFeeRule[]>([])
  const [packaging, setPackaging] = useState<PackagingType[]>([])
  const [pixEnabled, setPixEnabled] = useState(false)
  const [pixPercent, setPixPercent] = useState('0')
  const [storeName, setStoreName] = useState('')
  const [storePhone, setStorePhone] = useState('')
  const [storeAddress, setStoreAddress] = useState('')
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [feeModal, setFeeModal] = useState<{ open: boolean; editing?: PaymentFeeRule }>({ open: false })
  const [packModal, setPackModal] = useState<{ open: boolean; editing?: PackagingType }>({ open: false })
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const load = async () => {
    setLoading(true)
    try {
      const [p, f, pk, pixE, pixP, sn, sp, sa] = await Promise.all([
        listPaymentProviders(), listFeeRules(), listPackagingTypes(),
        getSetting('pix_discount_enabled'),
        getSetting('pix_discount_percent'),
        getSetting('store_name'),
        getSetting('store_phone'),
        getSetting('store_address'),
      ])
      setProviders(p)
      setFeeRules(f)
      setPackaging(pk)
      setPixEnabled(pixE === true || pixE === 'true' || pixE === 1)
      setPixPercent(String(pixP ?? 0))
      setStoreName(sn ?? '')
      setStorePhone(sp ?? '')
      setStoreAddress(sa ?? '')
    } catch (e) {
      console.error(e)
      alert('Erro ao carregar configurações.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const tabs: Array<{ k: TabKey; label: string; icon: React.ReactNode }> = [
    { k: 'pagamentos', label: 'Pagamentos', icon: <CreditCard className="w-4 h-4" /> },
    { k: 'embalagens', label: 'Embalagens', icon: <Package className="w-4 h-4" /> },
    { k: 'pix', label: 'Pix', icon: <Zap className="w-4 h-4" /> },
    { k: 'loja', label: 'Loja', icon: <Store className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-5 pb-4 sm:pb-6 relative">
      {toast && (
        <div className="fixed top-4 right-4 z-[60] bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-semibold animate-in fade-in slide-in-from-top-2">
          <Check className="w-4 h-4" /> {toast}
        </div>
      )}

      <div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-ink-900 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6" /> Configurações
        </h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Taxas, embalagens, descontos e dados da loja.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex overflow-x-auto hide-scroll border-b border-ink-100">
          {tabs.map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={cn(
                'px-4 sm:px-5 py-4 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition flex items-center gap-2',
                tab === t.k
                  ? 'border-brand-900 text-brand-900 bg-brand-50/30'
                  : 'border-transparent text-ink-500 hover:text-ink-800 hover:bg-ink-50'
              )}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6">
          {tab === 'pagamentos' && (
            <PagamentosTab
              loading={loading}
              providers={providers}
              feeRules={feeRules}
              onAddRule={() => setFeeModal({ open: true })}
              onEditRule={(r) => setFeeModal({ open: true, editing: r })}
              onDeleteRule={async (id) => {
                if (!confirm('Excluir esta regra de taxa?')) return
                try {
                  await deleteFeeRule(id)
                  showToast('Regra excluída.')
                  load()
                } catch (e) { console.error(e); alert('Erro ao excluir.') }
              }}
            />
          )}
          {tab === 'embalagens' && (
            <EmbalagensTab
              loading={loading}
              packaging={packaging}
              onAdd={() => setPackModal({ open: true })}
            />
          )}
          {tab === 'pix' && (
            <PixTab
              loading={loading}
              enabled={pixEnabled}
              percent={pixPercent}
              setEnabled={setPixEnabled}
              setPercent={setPixPercent}
              onSave={async () => {
                setSaving(s => ({ ...s, pix: true }))
                try {
                  await Promise.all([
                    upsertSetting('pix_discount_enabled', pixEnabled, 'Habilita/desabilita desconto Pix à vista'),
                    upsertSetting('pix_discount_percent', Number(pixPercent) || 0, 'Percentual de desconto Pix à vista'),
                  ])
                  showToast('Configurações Pix salvas!')
                } catch (e) { console.error(e); alert('Erro ao salvar.') }
                finally { setSaving(s => ({ ...s, pix: false })) }
              }}
              saving={saving.pix}
            />
          )}
          {tab === 'loja' && (
            <LojaTab
              loading={loading}
              name={storeName}
              phone={storePhone}
              address={storeAddress}
              setName={setStoreName}
              setPhone={setStorePhone}
              setAddress={setStoreAddress}
              onSave={async () => {
                setSaving(s => ({ ...s, loja: true }))
                try {
                  await Promise.all([
                    upsertSetting('store_name', storeName.trim(), 'Nome da loja'),
                    upsertSetting('store_phone', storePhone.trim(), 'Telefone da loja'),
                    upsertSetting('store_address', storeAddress.trim(), 'Endereço da loja'),
                  ])
                  showToast('Dados da loja salvos!')
                } catch (e) { console.error(e); alert('Erro ao salvar.') }
                finally { setSaving(s => ({ ...s, loja: false })) }
              }}
              saving={saving.loja}
            />
          )}
        </div>
      </div>

      {feeModal.open && (
        <FeeRuleModal
          editing={feeModal.editing}
          providers={providers}
          existingRules={feeRules}
          onClose={() => setFeeModal({ open: false })}
          onSaved={async () => {
            setFeeModal({ open: false })
            showToast('Regra salva!')
            load()
          }}
        />
      )}
    </div>
  )
}

function PagamentosTab({
  loading, providers, feeRules, onAddRule, onEditRule, onDeleteRule,
}: {
  loading: boolean
  providers: ProviderWithModalities[]
  feeRules: PaymentFeeRule[]
  onAddRule: () => void
  onEditRule: (r: PaymentFeeRule) => void
  onDeleteRule: (id: string) => void
}) {
  if (loading) return <div className="text-center py-10 text-ink-500">Carregando...</div>

  const methods: Array<'PIX' | 'DEBITO' | 'CREDITO'> = ['PIX', 'DEBITO', 'CREDITO']
  const installments = Array.from({ length: 12 }, (_, i) => i + 1)

  const findRule = (provId: string, modId: string, method: string, inst: number) =>
    feeRules.find(r =>
      r.provider_id === provId &&
      r.modality_id === modId &&
      r.method === method &&
      r.installments === inst
    )

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink-800">Taxas de pagamento</h3>
          <p className="text-xs text-ink-500 mt-0.5">
            Configure taxas por provedor, modalidade, método e parcelas.
          </p>
        </div>
        <button onClick={onAddRule} className="btn-primary self-start sm:self-auto">
          <Plus className="w-4 h-4" /> Adicionar regra
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="text-center py-10 text-ink-500">
          Nenhum provedor de pagamento configurado.
        </div>
      ) : providers.map(p => (
        <div key={p.provider.id} className="space-y-3">
          <div className="divider-label !my-2">
            <CreditCard className="w-3.5 h-3.5" /> {p.provider.name}
          </div>
          {p.modalities.length === 0 ? (
            <div className="text-sm text-ink-400 italic">Sem modalidades para este provedor.</div>
          ) : p.modalities.map(m => (
            <div key={m.id} className="card">
              <div className="px-4 py-3 border-b border-ink-100 bg-ink-50/50 flex items-center justify-between">
                <div>
                  <div className="font-bold text-ink-800 text-sm">{m.name}</div>
                  <div className="text-[11px] text-ink-500">Modalidade: {m.code}</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-semibold uppercase tracking-wider text-ink-500 px-4 py-3 border-b border-ink-100 bg-white">
                        Método
                      </th>
                      {installments.map(i => (
                        <th key={i} className="text-right text-xs font-semibold uppercase tracking-wider text-ink-500 px-3 py-3 border-b border-ink-100 bg-white num">
                          {i}x
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {methods.map(method => (
                      <tr key={method} className="border-b border-ink-50 last:border-0">
                        <td className="px-4 py-3 font-semibold text-ink-800 whitespace-nowrap">
                          {paymentMethodLabel(method)}
                        </td>
                        {installments.map(i => {
                          if (i > 1 && method !== 'CREDITO') {
                            return <td key={i} className="px-3 py-3 text-center text-ink-300 text-xs">—</td>
                          }
                          const rule = findRule(p.provider.id, m.id, method, i)
                          return (
                            <td key={i} className="px-3 py-3">
                              {rule ? (
                                <div
                                  onClick={() => onEditRule(rule)}
                                  className="group cursor-pointer p-2 rounded-lg bg-brand-50/50 border border-brand-100 hover:bg-brand-50 hover:border-brand-300 transition relative"
                                >
                                  <div className="text-xs font-bold text-brand-900 num text-center">
                                    {formatPercent(rule.fee_percent, 2)}
                                  </div>
                                  {Number(rule.fixed_fee) > 0 && (
                                    <div className="text-[10px] text-brand-700/70 num text-center mt-0.5">
                                      + {formatCurrency(rule.fixed_fee)}
                                    </div>
                                  )}
                                  {rule.receipt_term && (
                                    <div className="text-[10px] text-ink-500 num text-center mt-0.5">
                                      D+{rule.receipt_term}
                                    </div>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onDeleteRule(rule.id) }}
                                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white text-rose-600 border border-rose-200 opacity-0 group-hover:opacity-100 transition shadow-sm flex items-center justify-center"
                                    aria-label="Excluir"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    onEditRule({
                                      id: '',
                                      provider_id: p.provider.id,
                                      modality_id: m.id,
                                      method: method as any,
                                      installments: i,
                                      fee_percent: 0,
                                      fixed_fee: 0,
                                      valid_from: new Date().toISOString().slice(0, 10),
                                      created_at: '',
                                    } as PaymentFeeRule)
                                  }}
                                  className="w-full p-2 rounded-lg border border-dashed border-ink-200 hover:border-brand-400 hover:bg-brand-50/30 text-ink-300 hover:text-brand-500 transition text-xs flex items-center justify-center gap-1 min-h-[48px]"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function FeeRuleModal({
  editing, providers, existingRules, onClose, onSaved,
}: {
  editing?: PaymentFeeRule
  providers: ProviderWithModalities[]
  existingRules: PaymentFeeRule[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    provider_id: editing?.provider_id ?? providers[0]?.provider.id ?? '',
    modality_id: editing?.modality_id ?? '',
    method: editing?.method ?? 'PIX',
    installments: editing?.installments ?? 1,
    fee_percent: String(editing?.fee_percent ?? 0).replace('.', ','),
    fixed_fee: formatCurrency(editing?.fixed_fee ?? 0).replace('R$ ', ''),
    receipt_term: editing?.receipt_term ?? '',
  })
  const [saving, setSaving] = useState(false)

  const modalities = useMemo(
    () => providers.find(p => p.provider.id === form.provider_id)?.modalities ?? [],
    [providers, form.provider_id]
  )

  useEffect(() => {
    if (!form.modality_id && modalities.length > 0) {
      setForm(f => ({ ...f, modality_id: modalities[0].id }))
    }
  }, [form.provider_id, modalities])

  const submit = async () => {
    setSaving(true)
    try {
      const payload: Partial<PaymentFeeRule> & { id?: string } = {
        id: editing?.id || undefined,
        provider_id: form.provider_id,
        modality_id: form.modality_id || undefined,
        method: form.method as any,
        installments: Number(form.installments) || 1,
        fee_percent: parseBrl(form.fee_percent),
        fixed_fee: parseBrl(form.fixed_fee),
        receipt_term: form.receipt_term || undefined,
      }
      await upsertFeeRule(payload)
      onSaved()
    } catch (e) {
      console.error(e)
      alert('Erro ao salvar regra.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-ink-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-black text-ink-900">
              {editing?.id ? 'Editar regra de taxa' : 'Nova regra de taxa'}
            </h2>
            <p className="text-xs text-ink-500 mt-0.5">Defina provedor, método e valores.</p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Provedor</label>
              <div className="relative">
                <select className="select pr-10 w-full"
                  value={form.provider_id}
                  onChange={e => setForm(f => ({ ...f, provider_id: e.target.value, modality_id: '' }))}>
                  {providers.map(p => (
                    <option key={p.provider.id} value={p.provider.id}>{p.provider.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Modalidade</label>
              <div className="relative">
                <select className="select pr-10 w-full"
                  value={form.modality_id}
                  onChange={e => setForm(f => ({ ...f, modality_id: e.target.value }))}>
                  <option value="">Selecione...</option>
                  {modalities.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Método</label>
              <div className="relative">
                <select className="select pr-10 w-full"
                  value={form.method}
                  onChange={e => setForm(f => ({ ...f, method: e.target.value as any, installments: e.target.value === 'CREDITO' ? f.installments : 1 }))}>
                  <option value="PIX">Pix</option>
                  <option value="DEBITO">Débito</option>
                  <option value="CREDITO">Crédito</option>
                  <option value="BOLETO">Boleto</option>
                  <option value="DINHEIRO">Dinheiro</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Parcelas</label>
              <input type="number" min={1} max={12} className="input num"
                value={form.installments}
                onChange={e => setForm(f => ({ ...f, installments: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label">Taxa %</label>
              <div className="relative">
                <Percent className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-10 num"
                  value={form.fee_percent}
                  onChange={e => setForm(f => ({ ...f, fee_percent: e.target.value }))}
                  inputMode="decimal" />
              </div>
            </div>
            <div>
              <label className="label">Taxa fixa (R$)</label>
              <input className="input num"
                value={form.fixed_fee}
                onChange={e => setForm(f => ({ ...f, fixed_fee: e.target.value }))}
                inputMode="decimal" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Prazo de recebimento (dias)</label>
              <input type="number" min={0} placeholder="Ex: 30 para D+30"
                className="input num"
                value={form.receipt_term}
                onChange={e => setForm(f => ({ ...f, receipt_term: e.target.value }))} />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-br from-brand-50 to-white border border-brand-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-brand-700 mb-2">Simulação em R$ 100,00</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[10px] text-ink-500">Taxa %</div>
                <div className="text-sm font-bold num text-rose-700">− {formatCurrency(parseBrl(form.fee_percent))}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-500">Taxa fixa</div>
                <div className="text-sm font-bold num text-rose-700">− {formatCurrency(parseBrl(form.fixed_fee))}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-500">Líquido</div>
                <div className="text-sm font-black num text-emerald-700">
                  {formatCurrency(Math.max(0, 100 - parseBrl(form.fee_percent) - parseBrl(form.fixed_fee)))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-5 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary">Cancelar</button>
          <button onClick={submit} disabled={saving} className="btn-primary">
            <Save className="w-4 h-4" /> {saving ? 'Salvando...' : (editing?.id ? 'Atualizar regra' : 'Criar regra')}
          </button>
        </div>
      </div>
    </div>
  )
}

function EmbalagensTab({
  loading, packaging, onAdd,
}: {
  loading: boolean
  packaging: PackagingType[]
  onAdd: () => void
}) {
  if (loading) return <div className="text-center py-10 text-ink-500">Carregando...</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink-800">Tipos de embalagem</h3>
          <p className="text-xs text-ink-500 mt-0.5">
            Embalagens disponíveis para uso nas vendas.
          </p>
        </div>
        <button onClick={onAdd} className="btn-primary self-start sm:self-auto">
          <Plus className="w-4 h-4" /> Adicionar embalagem
        </button>
      </div>

      {packaging.length === 0 ? (
        <div className="text-center py-16 card">
          <Package className="w-12 h-12 text-ink-300 mx-auto mb-3" />
          <p className="text-sm text-ink-500 mb-4">Nenhuma embalagem cadastrada.</p>
          <button onClick={onAdd} className="btn-secondary">
            <Plus className="w-4 h-4" /> Cadastrar primeira
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {packaging.map(p => (
            <div key={p.id} className="card p-5 hover:shadow-md transition group">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center ring-1',
                  p.is_default
                    ? 'bg-brand-50 text-brand-700 ring-brand-100'
                    : 'bg-ink-50 text-ink-500 ring-ink-100'
                )}>
                  <Package className="w-6 h-6" />
                </div>
                {p.is_default && (
                  <span className="chip bg-brand-50 text-brand-700 ring-1 ring-brand-200 text-[10px]">
                    Padrão
                  </span>
                )}
              </div>
              <div className="font-bold text-ink-900 text-lg mb-1">{p.name}</div>
              {p.code && (
                <div className="text-xs text-ink-400 num mb-3">Código: {p.code}</div>
              )}
              <div className="pt-3 border-t border-ink-100 flex items-end justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Custo unitário</div>
                  <div className="text-xl font-black num text-brand-900 mt-0.5">
                    {formatCurrency(p.unit_cost)}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button className="btn-ghost !p-2 text-rose-600 hover:bg-rose-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PixTab({
  loading, enabled, percent, setEnabled, setPercent, onSave, saving,
}: {
  loading: boolean
  enabled: boolean
  percent: string
  setEnabled: (v: boolean) => void
  setPercent: (v: string) => void
  onSave: () => void
  saving?: boolean
}) {
  const pctNum = parseBrl(percent)
  const compraExemplo = 100
  const desconto = compraExemplo * (pctNum / 100)
  const comDesconto = compraExemplo - desconto

  if (loading) return <div className="text-center py-10 text-ink-500">Carregando...</div>

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h3 className="font-bold text-ink-800 flex items-center gap-2">
          <Zap className="w-5 h-5 text-brand-700" /> Desconto Pix à vista
        </h3>
        <p className="text-xs text-ink-500 mt-0.5">
          Configure um desconto especial para pagamentos via Pix.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-ink-50 border border-ink-100">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-ink-800">Habilitar desconto Pix</div>
            <div className="text-xs text-ink-500 mt-0.5">
              Quando ativo, aparecerá automaticamente no checkout.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className={cn(
              'relative inline-flex h-8 w-14 items-center rounded-full transition-colors flex-shrink-0',
              enabled ? 'bg-brand-900' : 'bg-ink-200'
            )}
          >
            <span className={cn(
              'inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-7' : 'translate-x-1'
            )} />
          </button>
        </div>

        <div className={cn(
          'transition space-y-4',
          !enabled && 'opacity-50 pointer-events-none'
        )}>
          <div>
            <label className="label flex items-center gap-1.5">
              <Percent className="w-4 h-4" /> % de desconto Pix à vista
            </label>
            <div className="relative">
              <input className="input num text-lg !py-3 !pl-12 font-bold text-brand-900"
                type="text"
                inputMode="decimal"
                value={percent}
                onChange={e => setPercent(e.target.value)}
                min={0}
                max={100}
              />
              <Percent className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" />
            </div>
            {pctNum > 20 && (
              <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-100">
                <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Desconto acima de 20% pode impactar fortemente sua margem. Confira antes de salvar.
                </span>
              </div>
            )}
          </div>

          <div className="p-5 rounded-xl bg-gradient-to-br from-brand-50 via-white to-white border border-brand-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-brand-700 mb-3">
              Preview: Compra de R$ 100,00
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-600">Valor original</span>
                <span className="num text-sm font-semibold text-ink-800 line-through opacity-70">
                  {formatCurrency(compraExemplo)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-rose-700 font-semibold flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" /> Desconto Pix ({formatPercent(pctNum, 1)})
                </span>
                <span className="num text-sm font-bold text-rose-600">− {formatCurrency(desconto)}</span>
              </div>
              <div className="pt-3 mt-2 border-t border-brand-200/50 flex items-center justify-between">
                <span className="font-bold text-ink-900">Cliente paga</span>
                <span className="num text-2xl font-black text-brand-900">
                  {formatCurrency(comDesconto)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving} className="btn-primary">
          <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  )
}

function LojaTab({
  loading, name, phone, address, setName, setPhone, setAddress, onSave, saving,
}: {
  loading: boolean
  name: string
  phone: string
  address: string
  setName: (v: string) => void
  setPhone: (v: string) => void
  setAddress: (v: string) => void
  onSave: () => void
  saving?: boolean
}) {
  if (loading) return <div className="text-center py-10 text-ink-500">Carregando...</div>

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h3 className="font-bold text-ink-800 flex items-center gap-2">
          <Store className="w-5 h-5 text-brand-700" /> Dados da loja
        </h3>
        <p className="text-xs text-ink-500 mt-0.5">
          Estes dados aparecem em notas, cupons e comunicações.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <label className="label flex items-center gap-1.5">
            <Building2 className="w-4 h-4" /> Nome da loja
          </label>
          <input className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Eveline Modas" />
        </div>
        <div>
          <label className="label flex items-center gap-1.5">
            <Phone className="w-4 h-4" /> Telefone / WhatsApp
          </label>
          <input className="input"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="(11) 99999-9999" />
        </div>
        <div>
          <label className="label flex items-center gap-1.5">
            <MapPin className="w-4 h-4" /> Endereço completo
          </label>
          <textarea className="input min-h-[90px]"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Rua, número, bairro, cidade / UF" />
        </div>

        {name && (
          <div className="p-4 rounded-xl bg-gradient-to-br from-ink-50 to-white border border-ink-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">
              Preview (exemplo de cupom)
            </div>
            <div className="font-black text-ink-900 text-lg">{name}</div>
            {phone && <div className="text-sm text-ink-600 mt-1 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {phone}</div>}
            {address && <div className="text-sm text-ink-600 mt-1 flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {address}</div>}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving} className="btn-primary">
          <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar dados da loja'}
        </button>
      </div>
    </div>
  )
}
