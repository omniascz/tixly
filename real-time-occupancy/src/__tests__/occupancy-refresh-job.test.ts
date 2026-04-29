import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OccupancyRefreshJob, type EventRegistryAdapter } from '../jobs/occupancy-refresh.job.js'
import { OccupancyService, type OccupancyDbAdapter, type RedisAdapter, type KafkaProducerAdapter } from '../services/occupancy.service.js'

vi.mock('../services/occupancy.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/occupancy.service.js')>()
  return {
    ...actual,
    OccupancyService: {
      ...actual.OccupancyService,
      refreshSnapshot: vi.fn(),
    },
  }
})

function createMockDb(): OccupancyDbAdapter {
  return {
    getScanSummaryByZone: vi.fn(),
    getEventCapacity: vi.fn(),
    getOccupancyThresholds: vi.fn(),
    saveOccupancySnapshot: vi.fn(),
    getLatestSnapshot: vi.fn(),
    saveAlert: vi.fn(),
    getActiveAlerts: vi.fn(),
    setOccupancyThresholds: vi.fn(),
  }
}

function createMockRedis(): RedisAdapter {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    increment: vi.fn(),
    decrement: vi.fn(),
  }
}

function createMockKafka(): KafkaProducerAdapter {
  return {
    publish: vi.fn(),
  }
}

function createMockRegistry(eventIds: string[] = []): EventRegistryAdapter {
  return {
    getOngoingEventIds: vi.fn().mockResolvedValue(eventIds),
  }
}

describe('OccupancyRefreshJob', () => {
  let mockDb: OccupancyDbAdapter
  let mockRedis: RedisAdapter
  let mockKafka: KafkaProducerAdapter
  let mockRegistry: EventRegistryAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    mockDb = createMockDb()
    mockRedis = createMockRedis()
    mockKafka = createMockKafka()
    mockRegistry = createMockRegistry()
    vi.mocked(OccupancyService.refreshSnapshot).mockReset()
  })

  afterEach(async () => {
    vi.useRealTimers()
  })

  it('runs tick immediately on start', async () => {
    mockRegistry = createMockRegistry(['evt-1'])
    vi.mocked(OccupancyService.refreshSnapshot).mockResolvedValue({
      event_id: 'evt-1',
      captured_at: new Date(),
      total_capacity: 100,
      total_inside: 50,
      total_checked_in_ever: 60,
      occupancy_pct: 50,
      zones: [],
    })

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry)
    job.start()

    // Allow the immediate tick to run
    await vi.advanceTimersByTimeAsync(0)

    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(1)
    expect(OccupancyService.refreshSnapshot).toHaveBeenCalledWith('evt-1', mockDb, mockRedis, mockKafka)

    await job.stop()
  })

  it('refreshes all ongoing events on each tick', async () => {
    mockRegistry = createMockRegistry(['evt-1', 'evt-2', 'evt-3'])
    vi.mocked(OccupancyService.refreshSnapshot).mockResolvedValue({
      event_id: 'any',
      captured_at: new Date(),
      total_capacity: 100,
      total_inside: 0,
      total_checked_in_ever: 0,
      occupancy_pct: 0,
      zones: [],
    })

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry)
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(OccupancyService.refreshSnapshot).toHaveBeenCalledTimes(3)

    await job.stop()
  })

  it('does not overlap ticks (skip-if-running guard)', async () => {
    let resolveFirst: (() => void) | undefined
    const slowPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })

    mockRegistry = createMockRegistry(['evt-1'])
    vi.mocked(OccupancyService.refreshSnapshot).mockImplementation(async () => {
      await slowPromise
      return {
        event_id: 'evt-1',
        captured_at: new Date(),
        total_capacity: 100,
        total_inside: 0,
        total_checked_in_ever: 0,
        occupancy_pct: 0,
        zones: [],
      }
    })

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry, {
      intervalMs: 100,
    })
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    // First tick is still running; advance past the interval
    await vi.advanceTimersByTimeAsync(200)

    // The registry should have been called only once (second tick skipped)
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(1)

    // Now resolve the first tick
    resolveFirst!()
    await vi.advanceTimersByTimeAsync(0)

    await job.stop()
  })

  it('uses default interval of 60 seconds', async () => {
    mockRegistry = createMockRegistry([])

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry)
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    // First call is immediate
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(1)

    // Advance 59 seconds — no second call
    await vi.advanceTimersByTimeAsync(59_000)
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(1)

    // Advance past 60 seconds — second call
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(2)

    await job.stop()
  })

  it('uses custom interval when provided', async () => {
    mockRegistry = createMockRegistry([])

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry, {
      intervalMs: 5_000,
    })
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(2)

    await job.stop()
  })

  it('handles errors in refreshSnapshot without crashing the loop', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRegistry = createMockRegistry(['evt-fail'])
    vi.mocked(OccupancyService.refreshSnapshot).mockRejectedValue(new Error('DB down'))

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry, {
      intervalMs: 100,
    })
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    // Error should be logged
    expect(consoleSpy).toHaveBeenCalled()

    // Next tick should still fire
    await vi.advanceTimersByTimeAsync(100)
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(2)

    consoleSpy.mockRestore()
    await job.stop()
  })

  it('handles errors in getOngoingEventIds', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRegistry = {
      getOngoingEventIds: vi.fn().mockRejectedValue(new Error('Registry unavailable')),
    }

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry, {
      intervalMs: 100,
    })
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(consoleSpy).toHaveBeenCalledWith(
      '[OccupancyRefreshJob] Unexpected error in tick:',
      expect.any(Error),
    )

    consoleSpy.mockRestore()
    await job.stop()
  })

  it('start is idempotent (calling start twice does not create two timers)', async () => {
    mockRegistry = createMockRegistry([])

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry, {
      intervalMs: 100,
    })
    job.start()
    job.start() // Second call should be a no-op

    await vi.advanceTimersByTimeAsync(100)

    // Should have 2 calls (immediate + 1 interval), not 3 (which would happen with 2 timers)
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(2)

    await job.stop()
  })

  it('stop prevents further ticks', async () => {
    mockRegistry = createMockRegistry([])

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry, {
      intervalMs: 100,
    })
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(1)

    await job.stop()

    await vi.advanceTimersByTimeAsync(500)
    expect(mockRegistry.getOngoingEventIds).toHaveBeenCalledTimes(1)
  })

  it('handles empty event list gracefully', async () => {
    mockRegistry = createMockRegistry([])

    const job = new OccupancyRefreshJob(mockDb, mockRedis, mockKafka, mockRegistry)
    job.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(OccupancyService.refreshSnapshot).not.toHaveBeenCalled()

    await job.stop()
  })
})
