/// <reference types="vite/client" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseUrl.trim().length > 0 && !supabaseUrl.startsWith('your_')
    && supabaseAnonKey && supabaseAnonKey.trim().length > 0 && !supabaseAnonKey.startsWith('your_')
)

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export const DEMO_EMAIL = 'admin@evelinegestao.com.br'
export const DEMO_PASSWORD = 'admin123'

let demoMode = false
let demoUser: { id: string; email: string; role: string } | null = null

try {
  const raw = localStorage.getItem('eg_demo')
  if (raw) {
    const o = JSON.parse(raw)
    if (o && o.id && o.email && o.role) {
      demoMode = true
      demoUser = { id: o.id, email: o.email, role: o.role }
    }
  }
} catch {}

export function isDemoMode() {
  return demoMode
}
export function getDemoUser() {
  return demoUser
}

export async function signInAdmin(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!supabase) {
    if (normalizedEmail === DEMO_EMAIL && password === DEMO_PASSWORD) {
      demoMode = true
      demoUser = { id: 'demo-user-001', email: DEMO_EMAIL, role: 'admin' }
      localStorage.setItem('eg_demo', JSON.stringify({ id: demoUser.id, email: demoUser.email, role: demoUser.role, t: Date.now() }))
      return { error: null }
    }
    return { error: { message: 'Configure as variáveis VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY no .env, ou use admin@evelinegestao.com.br / admin123 para demonstração local.' } }
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
  if (error || !data.user) return { error: { message: 'E-mail ou senha inválidos.' } }
  try {
    const { data: roleData }: any = await (supabase as any).rpc('get_admin_role', { p_user_id: data.user.id })
    const role = String(roleData ?? 'admin').trim().toLowerCase()
    if (role !== 'admin' && role !== 'owner' && role !== 'staff') {
      await supabase.auth.signOut()
      return { error: { message: 'Esta conta não tem permissão de administradora.' } }
    }
  } catch {}
  return { error: null }
}

export async function signOutAdmin() {
  if (supabase) await supabase.auth.signOut()
  demoMode = false
  demoUser = null
  try { localStorage.removeItem('eg_demo') } catch {}
}

export function getCurrentUserId(): string | null {
  if (demoUser) return demoUser.id
  if (supabase) return (supabase.auth as any).currentUser?.id ?? null
  try {
    const raw = localStorage.getItem('eg_demo')
    if (raw) { const o = JSON.parse(raw); demoUser = { id: o.id, email: o.email, role: o.role }; demoMode = true; return o.id }
  } catch {}
  return null
}

export function getCurrentUserEmail(): string | null {
  if (demoUser) return demoUser.email
  if (supabase) return (supabase.auth as any).currentUser?.email ?? null
  try {
    const raw = localStorage.getItem('eg_demo')
    if (raw) { const o = JSON.parse(raw); demoUser = { id: o.id, email: o.email, role: o.role }; demoMode = true; return o.email }
  } catch {}
  return null
}
