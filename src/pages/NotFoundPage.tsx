import { Link } from 'react-router-dom'
import { Home, SearchX } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center py-16">
      <div className="w-20 h-20 rounded-2xl bg-ink-100 flex items-center justify-center mb-6">
        <SearchX className="w-10 h-10 text-ink-400" />
      </div>
      <h1 className="text-4xl font-black text-ink-900 tracking-tight mb-2">404</h1>
      <p className="text-lg font-semibold text-ink-700 mb-1">Página não encontrada</p>
      <p className="text-sm text-ink-500 max-w-sm mb-8">
        A página que você tentou acessar não existe ou foi movida.
      </p>
      <Link to="/dashboard" className="btn-primary">
        <Home className="w-4 h-4" />
        Voltar para o Dashboard
      </Link>
    </div>
  )
}
