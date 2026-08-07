import type { Lead } from './types'
import { activeCadenceState } from './cadence'

const firstName = (lead: Lead) => lead.name.split(' ')[0]
const instrumentName = (lead: Lead) => lead.instrument.toLowerCase()
export function activeFollowUpFor(lead: Lead) {
  const textCount = Math.min(activeCadenceState(lead).stage, 3)
  const name = firstName(lead)
  const instrument = instrumentName(lead)

  if (textCount === 0) return {
    label: 'Day 0 · Text 1',
    voicemailLabel: 'Day 0 voicemail',
    voicemail: `Hi ${name}, this is Conor with Apollo Music Academy, following up on your request about ${instrument} lessons. I’m going to send you a quick text with a couple of free trial options. You can call or text me back whenever it’s convenient. Thanks!`,
    message: `Hi ${name},\n\nThis is Conor with Apollo Music Academy. Thanks for reaching out about ${instrument} lessons!\n\nWe offer a free 30-minute trial at World Learner School in Chaska. Weekly lessons afterward are $40 per 30 minutes.\n\nI currently have:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work for you?`,
    callFirst: true,
    needsTimes: true,
  }

  if (textCount === 1) return {
    label: 'Day 2 · Text 2',
    message: `Hi ${name},\n\nJust following up about ${instrument} lessons. Would a weekday afternoon/evening or Saturday generally work better for a free trial?\n\nOnce I know which is easier, I can send you two options.`,
    callFirst: true,
    needsTimes: false,
  }

  if (textCount === 2) return {
    label: 'Day 5 · Text 3',
    message: `Hi ${name},\n\nI wanted to try you again about the free trial lesson. I currently have:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work? If not, send me the days or times that are usually best and I’ll see what I can find.`,
    callFirst: true,
    needsTimes: true,
  }

  return {
    label: 'Day 8 · Close-the-loop text',
    voicemailLabel: 'Day 8 optional final voicemail',
    voicemail: `Hi ${name},\n\nThis is Conor with Apollo Music Academy. I wanted to make one more direct check-in about your request for ${instrument} lessons. I’ll send you a quick text so you can let me know where things stand whenever it’s convenient. Thanks!`,
    message: `Hi ${name},\n\nI wanted to close the loop on your request about music lessons. Just reply with the number that fits best:\n\n1️⃣ I’d like to schedule a free trial\n2️⃣ I’m interested, but the timing isn’t right\n3️⃣ I’m no longer interested\n4️⃣ I have a question\n\nIf I don’t hear back, no problem—I’ll stop checking in as frequently, but I may occasionally let you know when relevant lesson openings become available.`,
    callFirst: true,
    needsTimes: false,
  }
}
