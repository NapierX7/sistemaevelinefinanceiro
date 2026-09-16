import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import {
  signInAdmin as signIn,
  signOutAdmin as signOut,
  supabase,
  isSupabaseConfigured,
  DEMO_EMAIL,
  DEMO_PASSWORD,
} from '@/lib/supabase'
import { getCurrentUserEmail, getCurrentUserId } from '@/lib/supabase'

interface AuthContextValue {
  user: { id: string; email?: string | null; role: string } | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<{ error?: string | null }>
  signOut: () => Promise<void>
  isDemo: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthContextValue['user']>(null)
  const [isLoading, setIsLoading] = useState(true)

  const syncSession = useCallback(async () => {
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.auth.getSession()
      const s = data.session
      if (s?.user) {
        setUser({ id: s.user.id, email: s.user.email ?? null, role: 'admin' })
      } else {
        setUser(null)
      }
    } else {
      const id = getCurrentUserId()
      const email = getCurrentUserEmail()
      if (id) setUser({ id, email, role: 'admin' })
      else setUser(null)
    }
  }, [])

  useEffect(() => {
    syncSession().finally(() => setIsLoading(false))
    if (isSupabaseConfigured && supabase) {
      const { data } = supabase.auth.onAuthStateChange(() => { syncSession() })
      return () => data.subscription.unsubscribe()
    }
  }, [syncSession])

  const doSignIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await signIn(email.trim(), password)
    if (error) return { error: error.message }
    await syncSession()
    return { error: null }
  }

  const doSignOut: AuthContextValue['signOut'] = async () => {
    await signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{
      user, isLoading, signIn: doSignIn, signOut: doSignOut,
      isDemo: !isSupabaseConfigured,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}

export { DEMO_EMAIL, DEMO_PASSWORD }
