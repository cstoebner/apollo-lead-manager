import type { Lead } from './types'
import { nurtureWeekFor } from './cadence'
import { applyTemplate, defaultMessageTemplates } from './messageTemplates'

const render = (templates: Record<string, string>, key: string, vars: Record<string, string>) => applyTemplate(templates[key] ?? defaultMessageTemplates[key], vars)

export function nurtureMessageFor(lead: Lead, contactAt: Date, hasOpenings = false, templates: Record<string, string> = defaultMessageTemplates) {
  const week = nurtureWeekFor(lead, contactAt)
  const vars = { firstName: lead.name.split(' ')[0], instrument: lead.instruments.map((item) => item.toLowerCase()).join(' and ') }

  if (week <= 2) return {
    label: 'Week 2 · Call, then text',
    message: render(templates, 'nurture_week2', vars),
    callFirst: true,
    needsTimes: false,
  }
  if (week <= 4) return {
    label: 'Week 4 · Text only',
    message: render(templates, 'nurture_week4', vars),
    callFirst: false,
    needsTimes: false,
  }
  if (week <= 6) return {
    label: 'Week 6 · Call, then availability text',
    message: hasOpenings ? render(templates, 'nurture_week6_openings', vars) : render(templates, 'nurture_week6_no_openings', vars),
    callFirst: true,
    needsTimes: hasOpenings,
  }
  if (week <= 8) return {
    label: 'Week 8 · Text only',
    message: render(templates, 'nurture_week8', vars),
    callFirst: false,
    needsTimes: false,
  }
  if (week <= 10) return {
    label: 'Week 10 · Call, then easy-response text',
    message: render(templates, 'nurture_week10', vars),
    callFirst: true,
    needsTimes: false,
  }
  if (week <= 12) return {
    label: 'Week 12 · Final regular nurture text',
    message: render(templates, 'nurture_week12', vars),
    callFirst: false,
    needsTimes: false,
  }
  return {
    label: 'Long-term · Relevant opening only',
    message: render(templates, 'nurture_long_term', vars),
    callFirst: false,
    needsTimes: true,
  }
}
