export interface AcuityCalendar { id: string; name: string }
// The extra fields come back from Acuity's /appointment-types and are what the audit checks (assigned calendars, hidden/inactive).
export interface AcuityAppointmentType { id: string | number; name: string; active?: boolean; private?: boolean; duration?: number; price?: string; calendarIDs?: (string | number)[] }

export interface AcuityAppointment {
  id: string
  calendarID: string
  appointmentTypeID: string
  datetime: string
  datetimeCreated: string
  firstName: string
  lastName: string
  email: string
  phone: string
  forms?: unknown
}

export interface AcuityBlock {
  id: string
  calendarID: string
  start: string
  end: string
  notes?: string
}

export interface AcuityTime { time: string; slotsAvailable?: number }

export interface AcuityDate { date: string }

export interface AcuityClient {
  listCalendars(): Promise<AcuityCalendar[]>
  listAppointmentTypes(): Promise<AcuityAppointmentType[]>
  getAppointment(id: string): Promise<AcuityAppointment>
  listAppointments(params: { minDate: string; maxDate: string; calendarID?: string }): Promise<AcuityAppointment[]>
  listBlocks(calendarID: string): Promise<AcuityBlock[]>
  // The days in a month (YYYY-MM) on which Acuity offers any time for one appointment type + calendar.
  listAvailableDates(params: { month: string; appointmentTypeID: string; calendarID: string }): Promise<AcuityDate[]>
  // The start times Acuity is actually offering the public on a date for one appointment type + calendar.
  listAvailableTimes(params: { date: string; appointmentTypeID: string; calendarID: string }): Promise<AcuityTime[]>
  createBlock(input: { calendarID: string; start: string; end: string; notes: string }): Promise<AcuityBlock>
  deleteBlock(id: string): Promise<void>
  registerWebhook(input: { event: string; target: string }): Promise<{ id: string }>
}
