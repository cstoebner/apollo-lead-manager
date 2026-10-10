import type { AcuityAppointment, AcuityAppointmentType, AcuityBlock, AcuityCalendar, AcuityClient } from './acuityTypes'

// In-memory stand-in for the real Acuity API, so the rest of the integration
// (holds, blocking engine, reconciliation, webhooks) can be built and exercised
// before Conor has the Premium upgrade / API key. State only lives for the life
// of one Worker instance -- fine for local `wrangler pages dev` testing, not
// meant to simulate persistence across real deploys.
let blocks: AcuityBlock[] = []
let nextBlockId = 1

export function mockAcuityClient(): AcuityClient {
  return {
    listCalendars: async () => [
      { id: '14124874', name: 'Luke (mock)' },
      { id: '14124875', name: 'Faith (mock)' },
    ],
    listAppointmentTypes: async () => [{ id: '93655035', name: 'Trial Lesson (mock)' }],
    getAppointment: async (id): Promise<AcuityAppointment> => ({
      id,
      calendarID: '14124874',
      appointmentTypeID: '93655035',
      datetime: new Date().toISOString(),
      datetimeCreated: new Date().toISOString(),
      firstName: 'Mock',
      lastName: 'Family',
      email: 'mock-family@example.com',
      phone: '6145550100',
    }),
    listAppointments: async () => [],
    listBlocks: async (calendarID) => blocks.filter((block) => block.calendarID === calendarID),
    createBlock: async (input) => {
      const block: AcuityBlock = { id: String(nextBlockId++), ...input }
      blocks.push(block)
      return block
    },
    deleteBlock: async (id) => { blocks = blocks.filter((block) => block.id !== id) },
    registerWebhook: async () => ({ id: 'mock-webhook' }),
  }
}
