import type { Lead } from './types'
import { nurtureWeekFor } from './cadence'

export function nurtureMessageFor(lead: Lead, contactAt: Date, hasOpenings = false) {
  const week = nurtureWeekFor(lead, contactAt)
  const name = lead.name.split(' ')[0]
  const instrument = lead.instrument.toLowerCase()

  if (week <= 2) return {
    label: 'Week 2 · Call, then text',
    message: `Hi ${name}, I wanted to check back in about ${instrument} lessons. Are you still interested in trying a free lesson, or has finding the right time been the main obstacle?`,
    callFirst: true,
    needsTimes: false,
  }
  if (week <= 4) return {
    label: 'Week 4 · Text only',
    message: `Hi ${name}, just checking in about ${instrument} lessons. If scheduling, pricing, or finding the right instructor has been holding things up, I’m happy to help. Feel free to text me any questions.`,
    callFirst: false,
    needsTimes: false,
  }
  if (week <= 6) return {
    label: 'Week 6 · Call, then availability text',
    message: hasOpenings
      ? `Hi ${name}, a couple of ${instrument} trial openings have become available, so I wanted to check with you:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work for you?`
      : `Hi ${name}, I wanted to check back in about ${instrument} lessons. What days or time ranges would make a free trial easiest for you? I’d be happy to check the schedule.`,
    callFirst: true,
    needsTimes: hasOpenings,
  }
  if (week <= 8) return {
    label: 'Week 8 · Text only',
    message: `Hi ${name}, I know schedules get busy, so I wanted to see whether ${instrument} lessons are still on your radar. If you’d like, send me the days that usually work best and I can look for a trial time.`,
    callFirst: false,
    needsTimes: false,
  }
  if (week <= 10) return {
    label: 'Week 10 · Call, then easy-response text',
    message: `Hi ${name}, are you still thinking about ${instrument} lessons?\n\n1️⃣ Yes, I’d like to schedule a free trial\n2️⃣ Maybe later\n3️⃣ I’m no longer interested\n4️⃣ I have a question\n\nJust reply with the number that fits best.`,
    callFirst: true,
    needsTimes: false,
  }
  if (week <= 12) return {
    label: 'Week 12 · Final regular nurture text',
    message: `Hi ${name}, I wanted to make one last regular check-in about ${instrument} lessons. Apollo will be here whenever the timing is right.\n\nAfter this, I’ll only reach out occasionally when relevant openings or new scheduling options come up. If you’d rather not receive those updates, just let me know.`,
    callFirst: false,
    needsTimes: false,
  }
  return {
    label: 'Long-term · Relevant opening only',
    message: `Hi ${name}, a couple of ${instrument} trial openings have become available, so I wanted to check with you:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work for you?`,
    callFirst: false,
    needsTimes: true,
  }
}
