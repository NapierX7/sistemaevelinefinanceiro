import { FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, KeyRound, LogIn, Mail, ShieldCheck, UserRound,
} from 'lucide-react'
import { useAuth, DEMO_EMAIL, DEMO_PASSWORD } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'

export default function LoginPage() {
  const { signIn, user, isDemo } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state: { from?: string } | null }
  const from = location.state?.from ?? '/dashboard'

  useEffect(() => {
    if (user) navigate(from, { replace: true })
  }, [user, navigate, from])

  const [form, setForm] = useState({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await signIn(form.email, form.password)
    setSubmitting(false)
    if (error) setError(error)
    else navigate(from, { replace: true })
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-ink-50 via-white to-ink-100 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-900 shadow-panel text-white">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Eveline Gestão</h1>
          <p className="mt-1.5 text-sm text-ink-500">Sistema de Estoque, Vendas e Financeiro</p>
        </div>

        <div className="card shadow-panel p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            {isDemo ? (
              <>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="text-xs leading-5 text-amber-800">
                  <p className="font-bold uppercase tracking-wider">Modo Demonstração Local</p>
                  <p>
                    Configure <code className="font-mono text-[11px] bg-amber-100 px-1 rounded">.env</code> com as chaves do Supabase para conectar ao banco.
                    <br />Por enquanto, use: <strong>admin@evelinegestao.com.br</strong> / <strong>admin123</strong>
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="text-xs leading-5 text-emerald-800">
                  <p className="font-bold uppercase tracking-wider">Conectado ao Supabase</p>
                  <p>Seus dados são salvos no banco com RLS habilitado.</p>
                </div>
              </>
            )}
          </div>

          <form onSubmit={onSubmit} className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="label inline-flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-brand-700" /> E-mail
              </span>
              <input
                type="email" required autoComplete="email"
                className="input" placeholder="voce@eveline.com.br"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="label inline-flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-brand-700" /> Senha
              </span>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'} required
                  autoComplete="current-password" className="input pr-11"
                  placeholder="Mínimo 6 caracteres"
                  value={form.password}
                  onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                />
                <button
                  type="button" onClick={() => setShowPwd(v => !v)}
                  className="absolute inset-y-0 right-0 grid h-full w-11 place-items-center text-ink-400 hover:text-ink-700"
                  aria-label={showPwd ? 'Esconder senha' : 'Mostrar senha'}
                >
                  {showPwd ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </label>

            {error && (
              <div className="rounded-card border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-5 text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={submitting}
              className="btn-primary btn-block mt-1 h-12 rounded-card text-base"
            >
              <LogIn className="h-4.5 w-4.5" />
              {submitting ? 'Entrando…' : 'Entrar no sistema'}
            </button>

            <p className="pt-1 text-center text-[11px] leading-5 text-ink-400">
              {!isDemo && <>Não tem conta? Peça a um administrador para criar seu usuário no Supabase Auth.</>}
              {isDemo && <>Demonstração: dados armazenados apenas neste navegador.</>}
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
