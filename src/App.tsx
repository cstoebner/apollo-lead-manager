import { useMemo, useState } from 'react'
import { activeFollowUpFor } from './activeTemplates'
import { nextContact, nextNurtureContact } from './cadence'
import { defaultAvailability, demoInstructorAvailability, demoInstructors, demoLeads, demoScheduleEntries, demoTrialOpenings } from './data'
import { nurtureMessageFor } from './nurtureTemplates'
import { isSupabaseConfigured } from './supabase'
import type { ActivityType, Instructor, InstructorAvailability, Lead, LeadStatus, ScheduleActivity, ScheduleEntry, ScheduleEntryKind, TrialOpening } from './types'

type View = 'today' | 'leads' | 'trials' | 'openings' | 'activity' | 'marketing' | 'settings'
type MessageTemplate = { label: string; message: string; needsTimes?: boolean }
type StartText = (lead: Lead, template?: MessageTemplate) => void
type TextDraft = { lead: Lead; label: string; message: string }
type ScheduleLogInput = Omit<ScheduleActivity, 'id' | 'occurredAt'>

const instruments = ['Piano', 'Guitar', 'Voice', 'Drums', 'Violin', 'Saxophone', 'Trumpet', 'Trombone']

const statusLabels: Record<LeadStatus, string> = {
  active_student: 'Active Student', hot: 'Hot', nurture: 'Nurture',
  nurture_long_term: 'Nurture Long Term', unresponsive: 'Unresponsive',
}

const touchCount = (lead: Lead) => lead.activities.filter((activity) => activity.type === 'call' || activity.type === 'text').length
const smsLink = (phone: string) => `sms:${phone.replace(/[^+\d]/g, '')}`

async function openMessages(phone: string, message?: string) {
  if (message) {
    try {
      await navigator.clipboard.writeText(message)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = message
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      textArea.remove()
    }
  }
  window.location.href = smsLink(phone)
}

const formatDate = (value: string | Date, includeTime = true) => new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
}).format(new Date(value))

const formatTrialTime = (value: string | Date) => new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value))

const toDateTimeInput = (date: Date) => {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

function App() {
  const [entered, setEntered] = useState(false)
  if (!entered) return <Welcome onEnter={() => setEntered(true)} />
  return <Workspace />
}

function Welcome({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="welcome-shell">
      <section className="welcome-card">
        <div className="brand-mark">A</div>
        <p className="eyebrow">Apollo Music Academy</p>
        <h1>Turn every new inquiry into a clear next step.</h1>
        <p className="welcome-copy">Follow up on time, fill more trials, and see exactly what your advertising produces.</p>
        <button className="primary jumbo" onClick={onEnter}>{isSupabaseConfigured ? 'Sign in' : 'Enter demo workspace'}</button>
        {!isSupabaseConfigured && <p className="demo-note">Demo mode uses sample leads only. Connect Supabase before using real data.</p>}
        <div className="recent-updates"><strong>Recently updated · August 1, 2026</strong><span>Open one recurring lesson date without removing the regular student.</span><span>Fill that absence with a trial or one-time lesson.</span><span>Restore an accidentally opened date from the calendar.</span></div>
      </section>
    </main>
  )
}

function Workspace() {
  const [view, setView] = useState<View>('today')
  const [leads, setLeads] = useState(demoLeads)
  const [instructors, setInstructors] = useState(demoInstructors)
  const [trialOpenings, setTrialOpenings] = useState(demoTrialOpenings)
  const [instructorAvailability, setInstructorAvailability] = useState(demoInstructorAvailability)
  const [scheduleEntries, setScheduleEntries] = useState(demoScheduleEntries)
  const [scheduleActivities, setScheduleActivities] = useState<ScheduleActivity[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quickNoteId, setQuickNoteId] = useState<string | null>(null)
  const [showNewLead, setShowNewLead] = useState(false)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
  const selected = leads.find((lead) => lead.id === selectedId)

  const startText: StartText = (lead, template) => {
    if (template?.needsTimes) {
      setTextDraft({ lead, label: template.label, message: template.message })
      return
    }
    void openMessages(lead.phone, template?.message)
  }

  const updateLead = (id: string, update: Partial<Lead>) => setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, ...update } : lead))
  const logActivity = (id: string, type: ActivityType) => setLeads((current) => current.map((lead) => lead.id === id ? {
    ...lead,
    activities: [...lead.activities, { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), outcome: type === 'call' ? 'Attempted call' : 'Message sent' }],
  } : lead))
  const changeStatus = (id: string, status: LeadStatus) => setLeads((current) => current.map((lead) => {
    if (lead.id !== id || lead.status === status) return lead
    return {
      ...lead,
      status,
      activities: [...lead.activities, {
        id: crypto.randomUUID(), type: 'status_change', occurredAt: new Date().toISOString(),
        outcome: `Status changed from ${statusLabels[lead.status]} to ${statusLabels[status]}`,
      }],
    }
  }))
  const deleteActivity = (leadId: string, activityId: string) => setLeads((current) => current.map((lead) => lead.id === leadId ? {
    ...lead,
    activities: lead.activities.filter((activity) => activity.id !== activityId),
  } : lead))
  const addNote = (id: string, note: string) => setLeads((current) => current.map((lead) => lead.id === id ? {
    ...lead,
    activities: [...lead.activities, { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: note.trim() }],
  } : lead))
  const logScheduleActivity = (activity: ScheduleLogInput) => setScheduleActivities((current) => [...current, { ...activity, id: crypto.randomUUID(), occurredAt: new Date().toISOString() }])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo"><span>A</span><div>Apollo<small>Lead manager</small></div></div>
        <nav>
          <NavButton active={view === 'today'} onClick={() => setView('today')} icon="⌂" label="Today" />
          <NavButton active={view === 'leads'} onClick={() => setView('leads')} icon="◎" label="All leads" />
          <NavButton active={view === 'trials'} onClick={() => setView('trials')} icon="◇" label="Trials" />
          <NavButton active={view === 'openings'} onClick={() => setView('openings')} icon="◫" label="Instructor schedule" />
          <NavButton active={view === 'activity'} onClick={() => setView('activity')} icon="≡" label="Activity log" />
          <NavButton active={view === 'marketing'} onClick={() => setView('marketing')} icon="↗" label="Marketing" />
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="⚙" label="Availability" />
        </nav>
        <div className="sidebar-foot"><span className="avatar">CS</span><div>Conor<small>{isSupabaseConfigured ? 'Connected' : 'Demo mode'}</small></div></div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div><p className="eyebrow">{formatDate(new Date(), false)}</p><h1>{view === 'today' ? 'Your follow-up plan' : view === 'leads' ? 'All leads' : view === 'trials' ? 'Trial pipeline' : view === 'openings' ? 'Instructor schedule' : view === 'activity' ? 'Activity log' : view === 'marketing' ? 'Advertising yield' : 'Contact availability'}</h1></div>
          <button className="primary" onClick={() => setShowNewLead(true)}>＋ New lead</button>
        </header>

        {view === 'today' && <Today leads={leads} trialOpenings={trialOpenings} onSelect={setSelectedId} onLog={logActivity} onTextNow={startText} onTakeNote={setQuickNoteId} />}
        {view === 'leads' && <LeadTable leads={leads} onSelect={setSelectedId} />}
        {view === 'trials' && <Trials leads={leads} onSelect={setSelectedId} onUpdate={updateLead} />}
        {view === 'openings' && <InstructorSchedule instructors={instructors} availability={instructorAvailability} entries={scheduleEntries} openings={trialOpenings} onInstructorsChange={setInstructors} onAvailabilityChange={setInstructorAvailability} onEntriesChange={setScheduleEntries} onOpeningsChange={setTrialOpenings} onScheduleLog={logScheduleActivity} />}
        {view === 'activity' && <ActivityLog leads={leads} scheduleActivities={scheduleActivities} onSelect={setSelectedId} onDelete={deleteActivity} onDeleteSchedule={(id) => setScheduleActivities((current) => current.filter((activity) => activity.id !== id))} />}
        {view === 'marketing' && <Marketing leads={leads} />}
        {view === 'settings' && <Settings />}
      </main>

      {selected && <LeadPanel lead={selected} trialOpenings={trialOpenings} onClose={() => setSelectedId(null)} onLog={logActivity} onAddNote={addNote} onTextNow={startText} onUpdate={updateLead} onStatusChange={changeStatus} onDelete={deleteActivity} />}
      {showNewLead && <NewLeadModal onClose={() => setShowNewLead(false)} onSave={(lead) => { setLeads((current) => [lead, ...current]); setShowNewLead(false) }} />}
      {quickNoteId && <QuickNoteModal lead={leads.find((lead) => lead.id === quickNoteId)!} onClose={() => setQuickNoteId(null)} onSave={(note) => { addNote(quickNoteId, note); setQuickNoteId(null) }} />}
      {textDraft && <TrialTimePicker draft={textDraft} openings={trialOpenings} onClose={() => setTextDraft(null)} onManage={() => { setTextDraft(null); setView('openings') }} onSend={(message) => { setTextDraft(null); void openMessages(textDraft.lead.phone, message) }} />}
    </div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return <button className={active ? 'nav-active' : ''} onClick={onClick}><span>{icon}</span>{label}</button>
}

function Today({ leads, trialOpenings, onSelect, onLog, onTextNow, onTakeNote }: { leads: Lead[]; trialOpenings: TrialOpening[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void; onTextNow: StartText; onTakeNote: (id: string) => void }) {
  const active = leads.filter((lead) => lead.status === 'hot' && !lead.trialAt)
  const pending = leads.filter((lead) => lead.status === 'hot' && Boolean(lead.trialAt) && (!lead.holdFormComplete || lead.trialAttended || new Date(lead.trialAt!).getTime() < Date.now()))
  const nurture = leads.filter((lead) => lead.status === 'nurture' || lead.status === 'nurture_long_term')
  const longTerm = nurture.filter((lead) => lead.status === 'nurture_long_term').length
  const queue = useMemo(() => active.map((lead) => ({ lead, recommendation: nextContact(lead, defaultAvailability) })).sort((a, b) => {
    const timeDifference = a.recommendation.at.getTime() - b.recommendation.at.getTime()
    return timeDifference || Date.parse(b.lead.receivedAt) - Date.parse(a.lead.receivedAt)
  }), [leads])
  const fresh = queue.filter(({ recommendation }) => recommendation.reason.includes('now')).length

  return <>
    <section className="stats-grid">
      <Stat value={String(queue.length)} label="Active follow-ups" note={fresh ? `${fresh} needs a quick response` : 'Current call and text cadence'} tone="coral" />
      <Stat value={String(pending.length)} label="Action pending" note="Forms, bookings, and trial closes" tone="gold" />
      <Stat value={String(nurture.length)} label="Nurture" note={`${longTerm} in long-term nurture`} tone="green" />
    </section>

    <section className="card queue-card">
      <div className="section-head"><div><h2>Next actions</h2><p>Ordered by urgency and your available calling times.</p></div><span className="live-pill">● Live plan</span></div>
      <div className="queue-list">
        {queue.map(({ lead, recommendation }, index) => {
          const template = activeFollowUpFor(lead)
          return <article className="queue-row" key={lead.id}>
            <div className={`priority ${recommendation.reason.includes('now') ? 'urgent' : ''}`}>{index + 1}</div>
            <div className="lead-main" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{lead.instrument} · {lead.source}</span></div>
            <div className="recommendation"><strong>{recommendation.reason.includes('now') ? 'Now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span><em>{template.label}</em>{template.needsTimes && <small>Two trial times still need to be filled in.</small>}</div>
            <div className="row-actions"><button onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><button onClick={() => onLog(lead.id, 'text')}>✓ Log text</button><button onClick={() => onTakeNote(lead.id)}>✎ Take note</button><button className="text-now" onClick={() => onTextNow(lead, template)}>↗ Text now</button></div>
          </article>
        })}
      </div>
    </section>
    <PendingActions leads={pending} onSelect={onSelect} onLog={onLog} onTextNow={onTextNow} onTakeNote={onTakeNote} />
    <NurtureCadence leads={nurture} trialOpenings={trialOpenings} onSelect={onSelect} onLog={onLog} onTextNow={onTextNow} onTakeNote={onTakeNote} />
  </>
}

function PendingActions({ leads, onSelect, onLog, onTextNow, onTakeNote }: { leads: Lead[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void; onTextNow: StartText; onTakeNote: (id: string) => void }) {
  if (!leads.length) return null
  return <section className="card pending-card">
    <div className="section-head"><div><h2>Action pending</h2><p>These leads have moved beyond the outreach cadence and need a specific next step.</p></div></div>
    <div className="pending-list">{leads.map((lead) => {
      const action = lead.trialAttended || new Date(lead.trialAt!).getTime() < Date.now() ? 'Follow up and close enrollment' : 'Get the trial hold form completed'
      return <article key={lead.id} className="pending-row">
        <button className="pending-person" onClick={() => onSelect(lead.id)}><span><strong>{lead.name}</strong><small>{lead.instrument} · {statusLabels[lead.status]}</small></span><b>{action}</b><i>→</i></button>
        <div className="row-actions"><button onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><button onClick={() => onLog(lead.id, 'text')}>✓ Log text</button><button onClick={() => onTakeNote(lead.id)}>✎ Take note</button><button onClick={() => onTextNow(lead)}>↗ Text now</button></div>
      </article>
    })}</div>
  </section>
}

function NurtureCadence({ leads, trialOpenings, onSelect, onLog, onTextNow, onTakeNote }: { leads: Lead[]; trialOpenings: TrialOpening[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void; onTextNow: StartText; onTakeNote: (id: string) => void }) {
  if (!leads.length) return null
  const recommendations = leads.map((lead) => ({ lead, recommendation: nextNurtureContact(lead, defaultAvailability) }))
    .sort((a, b) => a.recommendation.at.getTime() - b.recommendation.at.getTime())

  return <section className="card nurture-card">
    <div className="section-head"><div><h2>Nurture cadence</h2><p>Text Now copies the matched personalized message and opens Messages.</p></div></div>
    <div className="nurture-list">{recommendations.map(({ lead, recommendation }) => {
      const matchingOpenings = trialOpenings.filter((opening) => opening.instruments.some((instrument) => instrument.toLowerCase() === lead.instrument.toLowerCase()) && Date.parse(opening.startsAt) > Date.now())
      const template = nurtureMessageFor(lead, recommendation.at, matchingOpenings.length >= 2)
      return <article className="nurture-row" key={lead.id}>
        <button className="nurture-person" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{statusLabels[lead.status]} · {lead.instrument}</span></button>
        <div className="nurture-next"><strong>{formatDate(recommendation.at)}</strong><span>{recommendation.reason} · {template.callFirst ? 'Call, then text' : 'Text only'}</span><em>{template.label}</em><small title={template.message}>{template.message}</small></div>
        <div className="row-actions"><button onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><button onClick={() => onLog(lead.id, 'text')}>✓ Log text</button><button onClick={() => onTakeNote(lead.id)}>✎ Take note</button><button className="text-now" onClick={() => onTextNow(lead, template)}>↗ Text now</button></div>
      </article>
    })}</div>
  </section>
}

function Stat({ value, label, note, tone }: { value: string; label: string; note: string; tone: string }) {
  return <div className={`stat-card ${tone}`}><span className="stat-value">{value}</span><strong>{label}</strong><small>{note}</small></div>
}

function LeadTable({ leads, onSelect }: { leads: Lead[]; onSelect: (id: string) => void }) {
  return <section className="card"><div className="section-head"><div><h2>Lead directory</h2><p>{leads.length} total leads in this workspace</p></div><input className="search" placeholder="Search leads" /></div>
    <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Received</th><th>Source</th><th>Touches</th><th>Status</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id} onClick={() => onSelect(lead.id)}><td><strong>{lead.name}</strong><small>{lead.instrument}</small></td><td>{formatDate(lead.receivedAt)}</td><td>{lead.source}<small>{lead.campaign}</small></td><td>{touchCount(lead)}</td><td><span className={`status ${lead.status}`}>{statusLabels[lead.status]}</span></td></tr>)}</tbody></table></div>
  </section>
}

function Trials({ leads, onSelect, onUpdate }: { leads: Lead[]; onSelect: (id: string) => void; onUpdate: (id: string, update: Partial<Lead>) => void }) {
  const trials = leads.filter((lead) => lead.trialAt)
  return <section className="card"><div className="section-head"><div><h2>Trial readiness</h2><p>See what must happen before each lesson.</p></div></div><div className="trial-grid">{trials.map((lead) => <article key={lead.id} className="trial-card"><div className="trial-date"><strong>{new Date(lead.trialAt!).getDate()}</strong><span>{new Date(lead.trialAt!).toLocaleDateString('en-US', { month: 'short' })}</span></div><div className="trial-info" onClick={() => onSelect(lead.id)}><h3>{lead.name}</h3><p>{lead.instrument} · {formatDate(lead.trialAt!)}</p><label><input type="checkbox" checked={lead.holdFormComplete} onChange={(event) => onUpdate(lead.id, { holdFormComplete: event.target.checked })} /> Hold form complete</label><label><input type="checkbox" checked={lead.trialAttended} onChange={(event) => onUpdate(lead.id, { trialAttended: event.target.checked })} /> Attended trial</label></div></article>)}</div></section>
}

function ActivityLog({ leads, scheduleActivities, onSelect, onDelete, onDeleteSchedule }: { leads: Lead[]; scheduleActivities: ScheduleActivity[]; onSelect: (id: string) => void; onDelete: (leadId: string, activityId: string) => void; onDeleteSchedule: (id: string) => void }) {
  const [range, setRange] = useState<'month' | 'year'>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const allEntries = [
    ...leads.flatMap((lead) => lead.activities.map((activity) => ({ kind: 'lead' as const, lead, activity, occurredAt: activity.occurredAt }))),
    ...scheduleActivities.map((activity) => ({ kind: 'schedule' as const, activity, occurredAt: activity.occurredAt })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const entries = allEntries.filter((entry) => {
    const date = new Date(entry.occurredAt)
    return date.getFullYear() === anchor.getFullYear() && (range === 'year' || date.getMonth() === anchor.getMonth())
  })
  const periodLabel = range === 'month'
    ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : String(anchor.getFullYear())

  const shiftPeriod = (direction: number) => setAnchor((current) => {
    const next = new Date(current)
    if (range === 'month') next.setMonth(next.getMonth() + direction)
    else next.setFullYear(next.getFullYear() + direction)
    return next
  })

  const exportCsv = () => {
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
    const rows = entries.map((entry) => {
      if (entry.kind === 'lead') {
        const action = entry.activity.type === 'call' ? 'Call logged' : entry.activity.type === 'text' ? 'Text logged' : entry.activity.type === 'note' ? 'Note added' : entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.outcome
        return [new Date(entry.occurredAt).toLocaleString('en-US'), 'Lead', entry.lead.name, '', action, entry.activity.outcome]
      }
      return [new Date(entry.occurredAt).toLocaleString('en-US'), 'Schedule', entry.activity.studentName ?? '', entry.activity.instructor, entry.activity.action, entry.activity.details]
    })
    const csv = [['Date', 'Category', 'Person', 'Instructor', 'Action', 'Details'], ...rows].map((row) => row.map(cell).join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `apollo-activity-${range === 'month' ? `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}` : anchor.getFullYear()}.csv`
    link.click(); URL.revokeObjectURL(url)
  }

  const remove = (leadId: string, activityId: string) => {
    if (window.confirm('Delete this activity?')) onDelete(leadId, activityId)
  }
  const removeSchedule = (id: string) => {
    if (window.confirm('Delete this schedule log entry? This will not undo the calendar change.')) onDeleteSchedule(id)
  }

  return <section className="card activity-card">
    <div className="section-head activity-head"><div><h2>Activity history</h2><p>Lead communication and instructor schedule changes, newest first.</p></div><div className="activity-controls"><div className="range-toggle"><button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>Month</button><button className={range === 'year' ? 'active' : ''} onClick={() => setRange('year')}>Year</button></div><div className="period-switch"><button onClick={() => shiftPeriod(-1)}>←</button><strong>{periodLabel}</strong><button onClick={() => shiftPeriod(1)}>→</button></div><button className="export-button" disabled={!entries.length} onClick={exportCsv}>⇩ Export CSV</button><span className="count-pill">{entries.length} actions</span></div></div>
    <div className="activity-list">
      {entries.map((entry) => entry.kind === 'lead' ? <article className="activity-row" key={`lead-${entry.activity.id}`}>
        <div className={`activity-icon ${entry.activity.type}`}>{entry.activity.type === 'call' ? '☎' : entry.activity.type === 'text' ? '↗' : entry.activity.type === 'note' ? '✎' : entry.activity.type === 'status_change' ? '↻' : '•'}</div>
        <button className="activity-person" onClick={() => onSelect(entry.lead.id)}><strong>{entry.lead.name}</strong><span>{entry.lead.instrument} · {entry.lead.phone}</span></button>
        <div className="activity-detail"><strong>{entry.activity.type === 'call' ? 'Call logged' : entry.activity.type === 'text' ? 'Text logged' : entry.activity.type === 'note' ? 'Note added' : entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.outcome}</strong><span>{entry.activity.outcome}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        {(entry.activity.type === 'call' || entry.activity.type === 'text' || entry.activity.type === 'note') && <button className="delete-action" onClick={() => remove(entry.lead.id, entry.activity.id)} aria-label={`Delete ${entry.activity.type} for ${entry.lead.name}`}>Delete</button>}
      </article> : <article className="activity-row" key={`schedule-${entry.activity.id}`}>
        <div className="activity-icon schedule">◫</div>
        <div className="activity-person static"><strong>{entry.activity.studentName ?? entry.activity.instructor}</strong><span>{entry.activity.studentName ? `${entry.activity.instructor} · Instructor schedule` : 'Instructor schedule'}</span></div>
        <div className="activity-detail"><strong>{entry.activity.action}</strong><span>{entry.activity.details}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        <button className="delete-action" onClick={() => removeSchedule(entry.activity.id)}>Delete</button>
      </article>)}
      {!entries.length && <div className="empty-state"><strong>No activity in {periodLabel}</strong><span>Use the arrows or switch to the yearly view.</span></div>}
    </div>
  </section>
}

function Marketing({ leads }: { leads: Lead[] }) {
  const sources = Object.values(leads.reduce<Record<string, { source: string; leads: number; spend: number; students: number }>>((result, lead) => {
    result[lead.source] ??= { source: lead.source, leads: 0, spend: 0, students: 0 }
    result[lead.source].leads += 1; result[lead.source].spend += lead.adCost; result[lead.source].students += lead.status === 'active_student' ? 1 : 0
    return result
  }, {}))
  const totalSpend = sources.reduce((sum, item) => sum + item.spend, 0)
  return <><section className="stats-grid"><Stat value={`$${totalSpend}`} label="Tracked spend" note={`$${Math.round(totalSpend / leads.length)} per lead`} tone="coral" /><Stat value={String(leads.length)} label="Leads generated" note="Across all campaigns" tone="gold" /><Stat value={`$${Math.round(totalSpend / Math.max(1, leads.filter(l => l.status === 'active_student').length))}`} label="Cost per student" note="Based on enrollments" tone="green" /></section><section className="card"><div className="section-head"><div><h2>Performance by source</h2><p>Use this to decide where the next advertising dollar goes.</p></div></div><div className="source-list">{sources.map((item) => <div className="source-row" key={item.source}><strong>{item.source}</strong><span>{item.leads} leads</span><div className="bar"><i style={{ width: `${Math.max(10, item.leads / leads.length * 100)}%` }} /></div><span>${Math.round(item.spend / item.leads)}/lead</span><span>{item.students} students</span></div>)}</div></section></>
}

function Settings() {
  return <section className="settings-grid"><div className="card setting-card"><h2>Weekly availability</h2><p>Recommendations will land inside these windows.</p><div className="schedule-row"><span>Monday–Friday</span><strong>4:30–8:00 PM</strong></div><div className="schedule-row"><span>Saturday–Sunday</span><strong>10:00 AM–4:00 PM</strong></div><div className="blackout"><strong>Recurring exceptions</strong><span>Tuesday 5:00–5:30 PM</span><span>Thursday 4:30–5:30 PM</span></div><button className="secondary">Edit availability</button></div><div className="card setting-card"><h2>Calendar rules</h2><p>The follow-up plan automatically recognizes the day of week and major U.S. holidays.</p><label className="toggle-row"><span><strong>Avoid major holidays</strong><small>Move planned outreach to the next open day</small></span><input type="checkbox" defaultChecked /></label><label className="toggle-row"><span><strong>Allow weekend outreach</strong><small>Use your weekend availability for fresh leads</small></span><input type="checkbox" defaultChecked /></label></div></section>
}

const scheduleDays = [
  { label: 'Monday', short: 'Mon', dayOfWeek: 1 }, { label: 'Tuesday', short: 'Tue', dayOfWeek: 2 },
  { label: 'Wednesday', short: 'Wed', dayOfWeek: 3 }, { label: 'Thursday', short: 'Thu', dayOfWeek: 4 },
  { label: 'Friday', short: 'Fri', dayOfWeek: 5 }, { label: 'Saturday', short: 'Sat', dayOfWeek: 6 },
]
const scheduleTimes = Array.from({ length: 23 }, (_, index) => {
  const minutes = 600 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
const timeMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const startOfScheduleWeek = (value: Date) => {
  const result = new Date(value)
  const offset = result.getDay() === 0 ? -6 : 1 - result.getDay()
  result.setDate(result.getDate() + offset); result.setHours(0, 0, 0, 0)
  return result
}
const datePlusDays = (value: Date, days: number) => { const result = new Date(value); result.setDate(result.getDate() + days); return result }
const dateAtTime = (date: Date, time: string) => {
  const result = new Date(date); result.setHours(Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0, 0); return result
}
const localDateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const formatClock = (time: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(dateAtTime(new Date(), time))

function slotIsAvailable(availability: InstructorAvailability[], instructorId: string, dayOfWeek: number, time: string) {
  const minute = timeMinutes(time)
  return availability.some((block) => block.instructorId === instructorId && block.dayOfWeek === dayOfWeek && minute >= timeMinutes(block.startTime) && minute < timeMinutes(block.endTime))
}

function entryAtSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  return entries.find((entry) => {
    if (entry.instructorId !== instructorId) return false
    if (entry.kind === 'regular') {
      if (entry.dayOfWeek !== date.getDay() || entry.startTime !== time) return false
      const key = localDateKey(date)
      if (entry.skippedDates?.includes(key)) return false
      return (!entry.startsOn || key >= entry.startsOn) && (!entry.endsOn || key <= entry.endsOn)
    }
    if (!entry.startsAt) return false
    const startsAt = new Date(entry.startsAt)
    return localDateKey(startsAt) === localDateKey(date) && `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}` === time
  })
}

function skippedRegularAtSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  const key = localDateKey(date)
  return entries.find((entry) => entry.instructorId === instructorId
    && entry.kind === 'regular'
    && entry.dayOfWeek === date.getDay()
    && entry.startTime === time
    && (!entry.startsOn || key >= entry.startsOn)
    && (!entry.endsOn || key <= entry.endsOn)
    && entry.skippedDates?.includes(key))
}

function upcomingEntriesAtSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  const displayedSlot = dateAtTime(date, time)
  const cutoff = datePlusDays(displayedSlot, 42)
  return entries.filter((entry) => {
    if (entry.instructorId !== instructorId) return false
    if (entry.kind === 'regular') {
      if (!entry.startsOn || entry.dayOfWeek !== date.getDay() || entry.startTime !== time) return false
      const begins = new Date(`${entry.startsOn}T${entry.startTime}:00`)
      return begins > displayedSlot && begins <= cutoff
    }
    if (!entry.startsAt) return false
    const startsAt = new Date(entry.startsAt)
    const entryTime = `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
    return startsAt > displayedSlot && startsAt <= cutoff && startsAt.getDay() === date.getDay() && entryTime === time
  }).sort((a, b) => upcomingEntryDate(a).getTime() - upcomingEntryDate(b).getTime())
}

function upcomingEntryDate(entry: ScheduleEntry) {
  return entry.kind === 'regular' ? new Date(`${entry.startsOn}T${entry.startTime}:00`) : new Date(entry.startsAt!)
}

function UpcomingSlotNotes({ entries }: { entries: ScheduleEntry[] }) {
  if (!entries.length) return null
  return <span className="upcoming-notes">{entries.slice(0, 3).map((entry) => <small key={entry.id}>{upcomingEntryDate(entry).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} {entry.kind === 'regular' ? 'Starts' : entry.kind === 'trial' ? 'Trial' : 'One-time'}: {entry.studentName}</small>)}{entries.length > 3 && <small>+{entries.length - 3} more</small>}</span>
}

function describeScheduleEntry(entry: ScheduleEntry) {
  if (entry.kind === 'regular') return `${entry.instrument} · Every ${scheduleDays.find((day) => day.dayOfWeek === entry.dayOfWeek)?.label} at ${formatClock(entry.startTime!)} · Starting ${new Date(`${entry.startsOn}T00:00:00`).toLocaleDateString('en-US')}`
  return `${entry.instrument} · ${entry.kind === 'trial' ? 'Trial' : 'One-time lesson'} · ${formatTrialTime(entry.startsAt!)}`
}

function InstructorSchedule({ instructors, availability, entries, openings, onInstructorsChange, onAvailabilityChange, onEntriesChange, onOpeningsChange, onScheduleLog }: {
  instructors: Instructor[]
  availability: InstructorAvailability[]
  entries: ScheduleEntry[]
  openings: TrialOpening[]
  onInstructorsChange: (value: Instructor[]) => void
  onAvailabilityChange: (value: InstructorAvailability[]) => void
  onEntriesChange: (value: ScheduleEntry[]) => void
  onOpeningsChange: (value: TrialOpening[]) => void
  onScheduleLog: (activity: ScheduleLogInput) => void
}) {
  const [instructorId, setInstructorId] = useState(instructors[0].id)
  const instructor = instructors.find((item) => item.id === instructorId) ?? instructors[0]
  const [weekStart, setWeekStart] = useState(() => startOfScheduleWeek(new Date()))
  const [availabilityDay, setAvailabilityDay] = useState(1)
  const [availabilityStart, setAvailabilityStart] = useState('16:30')
  const [availabilityEnd, setAvailabilityEnd] = useState('20:00')
  const [newInstructorName, setNewInstructorName] = useState('')
  const [newInstructorInstruments, setNewInstructorInstruments] = useState<string[]>([])
  const [slotEditor, setSlotEditor] = useState<{ date: Date; time: string; entry?: ScheduleEntry } | null>(null)
  const weekDates = scheduleDays.map((_, index) => datePlusDays(weekStart, index))
  const instructorOpenings = openings.filter((opening) => opening.instructor === instructor.name && Date.parse(opening.startsAt) > Date.now())

  const changeInstructor = (id: string) => {
    const next = instructors.find((item) => item.id === id) ?? instructors[0]
    setInstructorId(id); setSlotEditor(null)
  }

  const toggleOpening = (date: Date, time: string) => {
    const startsAt = dateAtTime(date, time)
    const existing = openings.find((opening) => opening.instructor === instructor.name && new Date(opening.startsAt).getTime() === startsAt.getTime())
    if (existing) {
      onOpeningsChange(openings.filter((opening) => opening.id !== existing.id))
      onScheduleLog({ action: 'Trial opening removed', instructor: instructor.name, details: `${formatTrialTime(startsAt)} · ${instructor.instruments.join(' / ')}` })
    } else {
      onOpeningsChange([...openings, { id: crypto.randomUUID(), instructor: instructor.name, instruments: instructor.instruments, startsAt: startsAt.toISOString() }])
      onScheduleLog({ action: 'Trial opening added', instructor: instructor.name, details: `${formatTrialTime(startsAt)} · ${instructor.instruments.join(' / ')}` })
    }
  }

  const addAvailability = () => {
    if (timeMinutes(availabilityStart) >= timeMinutes(availabilityEnd)) { window.alert('The ending time must be after the starting time.'); return }
    onAvailabilityChange([...availability, { id: crypto.randomUUID(), instructorId: instructor.id, dayOfWeek: availabilityDay, startTime: availabilityStart, endTime: availabilityEnd }])
    onScheduleLog({ action: 'Availability added', instructor: instructor.name, details: `${scheduleDays.find((day) => day.dayOfWeek === availabilityDay)?.label} · ${formatClock(availabilityStart)}–${formatClock(availabilityEnd)}` })
  }

  const removeAvailability = (block: InstructorAvailability) => {
    onAvailabilityChange(availability.filter((item) => item.id !== block.id))
    onScheduleLog({ action: 'Availability removed', instructor: instructor.name, details: `${scheduleDays.find((day) => day.dayOfWeek === block.dayOfWeek)?.label} · ${formatClock(block.startTime)}–${formatClock(block.endTime)}` })
  }

  const addInstructor = () => {
    const name = newInstructorName.trim()
    if (!name) return
    if (!newInstructorInstruments.length) { window.alert('Select at least one instrument.'); return }
    if (instructors.some((item) => item.name.toLowerCase() === name.toLowerCase())) { window.alert('That instructor already exists.'); return }
    const next = { id: crypto.randomUUID(), name, instruments: newInstructorInstruments }
    onInstructorsChange([...instructors, next]); setInstructorId(next.id); setNewInstructorName(''); setNewInstructorInstruments([])
    onScheduleLog({ action: 'Instructor added', instructor: name, details: newInstructorInstruments.join(' / ') })
  }

  const removeInstructor = (item: Instructor) => {
    if (instructors.length === 1) { window.alert('At least one instructor must remain.'); return }
    if (!window.confirm(`Remove ${item.name}? Their availability, scheduled lessons, and trial openings will also be removed.`)) return
    const remaining = instructors.filter((instructorItem) => instructorItem.id !== item.id)
    onInstructorsChange(remaining)
    onAvailabilityChange(availability.filter((block) => block.instructorId !== item.id))
    onEntriesChange(entries.filter((entry) => entry.instructorId !== item.id))
    onOpeningsChange(openings.filter((opening) => opening.instructor !== item.name))
    if (instructorId === item.id) setInstructorId(remaining[0].id)
    onScheduleLog({ action: 'Instructor removed', instructor: item.name, details: `${item.instruments.join(' / ')} · Schedule data removed` })
  }

  const saveEntry = (next: ScheduleEntry) => {
    const existing = entries.find((entry) => entry.id === next.id)
    const date = next.kind === 'regular' ? new Date(`${next.startsOn}T${next.startTime}:00`) : new Date(next.startsAt!)
    const time = next.kind === 'regular' ? next.startTime! : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    if (next.kind === 'regular' && date.getDay() !== next.dayOfWeek) { window.alert(`The start date must fall on ${scheduleDays.find((day) => day.dayOfWeek === next.dayOfWeek)?.label}.`); return }
    if (!slotIsAvailable(availability, instructor.id, date.getDay(), time)) { window.alert(`${instructor.name} is not marked available at that time.`); return }
    if (next.kind === 'regular') {
      const nextStart = next.startsOn ?? '0000-00-00'
      const nextEnd = next.endsOn ?? '9999-12-31'
      const recurringConflict = entries.some((entry) => entry.id !== next.id
        && entry.instructorId === instructor.id
        && entry.kind === 'regular'
        && entry.dayOfWeek === next.dayOfWeek
        && entry.startTime === next.startTime
        && (entry.startsOn ?? '0000-00-00') <= nextEnd
        && nextStart <= (entry.endsOn ?? '9999-12-31'))
      if (recurringConflict) { window.alert('Another regular student already owns this weekly time. Open a specific absence date, then add a trial or one-time lesson there.'); return }
    }
    if (entryAtSlot(entries.filter((entry) => entry.id !== next.id), instructor.id, date, time)) { window.alert('That time is already occupied.'); return }
    onEntriesChange(entries.some((entry) => entry.id === next.id) ? entries.map((entry) => entry.id === next.id ? next : entry) : [...entries, next])
    onOpeningsChange(openings.filter((opening) => {
      if (opening.instructor !== instructor.name) return true
      const openingDate = new Date(opening.startsAt)
      if (next.kind === 'regular') {
        const openingTime = `${String(openingDate.getHours()).padStart(2, '0')}:${String(openingDate.getMinutes()).padStart(2, '0')}`
        return openingDate.getDay() !== next.dayOfWeek || openingTime !== next.startTime || localDateKey(openingDate) < next.startsOn!
      }
      return openingDate.getTime() !== date.getTime()
    }))
    onScheduleLog({
      action: existing ? 'Scheduled lesson updated' : 'Scheduled lesson added',
      instructor: instructor.name,
      studentName: next.studentName,
      details: existing ? `${describeScheduleEntry(existing)} → ${describeScheduleEntry(next)}` : describeScheduleEntry(next),
    })
    setSlotEditor(null)
  }

  const removeEntry = (entry: ScheduleEntry) => {
    if (!window.confirm(`Remove ${entry.studentName} from the schedule?`)) return
    onEntriesChange(entries.filter((item) => item.id !== entry.id))
    onScheduleLog({ action: 'Scheduled lesson removed', instructor: instructor.name, studentName: entry.studentName, details: describeScheduleEntry(entry) })
    setSlotEditor(null)
  }

  const skipRegularDate = (entry: ScheduleEntry, date: Date) => {
    const key = localDateKey(date)
    onEntriesChange(entries.map((item) => item.id === entry.id ? { ...item, skippedDates: Array.from(new Set([...(item.skippedDates ?? []), key])) } : item))
    onScheduleLog({ action: 'Regular lesson marked absent', instructor: instructor.name, studentName: entry.studentName, details: `${date.toLocaleDateString('en-US')} at ${formatClock(entry.startTime!)}` })
    setSlotEditor(null)
  }

  const restoreRegularDate = (entry: ScheduleEntry, date: Date) => {
    const key = localDateKey(date)
    onEntriesChange(entries.map((item) => item.id === entry.id ? { ...item, skippedDates: (item.skippedDates ?? []).filter((skipped) => skipped !== key) } : item))
    onScheduleLog({ action: 'Regular lesson restored', instructor: instructor.name, studentName: entry.studentName, details: `${date.toLocaleDateString('en-US')} at ${formatClock(entry.startTime!)}` })
  }

  return <section className="schedule-page">
    <div className="card schedule-toolbar">
      <label>Instructor<select value={instructor.id} onChange={(event) => changeInstructor(event.target.value)}>{instructors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <div className="week-switcher"><button onClick={() => setWeekStart(datePlusDays(weekStart, -7))}>←</button><strong>{weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{datePlusDays(weekStart, 5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong><button onClick={() => setWeekStart(datePlusDays(weekStart, 7))}>→</button></div>
    </div>

    <div className="schedule-legend"><span className="legend-open">Available</span><span className="legend-regular">🔒 Regular student</span><span className="legend-dated">Dated lesson</span><span className="legend-offered">Trial opening</span><small>Click an available green cell to add or remove it from Text Now.</small></div>

    <div className="schedule-layout">
      <aside className="schedule-sidebar">
        <div className="card schedule-setup">
          <h2>Weekly availability</h2><p>Green hours repeat every week.</p>
          <label className="field">Day<select value={availabilityDay} onChange={(event) => setAvailabilityDay(Number(event.target.value))}>{scheduleDays.map((day) => <option value={day.dayOfWeek} key={day.dayOfWeek}>{day.label}</option>)}</select></label>
          <div className="field-pair"><label className="field">From<input type="time" step="1800" value={availabilityStart} onChange={(event) => setAvailabilityStart(event.target.value)} /></label><label className="field">To<input type="time" step="1800" value={availabilityEnd} onChange={(event) => setAvailabilityEnd(event.target.value)} /></label></div>
          <button className="secondary full" onClick={addAvailability}>＋ Add available hours</button>
          <div className="availability-chips">{availability.filter((block) => block.instructorId === instructor.id).map((block) => <span key={block.id}>{scheduleDays.find((day) => day.dayOfWeek === block.dayOfWeek)?.short} {formatClock(block.startTime)}–{formatClock(block.endTime)}<button onClick={() => removeAvailability(block)}>×</button></span>)}</div>
        </div>

        <div className="card schedule-setup instructor-manager">
          <h2>Instructors</h2><p>Add or remove teachers from this schedule.</p>
          <label className="field">Name<input value={newInstructorName} onChange={(event) => setNewInstructorName(event.target.value)} placeholder="Instructor name" /></label>
          <div className="instrument-checks">{instruments.map((item) => <label key={item}><input type="checkbox" checked={newInstructorInstruments.includes(item)} onChange={(event) => setNewInstructorInstruments((current) => event.target.checked ? [...current, item] : current.filter((instrument) => instrument !== item))} /> {item}</label>)}</div>
          <button className="secondary full" onClick={addInstructor}>＋ Add instructor</button>
          <div className="instructor-list">{instructors.map((item) => <span key={item.id}><b>{item.name}</b><small>{item.instruments.join(' / ')}</small><button title={`Remove ${item.name}`} onClick={() => removeInstructor(item)}>×</button></span>)}</div>
        </div>

        <div className="card schedule-tip"><strong>Add or edit lessons from the calendar</strong><p>Use the small <b>+</b> on an open slot to schedule a student. Click an occupied slot to edit it.</p></div>
      </aside>

      <div className="card schedule-board">
        <div className="schedule-grid">
          <div className="schedule-corner">Time</div>{weekDates.map((date, index) => <div className="schedule-day" key={date.toISOString()}><strong>{scheduleDays[index].short}</strong><small>{date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</small></div>)}
          {scheduleTimes.flatMap((time) => [<div className="schedule-time" key={`time-${time}`}>{formatClock(time)}</div>, ...weekDates.map((date) => {
            const available = slotIsAvailable(availability, instructor.id, date.getDay(), time)
            const entry = entryAtSlot(entries, instructor.id, date, time)
            const skippedRegular = entry ? undefined : skippedRegularAtSlot(entries, instructor.id, date, time)
            const startsAt = dateAtTime(date, time)
            const opening = openings.find((item) => item.instructor === instructor.name && new Date(item.startsAt).getTime() === startsAt.getTime())
            const upcoming = upcomingEntriesAtSlot(entries, instructor.id, date, time)
            const past = startsAt < new Date()
            const className = entry ? `schedule-cell ${entry.kind === 'regular' ? 'regular' : 'dated'}` : skippedRegular ? 'schedule-cell absence' : opening ? 'schedule-cell offered' : available ? `schedule-cell open${past ? ' past' : ''}` : 'schedule-cell unavailable'
            return <div className={className} key={`${localDateKey(date)}-${time}`}>
              {entry ? <button type="button" className="cell-main" onClick={() => setSlotEditor({ date, time, entry })}><strong>{entry.kind === 'regular' ? '🔒 ' : ''}{entry.studentName}</strong><small>{entry.kind === 'regular' ? 'Regular' : `${entry.kind === 'trial' ? 'Trial' : 'One-time'} · ${date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`}</small><UpcomingSlotNotes entries={upcoming} /></button>
                : available ? <><button type="button" disabled={past} className="cell-main" onClick={() => toggleOpening(date, time)}>{opening ? <><strong>✓ Trial opening</strong><small>{opening.instruments.join(' / ')}</small></> : skippedRegular ? <><strong>Open this week</strong><small>{skippedRegular.studentName} absent</small></> : <span>{past ? '' : 'Open'}</span>}<UpcomingSlotNotes entries={upcoming} /></button>{!past && <button type="button" className="cell-add" title="Schedule a student here" onClick={() => setSlotEditor({ date, time })}>＋</button>}{skippedRegular && !past && <button type="button" className="cell-restore" title={`Restore ${skippedRegular.studentName}'s regular lesson`} onClick={() => restoreRegularDate(skippedRegular, date)}>↶</button>}</>
                  : <UpcomingSlotNotes entries={upcoming} />}
            </div>
          })])}
        </div>
      </div>
    </div>
    <div className="selected-opening-summary"><strong>{instructorOpenings.length} upcoming {instructor.name} trial opening{instructorOpenings.length === 1 ? '' : 's'} available to Text Now</strong></div>
    {slotEditor && <ScheduleEntryEditor instructor={instructor} slot={slotEditor} onClose={() => setSlotEditor(null)} onSave={saveEntry} onDelete={slotEditor.entry ? () => removeEntry(slotEditor.entry!) : undefined} onSkipDate={slotEditor.entry?.kind === 'regular' ? () => skipRegularDate(slotEditor.entry!, slotEditor.date) : undefined} />}
  </section>
}

function ScheduleEntryEditor({ instructor, slot, onClose, onSave, onDelete, onSkipDate }: {
  instructor: Instructor
  slot: { date: Date; time: string; entry?: ScheduleEntry }
  onClose: () => void
  onSave: (entry: ScheduleEntry) => void
  onDelete?: () => void
  onSkipDate?: () => void
}) {
  const existing = slot.entry
  const initialDate = existing?.startsAt ? new Date(existing.startsAt) : dateAtTime(slot.date, slot.time)
  const [studentName, setStudentName] = useState(existing?.studentName ?? '')
  const [kind, setKind] = useState<ScheduleEntryKind>(existing?.kind ?? 'regular')
  const [instrument, setInstrument] = useState(existing?.instrument ?? instructor.instruments[0])
  const [dayOfWeek, setDayOfWeek] = useState(existing?.dayOfWeek ?? slot.date.getDay())
  const [time, setTime] = useState(existing?.startTime ?? slot.time)
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? localDateKey(slot.date))
  const [startsAt, setStartsAt] = useState(() => toDateTimeInput(initialDate))

  const save = () => {
    if (!studentName.trim()) return
    const base = { id: existing?.id ?? crypto.randomUUID(), instructorId: instructor.id, studentName: studentName.trim(), instrument, kind }
    onSave(kind === 'regular' ? { ...base, dayOfWeek, startTime: time, startsOn, endsOn: existing?.endsOn, skippedDates: existing?.skippedDates } : { ...base, startsAt: new Date(startsAt).toISOString() })
  }

  return <div className="overlay modal-overlay schedule-editor-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal schedule-editor">
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">{existing ? 'Edit scheduled lesson' : 'Add scheduled lesson'}</p>
    <h2>{existing ? existing.studentName : `${scheduleDays.find((day) => day.dayOfWeek === slot.date.getDay())?.label} at ${formatClock(slot.time)}`}</h2>
    {existing?.kind === 'regular' && <p className="editor-caution">🔒 This weekly time belongs to {existing.studentName}. Use “Open this date” for a one-week absence.</p>}
    <label className="field">Student<input autoFocus required value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="Student name" /></label>
    <div className="field-pair"><label className="field">Type<select disabled={existing?.kind === 'regular'} value={kind} onChange={(event) => setKind(event.target.value as ScheduleEntryKind)}><option value="regular">Regular student</option><option value="trial">Trial</option><option value="one_time">One-time lesson</option></select></label><label className="field">Instrument<select value={instrument} onChange={(event) => setInstrument(event.target.value)}>{instructor.instruments.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    {kind === 'regular' ? <><div className="field-pair"><label className="field">Day<select value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))}>{scheduleDays.map((day) => <option value={day.dayOfWeek} key={day.dayOfWeek}>{day.label}</option>)}</select></label><label className="field">Time<input type="time" step="1800" value={time} onChange={(event) => setTime(event.target.value)} /></label></div><label className="field">Starts on<input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /><small>The recurring lesson will not occupy earlier weeks.</small></label></> : <label className="field">Date and time<input type="datetime-local" step="1800" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>}
    <div className="editor-actions">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Remove from schedule</button>}{onSkipDate && <button type="button" className="absence-button" onClick={onSkipDate}>Open this date</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" onClick={save}>{existing ? 'Save changes' : 'Add lesson'}</button></div>
  </section></div>
}

function TrialTimePicker({ draft, openings, onClose, onManage, onSend }: { draft: TextDraft; openings: TrialOpening[]; onClose: () => void; onManage: () => void; onSend: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const matches = openings.filter((opening) => opening.instruments.some((instrument) => instrument.toLowerCase() === draft.lead.instrument.toLowerCase()) && Date.parse(opening.startsAt) > Date.now())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const chosen = selected.map((id) => matches.find((opening) => opening.id === id)).filter((opening): opening is TrialOpening => Boolean(opening))
  const preview = draft.message
    .replace('[Day/Time 1]', chosen[0] ? formatTrialTime(chosen[0].startsAt) : '[Choose first trial time]')
    .replace('[Day/Time 2]', chosen[1] ? formatTrialTime(chosen[1].startsAt) : '[Choose second trial time]')

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 2 ? [...current, id] : current)

  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal time-picker">
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">{draft.label}</p>
    <h2>Choose two {draft.lead.instrument.toLowerCase()} trial times</h2>
    <p className="muted">Select the two openings you want to offer {draft.lead.name.split(' ')[0]}.</p>
    <div className="time-options">{matches.map((opening) => <button type="button" key={opening.id} className={selected.includes(opening.id) ? 'time-option selected' : 'time-option'} onClick={() => toggle(opening.id)}><span>{selected.includes(opening.id) ? '✓' : '○'}</span><div><strong>{formatTrialTime(opening.startsAt)}</strong><small>Instructor: {opening.instructor}</small></div></button>)}
      {matches.length < 2 && <div className="picker-warning"><strong>Two openings are required.</strong><span>Add more {draft.lead.instrument.toLowerCase()} trial times before creating this message.</span></div>}
    </div>
    <div className="message-preview"><strong>Message preview</strong><p>{preview}</p></div>
    <div className="picker-actions"><button type="button" className="secondary" onClick={onManage}>Manage openings</button><button type="button" className="primary" disabled={selected.length !== 2} onClick={() => onSend(preview)}>Copy & open Messages</button></div>
  </section></div>
}

function LeadPanel({ lead, trialOpenings, onClose, onLog, onAddNote, onTextNow, onUpdate, onStatusChange, onDelete }: { lead: Lead; trialOpenings: TrialOpening[]; onClose: () => void; onLog: (id: string, type: ActivityType) => void; onAddNote: (id: string, note: string) => void; onTextNow: StartText; onUpdate: (id: string, update: Partial<Lead>) => void; onStatusChange: (id: string, status: LeadStatus) => void; onDelete: (leadId: string, activityId: string) => void }) {
  const isNurture = lead.status === 'nurture' || lead.status === 'nurture_long_term'
  const isActiveHotLead = lead.status === 'hot' && !lead.trialAt
  const recommendation = isNurture ? nextNurtureContact(lead, defaultAvailability) : nextContact(lead, defaultAvailability)
  const matchingOpenings = trialOpenings.filter((opening) => opening.instruments.some((instrument) => instrument.toLowerCase() === lead.instrument.toLowerCase()) && Date.parse(opening.startsAt) > Date.now())
  const nurtureTemplate = isNurture ? nurtureMessageFor(lead, recommendation.at, matchingOpenings.length >= 2) : undefined
  const activeTemplate = isActiveHotLead ? activeFollowUpFor(lead) : undefined
  const messageTemplate = nurtureTemplate ?? activeTemplate
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="drawer"><button className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>{lead.name}</h2><p className="muted">{lead.instrument} · {lead.phone}</p><div className="next-box"><small>Recommended next contact</small><strong>{recommendation.reason.includes('now') ? 'Call now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span>{messageTemplate && <><b>{messageTemplate.label}</b><small>{messageTemplate.message}</small></>}</div>{activeTemplate?.voicemail && <details className="script-box"><summary>{activeTemplate.voicemailLabel}</summary><p>{activeTemplate.voicemail}</p></details>}<div className="drawer-actions"><button className="primary" onClick={() => onTextNow(lead, messageTemplate)}>↗ Text now</button><button className="secondary" onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><button className="secondary" onClick={() => onLog(lead.id, 'text')}>✓ Log text</button></div><LeadNoteComposer onSave={(note) => onAddNote(lead.id, note)} /><label className="field">Status<select value={lead.status} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="details"><div><small>Received</small><strong>{formatDate(lead.receivedAt)}</strong></div><div><small>Campaign</small><strong>{lead.campaign}</strong></div><div><small>Ad cost</small><strong>${lead.adCost}</strong></div><div><small>Total touches</small><strong>{touchCount(lead)}</strong></div></div><h3>Activity</h3><div className="timeline">{[...lead.activities].reverse().map((activity) => <div key={activity.id}><i /><span><strong>{activity.type === 'call' ? 'Call' : activity.type === 'text' ? 'Text' : activity.type === 'note' ? 'Note' : activity.type === 'status_change' ? 'Status updated' : activity.type}</strong><small>{formatDate(activity.occurredAt)} · {activity.outcome}</small></span>{(activity.type === 'call' || activity.type === 'text' || activity.type === 'note') && <button className="timeline-delete" onClick={() => window.confirm('Delete this activity?') && onDelete(lead.id, activity.id)}>Delete</button>}</div>)}{!lead.activities.length && <p className="muted">No outreach logged yet.</p>}</div></aside></div>
}

function LeadNoteComposer({ onSave }: { onSave: (note: string) => void }) {
  const [note, setNote] = useState('')
  const save = () => { if (note.trim()) { onSave(note.trim()); setNote('') } }
  return <div className="note-composer"><label className="field">Notes<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context, scheduling details, or anything worth remembering…" /></label><button type="button" className="secondary" disabled={!note.trim()} onClick={save}>＋ Add note</button></div>
}

function QuickNoteModal({ lead, onClose, onSave }: { lead: Lead; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState('')
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal quick-note" onSubmit={(event) => { event.preventDefault(); if (note.trim()) onSave(note.trim()) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Take note</p><h2>{lead.name}</h2><p className="muted">{lead.instrument} · This note will appear in the Activity Log.</p><label className="field">Note<textarea autoFocus required rows={6} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What do you want to remember?" /></label><button className="primary full" type="submit" disabled={!note.trim()}>Save note</button></form></div>
}

function NewLeadModal({ onClose, onSave }: { onClose: () => void; onSave: (lead: Lead) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [instrument, setInstrument] = useState('Piano')
  const [source, setSource] = useState('Meta')
  const [receivedAt, setReceivedAt] = useState(() => toDateTimeInput(new Date()))
  return <div className="overlay modal-overlay"><form className="modal" onSubmit={(event) => { event.preventDefault(); onSave({ id: crypto.randomUUID(), name, phone, email: '', instrument, source, campaign: 'Manual entry', receivedAt: new Date(receivedAt).toISOString(), status: 'hot', activities: [], holdFormComplete: false, trialAttended: false, adCost: 0 }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Add inquiry</p><h2>New lead</h2><label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label><label className="field">Phone<input required value={phone} onChange={(e) => setPhone(e.target.value)} /></label><label className="field">Inquiry received<input required type="datetime-local" value={receivedAt} max={toDateTimeInput(new Date())} onChange={(e) => setReceivedAt(e.target.value)} /><small>Change this if you are entering the lead later.</small></label><div className="field-pair"><label className="field">Instrument<select value={instrument} onChange={(e) => setInstrument(e.target.value)}><option>Piano</option><option>Guitar</option><option>Voice</option><option>Drums</option><option>Violin</option><option>Saxophone</option><option>Trumpet</option><option>Trombone</option></select></label><label className="field">Source<select value={source} onChange={(e) => setSource(e.target.value)}><option>Meta</option><option>Website Traffic</option><option>WLS</option><option>Word of Mouth</option></select></label></div><button className="primary full" type="submit">Save lead</button></form></div>
}

export default App
