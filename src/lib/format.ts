import { clsx, type ClassValue } from 'clsx'
import { ptBR } from 'date-fns/locale/pt-BR'
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  formatDistanceToNowStrict,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfToday,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns'

export { clsx as cn, type ClassValue }

export function formatCurrency(value: number | bigint | null | undefined): string {
  const v = Number(value ?? 0)
  if (!isFinite(v)) return 'R$ 0,00'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}

export function formatCurrencyNoSymbol(value: number | null | undefined): string {
  const v = Number(value ?? 0)
  if (!isFinite(v)) return '0,00'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  const v = Number(value ?? 0)
  if (!isFinite(v)) return '0%'
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`
}

export function formatDate(d: string | Date | null | undefined, withTime = false): string {
  if (!d) return '-'
  const date = typeof d === 'string' ? parseISO(d.includes('T') ? d : d + 'T00:00:00') : d
  if (!date || isNaN(date.getTime())) return String(d)
  return format(date, withTime ? "dd/MM/yyyy 'às' HH:mm" : 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDateTime(d: string | Date | null | undefined): string {
  return formatDate(d, true)
}

export function formatRelative(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const date = typeof d === 'string' ? parseISO(d.includes('T') ? d : d + 'T00:00:00') : d
  if (!date || isNaN(date.getTime())) return String(d)
  return formatDistanceToNowStrict(date, { locale: ptBR, addSuffix: true })
}

export function formatFriendlyNumber(n: number | null | undefined, digits = 6): string {
  if (n === null || n === undefined) return '-'
  return String(n).padStart(digits, '0')
}

export function parseBrl(v: string | number | null | undefined): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  if (!v) return 0
  const s = String(v).replace(/[^\d,.\-]/g, '')
  if (!s) return 0
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  let normalized: string
  if (hasComma && hasDot) {
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    normalized = s.replace(',', '.')
  } else {
    normalized = s
  }
  const num = Number(normalized)
  return isFinite(num) ? num : 0
}

export function toInputDate(d?: string | Date | null): string {
  if (!d) return format(new Date(), 'yyyy-MM-dd')
  const date = typeof d === 'string' ? parseISO(d.includes('T') ? d : d + 'T00:00:00') : d
  return format(date, 'yyyy-MM-dd')
}

export function rangePresets() {
  const today = startOfToday()
  return {
    HOJE: { label: 'Hoje', from: today, to: today },
    SETE_DIAS: { label: '7 dias', from: subDays(today, 6), to: today },
    ESTE_MES: { label: 'Este mês', from: startOfMonth(today), to: endOfMonth(today) },
    MES_ANTERIOR: { label: 'Mês anterior', from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) },
    ESTA_SEMANA: { label: 'Esta semana', from: startOfWeek(today, { weekStartsOn: 1 }), to: today },
  } as const
}

export function inRange(d: string | Date, from: Date, to: Date): boolean {
  const date = startOfDay(typeof d === 'string' ? parseISO(d.includes('T') ? d : d + 'T00:00:00') : d)
  return (isSameDay(date, from) || isAfter(date, from)) && (isSameDay(date, to) || isBefore(date, to))
}

export function pluralize(n: number, singular: string, plural?: string): string {
  if (n === 1) return `1 ${singular}`
  return `${n} ${plural ?? singular + 's'}`
}

export function sourceLabel(v: string | null | undefined): string {
  switch (v) {
    case 'SITE': return 'Site'
    case 'PRESENCIAL': return 'Presencial'
    case 'DISTANCIA': return 'WhatsApp / Distância'
    case 'OUTRO': return 'Outro'
    default: return v || '-'
  }
}

export function statusLabel(v: string | null | undefined): { label: string; class: string } {
  switch (v) {
    case 'CONCLUIDA':
    case 'CONFIRMADO':
      return { label: 'Concluída', class: 'chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' }
    case 'PENDENTE':
      return { label: 'Pendente', class: 'chip bg-amber-50 text-amber-700 ring-1 ring-amber-200' }
    case 'CANCELADA':
    case 'CANCELADO':
      return { label: 'Cancelada', class: 'chip bg-rose-50 text-rose-700 ring-1 ring-rose-200' }
    case 'ESTORNADA':
      return { label: 'Estornada', class: 'chip bg-purple-50 text-purple-700 ring-1 ring-purple-200' }
    default:
      return { label: v || '-', class: 'chip bg-ink-100 text-ink-600 ring-1 ring-ink-200' }
  }
}

export function paymentMethodLabel(v: string | null | undefined): string {
  switch (v) {
    case 'PIX': return 'Pix'
    case 'CREDITO': return 'Crédito'
    case 'DEBITO': return 'Débito'
    case 'BOLETO': return 'Boleto'
    case 'DINHEIRO': return 'Dinheiro'
    case 'OUTRO': return 'Outro'
    default: return v || '-'
  }
}

export function slugify(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-')
    .slice(0, 80)
}

export {
  addDays, addMonths, endOfMonth, startOfMonth, startOfToday, subDays, subMonths, parseISO, format, startOfWeek, ptBR, isSameDay
}
