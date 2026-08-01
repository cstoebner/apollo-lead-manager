import type { Lead } from './types'

const DAY = 86_400_000

function nurtureStartedAt(lead: Lead) {
  const statusChange = [...lead.activities].reverse().find((activity) =>
    activity.type === 'status_change' && activity.outcome.includes('to Nurture'),
  )
  return statusChange ? new Date(statusChange.occurredAt) : new Date(lead.receivedAt)
}

export function nurtureMessageFor(lead: Lead, contactAt: Date) {
  const elapsedWeeks = Math.max(2, (contactAt.getTime() - nurtureStartedAt(lead).getTime()) / DAY / 7)
  const week = Math.ceil(elapsedWeeks / 2) * 2
  const name = lead.name.split(' ')[0]
  const instrument = lead.instrument.toLowerCase()

  if (week <= 2) return {
    label: 'Week 2 · Simple check-in',
    message: `Hi ${name}, just wanted to check in and see if you're still interested in ${instrument} lessons. If the timing isn't right yet, no worries—just let me know!`,
  }
  if (week <= 4) return {
    label: 'Week 4 · Offer help',
    message: `Hi ${name}, I just wanted to check in and see if there was anything that had been holding you back from getting started with ${instrument} lessons. Whether it's scheduling, pricing, or finding the right teacher, I'm happy to help.`,
  }
  if (week <= 6) return {
    label: 'Week 6 · Availability',
    message: `Hi ${name}, we had a couple of ${instrument} lesson openings come up this week, so I thought I'd check if you were still interested in getting started.`,
  }
  if (week <= 8) return {
    label: 'Week 8 · No pressure',
    message: `Hi ${name}, I know life gets busy! I just wanted to see whether ${instrument} lessons are still on your radar. No rush either way.`,
  }
  if (week <= 10) return {
    label: 'Week 10 · Easy response',
    message: `Hi ${name}, are you still thinking about ${instrument} lessons?\n1️⃣ Yes, I'd like to schedule.\n2️⃣ Maybe later.\n3️⃣ Not interested anymore.\nJust reply with the number that fits best.`,
  }
  if (week <= 12) return {
    label: 'Week 12 · Schedule update',
    message: `Hi ${name}, we're updating our lesson schedule for the next few weeks. If you've still been thinking about ${instrument} lessons, I'd be happy to see what times are available.`,
  }
  return {
    label: `Week ${week} · Later follow-up`,
    message: `Hi ${name}, just wanted to pop in and let you know we're still here whenever you're ready. We'd love to help you get started with ${instrument} lessons!`,
  }
}
