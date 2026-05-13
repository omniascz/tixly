import type {
  OrderCompletedKafkaEvent,
  PageViewedKafkaEvent,
  OrderCreatedKafkaEvent,
  TrackingResult,
  ServiceDeps,
} from '../types/tracking.types.js';
import * as metaService from './meta.service.js';
import * as tiktokService from './tiktok.service.js';

function logResults(
  eventLabel: string,
  results: PromiseSettledResult<TrackingResult>[],
  deps: ServiceDeps,
): void {
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const r = result.value;
      if (r.skippedAsDuplicate) {
        deps.logger.info(`${eventLabel}: skipped duplicate`, {
          platform: r.platform,
          eventId: r.eventId,
        });
      } else if (r.success) {
        deps.logger.info(`${eventLabel}: sent`, {
          platform: r.platform,
          eventId: r.eventId,
          statusCode: r.statusCode,
        });
      } else {
        deps.logger.error(`${eventLabel}: failed`, {
          platform: r.platform,
          eventId: r.eventId,
          error: r.error,
        });
      }
    } else {
      // Rejected means an unexpected throw (e.g. PayloadBuildError)
      const error = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      deps.logger.error(`${eventLabel}: unhandled rejection`, { error });
    }
  }
}

/**
 * Handle OrderCompleted Kafka event.
 * Sends Purchase event to both Meta and TikTok in parallel.
 * A failure on one platform does not block the other.
 */
export async function handleOrderCompleted(
  event: OrderCompletedKafkaEvent,
  deps: ServiceDeps,
): Promise<void> {
  deps.logger.info('Orchestrator: handling OrderCompleted', { orderId: event.orderId });

  const results = await Promise.allSettled([
    metaService.sendPurchaseEvent(event, deps),
    tiktokService.sendPurchaseEvent(event, deps),
  ]);

  logResults('OrderCompleted', results, deps);
}

/**
 * Handle PageViewed Kafka event.
 * Only processes 'event_detail' page type — all other page types are skipped.
 * Sends ViewContent event to both Meta and TikTok in parallel.
 */
export async function handlePageViewed(
  event: PageViewedKafkaEvent,
  deps: ServiceDeps,
): Promise<void> {
  if (event.pageType !== 'event_detail') {
    deps.logger.info('Orchestrator: PageViewed skipped (not event_detail)', {
      pageType: event.pageType,
      sessionId: event.sessionId,
    });
    return;
  }

  deps.logger.info('Orchestrator: handling PageViewed (event_detail)', {
    eventId: event.eventId,
    sessionId: event.sessionId,
  });

  const results = await Promise.allSettled([
    metaService.sendViewContentEvent(event, deps),
    tiktokService.sendViewContentEvent(event, deps),
  ]);

  logResults('PageViewed', results, deps);
}

/**
 * Handle OrderCreated Kafka event.
 * Sends InitiateCheckout event to both Meta and TikTok in parallel.
 */
export async function handleOrderCreated(
  event: OrderCreatedKafkaEvent,
  deps: ServiceDeps,
): Promise<void> {
  deps.logger.info('Orchestrator: handling OrderCreated', { orderId: event.orderId });

  const results = await Promise.allSettled([
    metaService.sendInitiateCheckoutEvent(event, deps),
    tiktokService.sendInitiateCheckoutEvent(event, deps),
  ]);

  logResults('OrderCreated', results, deps);
}
