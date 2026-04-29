import type { StaffRole, StaffPermission } from '../types/staff.js';

export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRole, StaffPermission[]> = {
  security:        ['scan_tickets'],
  bar:             [],
  technics:        [],
  usher:           ['scan_tickets'],
  ticket_check:    ['scan_tickets', 'guest_list_check_in'],
  cloakroom:       [],
  first_aid:       [],
  cleaning:        [],
  manager:         ['scan_tickets', 'will_call_pickup', 'guest_list_check_in', 'manage_orders', 'view_revenue', 'manage_staff'],
  other:           [],
};

/** Compute the effective permission set from a list of roles. Union semantics. */
export function computeRolePermissions(roles: StaffRole[]): StaffPermission[] {
  const set = new Set<StaffPermission>();
  for (const role of roles) {
    const perms = DEFAULT_ROLE_PERMISSIONS[role];
    if (!perms) continue;
    for (const p of perms) set.add(p);
  }
  return Array.from(set);
}
