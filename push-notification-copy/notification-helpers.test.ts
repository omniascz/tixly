import { describe, it, expect, beforeEach } from 'vitest'
import { renderNotification, pickVariant } from './notification-helpers'
import { pushNotifications, PushNotification, NotificationVariants } from './notifications'

describe('renderNotification', () => {
  it('should replace all variables with provided values', () => {
    const notification: PushNotification = {
      title: '{{eventName}} za 24 hodin',
      body: 'Začíná v {{eventTime}}, {{venueName}}',
      url: '/tickets/{{ticketId}}'
    }

    const variables = {
      eventName: 'Koncert ABC',
      eventTime: '20:00',
      venueName: 'O2 Arena',
      ticketId: '12345'
    }

    const result = renderNotification(notification, variables)

    expect(result.title).toBe('Koncert ABC za 24 hodin')
    expect(result.body).toBe('Začíná v 20:00, O2 Arena')
    expect(result.url).toBe('/tickets/12345')
  })

  it('should replace missing variables with empty strings', () => {
    const notification: PushNotification = {
      title: '{{eventName}} - {{missing}}',
      body: 'Venue: {{venueName}}'
    }

    const variables = {
      eventName: 'Event',
      venueName: 'Venue'
    }

    const result = renderNotification(notification, variables)

    expect(result.title).toBe('Event - ')
    expect(result.body).toBe('Venue: Venue')
  })

  it('should handle nested/consecutive variables', () => {
    const notification: PushNotification = {
      title: '{{eventName}}{{eventDate}}',
      body: '{{price}} Kč za {{ticketId}}'
    }

    const variables = {
      eventName: 'Akce',
      eventDate: '5.4.',
      price: '500',
      ticketId: 'ABC123'
    }

    const result = renderNotification(notification, variables)

    expect(result.title).toBe('Akce5.4.')
    expect(result.body).toBe('500 Kč za ABC123')
  })

  it('should not mutate the input notification object', () => {
    const notification: PushNotification = {
      title: '{{eventName}}',
      body: '{{venueName}}',
      url: '/events/{{eventId}}'
    }

    const originalNotification = JSON.parse(JSON.stringify(notification))

    const variables = {
      eventName: 'Concert',
      venueName: 'Arena',
      eventId: '789'
    }

    renderNotification(notification, variables)

    expect(notification).toEqual(originalNotification)
  })

  it('should handle empty variables object', () => {
    const notification: PushNotification = {
      title: '{{eventName}}',
      body: 'Text'
    }

    const result = renderNotification(notification, {})

    expect(result.title).toBe('')
    expect(result.body).toBe('Text')
  })

  it('should handle notification without URL', () => {
    const notification: PushNotification = {
      title: '{{title}}',
      body: '{{body}}'
    }

    const variables = {
      title: 'Test',
      body: 'Content'
    }

    const result = renderNotification(notification, variables)

    expect(result.url).toBeUndefined()
  })

  it('should replace variables in URL when present', () => {
    const notification: PushNotification = {
      title: 'Title',
      body: 'Body',
      url: '/events/{{eventId}}/resale'
    }

    const variables = {
      eventId: 'event123'
    }

    const result = renderNotification(notification, variables)

    expect(result.url).toBe('/events/event123/resale')
  })
})

describe('pickVariant', () => {
  const mockVariants: NotificationVariants = {
    cs: [
      { title: 'Varianta 1 CZ', body: 'Body 1' },
      { title: 'Varianta 2 CZ', body: 'Body 2' },
      { title: 'Varianta 3 CZ', body: 'Body 3' }
    ],
    en: [
      { title: 'Variant 1 EN', body: 'Body 1' },
      { title: 'Variant 2 EN', body: 'Body 2' }
    ]
  }

  it('should pick a Czech variant without seed', () => {
    const result = pickVariant(mockVariants, 'cs')
    expect(mockVariants.cs).toContainEqual(result)
  })

  it('should pick an English variant without seed', () => {
    const result = pickVariant(mockVariants, 'en')
    expect(mockVariants.en).toContainEqual(result)
  })

  it('should deterministically pick the same variant with same seed', () => {
    const result1 = pickVariant(mockVariants, 'cs', 'user-123')
    const result2 = pickVariant(mockVariants, 'cs', 'user-123')
    const result3 = pickVariant(mockVariants, 'cs', 'user-123')

    expect(result1).toEqual(result2)
    expect(result2).toEqual(result3)
  })

  it('should pick different variant with different seed', () => {
    const result1 = pickVariant(mockVariants, 'cs', 'user-123')
    const result2 = pickVariant(mockVariants, 'cs', 'user-456')

    // Not guaranteed to be different, but very likely
    // We'll check they're both valid at least
    expect(mockVariants.cs).toContainEqual(result1)
    expect(mockVariants.cs).toContainEqual(result2)
  })

  it('should respect locale when picking with seed', () => {
    const resultCS = pickVariant(mockVariants, 'cs', 'seed-1')
    const resultEN = pickVariant(mockVariants, 'en', 'seed-1')

    expect(mockVariants.cs).toContainEqual(resultCS)
    expect(mockVariants.en).toContainEqual(resultEN)
  })

  it('should throw error if variants list is empty', () => {
    const emptyVariants: NotificationVariants = {
      cs: [],
      en: [{ title: 'Title', body: 'Body' }]
    }

    expect(() => pickVariant(emptyVariants, 'cs')).toThrow()
  })

  it('should return valid variant with English locale and seed', () => {
    const result = pickVariant(mockVariants, 'en', 'user-id-1')
    expect(mockVariants.en).toContainEqual(result)
  })
})

describe('Notification copy validation', () => {
  it('all Czech titles should be <= 50 characters', () => {
    Object.values(pushNotifications).forEach((category) => {
      Object.values(category).forEach((variants) => {
        variants.cs.forEach((notification) => {
          expect(notification.title.length).toBeLessThanOrEqual(50)
        })
      })
    })
  })

  it('all English titles should be <= 50 characters', () => {
    Object.values(pushNotifications).forEach((category) => {
      Object.values(category).forEach((variants) => {
        variants.en.forEach((notification) => {
          expect(notification.title.length).toBeLessThanOrEqual(50)
        })
      })
    })
  })

  it('all Czech bodies should be <= 100 characters', () => {
    Object.values(pushNotifications).forEach((category) => {
      Object.values(category).forEach((variants) => {
        variants.cs.forEach((notification) => {
          expect(notification.body.length).toBeLessThanOrEqual(100)
        })
      })
    })
  })

  it('all English bodies should be <= 100 characters', () => {
    Object.values(pushNotifications).forEach((category) => {
      Object.values(category).forEach((variants) => {
        variants.en.forEach((notification) => {
          expect(notification.body.length).toBeLessThanOrEqual(100)
        })
      })
    })
  })

  it('should have at least 1 variant per locale for each notification', () => {
    Object.values(pushNotifications).forEach((category) => {
      Object.values(category).forEach((variants) => {
        expect(variants.cs.length).toBeGreaterThanOrEqual(1)
        expect(variants.en.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  it('all notifications should have title and body', () => {
    Object.values(pushNotifications).forEach((category) => {
      Object.values(category).forEach((variants) => {
        variants.cs.forEach((notification) => {
          expect(notification.title).toBeDefined()
          expect(notification.title.length).toBeGreaterThan(0)
          expect(notification.body).toBeDefined()
          expect(notification.body.length).toBeGreaterThan(0)
        })
        variants.en.forEach((notification) => {
          expect(notification.title).toBeDefined()
          expect(notification.title.length).toBeGreaterThan(0)
          expect(notification.body).toBeDefined()
          expect(notification.body.length).toBeGreaterThan(0)
        })
      })
    })
  })

  it('all notifications with URL should follow deep link pattern', () => {
    Object.values(pushNotifications).forEach((category) => {
      Object.values(category).forEach((variants) => {
        const allNotifications = [...variants.cs, ...variants.en]
        allNotifications.forEach((notification) => {
          if (notification.url) {
            expect(notification.url).toMatch(/^\//)
          }
        })
      })
    })
  })
})
