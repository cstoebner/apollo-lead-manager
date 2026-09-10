import type { Lead } from './types'
import { activeCadenceState } from './cadence'
import { applyTemplate, defaultMessageTemplates } from './messageTemplates'

const firstName = (lead: Lead) => lead.name.split(' ')[0]
const instrumentName = (lead: Lead) => lead.instruments.map((item) => item.toLowerCase()).join(' and ')
const render = (templates: Record<string, string>, key: string, vars: Record<string, string>) => applyTemplate(templates[key] ?? defaultMessageTemplates[key], vars)

export function activeFollowUpFor(lead: Lead, templates: Record<string, string> = defaultMessageTemplates) {
  const textCount = Math.min(activeCadenceState(lead).stage, 3)
  const vars = { firstName: firstName(lead), instrument: instrumentName(lead) }

  if (textCount === 0) return {
    label: 'Day 0 · Text 1',
    voicemailLabel: 'Day 0 voicemail',
    voicemail: render(templates, 'active_day0_voicemail', vars),
    message: render(templates, 'active_day0_text', vars),
    callFirst: true,
    needsTimes: true,
  }

  if (textCount === 1) return {
    label: 'Day 2 · Text 2',
    message: render(templates, 'active_day2_text', vars),
    callFirst: true,
    needsTimes: false,
  }

  if (textCount === 2) return {
    label: 'Day 5 · Text 3',
    message: render(templates, 'active_day5_text', vars),
    callFirst: true,
    needsTimes: true,
  }

  return {
    label: 'Day 8 · Close-the-loop text',
    voicemailLabel: 'Day 8 optional final voicemail',
    voicemail: render(templates, 'active_day8_voicemail', vars),
    message: render(templates, 'active_day8_text', vars),
    callFirst: true,
    needsTimes: false,
  }
}
