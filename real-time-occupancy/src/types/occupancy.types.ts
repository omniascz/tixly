export interface OccupancySnapshot {
  event_id: string
  captured_at: Date
  total_capacity: number
  total_inside: number
  total_checked_in_ever: number
  occupancy_pct: number
  zones: ZoneOccupancy[]
}

export interface ZoneOccupancy {
  zone_id: string
  zone_name: string
  capacity: number | null
  inside: number
  occupancy_pct: number | null
}

export type OccupancyAlertType =
  | 'capacity_warning'
  | 'capacity_critical'
  | 'capacity_full'
  | 'zone_full'

export interface OccupancyAlert {
  event_id: string
  alert_type: OccupancyAlertType
  zone_id: string | null
  threshold_pct: number
  current_pct: number
  triggered_at: Date
}

export interface OccupancyThresholds {
  event_id: string
  warning_pct: number
  critical_pct: number
  full_pct: number
  zone_thresholds: Array<{ zone_id: string; full_pct: number }>
}
