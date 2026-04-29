// email-copy/subject-line-helpers.test.ts

import { describe, it, expect } from 'vitest'
import {
  renderSubjectLine,
  selectVariantForUser,
  validateLength,
  getVariantsByApproach,
  validateVariantTemplate,
  validateCampaign,
} from './subject-line-helpers'
import { subjectLines } from './subject-lines'

// ============================================================================
// renderSubjectLine testy
// ============================================================================

describe('renderSubjectLine', () => {
  it('should replace all variables with provided values', () => {
    const variant = {
      text: '{{eventName}} — {{eventDate}}',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const result = renderSubjectLine(variant, {
      eventName: 'Kabát',
      eventDate: '15. dubna',
    })

    expect(result).toBe('Kabát — 15. dubna')
  })

  it('should replace variables case-sensitively', () => {
    const variant = {
      text: '{{EventName}} vs {{eventname}}',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const result = renderSubjectLine(variant, {
      EventName: 'Kabát',
      eventname: 'concert',
    })

    expect(result).toBe('Kabát vs concert')
  })

  it('should replace missing variables with empty string', () => {
    const variant = {
      text: '{{eventName}} — {{missingVar}} — done',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const result = renderSubjectLine(variant, {
      eventName: 'Kabát',
    })

    expect(result).toBe('Kabát —  — done')
  })

  it('should handle multiple occurrences of same variable', () => {
    const variant = {
      text: '{{eventName}} loves {{eventName}}',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const result = renderSubjectLine(variant, {
      eventName: 'Kabát',
    })

    expect(result).toBe('Kabát loves Kabát')
  })

  it('should not mutate input variant', () => {
    const variant = {
      text: '{{eventName}} — fixed',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }
    const originalText = variant.text

    renderSubjectLine(variant, { eventName: 'Kabát' })

    expect(variant.text).toBe(originalText)
  })

  it('should return original text if no variables provided', () => {
    const variant = {
      text: 'No variables here',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const result = renderSubjectLine(variant, {})

    expect(result).toBe('No variables here')
  })

  it('should handle numeric variable values', () => {
    const variant = {
      text: 'Order #{{orderNumber}}',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const result = renderSubjectLine(variant, {
      orderNumber: '12345',
    })

    expect(result).toBe('Order #12345')
  })

  it('should handle empty variables object', () => {
    const variant = {
      text: '{{eventName}}',
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const result = renderSubjectLine(variant, {})

    expect(result).toBe('')
  })
})

// ============================================================================
// selectVariantForUser testy
// ============================================================================

describe('selectVariantForUser', () => {
  it('should return same variant for same userId (deterministic)', () => {
    const campaign = subjectLines.orderConfirmation
    const userId = 'user-123'

    const variant1 = selectVariantForUser(campaign, 'cs', userId)
    const variant2 = selectVariantForUser(campaign, 'cs', userId)

    expect(variant1).toBe(variant2)
  })

  it('should return different variants for different userIds (usually)', () => {
    const campaign = subjectLines.orderConfirmation
    const variants = new Set()

    // Generuje několik variant pro různé userIds
    for (let i = 0; i < 50; i++) {
      const variant = selectVariantForUser(campaign, 'cs', `user-${i}`)
      variants.add(variant.text)
    }

    // Měly by být vidět alespoň 3 různé varianty z 10
    expect(variants.size).toBeGreaterThanOrEqual(3)
  })

  it('should work for both locales independently', () => {
    const campaign = subjectLines.orderConfirmation
    const userId = 'user-test'

    const csVariant = selectVariantForUser(campaign, 'cs', userId)
    const enVariant = selectVariantForUser(campaign, 'en', userId)

    // Mohou být stejný approach, ale text by měl být jiný
    expect(csVariant.text).not.toBe(enVariant.text)
  })

  it('should throw for empty campaign', () => {
    const campaign = {
      cs: [],
      en: [],
      variables: [],
    }

    expect(() => {
      selectVariantForUser(campaign, 'cs', 'user-123')
    }).toThrow()
  })

  it('should distribute evenly across all variants', () => {
    const campaign = subjectLines.orderConfirmation
    const distribution: Record<string, number> = {}

    // Vybere 1000 variant a spočítá distribuci
    for (let i = 0; i < 1000; i++) {
      const variant = selectVariantForUser(campaign, 'cs', `user-${i}`)
      distribution[variant.text] = (distribution[variant.text] || 0) + 1
    }

    // Každá varianta by měla být vybrána alespoň ~100 krát (1000 / 10)
    Object.values(distribution).forEach((count) => {
      expect(count).toBeGreaterThan(50) // Allow some variance
      expect(count).toBeLessThan(200)
    })
  })
})

// ============================================================================
// validateLength testy
// ============================================================================

describe('validateLength', () => {
  it('should return short for 35 chars', () => {
    const text = 'a'.repeat(35)
    expect(validateLength(text)).toBe('short')
  })

  it('should return medium for 36 chars', () => {
    const text = 'a'.repeat(36)
    expect(validateLength(text)).toBe('medium')
  })

  it('should return medium for 55 chars', () => {
    const text = 'a'.repeat(55)
    expect(validateLength(text)).toBe('medium')
  })

  it('should return long for 56 chars', () => {
    const text = 'a'.repeat(56)
    expect(validateLength(text)).toBe('long')
  })

  it('should return long for 70 chars', () => {
    const text = 'a'.repeat(70)
    expect(validateLength(text)).toBe('long')
  })

  it('should return too_long for 71 chars', () => {
    const text = 'a'.repeat(71)
    expect(validateLength(text)).toBe('too_long')
  })

  it('should return too_long for 100 chars', () => {
    const text = 'a'.repeat(100)
    expect(validateLength(text)).toBe('too_long')
  })

  it('should handle 0 chars as short', () => {
    expect(validateLength('')).toBe('short')
  })

  it('should handle emoji in length calculation', () => {
    // Emoji je typicky 2 znaky
    const text = '🎉' + 'a'.repeat(33)
    const length = validateLength(text)
    expect(length).toBe('short')
  })
})

// ============================================================================
// getVariantsByApproach testy
// ============================================================================

describe('getVariantsByApproach', () => {
  it('should return variants matching approach', () => {
    const campaign = subjectLines.orderConfirmation
    const variants = getVariantsByApproach(campaign, 'cs', 'Emoji + název akce')

    expect(variants.length).toBeGreaterThan(0)
    variants.forEach((v) => {
      expect(v.approach).toBe('Emoji + název akce')
    })
  })

  it('should return empty array for non-existent approach', () => {
    const campaign = subjectLines.orderConfirmation
    const variants = getVariantsByApproach(campaign, 'cs', 'non-existent approach')

    expect(variants).toEqual([])
  })

  it('should work for both locales independently', () => {
    const campaign = subjectLines.orderConfirmation

    const csVariants = getVariantsByApproach(campaign, 'cs', 'Emoji + název akce')
    const enVariants = getVariantsByApproach(campaign, 'en', 'Emoji + název akce')

    expect(csVariants.length).toBeGreaterThan(0)
    expect(enVariants.length).toBeGreaterThan(0)

    // Text by měl být jiný
    expect(csVariants[0].text).not.toBe(enVariants[0].text)
  })
})

// ============================================================================
// validateVariantTemplate testy
// ============================================================================

describe('validateVariantTemplate', () => {
  it('should return empty array for valid short variant', () => {
    const variant = {
      text: 'a'.repeat(35),
      length: 'short' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const errors = validateVariantTemplate(variant)
    expect(errors).toEqual([])
  })

  it('should return empty array for valid medium variant', () => {
    const variant = {
      text: 'a'.repeat(45),
      length: 'medium' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const errors = validateVariantTemplate(variant)
    expect(errors).toEqual([])
  })

  it('should return empty array for valid long variant', () => {
    const variant = {
      text: 'a'.repeat(65),
      length: 'long' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const errors = validateVariantTemplate(variant)
    expect(errors).toEqual([])
  })

  it('should error if short variant is too long', () => {
    const variant = {
      text: 'a'.repeat(36),
      length: 'short' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const errors = validateVariantTemplate(variant)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('Short variant too long')
  })

  it('should error if emoji flag mismatch', () => {
    const variant = {
      text: '🎉 test',
      length: 'short' as const,
      approach: 'test',
      hasEmoji: false, // Wrong flag
    }

    const errors = validateVariantTemplate(variant)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('should validate emoji flag correctly when true', () => {
    const variant = {
      text: '🎉 test',
      length: 'short' as const,
      approach: 'test',
      hasEmoji: true,
    }

    const errors = validateVariantTemplate(variant)
    expect(errors).toEqual([])
  })

  it('should validate emoji flag correctly when false', () => {
    const variant = {
      text: 'no emoji here',
      length: 'short' as const,
      approach: 'test',
      hasEmoji: false,
    }

    const errors = validateVariantTemplate(variant)
    expect(errors).toEqual([])
  })
})

// ============================================================================
// validateCampaign testy
// ============================================================================

describe('validateCampaign', () => {
  it('should pass for valid campaign', () => {
    const campaign = subjectLines.orderConfirmation
    const errors = validateCampaign(campaign)

    expect(errors).toEqual([])
  })

  it('should error if not 10 CS variants', () => {
    const campaign = {
      cs: subjectLines.orderConfirmation.cs.slice(0, 5),
      en: subjectLines.orderConfirmation.en,
      variables: [],
    }

    const errors = validateCampaign(campaign)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('CS variants'))).toBe(true)
  })

  it('should error if not 10 EN variants', () => {
    const campaign = {
      cs: subjectLines.orderConfirmation.cs,
      en: subjectLines.orderConfirmation.en.slice(0, 5),
      variables: [],
    }

    const errors = validateCampaign(campaign)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('EN variants'))).toBe(true)
  })

  it('should error if short variants < 3', () => {
    const campaign = {
      cs: subjectLines.orderConfirmation.cs.map((v, i) => ({
        ...v,
        length: i < 2 ? ('short' as const) : ('medium' as const),
      })),
      en: subjectLines.orderConfirmation.en,
      variables: [],
    }

    const errors = validateCampaign(campaign)
    expect(errors.some((e) => e.includes('CS short variants'))).toBe(true)
  })

  it('should pass for all campaigns', () => {
    Object.entries(subjectLines).forEach(([name, campaign]) => {
      const errors = validateCampaign(campaign)
      expect(errors).toEqual([], `Campaign ${name} should be valid`)
    })
  })

  it('should verify each campaign has exactly 10 CS and 10 EN', () => {
    Object.entries(subjectLines).forEach(([name, campaign]) => {
      expect(campaign.cs.length).toBe(10, `${name} CS variants`)
      expect(campaign.en.length).toBe(10, `${name} EN variants`)
    })
  })

  it('should verify distribution of lengths (min 3 short, 4 medium, 3 long)', () => {
    Object.entries(subjectLines).forEach(([name, campaign]) => {
      const csShort = campaign.cs.filter((v) => v.length === 'short').length
      const csMedium = campaign.cs.filter((v) => v.length === 'medium').length
      const csLong = campaign.cs.filter((v) => v.length === 'long').length

      expect(csShort).toBeGreaterThanOrEqual(3, `${name} CS short`)
      expect(csMedium).toBeGreaterThanOrEqual(4, `${name} CS medium`)
      expect(csLong).toBeGreaterThanOrEqual(3, `${name} CS long`)

      const enShort = campaign.en.filter((v) => v.length === 'short').length
      const enMedium = campaign.en.filter((v) => v.length === 'medium').length
      const enLong = campaign.en.filter((v) => v.length === 'long').length

      expect(enShort).toBeGreaterThanOrEqual(3, `${name} EN short`)
      expect(enMedium).toBeGreaterThanOrEqual(4, `${name} EN medium`)
      expect(enLong).toBeGreaterThanOrEqual(3, `${name} EN long`)
    })
  })

  it('should verify no variant exceeds 70 chars', () => {
    Object.entries(subjectLines).forEach(([name, campaign]) => {
      const all = [...campaign.cs, ...campaign.en]
      all.forEach((variant, idx) => {
        expect(variant.text.length).toBeLessThanOrEqual(
          70,
          `${name} variant ${idx} exceeds 70 chars`
        )
      })
    })
  })

  it('should verify hasEmoji flag matches text content', () => {
    Object.entries(subjectLines).forEach(([name, campaign]) => {
      const all = [...campaign.cs, ...campaign.en]
      all.forEach((variant, idx) => {
        const hasEmoji = /\p{Emoji}/u.test(variant.text)
        expect(hasEmoji).toBe(
          variant.hasEmoji,
          `${name} variant ${idx} emoji flag mismatch`
        )
      })
    })
  })
})

// ============================================================================
// Integration testy
// ============================================================================

describe('Integration tests', () => {
  it('should render orderConfirmation variant successfully', () => {
    const campaign = subjectLines.orderConfirmation
    const variant = campaign.cs[0]

    const rendered = renderSubjectLine(variant, {
      eventName: 'Kabát — O2 Arena Praha',
      eventDate: '15. dubna',
      orderNumber: '12345',
    })

    expect(rendered).toContain('Kabát')
    const length = validateLength(rendered)
    expect(['short', 'medium', 'long']).toContain(length)
  })

  it('should render reminder48h variant successfully', () => {
    const campaign = subjectLines.reminder48h
    const variant = selectVariantForUser(campaign, 'cs', 'user-123')

    const rendered = renderSubjectLine(variant, {
      eventName: 'Kabát',
      eventDate: '15. dubna',
      venueName: 'O2 Arena Praha',
      eventTime: '20:00',
    })

    expect(rendered.length).toBeGreaterThan(0)
  })

  it('should render all campaign types without error', () => {
    Object.entries(subjectLines).forEach(([campaignName, campaign]) => {
      campaign.cs.forEach((variant, idx) => {
        const mockVars: Record<string, string> = {}

        // Nahradí všechny proměnné s mock daty
        campaign.variables.forEach((varName) => {
          const cleanName = varName.replace(/\{\{|\}\}/g, '')
          mockVars[cleanName] = `mock-${cleanName}`
        })

        const rendered = renderSubjectLine(variant, mockVars)
        expect(rendered).toBeDefined()
        expect(rendered.length).toBeGreaterThan(0)
        expect(rendered.length).toBeLessThanOrEqual(70)
      })
    })
  })

  it('should handle resale campaign with price and count', () => {
    const campaign = subjectLines.resaleWatchlistAlert
    const variant = campaign.cs[1]

    const rendered = renderSubjectLine(variant, {
      eventName: 'The Killers',
      price: '850 Kč',
      availableCount: '3',
    })

    expect(rendered).toContain('850 Kč')
    expect(rendered).toContain('The Killers')
  })

  it('should handle early bird campaign with savings calculation', () => {
    const campaign = subjectLines.earlyBirdExpiring
    const variant = campaign.cs[0]

    const rendered = renderSubjectLine(variant, {
      eventName: 'Metallica',
      savings: '200 Kč',
      deadline: 'dnes v 23:59',
      earlyBirdPrice: '650 Kč',
    })

    expect(rendered).toContain('200 Kč')
  })

  it('should handle churn retention with discount percentage', () => {
    const campaign = subjectLines.churnRetentionDiscount
    const variant = campaign.cs[0]

    const rendered = renderSubjectLine(variant, {
      discountPct: '15',
      passName: 'Divadelní permanentka',
      expiryDate: '30. dubna',
      savings: '500 Kč',
    })

    expect(rendered).toContain('15')
  })

  it('should handle referral campaign with credit amounts', () => {
    const campaign = subjectLines.referralCreditEarned
    const variant = campaign.cs[0]

    const rendered = renderSubjectLine(variant, {
      creditAmount: '125',
      totalCredit: '375',
      referredUserFirstName: 'Martin',
    })

    expect(rendered).toContain('125')
    expect(rendered).toContain('Martin')
  })

  it('should handle wallet pass campaign with wallet type', () => {
    const campaign = subjectLines.walletPassAdded
    const variant = campaign.cs[0]

    const rendered = renderSubjectLine(variant, {
      eventName: 'Katy Perry',
      walletType: 'Apple Wallet',
    })

    expect(rendered).toContain('Apple Wallet')
    expect(rendered).toContain('Katy Perry')
  })
})
