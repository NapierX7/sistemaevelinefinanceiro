import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Search, Edit, X, Package, Tag, Hash, Box, Image as ImageIcon,
  AlertTriangle, ChevronDown, Check, Filter
} from 'lucide-react'
import {
  formatCurrency, formatPercent, cn, parseBrl, slugify
} from '@/lib/format'
import {
  listCategories, listPackagingTypes,
  createProduct, updateProduct, onInvalidate, dispatchInvalidate, listProductsWithStock
} from '@/services'
import type { Product, Category, PackagingType } from '@/types/supabase'
import type { ProductWithStock } from '@/types/supabase'

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithStock[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [packaging, setPackaging] = useState<PackagingType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [uiError, setUiError] = useState<string | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setUiError(null)
    try {
      const [rp, rc, rpk] = await Promise.allSettled([
        listProductsWithStock(true), listCategories(), listPackagingTypes()
      ])
      if (rp.status === 'fulfilled') {
        setProducts(rp.value as ProductWithStock[])
      } else {
        console.error('[ProductsPage] listProductsWithStock falhou:', rp.reason)
        setUiError('Não foi possível carregar os produtos. Tente novamente.')
      }
      if (rc.status === 'fulfilled') {
        setCategories(rc.value)
      } else {
        console.error('[ProductsPage] listCategories falhou:', rc.reason)
      }
      if (rpk.status === 'fulfilled') {
        setPackaging(rpk.value)
      } else {
        console.error('[ProductsPage] listPackagingTypes falhou:', rpk.reason)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    const cleanup = onInvalidate((scope) => {
      if (scope === 'all' || scope === 'products' || scope === 'inventory' || scope === 'sales' || scope === 'purchases') {
        loadAll()
      }
    })
    return cleanup
  }, [])

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (filterStatus === 'active' && !p.active) return false
      if (filterStatus === 'inactive' && p.active) return false
      if (filterCategory !== 'all' && p.category_id !== filterCategory) return false
      if (search) {
        const s = search.toLowerCase()
        const n = p.name.toLowerCase()
        const sku = (p.sku || '').toLowerCase()
        if (!n.includes(s) && !sku.includes(s)) return false
      }
      return true
    })
  }, [products, search, filterCategory, filterStatus])

  const openNew = () => { setEditingId(null); setModalOpen(true) }
  const openEdit = (id: string) => { setEditingId(id); setModalOpen(true) }

  return (
    <div className="page-wrap pb-4 sm:pb-6">
      <header className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Produtos</h1>
            <p className="page-subtitle">Cadastro e gerenciamento de produtos.</p>
          </div>
          <button onClick={openNew} className="btn-primary">
            <Plus className="w-4 h-4" /> Novo produto
          </button>
        </div>
      </header>

      {uiError && (
        <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600" />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-sm">{uiError}</div>
          </div>
          <button onClick={() => loadAll()} className="btn-danger !py-2 !px-3 text-xs whitespace-nowrap min-w-fit">
            Tentar novamente
          </button>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-10"
              placeholder="Buscar por nome ou SKU..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="relative">
            <select className="select pr-10 w-full" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="all">Todas as categorias</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select className="select pr-10 w-full" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
              <option value="all">Todos os status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="hidden sm:block">
        <div className="card">
          <div className="table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">Ativo</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>SKU</th>
                  <th className="text-right">Estoque</th>
                  <th className="text-right">Custo atual</th>
                  <th className="text-right">Preço venda</th>
                  <th className="text-right">Markup</th>
                  <th className="text-right">Margem bruta</th>
                  <th className="w-24 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="text-center py-10 text-ink-500">Carregando...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-10 text-ink-500">
                    <Filter className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                    Nenhum produto encontrado.
                  </td></tr>
                ) : filtered.map(p => {
                  const cat = categories.find(c => c.id === p.category_id)
                  const stock = Number(p.available_quantity ?? p.total_stock ?? 0)
                  const min = Number(p.min_stock ?? 0)
                  const custo = Number(p.current_cost ?? 0)
                  const venda = Number(p.sale_price ?? 0)
                  const markup = custo > 0 ? ((venda - custo) / custo) * 100 : 0
                  const margem = venda > 0 ? ((venda - custo) / venda) * 100 : 0
                  const stockCls = stock === 0
                    ? 'bg-rose-50 text-rose-700 ring-rose-200'
                    : stock <= min
                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                    : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  return (
                    <tr key={p.id} className="hover:bg-ink-50/50 transition">
                      <td>
                        <span className={cn('inline-flex w-8 h-8 rounded-lg items-center justify-center ring-1',
                          p.active ? 'bg-emerald-50 ring-emerald-200 text-emerald-700' : 'bg-ink-100 ring-ink-200 text-ink-400')}>
                          {p.active ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                        </span>
                      </td>
                      <td className="font-semibold text-ink-900">{p.name}</td>
                      <td>{cat?.name || <span className="text-ink-400">—</span>}</td>
                      <td className="num text-ink-600">{p.sku || '—'}</td>
                      <td className="text-right">
                        <span className={cn('chip ring-1 num', stockCls)}>{stock} un</span>
                      </td>
                      <td className="text-right num">{formatCurrency(custo)}</td>
                      <td className="text-right num font-bold text-ink-900">{formatCurrency(venda)}</td>
                      <td className={cn('text-right num font-semibold', markup >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                        {formatPercent(markup)}
                      </td>
                      <td className={cn('text-right num font-semibold', margem >= 0 ? 'text-brand-700' : 'text-rose-700')}>
                        {formatPercent(margem)}
                      </td>
                      <td className="text-right">
                        <button onClick={() => openEdit(p.id)} className="btn-ghost !p-2">
                          <Edit className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="sm:hidden flex flex-col gap-3">
        {loading ? (
          <div className="mcard justify-center items-center py-8 text-ink-500">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="mcard justify-center items-center py-8 text-center">
            <Filter className="w-10 h-10 text-ink-300 mb-2" />
            <div className="text-ink-500">Nenhum produto encontrado.</div>
          </div>
        ) : filtered.map(p => {
          const cat = categories.find(c => c.id === p.category_id)
          const stock = Number(p.available_quantity ?? p.total_stock ?? 0)
          const min = Number(p.min_stock ?? 0)
          const custo = Number(p.current_cost ?? 0)
          const venda = Number(p.sale_price ?? 0)
          const markup = custo > 0 ? ((venda - custo) / custo) * 100 : 0
          const margem = venda > 0 ? ((venda - custo) / venda) * 100 : 0
          const stockBadge = stock === 0
            ? <span className="stock-out">{stock} un · Sem estoque</span>
            : stock <= min
            ? <span className="stock-low">{stock} un · Baixo estoque</span>
            : <span className="stock-ok">{stock} un · Em estoque</span>
          return (
            <div key={p.id} className="mcard">
              <div className="mcard-head">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <span className={cn('inline-flex w-8 h-8 rounded-lg items-center justify-center ring-1 flex-shrink-0 mt-0.5',
                      p.active ? 'bg-emerald-50 ring-emerald-200 text-emerald-700' : 'bg-ink-100 ring-ink-200 text-ink-400')}>
                      {p.active ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mcard-title truncate" title={p.name}>{p.name}</div>
                      {cat && <div className="mcard-sub mt-0.5">{cat.name}</div>}
                      {p.sku && <div className="mcard-sub num">SKU: {p.sku}</div>}
                    </div>
                  </div>
                </div>
                <button onClick={() => openEdit(p.id)} className="btn-icon flex-shrink-0" aria-label="Editar">
                  <Edit className="w-4 h-4" />
                </button>
              </div>
              <div className="mcard-meta pt-1">{stockBadge}</div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ink-100">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Preço venda</div>
                  <div className="num font-black text-ink-900 mt-0.5">{formatCurrency(venda)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Custo atual</div>
                  <div className="num font-semibold text-ink-700 mt-0.5">{formatCurrency(custo)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Markup</div>
                  <div className={cn('num font-semibold mt-0.5', markup >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{formatPercent(markup)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Margem</div>
                  <div className={cn('num font-semibold mt-0.5', margem >= 0 ? 'text-brand-700' : 'text-rose-700')}>{formatPercent(margem)}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {modalOpen && (
        <ProductModal
          editingId={editingId}
          products={products}
          categories={categories}
          packaging={packaging}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); loadAll() }}
        />
      )}
    </div>
  )
}

function ProductModal({
  editingId, products, categories, packaging, onClose, onSaved
}: {
  editingId: string | null
  products: Product[] | ProductWithStock[]
  categories: Category[]
  packaging: PackagingType[]
  onClose: () => void
  onSaved: () => void
}) {
  const existing = editingId ? products.find(p => p.id === editingId) : null
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    category_id: existing?.category_id ?? '',
    sku: existing?.sku ?? '',
    current_cost: formatCurrency(existing?.current_cost ?? 0).replace('R$ ', ''),
    sale_price: formatCurrency(existing?.sale_price ?? 0).replace('R$ ', ''),
    default_packaging_type_id: existing?.default_packaging_type_id ?? '',
    min_stock: String(existing?.min_stock ?? 0),
    active: existing?.active ?? true,
    notes: existing?.notes ?? '',
    image_url: existing?.image_url ?? '',
  })
  const [saving, setSaving] = useState(false)

  const custoNum = parseBrl(form.current_cost)
  const vendaNum = parseBrl(form.sale_price)
  const markup = custoNum > 0 ? ((vendaNum - custoNum) / custoNum) * 100 : 0
  const margem = vendaNum > 0 ? ((vendaNum - custoNum) / vendaNum) * 100 : 0
  const precoMin = custoNum * 1.1

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) { alert('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        slug: slugify(form.name),
        category_id: form.category_id || null,
        sku: form.sku.trim() || null,
        current_cost: custoNum,
        sale_price: vendaNum,
        default_packaging_type_id: form.default_packaging_type_id || null,
        min_stock: Number(form.min_stock) || 0,
        active: form.active,
        notes: form.notes.trim() || null,
        image_url: form.image_url.trim() || null,
      }
      if (editingId) await updateProduct(editingId, payload as any)
      else await createProduct(payload as any)
      alert('Produto salvo com sucesso!')
      dispatchInvalidate('products')
      dispatchInvalidate('inventory')
      onSaved()
    } catch (e) {
      console.error(e)
      alert('Erro ao salvar produto.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-shell" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-content modal-wide">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{existing ? 'Editar produto' : 'Novo produto'}</h2>
            <p className="text-xs text-ink-500 mt-0.5">Preencha os campos abaixo.</p>
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="modal-body space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nome *</label>
              <div className="relative">
                <Package className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-10" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Camisa Polo" />
              </div>
            </div>
            <div>
              <label className="label">Categoria</label>
              <div className="relative">
                <Tag className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 z-10" />
                <select className="select pl-10 w-full" value={form.category_id} onChange={e => set('category_id', e.target.value)}>
                  <option value="">Sem categoria</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">SKU</label>
              <div className="relative">
                <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-10" value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="Ex: CAM-POLO-M" />
              </div>
            </div>
            <div>
              <label className="label">Custo atual (R$)</label>
              <input
                className="input num"
                value={form.current_cost}
                onChange={e => set('current_cost', e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="label">Preço de venda (R$)</label>
              <input
                className="input num"
                value={form.sale_price}
                onChange={e => set('sale_price', e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="label">Embalagem padrão</label>
              <div className="relative">
                <Box className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 z-10" />
                <select className="select pl-10 w-full" value={form.default_packaging_type_id} onChange={e => set('default_packaging_type_id', e.target.value)}>
                  <option value="">Sem embalagem padrão</option>
                  {packaging.map(p => <option key={p.id} value={p.id}>{p.name} ({formatCurrency(p.unit_cost)})</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="label">Estoque mínimo</label>
              <input
                className="input num"
                type="number"
                min={0}
                value={form.min_stock}
                onChange={e => set('min_stock', e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">URL da imagem</label>
              <div className="relative">
                <ImageIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  className="input pl-10"
                  value={form.image_url}
                  onChange={e => set('image_url', e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="sm:col-span-2 flex items-center justify-between gap-3 p-3 rounded-lg bg-ink-50 border border-ink-100">
              <div>
                <div className="font-semibold text-sm text-ink-800">Produto ativo</div>
                <div className="text-xs text-ink-500">Desative para ocultar de listagens e vendas.</div>
              </div>
              <button
                type="button"
                onClick={() => set('active', !form.active)}
                className={cn(
                  'relative inline-flex h-8 w-14 items-center rounded-full transition-colors',
                  form.active ? 'bg-brand-900' : 'bg-ink-200'
                )}
              >
                <span className={cn(
                  'inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform',
                  form.active ? 'translate-x-7' : 'translate-x-1'
                )} />
              </button>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Observações</label>
              <textarea
                className="input min-h-[80px]"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Informações adicionais..."
              />
            </div>
          </div>

          <div className="divider-label">Indicadores em tempo real</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-lg bg-brand-50 border border-brand-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Markup %</div>
              <div className={cn('text-xl font-black num mt-1', markup >= 0 ? 'text-brand-900' : 'text-rose-700')}>
                {formatPercent(markup)}
              </div>
              <div className="text-[11px] text-brand-600/80 mt-0.5">sobre o custo</div>
            </div>
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Margem bruta %</div>
              <div className={cn('text-xl font-black num mt-1', margem >= 0 ? 'text-emerald-900' : 'text-rose-700')}>
                {formatPercent(margem)}
              </div>
              <div className="text-[11px] text-emerald-600/80 mt-0.5">sobre a venda</div>
            </div>
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Preço mínimo
              </div>
              <div className="text-xl font-black num mt-1 text-amber-900">
                {formatCurrency(precoMin)}
              </div>
              <div className="text-[11px] text-amber-600/80 mt-0.5">10% acima do custo</div>
            </div>
          </div>
          {vendaNum < precoMin && vendaNum > 0 && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-rose-800">Preço de venda abaixo do mínimo</div>
                <div className="text-[11px] text-rose-700/80 mt-0.5">
                  Venda {formatCurrency(vendaNum)} · Mínimo recomendado {formatCurrency(precoMin)}.
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary">Cancelar</button>
          <button onClick={submit} disabled={saving} className="btn-primary">
            {saving ? 'Salvando...' : 'Salvar produto'}
          </button>
        </div>
      </div>
    </div>
  )
}
