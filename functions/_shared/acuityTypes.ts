export interface AcuityCalendar { id: string; name: string }
export interface AcuityAppointmentType { id: string; name: string }

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

export interface AcuityClient {
  listCalendars(): Promise<AcuityCalendar[]>
  listAppointmentTypes(): Promise<AcuityAppointmentType[]>
  getAppointment(id: string): Promise<AcuityAppointment>
  listAppointments(params: { minDate: string; maxDate: string; calendarID?: string }): Promise<AcuityAppointment[]>
  listBlocks(calendarID: string): Promise<AcuityBlock[]>
  createBlock(input: { calendarID: string; start: string; end: string; notes: string }): Promise<AcuityBlock>
  deleteBlock(id: string): Promise<void>
  registerWebhook(input: { event: string; target: string }): Promise<{ id: string }>
}
