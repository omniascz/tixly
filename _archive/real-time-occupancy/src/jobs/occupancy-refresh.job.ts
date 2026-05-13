import { OccupancyService, type KafkaProducerAdapter, type OccupancyDbAdapter, type RedisAdapter } from '../services/occupancy.service'

// ---------------------------------------------------------------------------
// Adapter interfaces for the job's infrastructure dependencies
// ---------------------------------------------------------------------------

export interface EventRegistryAdapter {
  /** Returns IDs of all events that are currently in progress. */
  getOngoingEventIds(): Promise<string[]>
}

export interface OccupancyJobConfig {
  intervalMs?: number // default: 60_000
}

// ---------------------------------------------------------------------------
// OccupancyRefreshJob
// ---------------------------------------------------------------------------

export class OccupancyRefreshJob {
  private readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private shuttingDown = false

  constructor(
    private readonly db: OccupancyDbAdapter,
    private readonly redis: RedisAdapter,
    private readonly kafka: KafkaProducerAdapter,
    private readonly eventRegistry: EventRegistryAdapter,
    config: OccupancyJobConfig = {},
  ) {
    this.intervalMs = config.intervalMs ?? 60_000
  }

  /** Start the periodic refresh loop. Safe to call once. */
  start(): void {
    if (this.timer !== null) return

    // Run immediately on start, then on each interval
    void this.tick()
    this.timer = setInterval(() => {
      void this.tick()
    }, this.intervalMs)
  }

  /**
   * Stop accepting new ticks and wait for the current one to finish.
   * Resolves once the job is fully stopped.
   */
  async stop(): Promise<void> {
    this.shuttingDown = true
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }

    // Wait for an in-flight tick to finish
    if (this.running) {
      await new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          if (!this.running) {
            clearInterval(poll)
            resolve()
          }
        }, 50)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async tick(): Promise<void> {
    // Skip-if-running guard
    if (this.running || this.shuttingDown) return
    this.running = true

    try {
      const eventIds = await this.eventRegistry.getOngoingEventIds()

      await Promise.allSettled(
        eventIds.map((eventId) =>
          OccupancyService.refreshSnapshot(eventId, this.db, this.redis, this.kafka).catch(
            (err: unknown) => {
              console.error(`[OccupancyRefreshJob] Failed to refresh event ${eventId}:`, err)
            },
          ),
        ),
      )
    } catch (err) {
      console.error('[OccupancyRefreshJob] Unexpected error in tick:', err)
    } finally {
      this.running = false
    }
  }
}
