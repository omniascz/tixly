import type { WillCallEntry } from '../types/will-call.types'

export function isWithinPickupWindow(entry: WillCallEntry, now: Date): boolean {
  if (entry.pickup_window_start === null && entry.pickup_window_end === null) {
    return true
  }
  if (entry.pickup_window_start !== null && now < entry.pickup_window_start) {
    return false
  }
  if (entry.pickup_window_end !== null && now > entry.pickup_window_end) {
    return false
  }
  return true
}

export function canPickUp(
  entry: WillCallEntry,
  now: Date,
): { allowed: boolean; reason?: string } {
  if (entry.status === 'picked_up') {
    return { allowed: false, reason: 'already_picked_up' }
  }
  if (entry.status === 'forfeited') {
    return { allowed: false, reason: 'forfeited' }
  }
  if (!isWithinPickupWindow(entry, now)) {
    return { allowed: false, reason: 'window_closed' }
  }
  return { allowed: true }
}

export function shouldForfeiture(entry: WillCallEntry, now: Date): boolean {
  if (entry.status !== 'ready_for_pickup') {
    return false
  }
  if (entry.pickup_window_end === null) {
    return false
  }
  return now > entry.pickup_window_end
}

const CS_SINGULAR = 'vstupenka'
const CS_FEW = 'vstupenky' // 2–4
const CS_MANY = 'vstupenek' // 5+

function csCopies(n: number): string {
  if (n === 1) return `${n}× ${CS_SINGULAR}`
  if (n >= 2 && n <= 4) return `${n}× ${CS_FEW}`
  return `${n}× ${CS_MANY}`
}

function enCopies(n: number): string {
  return n === 1 ? `1 ticket` : `${n} tickets`
}

function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function formatPickupConfirmation(
  entry: WillCallEntry,
  lang: 'cs' | 'en',
): string {
  const time = entry.picked_up_at ? formatTime(entry.picked_up_at) : formatTime(new Date())

  if (lang === 'cs') {
    return `Vstupenka vydána: ${entry.holder_name} (${csCopies(entry.quantity)} ${entry.ticket_type_name}) — ${time}`
  }
  return `Ticket issued: ${entry.holder_name} (${enCopies(entry.quantity)} ${entry.ticket_type_name}) — ${time}`
}

const DIACRITIC_MAP: Record<string, string> = {
  á: 'a', č: 'c', ď: 'd', é: 'e', ě: 'e', í: 'i', ň: 'n',
  ó: 'o', ř: 'r', š: 's', ť: 't', ú: 'u', ů: 'u', ý: 'y', ž: 'z',
  Á: 'a', Č: 'c', Ď: 'd', É: 'e', Ě: 'e', Í: 'i', Ň: 'n',
  Ó: 'o', Ř: 'r', Š: 's', Ť: 't', Ú: 'u', Ů: 'u', Ý: 'y', Ž: 'z',
}

export function normalizeSearchQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, (ch) => DIACRITIC_MAP[ch] ?? ch)
}
