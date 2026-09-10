export const defaultMessageTemplates: Record<string, string> = {
  active_day0_voicemail: 'Hi {{firstName}}, this is Conor with Apollo Music Academy, following up on your request about {{instrument}} lessons. I’m going to send you a quick text with a couple of free trial options. You can call or text me back whenever it’s convenient. Thanks!',
  active_day0_text: 'Hi {{firstName}},\n\nThis is Conor with Apollo Music Academy. Thanks for reaching out about {{instrument}} lessons!\n\nWe offer a free 30-minute trial at World Learner School in Chaska. Weekly lessons afterward are $40 per 30 minutes.\n\nI currently have:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work for you?',
  active_day2_text: 'Hi {{firstName}},\n\nJust following up about {{instrument}} lessons. Would a weekday afternoon/evening or Saturday generally work better for a free trial?\n\nOnce I know which is easier, I can send you two options.',
  active_day5_text: 'Hi {{firstName}},\n\nI wanted to try you again about the free trial lesson. I currently have:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work? If not, send me the days or times that are usually best and I’ll see what I can find.',
  active_day8_voicemail: 'Hi {{firstName}},\n\nThis is Conor with Apollo Music Academy. I wanted to make one more direct check-in about your request for {{instrument}} lessons. I’ll send you a quick text so you can let me know where things stand whenever it’s convenient. Thanks!',
  active_day8_text: 'Hi {{firstName}},\n\nI wanted to close the loop on your request about music lessons. Just reply with the number that fits best:\n\n1️⃣ I’d like to schedule a free trial\n2️⃣ I’m interested, but the timing isn’t right\n3️⃣ I’m no longer interested\n4️⃣ I have a question\n\nIf I don’t hear back, no problem—I’ll stop checking in as frequently, but I may occasionally let you know when relevant lesson openings become available.',
  nurture_week2: 'Hi {{firstName}}, I wanted to check back in about {{instrument}} lessons. Are you still interested in trying a free lesson, or has finding the right time been the main obstacle?',
  nurture_week4: 'Hi {{firstName}}, just checking in about {{instrument}} lessons. If scheduling, pricing, or finding the right instructor has been holding things up, I’m happy to help. Feel free to text me any questions.',
  nurture_week6_openings: 'Hi {{firstName}}, a couple of {{instrument}} trial openings have become available, so I wanted to check with you:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work for you?',
  nurture_week6_no_openings: 'Hi {{firstName}}, I wanted to check back in about {{instrument}} lessons. What days or time ranges would make a free trial easiest for you? I’d be happy to check the schedule.',
  nurture_week8: 'Hi {{firstName}}, I know schedules get busy, so I wanted to see whether {{instrument}} lessons are still on your radar. If you’d like, send me the days that usually work best and I can look for a trial time.',
  nurture_week10: 'Hi {{firstName}}, are you still thinking about {{instrument}} lessons?\n\n1️⃣ Yes, I’d like to schedule a free trial\n2️⃣ Maybe later\n3️⃣ I’m no longer interested\n4️⃣ I have a question\n\nJust reply with the number that fits best.',
  nurture_week12: 'Hi {{firstName}}, I wanted to make one last regular check-in about {{instrument}} lessons. Apollo will be here whenever the timing is right.\n\nAfter this, I’ll only reach out occasionally when relevant openings or new scheduling options come up. If you’d rather not receive those updates, just let me know.',
  nurture_long_term: 'Hi {{firstName}}, a couple of {{instrument}} trial openings have become available, so I wanted to check with you:\n\n1️⃣ [Day/Time 1]\n2️⃣ [Day/Time 2]\n\nWould either work for you?',
  trial_form_reminder: 'Hi {{firstName}},\n\nThe last step to confirm {{studentPossessive}} free {{instrument}} trial lesson on {{trialTime}} is to complete our registration form and reserve the time.\n\nWe do require a credit card on file to hold the appointment. The lesson itself is completely free; the card would only be charged the $35 fee if the lesson is canceled or rescheduled with less than 24 hours’ notice or if the student does not attend.\n\nPlease let me know if you need the registration link again or have any questions. I’m happy to help!',
}

export const messageTemplateGroups: { title: string; items: { key: string; label: string; variables: string[] }[] }[] = [
  {
    title: 'Active outreach (Day 0–8)',
    items: [
      { key: 'active_day0_voicemail', label: 'Day 0 · Voicemail', variables: ['firstName', 'instrument'] },
      { key: 'active_day0_text', label: 'Day 0 · Text', variables: ['firstName', 'instrument'] },
      { key: 'active_day2_text', label: 'Day 2 · Text', variables: ['firstName', 'instrument'] },
      { key: 'active_day5_text', label: 'Day 5 · Text', variables: ['firstName', 'instrument'] },
      { key: 'active_day8_voicemail', label: 'Day 8 · Voicemail', variables: ['firstName', 'instrument'] },
      { key: 'active_day8_text', label: 'Day 8 · Close-the-loop text', variables: ['firstName'] },
    ],
  },
  {
    title: 'Nurture check-ins',
    items: [
      { key: 'nurture_week2', label: 'Week 2', variables: ['firstName', 'instrument'] },
      { key: 'nurture_week4', label: 'Week 4', variables: ['firstName', 'instrument'] },
      { key: 'nurture_week6_openings', label: 'Week 6 · Openings available', variables: ['firstName', 'instrument'] },
      { key: 'nurture_week6_no_openings', label: 'Week 6 · No openings', variables: ['firstName', 'instrument'] },
      { key: 'nurture_week8', label: 'Week 8', variables: ['firstName', 'instrument'] },
      { key: 'nurture_week10', label: 'Week 10', variables: ['firstName', 'instrument'] },
      { key: 'nurture_week12', label: 'Week 12 · Final regular check-in', variables: ['firstName', 'instrument'] },
      { key: 'nurture_long_term', label: 'Long-term · Opening available', variables: ['firstName', 'instrument'] },
    ],
  },
  {
    title: 'Trial reminders',
    items: [
      { key: 'trial_form_reminder', label: 'Booking form reminder', variables: ['firstName', 'studentPossessive', 'instrument', 'trialTime'] },
    ],
  },
]

export function applyTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}
