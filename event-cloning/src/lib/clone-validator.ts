import type {
  CloneEventOptions,
  Event,
  TicketType,
} from '../types/cloning.types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of clones allowed in a single clone-series request. */
export const MAX_SERIES_CLONES = 100

// ─── validateCloneOptions ─────────────────────────────────────────────────────

/**
 * Validate user-supplied clone options.
 *
 * Returns an array of human-readable error strings. An empty array means the
 * options are valid.
 */
export function validateCloneOptions(
  options: CloneEventOptions,
  now: Date = new Date(),
): string[] {
  const errors: string[] = []

  const { newDateStart, newDateEnd, onSaleAt, offSaleAt } = options

  // newDateStart must be in the future
  if (!(newDateStart instanceof Date) || isNaN(newDateStart.getTime())) {
    errors.push('newDateStart musí být platné datum.')
  } else if (newDateStart <= now) {
    errors.push('newDateStart musí být v budoucnosti.')
  }

  // newDateEnd must be after newDateStart
  if (!(newDateEnd instanceof Date) || isNaN(newDateEnd.getTime())) {
    errors.push('newDateEnd musí být platné datum.')
  } else if (
    newDateStart instanceof Date &&
    !isNaN(newDateStart.getTime()) &&
    newDateEnd <= newDateStart
  ) {
    errors.push('newDateEnd musí být po newDateStart.')
  }

  // onSaleAt / offSaleAt cross-check (only when both present)
  if (
    onSaleAt instanceof Date &&
    !isNaN(onSaleAt.getTime()) &&
    offSaleAt instanceof Date &&
    !isNaN(offSaleAt.getTime()) &&
    offSaleAt <= onSaleAt
  ) {
    errors.push('offSaleAt musí být po onSaleAt.')
  }

  // onSaleAt should not be after event start
  if (
    onSaleAt instanceof Date &&
    !isNaN(onSaleAt.getTime()) &&
    newDateStart instanceof Date &&
    !isNaN(newDateStart.getTime()) &&
    onSaleAt >= newDateStart
  ) {
    errors.push('onSaleAt musí být před začátkem akce (newDateStart).')
  }

  // offSaleAt should not be after event end
  if (
    offSaleAt instanceof Date &&
    !isNaN(offSaleAt.getTime()) &&
    newDateEnd instanceof Date &&
    !isNaN(newDateEnd.getTime()) &&
    offSaleAt > newDateEnd
  ) {
    errors.push('offSaleAt nesmí být po konci akce (newDateEnd).')
  }

  // clonePricingRules without cloneTicketTypes makes no sense
  if (options.clonePricingRules === true && options.cloneTicketTypes === false) {
    errors.push(
      'clonePricingRules nelze nastavit na true pokud cloneTicketTypes je false.',
    )
  }

  // newTitle must not be blank if supplied
  if (options.newTitle !== undefined && options.newTitle.trim().length === 0) {
    errors.push('newTitle nesmí být prázdný řetězec.')
  }

  return errors
}

// ─── validateSeriesDates ──────────────────────────────────────────────────────

/**
 * Validate the `dates` array for a clone-series request.
 *
 * Returns an array of error strings. An empty array means all dates are valid.
 */
export function validateSeriesDates(
  dates: Array<{ dateStart: Date; dateEnd: Date }>,
  now: Date = new Date(),
): string[] {
  const errors: string[] = []

  if (!Array.isArray(dates) || dates.length === 0) {
    errors.push('dates musí být neprázdné pole.')
    return errors
  }

  if (dates.length > MAX_SERIES_CLONES) {
    errors.push(
      `Maximální počet klonů najednou je ${MAX_SERIES_CLONES}. Zadáno: ${dates.length}.`,
    )
  }

  dates.forEach(({ dateStart, dateEnd }, index) => {
    const prefix = `dates[${index}]:`

    if (!(dateStart instanceof Date) || isNaN(dateStart.getTime())) {
      errors.push(`${prefix} dateStart musí být platné datum.`)
    } else if (dateStart <= now) {
      errors.push(`${prefix} dateStart musí být v budoucnosti.`)
    }

    if (!(dateEnd instanceof Date) || isNaN(dateEnd.getTime())) {
      errors.push(`${prefix} dateEnd musí být platné datum.`)
    } else if (
      dateStart instanceof Date &&
      !isNaN(dateStart.getTime()) &&
      dateEnd <= dateStart
    ) {
      errors.push(`${prefix} dateEnd musí být po dateStart.`)
    }
  })

  return errors
}

// ─── sanitizeClonedEvent ──────────────────────────────────────────────────────

/**
 * Produce the INSERT payload for the new cloned event.
 *
 * Fields that must NOT be copied (transactional data, status, dates) are either
 * reset to their defaults or taken from `options`.
 */
export function sanitizeClonedEvent(
  original: Event,
  options: CloneEventOptions,
): Omit<Event, 'id' | 'created_at' | 'updated_at'> {
  const title =
    options.newTitle?.trim() !== undefined && options.newTitle.trim() !== ''
      ? options.newTitle.trim()
      : `${original.title} (kopie)`

  return {
    // Identity / ownership — keep from original
    organizer_id: original.organizer_id,
    venue_id: original.venue_id,

    // Descriptive fields — keep from original
    description: original.description,
    category: original.category,
    subcategory: original.subcategory,
    image_url: original.image_url,
    capacity: original.capacity,
    tags: [...(original.tags ?? [])],
    metadata: original.metadata ? { ...original.metadata } : null,

    // Access & resale settings — keep from original
    resale_allowed: original.resale_allowed,
    resale_commission_rate: original.resale_commission_rate,
    re_entry_allowed: original.re_entry_allowed,
    zone_access_rules: original.zone_access_rules
      ? { ...original.zone_access_rules }
      : null,

    // ── Fields that MUST be reset / overridden ───────────────────────────────

    title,

    // New dates from options
    date_start: options.newDateStart,
    date_end: options.newDateEnd,

    // Always start as draft — organiser publishes after reviewing
    status: 'draft',

    // Sale window from options or null (organiser will set)
    on_sale_at: options.onSaleAt ?? null,
    off_sale_at: options.offSaleAt ?? null,
  }
}

// ─── sanitizeClonedTicketType ─────────────────────────────────────────────────

/**
 * Produce the INSERT payload for one cloned ticket type.
 *
 * `event_id` is intentionally left out — the caller must set it to the new
 * event's ID before inserting.
 */
export function sanitizeClonedTicketType(
  original: TicketType,
): Omit<TicketType, 'id' | 'event_id' | 'created_at' | 'updated_at'> {
  return {
    name: original.name,
    kind: original.kind,
    base_price: original.base_price,
    total_qty: original.total_qty,
    // Reset: all seats/tickets become available again
    remaining_qty: original.total_qty,
    max_per_user: original.max_per_user,
    // Reset sale window — organiser sets these after cloning
    sale_start_at: null,
    sale_end_at: null,
    zone_id: original.zone_id,
    is_active: original.is_active,
  }
}

// ─── generateCloneWarnings ────────────────────────────────────────────────────

/**
 * Produce human-readable warnings that the organiser should review after a
 * clone operation.  These are non-fatal notices, not errors.
 */
export function generateCloneWarnings(
  original: Event,
  options: CloneEventOptions,
  now: Date = new Date(),
): string[] {
  const warnings: string[] = []

  // on_sale_at from original was in the past — the clone resets it
  if (original.on_sale_at !== null && original.on_sale_at < now) {
    warnings.push(
      `Původní on_sale_at (${original.on_sale_at.toISOString()}) bylo v minulosti — resetováno na null. Nastavte nové datum zahájení prodeje.`,
    )
  }

  // off_sale_at from original was in the past
  if (original.off_sale_at !== null && original.off_sale_at < now) {
    warnings.push(
      `Původní off_sale_at (${original.off_sale_at.toISOString()}) bylo v minulosti — resetováno na null. Nastavte nové datum ukončení prodeje.`,
    )
  }

  // on_sale_at supplied by organiser but it is already in the past
  if (
    options.onSaleAt !== undefined &&
    options.onSaleAt instanceof Date &&
    !isNaN(options.onSaleAt.getTime()) &&
    options.onSaleAt < now
  ) {
    warnings.push(
      `Zadané onSaleAt (${options.onSaleAt.toISOString()}) je v minulosti — zvažte nastavení platného data.`,
    )
  }

  // Pricing rules were reset
  if (options.resetPricing === true) {
    warnings.push(
      'resetPricing=true: cenové pravidla (pricing rules) nebyly zklonovány. Zkontrolujte a nastavte nová pravidla.',
    )
  }

  // Ticket types were not cloned
  if (options.cloneTicketTypes === false) {
    warnings.push(
      'cloneTicketTypes=false: typy vstupenek nebyly zklonovány. Nová akce nemá žádné typy vstupenek.',
    )
  }

  // Original event was not in a stable state
  if (original.status === 'cancelled') {
    warnings.push(
      'Původní akce byla zrušena (cancelled). Zkontrolujte, zda je klonování záměrné.',
    )
  }

  if (original.status === 'postponed') {
    warnings.push(
      'Původní akce byla odložena (postponed). Zkontrolujte detaily před publikací.',
    )
  }

  return warnings
}
