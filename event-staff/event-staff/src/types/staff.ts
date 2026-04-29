export type StaffRole = 'security' | 'bar' | 'technics' | 'usher' | 'ticket_check' | 'cloakroom' | 'first_aid' | 'cleaning' | 'manager' | 'other';

export type StaffEmploymentType = 'employee' | 'contractor' | 'agency' | 'volunteer';

export type StaffStatus = 'active' | 'inactive' | 'archived';

/** Granular permission flags. A staff member has zero or more. */
export type StaffPermission =
  | 'scan_tickets'              // can use the gate scanner
  | 'will_call_pickup'          // can issue will-call tickets
  | 'guest_list_check_in'       // can check in guests
  | 'manage_orders'             // can refund/modify orders
  | 'view_revenue'              // can see financial reports
  | 'manage_staff';             // can add/edit other staff

export interface StaffMember {
  id: string;
  promoterId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  emergencyContact: string | null;
  employmentType: StaffEmploymentType;
  hourlyRateHalire: number | null;
  status: StaffStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffMemberWithRoles extends StaffMember {
  roles: StaffRole[];
  permissions: StaffPermission[];
}

export interface CreateStaffMemberInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  emergencyContact?: string;
  employmentType: StaffEmploymentType;
  hourlyRateHalire?: number;
  roles: StaffRole[];
  permissions?: StaffPermission[];
  notes?: string;
}

export interface UpdateStaffMemberInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  emergencyContact?: string | null;
  employmentType?: StaffEmploymentType;
  hourlyRateHalire?: number | null;
  status?: StaffStatus;
  roles?: StaffRole[];
  permissions?: StaffPermission[];
  notes?: string | null;
}

export type ShiftStatus =
  | 'scheduled'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface Shift {
  id: string;
  promoterId: string;
  eventId: string;
  staffId: string;
  role: StaffRole;
  zone: string | null;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
  notes: string | null;
  /** Filled in when status='completed' or 'no_show' */
  actualStartsAt: Date | null;
  actualEndsAt: Date | null;
  /** Computed at completion: ms worked × hourly_rate (snapshot of staff rate at the time) */
  payoutHalire: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftWithStaff extends Shift {
  staffFirstName: string;
  staffLastName: string;
  staffPhone: string | null;
}

export interface CreateShiftInput {
  staffId: string;
  role: StaffRole;
  zone?: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
}

export interface BulkCreateShiftsInput {
  staffIds: string[];
  role: StaffRole;
  zone?: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
}

export interface UpdateShiftInput {
  role?: StaffRole;
  zone?: string | null;
  startsAt?: string;
  endsAt?: string;
  status?: ShiftStatus;
  notes?: string | null;
}

export interface ShiftTimelineSlot {
  /** ISO date YYYY-MM-DD bucketing */
  date: string;
  shifts: ShiftWithStaff[];
}

// ---------------------------------------------------------------------------
// Recurring weekly shift templates
// ---------------------------------------------------------------------------

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface RecurringShiftTemplate {
  id: string;
  promoterId: string;
  branchId: string;
  staffId: string;
  role: StaffRole;
  zone: string | null;
  /** Day of week */
  dayOfWeek: DayOfWeek;
  /** Time of day in branch timezone */
  startTimeLocal: string; // HH:mm
  endTimeLocal: string; // HH:mm
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateRecurringShiftInput {
  branchId: string;
  staffId: string;
  role: StaffRole;
  zone?: string;
  dayOfWeek: DayOfWeek;
  startTimeLocal: string; // HH:mm
  endTimeLocal: string; // HH:mm
  effectiveFrom: string; // ISO date YYYY-MM-DD
  effectiveUntil?: string;
}
