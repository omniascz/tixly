import { PushNotification, NotificationVariants } from './notifications'

/**
 * Renders a notification by replacing {{variable}} placeholders with values.
 * Missing variables are replaced with empty strings.
 * Does not mutate the input notification.
 */
export function renderNotification(
  notification: PushNotification,
  variables: Record<string, string>
): PushNotification {
  const rendered: PushNotification = {
    title: replaceVariables(notification.title, variables),
    body: replaceVariables(notification.body, variables),
  }

  if (notification.url) {
    rendered.url = replaceVariables(notification.url, variables)
  }

  return rendered
}

/**
 * Picks a random variant from the NotificationVariants for the given locale.
 * If seed is provided, uses deterministic selection based on hash.
 * Returns one PushNotification from the array.
 */
export function pickVariant(
  variants: NotificationVariants,
  locale: 'cs' | 'en',
  seed?: string
): PushNotification {
  const variantsList = variants[locale]

  if (variantsList.length === 0) {
    throw new Error(`No variants found for locale: ${locale}`)
  }

  if (seed === undefined) {
    // Random selection
    const randomIndex = Math.floor(Math.random() * variantsList.length)
    return variantsList[randomIndex]
  }

  // Deterministic selection using seed
  const index = hashSeed(seed) % variantsList.length
  return variantsList[index]
}

/**
 * Simple hash function for deterministic seed-based selection.
 * Uses djb2 algorithm for consistent hashing.
 */
function hashSeed(seed: string): number {
  let hash = 5381
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) + hash + seed.charCodeAt(i)
    // Keep hash in 32-bit range
    hash = hash & hash
  }
  // Return absolute value to ensure positive index
  return Math.abs(hash)
}

/**
 * Replaces all {{variable}} placeholders with corresponding values.
 * Missing variables are replaced with empty string.
 */
function replaceVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
    return variables[key] ?? ''
  })
}
