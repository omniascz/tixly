// email-copy/subject-line-helpers.ts

import { SubjectLineVariant, CampaignSubjectLines } from './subject-lines'

/**
 * Nahradí {{variable}} skutečnými hodnotami
 * Chybějící proměnné jsou nahrazeny prázdným stringem
 * Nemutuje input variant
 */
export function renderSubjectLine(
  variant: SubjectLineVariant,
  variables: Record<string, string>
): string {
  let rendered = variant.text

  // Najde všechny {{variable}} patterns a nahradí je
  const regex = /\{\{(\w+)\}\}/g
  rendered = rendered.replace(regex, (match, key) => {
    return variables[key] ?? ''
  })

  return rendered
}

/**
 * Vybere variantu pro A/B test deterministicky dle userId
 * Stejné userId vždy vrátí stejnou variantu
 * Distribuce je rovnoměrná pro různé userId
 */
export function selectVariantForUser(
  campaign: CampaignSubjectLines,
  locale: 'cs' | 'en',
  userId: string
): SubjectLineVariant {
  const variants = campaign[locale]

  if (variants.length === 0) {
    throw new Error(`No variants available for locale: ${locale}`)
  }

  // Vytvoří deterministický hash z userId
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }

  // Vybere variantu indexem
  const index = Math.abs(hash) % variants.length
  return variants[index]
}

/**
 * Validuje délku rendered subject line (ne template)
 * short: ≤35, medium: 36-55, long: 56-70, too_long: >70
 */
export function validateLength(rendered: string): 'short' | 'medium' | 'long' | 'too_long' {
  const length = rendered.length

  if (length <= 35) {
    return 'short'
  } else if (length <= 55) {
    return 'medium'
  } else if (length <= 70) {
    return 'long'
  } else {
    return 'too_long'
  }
}

/**
 * Vrátí všechny varianty pro daný přístup (pro reporting/debugging)
 * Prochází zadanou lokalizaci a filtruje dle approach
 */
export function getVariantsByApproach(
  campaign: CampaignSubjectLines,
  locale: 'cs' | 'en',
  approach: string
): SubjectLineVariant[] {
  return campaign[locale].filter((variant) => variant.approach === approach)
}

/**
 * Helper: validuje template variantu (ne rendered text)
 * Vrací seznam chyb, prázdné pole = validní
 * Používá se v testech a validaci dat
 */
export function validateVariantTemplate(variant: SubjectLineVariant): string[] {
  const errors: string[] = []
  const length = variant.text.length

  // Check délka template (ne rendered)
  if (variant.length === 'short' && length > 35) {
    errors.push(`Short variant too long: ${length} > 35`)
  } else if (variant.length === 'medium' && (length <= 35 || length > 55)) {
    errors.push(`Medium variant length invalid: ${length} not in 36-55`)
  } else if (variant.length === 'long' && (length <= 55 || length > 70)) {
    errors.push(`Long variant length invalid: ${length} not in 56-70`)
  }

  // Check emoji flag
  const hasEmojiInText = /\p{Emoji}/u.test(variant.text)
  if (hasEmojiInText !== variant.hasEmoji) {
    errors.push(`hasEmoji mismatch: flag is ${variant.hasEmoji}, text contains ${hasEmojiInText ? 'emoji' : 'no emoji'}`)
  }

  return errors
}

/**
 * Helper: validuje kompletní kampaň
 * Vrací seznam chyb, prázdné pole = validní
 */
export function validateCampaign(campaign: CampaignSubjectLines): string[] {
  const errors: string[] = []

  // Ověří počet variant
  if (campaign.cs.length !== 10) {
    errors.push(`CS variants: expected 10, got ${campaign.cs.length}`)
  }
  if (campaign.en.length !== 10) {
    errors.push(`EN variants: expected 10, got ${campaign.en.length}`)
  }

  // Ověří délku distribution pro CS
  const csLengths = {
    short: campaign.cs.filter((v) => v.length === 'short').length,
    medium: campaign.cs.filter((v) => v.length === 'medium').length,
    long: campaign.cs.filter((v) => v.length === 'long').length,
  }

  if (csLengths.short < 3) {
    errors.push(`CS short variants: expected min 3, got ${csLengths.short}`)
  }
  if (csLengths.medium < 4) {
    errors.push(`CS medium variants: expected min 4, got ${csLengths.medium}`)
  }
  if (csLengths.long < 3) {
    errors.push(`CS long variants: expected min 3, got ${csLengths.long}`)
  }

  // Ověří délku distribution pro EN
  const enLengths = {
    short: campaign.en.filter((v) => v.length === 'short').length,
    medium: campaign.en.filter((v) => v.length === 'medium').length,
    long: campaign.en.filter((v) => v.length === 'long').length,
  }

  if (enLengths.short < 3) {
    errors.push(`EN short variants: expected min 3, got ${enLengths.short}`)
  }
  if (enLengths.medium < 4) {
    errors.push(`EN medium variants: expected min 4, got ${enLengths.medium}`)
  }
  if (enLengths.long < 3) {
    errors.push(`EN long variants: expected min 3, got ${enLengths.long}`)
  }

  // Ověří délku jednotlivých variant (template)
  const allVariants = [...campaign.cs, ...campaign.en]
  allVariants.forEach((variant, index) => {
    const variantErrors = validateVariantTemplate(variant)
    variantErrors.forEach((error) => {
      errors.push(`Variant ${index}: ${error}`)
    })
  })

  // Ověří žádný variant nepřesahuje 70 znaků (template délka)
  allVariants.forEach((variant, index) => {
    if (variant.text.length > 70) {
      errors.push(`Variant ${index} exceeds 70 chars: "${variant.text}" (${variant.text.length})`)
    }
  })

  return errors
}
