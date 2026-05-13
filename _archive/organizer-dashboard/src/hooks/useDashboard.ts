// =============================================================================
// TanStack Query hooks pro Organizer Dashboard
// Polling intervaly dle kritičnosti dat:
//   - zone-capacity: 15s (nejkritičtější)
//   - overview: 30s
//   - resale-stats + sales-timeline: 60s
//   - heatmap: staleTime 5 min
// =============================================================================

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type {
  SalesOverview,
  SalesByPeriod,
  ZoneCapacity,
  ResaleStat,
  HeatmapCell,
  DemographicData,
  ResaleSettings,
  ApiSuccessResponse,
  TimelineGranularity,
} from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Fetch helper — typed, throws on non-2xx
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<ApiSuccessResponse<T>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<ApiSuccessResponse<T>>;
}

// ---------------------------------------------------------------------------
// Query key factory — konzistentní klíče napříč hooky
// ---------------------------------------------------------------------------

export const dashboardKeys = {
  all: (organizerId: string) => ["organizer", organizerId] as const,
  overview: (organizerId: string, eventId?: string) =>
    ["organizer", organizerId, "overview", eventId ?? "all"] as const,
  timeline: (
    organizerId: string,
    eventId: string,
    granularity: TimelineGranularity,
    from: string,
    to: string
  ) =>
    ["organizer", organizerId, "sales-timeline", eventId, granularity, from, to] as const,
  zoneCapacity: (organizerId: string, eventId: string) =>
    ["organizer", organizerId, "zone-capacity", eventId] as const,
  resaleStats: (organizerId: string, eventId?: string) =>
    ["organizer", organizerId, "resale-stats", eventId ?? "all"] as const,
  heatmap: (organizerId: string, eventId: string) =>
    ["organizer", organizerId, "sales-heatmap", eventId] as const,
  demographics: (organizerId: string, eventId?: string) =>
    ["organizer", organizerId, "demographics", eventId ?? "all"] as const,
  resaleSettings: (organizerId: string, eventId: string) =>
    ["organizer", organizerId, "events", eventId, "resale-settings"] as const,
} as const;

// ---------------------------------------------------------------------------
// useSalesOverview — refetch každých 30s
// ---------------------------------------------------------------------------

export function useSalesOverview(
  organizerId: string,
  eventId?: string,
  options?: Omit<UseQueryOptions<SalesOverview>, "queryKey" | "queryFn">
) {
  const url = `/api/organizer/${organizerId}/overview${eventId ? `?eventId=${eventId}` : ""}`;

  return useQuery<SalesOverview>({
    queryKey: dashboardKeys.overview(organizerId, eventId),
    queryFn: async () => {
      const res = await apiFetch<SalesOverview>(url);
      return res.data;
    },
    refetchInterval: 30_000, // 30 sekund
    staleTime: 25_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useSalesTimeline — refetch každých 60s
// ---------------------------------------------------------------------------

export function useSalesTimeline(
  organizerId: string,
  eventId: string,
  granularity: TimelineGranularity,
  from: string,
  to: string,
  options?: Omit<UseQueryOptions<SalesByPeriod[]>, "queryKey" | "queryFn">
) {
  const params = new URLSearchParams({
    eventId,
    granularity,
    from,
    to,
  });
  const url = `/api/organizer/${organizerId}/sales-timeline?${params.toString()}`;

  return useQuery<SalesByPeriod[]>({
    queryKey: dashboardKeys.timeline(organizerId, eventId, granularity, from, to),
    queryFn: async () => {
      const res = await apiFetch<SalesByPeriod[]>(url);
      // Deserializuj timestamp string → Date
      return res.data.map((p) => ({
        ...p,
        timestamp: new Date(p.timestamp),
      }));
    },
    refetchInterval: 60_000, // 60 sekund
    staleTime: 55_000,
    enabled: Boolean(organizerId && eventId && from && to),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useZoneCapacity — refetch každých 15s (nejkritičtější real-time data)
// ---------------------------------------------------------------------------

export function useZoneCapacity(
  organizerId: string,
  eventId: string,
  options?: Omit<UseQueryOptions<ZoneCapacity[]>, "queryKey" | "queryFn">
) {
  const url = `/api/organizer/${organizerId}/zone-capacity?eventId=${eventId}`;

  return useQuery<ZoneCapacity[]>({
    queryKey: dashboardKeys.zoneCapacity(organizerId, eventId),
    queryFn: async () => {
      const res = await apiFetch<ZoneCapacity[]>(url);
      return res.data;
    },
    refetchInterval: 15_000, // 15 sekund
    staleTime: 10_000,
    enabled: Boolean(organizerId && eventId),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useResaleStats — refetch každých 60s
// ---------------------------------------------------------------------------

export function useResaleStats(
  organizerId: string,
  eventId?: string,
  options?: Omit<UseQueryOptions<ResaleStat>, "queryKey" | "queryFn">
) {
  const url = `/api/organizer/${organizerId}/resale-stats${eventId ? `?eventId=${eventId}` : ""}`;

  return useQuery<ResaleStat>({
    queryKey: dashboardKeys.resaleStats(organizerId, eventId),
    queryFn: async () => {
      const res = await apiFetch<ResaleStat>(url);
      return res.data;
    },
    refetchInterval: 60_000,
    staleTime: 55_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useSalesHeatmap — staleTime 5 min (mění se pomalu)
// ---------------------------------------------------------------------------

export function useSalesHeatmap(
  organizerId: string,
  eventId: string,
  options?: Omit<UseQueryOptions<HeatmapCell[]>, "queryKey" | "queryFn">
) {
  const url = `/api/organizer/${organizerId}/sales-heatmap?eventId=${eventId}`;

  return useQuery<HeatmapCell[]>({
    queryKey: dashboardKeys.heatmap(organizerId, eventId),
    queryFn: async () => {
      const res = await apiFetch<HeatmapCell[]>(url);
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minut
    refetchInterval: 5 * 60 * 1000,
    enabled: Boolean(organizerId && eventId),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useDemographics
// ---------------------------------------------------------------------------

export function useDemographics(
  organizerId: string,
  eventId?: string,
  options?: Omit<UseQueryOptions<DemographicData>, "queryKey" | "queryFn">
) {
  const url = `/api/organizer/${organizerId}/demographics${eventId ? `?eventId=${eventId}` : ""}`;

  return useQuery<DemographicData>({
    queryKey: dashboardKeys.demographics(organizerId, eventId),
    queryFn: async () => {
      const res = await apiFetch<DemographicData>(url);
      return res.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minuty
    refetchInterval: 2 * 60 * 1000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useResaleSettings + usePatchResaleSettings
// ---------------------------------------------------------------------------

export function useResaleSettings(organizerId: string, eventId: string) {
  const url = `/api/organizer/${organizerId}/events/${eventId}/resale-settings`;

  return useQuery<ResaleSettings>({
    queryKey: dashboardKeys.resaleSettings(organizerId, eventId),
    queryFn: async () => {
      const res = await apiFetch<ResaleSettings>(url);
      return res.data;
    },
    staleTime: 30_000,
    enabled: Boolean(organizerId && eventId),
  });
}

export interface PatchResaleSettingsInput {
  resaleAllowed?: boolean;
  commissionRate?: number;
}

export function usePatchResaleSettings(organizerId: string, eventId: string) {
  const queryClient = useQueryClient();
  const url = `/api/organizer/${organizerId}/events/${eventId}/resale-settings`;

  return useMutation<ResaleSettings, Error, PatchResaleSettingsInput>({
    mutationFn: async (patch) => {
      const res = await apiFetch<ResaleSettings>(url, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return res.data;
    },
    // Optimistic update
    onMutate: async (patch) => {
      await queryClient.cancelQueries({
        queryKey: dashboardKeys.resaleSettings(organizerId, eventId),
      });
      const previous = queryClient.getQueryData<ResaleSettings>(
        dashboardKeys.resaleSettings(organizerId, eventId)
      );
      if (previous) {
        queryClient.setQueryData<ResaleSettings>(
          dashboardKeys.resaleSettings(organizerId, eventId),
          {
            ...previous,
            ...(patch.resaleAllowed !== undefined && {
              resaleAllowed: patch.resaleAllowed,
            }),
            ...(patch.commissionRate !== undefined && {
              resaleCommissionRate: patch.commissionRate,
            }),
          }
        );
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      // Rollback optimistic update
      const ctx = context as { previous?: ResaleSettings } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(
          dashboardKeys.resaleSettings(organizerId, eventId),
          ctx.previous
        );
      }
    },
    onSettled: () => {
      // Znovu načti po úspěchu i chybě
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.resaleSettings(organizerId, eventId),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.resaleStats(organizerId, eventId),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.overview(organizerId, eventId),
      });
    },
  });
}
