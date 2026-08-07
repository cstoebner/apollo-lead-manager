import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { activeFollowUpFor } from './activeTemplates'
import { activeCadenceState, nextContact, nextNurtureContact, nurtureCadenceState, nurtureRequiresCall, nurtureStartedAt } from './cadence'
import { defaultAvailability, demoInstructorAvailability, demoInstructors, demoLeads, demoScheduleEntries, demoTrialOpenings } from './data'
import { loadWorkspaceData, removeActivity as removeStoredActivity, removeLead as removeStoredLead, removeScheduleActivity as removeStoredScheduleActivity, saveActivity, saveLead, saveScheduleActivity, saveSettings, syncAvailability, syncEntries, syncInstructors, syncOpenings, updateLead } from './database'
import { nurtureMessageFor } from './nurtureTemplates'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Activity, ActivityType, Instructor, InstructorAvailability, Lead, LeadStatus, ScheduleActivity, ScheduleEntry, ScheduleEntryKind, TrialOpening } from './types'

type View = 'today' | 'leads' | 'trials' | 'openings' | 'activity' | 'settings'
type MessageTemplate = { label: string; message: string; needsTimes?: boolean; callFirst?: boolean }
type StartText = (lead: Lead, template?: MessageTemplate) => void
type TextDraft = { lead: Lead; label: string; message: string }
type ScheduleLogInput = Omit<ScheduleActivity, 'id' | 'occurredAt'>
type ManualActivityType = Extract<ActivityType, 'call' | 'text' | 'email' | 'note'>
type ManualEventType = ManualActivityType | 'trial_booked' | 'trial_form_completed' | 'trial_completed' | 'became_student' | 'unenrolled'
type ManualActivityInput = { leadId: string; activityId?: string; type: ManualEventType; occurredAt: string; outcome: string; trialAt?: string }
type LeadSortKey = 'name' | 'receivedAt' | 'source' | 'touches' | 'status'
type PendingActionItem = { lead: Lead; reason: 'manual' | 'trial_form' | 'post_trial'; action: string; template?: MessageTemplate }

const defaultInstruments = ['Piano', 'Guitar', 'Voice', 'Drums', 'Violin', 'Saxophone', 'Trumpet', 'Trombone']

const statusLabels: Record<LeadStatus, string> = {
  active_student: 'Active Student', hot: 'Hot', action_pending: 'Action Pending', nurture: 'Nurture',
  nurture_long_term: 'Nurture Long Term', unresponsive: 'Unresponsive', unenrolled: 'Unenrolled',
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

const trialFormReminderFor = (lead: Lead): MessageTemplate => ({
  label: 'TRIAL FORM REMINDER',
  message: `Hi ${lead.name.split(' ')[0]},\n\nThe last step to confirm ${lead.studentName && lead.studentName !== lead.name ? `${lead.studentName}'s` : 'your'} free ${lead.instrument.toLowerCase()} trial lesson on ${formatTrialTime(lead.trialAt!)} is to complete our registration form and reserve the time.\n\nWe do require a credit card on file to hold the appointment. The lesson itself is completely free; the card would only be charged the $35 fee if the lesson is canceled or rescheduled with less than 24 hours’ notice or if the student does not attend.\n\nPlease let me know if you need the registration link again or have any questions. I’m happy to help!`,
})

const toDateTimeInput = (date: Date) => {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

function App() {
  const [entered, setEntered] = useState(false)
  if (!entered) return <Welcome onEnter={() => setEntered(true)} />
  return isSupabaseConfigured ? <AuthenticatedApp /> : <Workspace />
}

function AuthenticatedApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase!.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <AppLoading message="Checking your secure session…" />
  if (!session) return <Login />
  return <Workspace onSignOut={() => { void supabase!.auth.signOut() }} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true); setError('')
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) setError(signInError.message)
    setSubmitting(false)
  }

  return <main className="welcome-shell"><form className="welcome-card login-card" onSubmit={submit}>
    <div className="brand-mark">A</div><p className="eyebrow">Apollo Music Academy</p><h1>Welcome back.</h1>
    <p className="welcome-copy">Sign in to your private lead manager.</p>
    <label className="field">Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus /></label>
    <label className="field">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error && <p className="auth-error">{error}</p>}
    <button className="primary jumbo full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
  </form></main>
}

function AppLoading({ message }: { message: string }) {
  return <main className="app-loading"><div className="brand-mark">A</div><strong>{message}</strong></main>
}

function Welcome({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="welcome-shell">
      <section className="welcome-card">
        <div className="brand-mark">A</div>
        <p className="eyebrow">Apollo Music Academy</p>
        <h1>Turn every new inquiry into a clear next step.</h1>
        <p className="welcome-copy">Follow up on time, fill more trials, and see which inquiries become students.</p>
        <button className="primary jumbo" onClick={onEnter}>{isSupabaseConfigured ? 'Sign in' : 'Enter demo workspace'}</button>
        {!isSupabaseConfigured && <p className="demo-note">Demo mode uses sample leads only. Connect Supabase before using real data.</p>}
        <div className="recent-updates"><strong>Recently updated · August 1, 2026</strong><span>Instructor schedules now use 15-minute increments and support 30-, 45-, and 60-minute lessons.</span><span>Trial form reminders and post-trial booking tasks appear automatically under Action Pending.</span><span>Every activity can be deleted with a 10-second Undo window.</span></div>
      </section>
    </main>
  )
}

function Workspace({ onSignOut }: { onSignOut?: () => void }) {
  const [view, setView] = useState<View>('today')
  const [leads, setLeads] = useState(isSupabaseConfigured ? [] : demoLeads)
  const [offeredInstruments, setOfferedInstruments] = useState(defaultInstruments)
  const [instructors, setInstructors] = useState(isSupabaseConfigured ? [] : demoInstructors)
  const [trialOpenings, setTrialOpenings] = useState(isSupabaseConfigured ? [] : demoTrialOpenings)
  const [instructorAvailability, setInstructorAvailability] = useState(isSupabaseConfigured ? [] : demoInstructorAvailability)
  const [scheduleEntries, setScheduleEntries] = useState(isSupabaseConfigured ? [] : demoScheduleEntries)
  const [scheduleActivities, setScheduleActivities] = useState<ScheduleActivity[]>([])
  const [loadingData, setLoadingData] = useState(isSupabaseConfigured)
  const [dataError, setDataError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quickNoteId, setQuickNoteId] = useState<string | null>(null)
  const [showNewLead, setShowNewLead] = useState(false)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
  const selected = leads.find((lead) => lead.id === selectedId)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void loadWorkspaceData().then((data) => {
      const createdActivities = data.leads.flatMap((lead) => lead.activities.some((activity) => activity.type === 'lead_created') ? [] : [{
        leadId: lead.id,
        activity: { id: crypto.randomUUID(), type: 'lead_created' as const, occurredAt: lead.receivedAt, outcome: 'New lead received' },
      }])
      setLeads(data.leads.map((lead) => {
        const created = createdActivities.find((item) => item.leadId === lead.id)?.activity
        return created ? { ...lead, activities: [created, ...lead.activities] } : lead
      }))
      if (createdActivities.length) void Promise.all(createdActivities.map(({ leadId, activity }) => saveActivity(leadId, activity))).catch((error: Error) => setDataError(`Lead history could not be completed: ${error.message}`))
      setInstructors(data.instructors)
      setInstructorAvailability(data.availability)
      setScheduleEntries(data.entries)
      setTrialOpenings(data.openings)
      setScheduleActivities(data.scheduleActivities)
      setOfferedInstruments(data.instruments?.length ? data.instruments : defaultInstruments)
      setLoadingData(false)
    }).catch((error: Error) => { setDataError(error.message); setLoadingData(false) })
  }, [])

  const persist = (work: Promise<unknown>) => {
    if (isSupabaseConfigured) void work.catch((error: Error) => setDataError(`Your change is still visible here, but could not be saved: ${error.message}`))
  }

  const startText: StartText = (lead, template) => {
    if (template?.needsTimes) {
      setTextDraft({ lead, label: template.label, message: template.message })
      return
    }
    void openMessages(lead.phone, template?.message)
  }

  const addLead = (lead: Lead) => {
    const activity: Activity = { id: crypto.randomUUID(), type: 'lead_created', occurredAt: lead.receivedAt, outcome: 'New lead received' }
    const next = { ...lead, activities: [activity] }
    setLeads((current) => [next, ...current])
    persist(Promise.all([saveLead(lead), saveActivity(lead.id, activity)]))
    setShowNewLead(false)
  }
  const updateLeadInfo = (id: string, update: Partial<Lead>) => {
    const lead = leads.find((item) => item.id === id)
    if (!lead) return
    const labels: Partial<Record<keyof Lead, string>> = { name: 'lead name', studentName: 'student name', phone: 'phone', email: 'email', instrument: 'instrument', receivedAt: 'inquiry date', source: 'source', campaign: 'campaign' }
    const changed = (Object.keys(update) as (keyof Lead)[]).filter((key) => lead[key] !== update[key]).map((key) => labels[key]).filter(Boolean)
    if (!changed.length) return
    const activity: Activity = { id: crypto.randomUUID(), type: 'lead_update', occurredAt: new Date().toISOString(), outcome: `Lead information updated: ${changed.join(', ')}` }
    const next = { ...lead, ...update, activities: [...lead.activities, activity] }
    setLeads((current) => current.map((item) => item.id === id ? next : item))
    persist(Promise.all([saveLead(next), saveActivity(id, activity)]))
  }
  const deleteLead = (id: string) => {
    const lead = leads.find((item) => item.id === id)
    if (!lead || !window.confirm(`Permanently delete ${lead.name}? This will also delete their activity history and linked schedule entries. Use Unenrolled instead for a real former student.`)) return
    setLeads((current) => current.filter((item) => item.id !== id))
    setScheduleEntries((current) => current.filter((entry) => entry.leadId !== id))
    setSelectedId(null)
    persist(removeStoredLead(id))
  }
  const logActivity = (id: string, type: ActivityType) => {
    const activity: Activity = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), outcome: type === 'call' ? 'Attempted call' : 'Message sent' }
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, activities: [...lead.activities, activity] } : lead))
    persist(saveActivity(id, activity))
  }
  const changeStatus = (id: string, status: LeadStatus) => {
    const lead = leads.find((item) => item.id === id)
    if (!lead || lead.status === status) return
    const activity: Activity = { id: crypto.randomUUID(), type: 'status_change', occurredAt: new Date().toISOString(), outcome: `Status changed from ${statusLabels[lead.status]} to ${statusLabels[status]}` }
    setLeads((current) => current.map((item) => item.id === id ? { ...item, status, activities: [...item.activities, activity] } : item))
    persist(Promise.all([updateLead(id, { status }), saveActivity(id, activity)]))
  }
  const updateTrial = (id: string, update: Partial<Lead>, outcome: string) => {
    const activity: Activity = { id: crypto.randomUUID(), type: 'trial_update', occurredAt: new Date().toISOString(), outcome }
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, ...update, activities: [...lead.activities, activity] } : lead))
    persist(Promise.all([updateLead(id, update), saveActivity(id, activity)]))
  }
  const deleteActivity = (leadId: string, activityId: string) => {
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, activities: lead.activities.filter((activity) => activity.id !== activityId) } : lead))
    persist(removeStoredActivity(activityId))
  }
  const addNote = (id: string, note: string) => {
    const activity: Activity = { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: note.trim() }
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, activities: [...lead.activities, activity] } : lead))
    persist(saveActivity(id, activity))
  }
  const saveManualActivity = ({ leadId, activityId, type, occurredAt, outcome, trialAt }: ManualActivityInput) => {
    const activityType: ActivityType = type === 'trial_booked' || type === 'trial_form_completed' || type === 'trial_completed' ? 'trial_update'
      : type === 'became_student' || type === 'unenrolled' ? 'status_change' : type
    const leadUpdate: Partial<Lead> | undefined = type === 'trial_booked' ? { trialAt }
      : type === 'trial_form_completed' ? { holdFormComplete: true }
        : type === 'trial_completed' ? { trialAttended: true }
          : type === 'became_student' ? { status: 'active_student', enrolledAt: occurredAt }
            : type === 'unenrolled' ? { status: 'unenrolled' } : undefined
    const activity: Activity = { id: activityId ?? crypto.randomUUID(), type: activityType, occurredAt, outcome: outcome.trim() }
    setLeads((current) => current.map((lead) => lead.id === leadId ? {
      ...lead,
      ...leadUpdate,
      activities: activityId ? lead.activities.map((item) => item.id === activityId ? activity : item) : [...lead.activities, activity],
    } : lead))
    persist(Promise.all([saveActivity(leadId, activity), ...(leadUpdate ? [updateLead(leadId, leadUpdate)] : [])]))
  }
  const insertCadenceProgress = (leadId: string, activities: Activity[]) => {
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, activities: [...lead.activities, ...activities] } : lead))
    persist(Promise.all(activities.map((activity) => saveActivity(leadId, activity))))
  }
  const logScheduleActivity = (input: ScheduleLogInput) => {
    const activity: ScheduleActivity = { ...input, id: crypto.randomUUID(), occurredAt: new Date().toISOString() }
    setScheduleActivities((current) => [...current, activity])
    persist(saveScheduleActivity(activity, instructors.find((item) => item.name === input.instructor)?.id))
  }
  const replaceInstruments = (next: string[]) => { setOfferedInstruments(next); persist(saveSettings(next)) }
  const replaceInstructors = (next: Instructor[]) => { const previous = instructors; setInstructors(next); persist(syncInstructors(previous, next)) }
  const replaceAvailability = (next: InstructorAvailability[]) => { const previous = instructorAvailability; setInstructorAvailability(next); persist(syncAvailability(previous, next)) }
  const replaceEntries = (next: ScheduleEntry[]) => { const previous = scheduleEntries; setScheduleEntries(next); persist(syncEntries(previous, next)) }
  const replaceOpenings = (next: TrialOpening[]) => { const previous = trialOpenings; setTrialOpenings(next); persist(syncOpenings(previous, next, instructors)) }
  const deleteScheduleActivity = (id: string) => { setScheduleActivities((current) => current.filter((activity) => activity.id !== id)); persist(removeStoredScheduleActivity(id)) }

  if (loadingData) return <AppLoading message="Loading your lead manager…" />
  if (dataError && !leads.length && !instructors.length) return <main className="app-loading error-loading"><strong>We couldn’t load your data.</strong><span>{dataError}</span><button className="primary" onClick={() => window.location.reload()}>Try again</button></main>

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
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="⚙" label="Settings" />
        </nav>
        <div className="sidebar-foot"><span className="avatar">CS</span><div>Conor<small>{isSupabaseConfigured ? 'Connected' : 'Demo mode'}</small></div>{onSignOut && <button className="sidebar-signout" onClick={onSignOut}>Sign out</button>}</div>
      </aside>

      <main className="content">
        {dataError && <div className="data-warning"><span>{dataError}</span><button onClick={() => setDataError('')}>×</button></div>}
        <header className="topbar">
          <div><p className="eyebrow">{formatDate(new Date(), false)}</p><h1>{view === 'today' ? 'Your follow-up plan' : view === 'leads' ? 'All leads' : view === 'trials' ? 'Trial pipeline' : view === 'openings' ? 'Instructor schedule' : view === 'activity' ? 'Activity log' : 'Settings'}</h1></div>
          <button className="primary" onClick={() => setShowNewLead(true)}>＋ New lead</button>
        </header>

        {view === 'today' && <Today leads={leads} trialOpenings={trialOpenings} onSelect={setSelectedId} onLog={logActivity} onTextNow={startText} onTakeNote={setQuickNoteId} />}
        {view === 'leads' && <LeadTable leads={leads} onSelect={setSelectedId} />}
        {view === 'trials' && <Trials leads={leads} onSelect={setSelectedId} onTrialUpdate={updateTrial} />}
        {view === 'openings' && <InstructorSchedule leads={leads} instructors={instructors} availability={instructorAvailability} entries={scheduleEntries} openings={trialOpenings} onAvailabilityChange={replaceAvailability} onEntriesChange={replaceEntries} onOpeningsChange={replaceOpenings} onScheduleLog={logScheduleActivity} onLeadTrialChange={updateTrial} />}
        {view === 'activity' && <ActivityLog leads={leads} scheduleActivities={scheduleActivities} onSelect={setSelectedId} onSaveActivity={saveManualActivity} onDelete={deleteActivity} onDeleteSchedule={deleteScheduleActivity} onInsertCadenceProgress={insertCadenceProgress} />}
        {view === 'settings' && <Settings instruments={offeredInstruments} leads={leads} instructors={instructors} availability={instructorAvailability} entries={scheduleEntries} openings={trialOpenings} onInstrumentsChange={replaceInstruments} onInstructorsChange={replaceInstructors} onAvailabilityChange={replaceAvailability} onEntriesChange={replaceEntries} onOpeningsChange={replaceOpenings} onScheduleLog={logScheduleActivity} />}
      </main>

      {selected && <LeadPanel lead={selected} instruments={offeredInstruments} trialOpenings={trialOpenings} onClose={() => setSelectedId(null)} onLog={logActivity} onAddNote={addNote} onTextNow={startText} onTrialUpdate={updateTrial} onStatusChange={changeStatus} onDeleteActivity={deleteActivity} onUpdateLead={updateLeadInfo} onDeleteLead={deleteLead} />}
      {showNewLead && <NewLeadModal instruments={offeredInstruments} onClose={() => setShowNewLead(false)} onSave={addLead} />}
      {quickNoteId && <QuickNoteModal lead={leads.find((lead) => lead.id === quickNoteId)!} onClose={() => setQuickNoteId(null)} onSave={(note) => { addNote(quickNoteId, note); setQuickNoteId(null) }} />}
      {textDraft && <TrialTimePicker draft={textDraft} openings={trialOpenings} onClose={() => setTextDraft(null)} onManage={() => { setTextDraft(null); setView('openings') }} onSend={(message) => { setTextDraft(null); void openMessages(textDraft.lead.phone, message) }} />}
    </div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return <button className={active ? 'nav-active' : ''} onClick={onClick}><span className="nav-icon">{icon}</span><span className="nav-label">{label}</span></button>
}

function Today({ leads, trialOpenings, onSelect, onLog, onTextNow, onTakeNote }: { leads: Lead[]; trialOpenings: TrialOpening[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void; onTextNow: StartText; onTakeNote: (id: string) => void }) {
  const active = leads.filter((lead) => lead.status === 'hot' && !lead.trialAt)
  const pending: PendingActionItem[] = leads.flatMap<PendingActionItem>((lead) => {
    if (lead.trialAt && lead.holdFormComplete && lead.trialAttended && Date.parse(lead.trialAt) <= Date.now() && lead.status !== 'active_student' && lead.status !== 'unenrolled') {
      return [{ lead, reason: 'post_trial' as const, action: 'Trial completed · needs regular lesson booking' }]
    }
    if (lead.trialAt && !lead.holdFormComplete && !lead.trialAttended && lead.status !== 'unenrolled') {
      return [{ lead, reason: 'trial_form' as const, action: 'Send trial confirmation form reminder', template: trialFormReminderFor(lead) }]
    }
    if (lead.status === 'action_pending') return [{ lead, reason: 'manual' as const, action: 'Manual follow-up needed' }]
    return []
  })
  const nurture = leads.filter((lead) => lead.status === 'nurture' || lead.status === 'nurture_long_term')
  const planned = useMemo(() => [
    ...active.map((lead) => ({ lead, kind: 'active' as const, recommendation: nextContact(lead, defaultAvailability), template: activeFollowUpFor(lead), progress: activeCadenceState(lead) })),
    ...nurture.map((lead) => {
      const recommendation = nextNurtureContact(lead, defaultAvailability)
      const matchingOpenings = trialOpenings.filter((opening) => opening.instruments.some((instrument) => instrument.toLowerCase() === lead.instrument.toLowerCase()) && Date.parse(opening.startsAt) > Date.now())
      return { lead, kind: 'nurture' as const, recommendation, template: nurtureMessageFor(lead, recommendation.at, matchingOpenings.length >= 2), progress: nurtureCadenceState(lead) }
    }),
  ].filter((item) => !item.progress.complete).sort((a, b) => a.recommendation.at.getTime() - b.recommendation.at.getTime() || Date.parse(b.lead.receivedAt) - Date.parse(a.lead.receivedAt)), [leads, trialOpenings])
  const now = new Date()
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999)
  const queue = planned.filter(({ recommendation }) => recommendation.at <= endOfToday)
  const upcomingMap = new Map<string, { date: Date; items: typeof planned }>()
  planned.filter(({ recommendation }) => recommendation.at > endOfToday).forEach((item) => {
    const key = item.recommendation.at.toDateString()
    const group = upcomingMap.get(key) ?? { date: item.recommendation.at, items: [] }
    group.items.push(item)
    upcomingMap.set(key, group)
  })
  const upcomingDays = [...upcomingMap.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 5)

  return <>
    <section className="card queue-card">
      <div className="section-head"><div><h2>Next actions</h2><p>Hot leads and nurture contacts, ordered by who should hear from you next.</p></div><span className="live-pill">● Priority order</span></div>
      <div className="queue-list">
        {queue.map(({ lead, recommendation, template, progress }, index) => {
          const channel = template.callFirst ? 'Call, then text' : 'Text only'
          return <article className="queue-row" key={lead.id}>
            <div className={`priority ${recommendation.at <= now ? 'urgent' : ''}`}>{index + 1}</div>
            <div className="lead-main" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{statusLabels[lead.status]} · {lead.instrument} · {lead.source}</span></div>
            <div className="recommendation"><strong>{recommendation.at <= now ? 'Now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason} · {channel}</span><em>{template.label}</em>{template.needsTimes && <small>Two trial times still need to be filled in.</small>}</div>
            <div className="row-actions">{template.callFirst && <button disabled={progress.callLogged} onClick={() => onLog(lead.id, 'call')}>{progress.callLogged ? '✓ Call logged' : '☎ Log call'}</button>}<button disabled={progress.textLogged} onClick={() => onLog(lead.id, 'text')}>{progress.textLogged ? '✓ Text logged' : '✓ Log text'}</button><button onClick={() => onTakeNote(lead.id)}>✎ Take note</button><button className="text-now" onClick={() => onTextNow(lead, template)}>↗ Text now</button></div>
          </article>
        })}
        {!queue.length && <div className="today-complete"><strong>All caught up for today</strong><span>Your next scheduled contacts are previewed below.</span></div>}
      </div>
    </section>
    <PendingActions leads={pending} onSelect={onSelect} onLog={onLog} onTextNow={onTextNow} onTakeNote={onTakeNote} />
    <section className="card upcoming-outreach-card">
      <div className="section-head"><div><h2>Upcoming outreach</h2><p>A preview of the next days when you should plan to be available.</p></div></div>
      <div className="upcoming-outreach-list">{upcomingDays.map(({ date, items }) => {
        const earliest = items[0].recommendation.at
        return <article key={date.toDateString()}><div className="outreach-date"><strong>{date.toLocaleDateString('en-US', { weekday: 'short' })}</strong><span>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div><div className="outreach-preview"><strong>{items.length} planned {items.length === 1 ? 'contact' : 'contacts'}</strong><span>{items.slice(0, 4).map((item) => `${item.lead.name} · ${item.template.label}`).join('  •  ')}{items.length > 4 ? `  •  +${items.length - 4} more` : ''}</span></div><b>Be available around {earliest.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b></article>
      })}{!upcomingDays.length && <div className="today-complete"><strong>No upcoming outreach scheduled</strong><span>New leads and future cadence dates will appear here.</span></div>}</div>
    </section>
  </>
}

function PendingActions({ leads, onSelect, onLog, onTextNow, onTakeNote }: { leads: PendingActionItem[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void; onTextNow: StartText; onTakeNote: (id: string) => void }) {
  return <section className="card pending-card">
    <div className="section-head"><div><h2>Action pending</h2><p>Trial milestones and manual follow-ups that still need your attention.</p></div></div>
    <div className="pending-list">{leads.map(({ lead, reason, action, template }) => {
      return <article key={lead.id} className={`pending-row pending-${reason}`}>
        <button className="pending-person" onClick={() => onSelect(lead.id)}><span><strong>{lead.name}</strong><small>{lead.instrument} · {lead.source}</small></span><b>{action}</b><i>Open →</i></button>
        <div className="row-actions">{reason !== 'trial_form' && <button onClick={() => onLog(lead.id, 'call')}>☎ Log call</button>}<button onClick={() => onLog(lead.id, 'text')}>✓ Log text</button><button onClick={() => onTakeNote(lead.id)}>✎ Take note</button>{reason !== 'post_trial' && <button className={reason === 'trial_form' ? 'text-now' : ''} onClick={() => onTextNow(lead, template)}>↗ Text now</button>}</div>
      </article>
    })}{!leads.length && <div className="today-complete"><strong>No actions pending</strong><span>Scheduled trial reminders and manual follow-ups will appear here.</span></div>}</div>
  </section>
}

function LeadTable({ leads, onSelect }: { leads: Lead[]; onSelect: (id: string) => void }) {
  const [sortKey, setSortKey] = useState<LeadSortKey>('receivedAt')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const changeSort = (key: LeadSortKey) => {
    if (sortKey === key) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDirection(key === 'receivedAt' || key === 'touches' ? 'desc' : 'asc') }
  }
  const sortedLeads = useMemo(() => [...leads].sort((a, b) => {
    const comparison = sortKey === 'receivedAt' ? Date.parse(a.receivedAt) - Date.parse(b.receivedAt)
      : sortKey === 'touches' ? touchCount(a) - touchCount(b)
        : sortKey === 'status' ? statusLabels[a.status].localeCompare(statusLabels[b.status], undefined, { sensitivity: 'base' })
          : sortKey === 'source' ? a.source.localeCompare(b.source, undefined, { sensitivity: 'base' })
            : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    const directed = sortDirection === 'asc' ? comparison : -comparison
    return directed || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  }), [leads, sortKey, sortDirection])
  const sortHeader = (key: LeadSortKey, label: string) => <th aria-sort={sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className={sortKey === key ? 'sort-button active' : 'sort-button'} onClick={() => changeSort(key)}>{label}<span>{sortKey === key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
  return <section className="card"><div className="section-head"><div><h2>Lead directory</h2><p>{leads.length} total leads in this workspace</p></div><input className="search" placeholder="Search leads" /></div>
    <div className="table-wrap"><table><thead><tr>{sortHeader('name', 'Lead')}{sortHeader('receivedAt', 'Received')}{sortHeader('source', 'Source')}{sortHeader('touches', 'Touches')}{sortHeader('status', 'Status')}</tr></thead><tbody>{sortedLeads.map((lead) => <tr key={lead.id} onClick={() => onSelect(lead.id)}><td><strong>{lead.name}</strong><small>{lead.instrument}</small></td><td>{formatDate(lead.receivedAt)}</td><td>{lead.source}<small>{lead.campaign}</small></td><td>{touchCount(lead)}</td><td><span className={`status ${lead.status}`}>{statusLabels[lead.status]}</span></td></tr>)}</tbody></table></div>
  </section>
}

function Trials({ leads, onSelect, onTrialUpdate }: { leads: Lead[]; onSelect: (id: string) => void; onTrialUpdate: (id: string, update: Partial<Lead>, outcome: string) => void }) {
  const trials = leads.filter((lead) => lead.trialAt)
  return <section className="card"><div className="section-head"><div><h2>Trial readiness</h2><p>See what must happen before and after each lesson.</p></div></div><div className="trial-grid">{trials.map((lead) => <article key={lead.id} className="trial-card"><div className="trial-date"><strong>{new Date(lead.trialAt!).getDate()}</strong><span>{new Date(lead.trialAt!).toLocaleDateString('en-US', { month: 'short' })}</span></div><div className="trial-info"><button className="trial-person" onClick={() => onSelect(lead.id)}><h3>{lead.name}</h3><p>{lead.instrument} · {formatDate(lead.trialAt!)}</p></button><label><input type="checkbox" checked={lead.holdFormComplete} onChange={(event) => onTrialUpdate(lead.id, { holdFormComplete: event.target.checked }, event.target.checked ? 'Booking form completed' : 'Booking form marked incomplete')} /> Booking form complete</label><label><input type="checkbox" checked={lead.trialAttended} onChange={(event) => onTrialUpdate(lead.id, { trialAttended: event.target.checked }, event.target.checked ? 'Trial marked completed' : 'Trial marked not completed')} /> Trial completed</label>{lead.trialAttended && lead.status !== 'active_student' && <span className="post-trial-pill">Post-trial · waiting to book lessons</span>}</div></article>)}</div></section>
}

function ActivityLog({ leads, scheduleActivities, onSelect, onSaveActivity, onDelete, onDeleteSchedule, onInsertCadenceProgress }: { leads: Lead[]; scheduleActivities: ScheduleActivity[]; onSelect: (id: string) => void; onSaveActivity: (input: ManualActivityInput) => void; onDelete: (leadId: string, activityId: string) => void; onDeleteSchedule: (id: string) => void; onInsertCadenceProgress: (leadId: string, activities: Activity[]) => void }) {
  const [range, setRange] = useState<'month' | 'year'>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [activityEditor, setActivityEditor] = useState<ManualActivityInput | null>(null)
  const [cadenceInsertOpen, setCadenceInsertOpen] = useState(false)
  const [pendingDeletions, setPendingDeletions] = useState<{ key: string; label: string; timerId: number }[]>([])
  const allEntries = [
    ...leads.flatMap((lead) => lead.activities.map((activity) => ({ kind: 'lead' as const, lead, activity, occurredAt: activity.occurredAt }))),
    ...scheduleActivities.map((activity) => ({ kind: 'schedule' as const, activity, occurredAt: activity.occurredAt })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const pendingKeys = new Set(pendingDeletions.map((item) => item.key))
  const entries = allEntries.filter((entry) => {
    const key = `${entry.kind}-${entry.activity.id}`
    if (pendingKeys.has(key)) return false
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
        const action = entry.activity.type === 'call' ? 'Call logged' : entry.activity.type === 'text' ? 'Text logged' : entry.activity.type === 'email' ? 'Email logged' : entry.activity.type === 'note' ? 'Note added' : entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.type === 'trial_update' ? 'Trial updated' : entry.activity.type === 'lead_created' ? 'New lead received' : entry.activity.type === 'lead_update' ? 'Lead information updated' : entry.activity.outcome
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

  const queueDeletion = (key: string, label: string, commit: () => void) => {
    if (pendingDeletions.some((item) => item.key === key)) return
    const timerId = window.setTimeout(() => {
      commit()
      setPendingDeletions((current) => current.filter((item) => item.key !== key))
    }, 10_000)
    setPendingDeletions((current) => [...current, { key, label, timerId }])
  }
  const remove = (leadId: string, activityId: string) => queueDeletion(`lead-${activityId}`, 'Activity deleted', () => onDelete(leadId, activityId))
  const removeSchedule = (id: string) => {
    queueDeletion(`schedule-${id}`, 'Schedule log deleted', () => onDeleteSchedule(id))
  }
  const undoDeletion = (key: string) => {
    const pending = pendingDeletions.find((item) => item.key === key)
    if (!pending) return
    window.clearTimeout(pending.timerId)
    setPendingDeletions((current) => current.filter((item) => item.key !== key))
  }
  const latestDeletion = pendingDeletions[pendingDeletions.length - 1]

  return <><section className="card activity-card">
    <div className="section-head activity-head"><div><h2>Activity history</h2><p>Lead communication and instructor schedule changes, newest first.</p></div><div className="activity-controls"><button className="primary add-event-button" disabled={!leads.length} onClick={() => setActivityEditor({ leadId: leads[0]?.id ?? '', type: 'call', occurredAt: new Date().toISOString(), outcome: 'Attempted call' })}>＋ Add event</button><button className="insert-cadence-button" disabled={!leads.length} onClick={() => setCadenceInsertOpen(true)}>⇥ Insert into follow-up cycle</button><div className="range-toggle"><button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>Month</button><button className={range === 'year' ? 'active' : ''} onClick={() => setRange('year')}>Year</button></div><div className="period-switch"><button onClick={() => shiftPeriod(-1)}>←</button><strong>{periodLabel}</strong><button onClick={() => shiftPeriod(1)}>→</button></div><button className="export-button" disabled={!entries.length} onClick={exportCsv}>⇩ Export CSV</button><span className="count-pill">{entries.length} actions</span></div></div>
    <div className="activity-list">
      {entries.map((entry) => entry.kind === 'lead' ? <article className="activity-row" key={`lead-${entry.activity.id}`}>
        <div className={`activity-icon ${entry.activity.type}`}>{entry.activity.type === 'call' ? '☎' : entry.activity.type === 'text' ? '↗' : entry.activity.type === 'email' ? '✉' : entry.activity.type === 'note' ? '✎' : entry.activity.type === 'status_change' ? '↻' : entry.activity.type === 'trial_update' ? '◇' : entry.activity.type === 'lead_created' ? '＋' : entry.activity.type === 'lead_update' ? '✎' : '•'}</div>
        <button className="activity-person" onClick={() => onSelect(entry.lead.id)}><strong>{entry.lead.name}</strong><span>{entry.lead.instrument} · {entry.lead.phone}</span></button>
        <div className="activity-detail"><strong>{entry.activity.type === 'call' ? 'Call logged' : entry.activity.type === 'text' ? 'Text logged' : entry.activity.type === 'email' ? 'Email logged' : entry.activity.type === 'note' ? 'Note added' : entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.type === 'trial_update' ? 'Trial updated' : entry.activity.type === 'lead_created' ? 'New lead received' : entry.activity.type === 'lead_update' ? 'Lead information updated' : entry.activity.outcome}</strong><span>{entry.activity.outcome}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        <div className="activity-row-actions">{(entry.activity.type === 'call' || entry.activity.type === 'text' || entry.activity.type === 'note' || entry.activity.type === 'email') && <button className="edit-action" onClick={() => setActivityEditor({ leadId: entry.lead.id, activityId: entry.activity.id, type: entry.activity.type as ManualActivityType, occurredAt: entry.activity.occurredAt, outcome: entry.activity.outcome })}>Edit</button>}<button className="delete-action" onClick={() => remove(entry.lead.id, entry.activity.id)} aria-label={`Delete ${entry.activity.type} for ${entry.lead.name}`}>Delete</button></div>
      </article> : <article className="activity-row" key={`schedule-${entry.activity.id}`}>
        <div className="activity-icon schedule">◫</div>
        <div className="activity-person static"><strong>{entry.activity.studentName ?? entry.activity.instructor}</strong><span>{entry.activity.studentName ? `${entry.activity.instructor} · Instructor schedule` : 'Instructor schedule'}</span></div>
        <div className="activity-detail"><strong>{entry.activity.action}</strong><span>{entry.activity.details}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        <button className="delete-action" onClick={() => removeSchedule(entry.activity.id)}>Delete</button>
      </article>)}
      {!entries.length && <div className="empty-state"><strong>No activity in {periodLabel}</strong><span>Use the arrows or switch to the yearly view.</span></div>}
    </div>
  </section>{latestDeletion && <div className="undo-toast" role="status"><span>{latestDeletion.label}. Permanently deleting in 10 seconds.</span><button onClick={() => undoDeletion(latestDeletion.key)}>Undo</button></div>}{activityEditor && <ActivityEditorModal leads={leads} initial={activityEditor} onClose={() => setActivityEditor(null)} onSave={(input) => { onSaveActivity(input); setAnchor(new Date(input.occurredAt)); setActivityEditor(null) }} />}{cadenceInsertOpen && <CadenceInsertModal leads={leads} onClose={() => setCadenceInsertOpen(false)} onSave={(leadId, activities) => { onInsertCadenceProgress(leadId, activities); setCadenceInsertOpen(false) }} />}</>
}

function ActivityEditorModal({ leads, initial, onClose, onSave }: { leads: Lead[]; initial: ManualActivityInput; onClose: () => void; onSave: (input: ManualActivityInput) => void }) {
  const defaults: Record<ManualEventType, string> = {
    call: 'Attempted call', text: 'Message sent', email: 'Email sent', note: '',
    trial_booked: 'Trial lesson booked', trial_form_completed: 'Trial confirmation form completed', trial_completed: 'Trial lesson completed',
    became_student: 'Became an active student', unenrolled: 'Student unenrolled',
  }
  const [leadId, setLeadId] = useState(initial.leadId)
  const [type, setType] = useState<ManualEventType>(initial.type)
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeInput(new Date(initial.occurredAt)))
  const [trialAt, setTrialAt] = useState(() => initial.trialAt ? toDateTimeInput(new Date(initial.trialAt)) : toDateTimeInput(new Date()))
  const [outcome, setOutcome] = useState(initial.outcome)
  const changeType = (next: ManualEventType) => {
    if (outcome === defaults[type]) setOutcome(defaults[next])
    setType(next)
  }
  const trialDateRequired = type === 'trial_booked'
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal activity-editor" onSubmit={(event) => { event.preventDefault(); if (leadId && occurredAt && outcome.trim() && (!trialDateRequired || trialAt)) onSave({ leadId, activityId: initial.activityId, type, occurredAt: new Date(occurredAt).toISOString(), outcome: outcome.trim(), trialAt: trialDateRequired ? new Date(trialAt).toISOString() : undefined }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">{initial.activityId ? 'Edit activity' : 'Add activity'}</p><h2>{initial.activityId ? 'Correct this event' : 'Log a past event'}</h2><label className="field">Lead<select required disabled={Boolean(initial.activityId)} value={leadId} onChange={(event) => setLeadId(event.target.value)}><option value="">Choose a lead</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.name}{lead.studentName && lead.studentName !== lead.name ? ` / ${lead.studentName}` : ''} · {lead.instrument}</option>)}</select></label><div className="field-pair"><label className="field">Event type<select value={type} onChange={(event) => changeType(event.target.value as ManualEventType)}><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="note">Note</option><option value="trial_booked">Trial lesson booked</option><option value="trial_form_completed">Trial confirmation form completed</option><option value="trial_completed">Trial lesson completed</option><option value="became_student">Became an active student</option><option value="unenrolled">Student unenrolled</option></select></label><label className="field">Event date and time<input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label></div>{trialDateRequired && <label className="field event-highlight">Trial lesson date and time<input required type="datetime-local" value={trialAt} onChange={(event) => setTrialAt(event.target.value)} /><small>This is the lesson time—not when it was booked.</small></label>}<label className="field">Details<textarea required rows={4} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What happened?" /></label><div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!leadId || !occurredAt || !outcome.trim() || (trialDateRequired && !trialAt)}>{initial.activityId ? 'Save changes' : 'Add event'}</button></div></form></div>
}

const ACTIVE_CADENCE_STEPS = [
  { label: 'Step 1 · Initial contact', detail: 'Day 0 — call and text', needsCall: true },
  { label: 'Step 2 · First follow-up', detail: 'Day 2 — text', needsCall: false },
  { label: 'Step 3 · Second follow-up', detail: 'Day 5 — text', needsCall: false },
  { label: 'Step 4 · Final follow-up', detail: 'Day 8 — text', needsCall: false },
]

function CadenceInsertModal({ leads, onClose, onSave }: { leads: Lead[]; onClose: () => void; onSave: (leadId: string, activities: Activity[]) => void }) {
  const eligibleLeads = leads.filter((item) => item.status === 'hot' || item.status === 'action_pending' || item.status === 'nurture' || item.status === 'nurture_long_term')
  const [leadId, setLeadId] = useState(eligibleLeads[0]?.id ?? leads[0]?.id ?? '')
  const lead = leads.find((item) => item.id === leadId)
  const isNurture = lead?.status === 'nurture' || lead?.status === 'nurture_long_term'
  const isActiveEligible = lead?.status === 'hot' || lead?.status === 'action_pending'
  const [stepDates, setStepDates] = useState<string[]>(['', '', '', ''])
  const [nurtureDate, setNurtureDate] = useState('')

  const setStep = (index: number, value: string) => setStepDates((current) => {
    const next = [...current]
    next[index] = value
    if (!value) for (let i = index + 1; i < next.length; i += 1) next[i] = ''
    return next
  })

  const filledCount = stepDates.filter(Boolean).length
  const contiguous = stepDates.every((value, index) => Boolean(value) === (index < filledCount))

  const save = () => {
    if (!lead) return
    if (isNurture) {
      if (!nurtureDate) return
      const date = new Date(`${nurtureDate}T12:00:00`)
      const activities: Activity[] = []
      if (nurtureRequiresCall(lead, date)) activities.push({ id: crypto.randomUUID(), type: 'call', occurredAt: new Date(date.getTime() - 60_000).toISOString(), outcome: 'Attempted call (backfilled)' })
      activities.push({ id: crypto.randomUUID(), type: 'text', occurredAt: date.toISOString(), outcome: 'Message sent (backfilled)' })
      onSave(lead.id, activities)
      return
    }
    if (!filledCount || !contiguous) return
    const activities: Activity[] = []
    stepDates.forEach((value, index) => {
      if (!value) return
      const date = new Date(`${value}T12:00:00`)
      if (ACTIVE_CADENCE_STEPS[index].needsCall) activities.push({ id: crypto.randomUUID(), type: 'call', occurredAt: new Date(date.getTime() - 60_000).toISOString(), outcome: 'Attempted call (backfilled)' })
      activities.push({ id: crypto.randomUUID(), type: 'text', occurredAt: date.toISOString(), outcome: 'Message sent (backfilled)' })
    })
    onSave(lead.id, activities)
  }

  const canSave = Boolean(lead) && (isNurture ? Boolean(nurtureDate) : isActiveEligible && filledCount > 0 && contiguous)

  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal cadence-insert-modal">
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">Insert into follow-up cycle</p>
    <h2>Backfill past outreach steps</h2>
    <p className="muted">For a lead who was already partway through their follow-up cadence before it was tracked here. This creates the call/text history needed so future reminders land on the right day — meant for a lead with no outreach logged here yet.</p>
    <label className="field">Lead<select value={leadId} onChange={(event) => { setLeadId(event.target.value); setStepDates(['', '', '', '']); setNurtureDate('') }}><option value="">Choose a lead</option>{leads.map((item) => <option value={item.id} key={item.id}>{item.name}{item.studentName && item.studentName !== item.name ? ` / ${item.studentName}` : ''} · {statusLabels[item.status]}</option>)}</select></label>
    {!lead ? null : isNurture ? <>
      <p className="muted">Nurture check-ins repeat every two weeks indefinitely, so only the most recent one matters for scheduling the next. Enter that date — whether a call was needed that day is figured out automatically.</p>
      <label className="field">Most recent completed check-in<input type="date" value={nurtureDate} min={localDateKey(nurtureStartedAt(lead))} max={localDateKey(new Date())} onChange={(event) => setNurtureDate(event.target.value)} /></label>
    </> : isActiveEligible ? <div className="cadence-steps">{ACTIVE_CADENCE_STEPS.map((step, index) => {
      const disabled = index > filledCount
      return <div className={`cadence-step${disabled ? ' step-disabled' : ''}`} key={step.label}>
        <div><strong>{step.label}</strong><small>{step.detail}{disabled ? ' · Fill the previous step first' : ''}</small></div>
        <input type="date" disabled={disabled} value={stepDates[index]} max={localDateKey(new Date())} onChange={(event) => setStep(index, event.target.value)} />
      </div>
    })}</div> : <p className="picker-warning"><strong>{lead.name} isn't in an active outreach or nurture cadence right now.</strong><span>Their status is {statusLabels[lead.status]}, so backfilling steps wouldn't change anything for them.</span></p>}
    <div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!canSave} onClick={save}>Add to activity log</button></div>
  </section></div>
}

function Settings({ instruments, leads, instructors, availability, entries, openings, onInstrumentsChange, onInstructorsChange, onAvailabilityChange, onEntriesChange, onOpeningsChange, onScheduleLog }: {
  instruments: string[]
  leads: Lead[]
  instructors: Instructor[]
  availability: InstructorAvailability[]
  entries: ScheduleEntry[]
  openings: TrialOpening[]
  onInstrumentsChange: (value: string[]) => void
  onInstructorsChange: (value: Instructor[]) => void
  onAvailabilityChange: (value: InstructorAvailability[]) => void
  onEntriesChange: (value: ScheduleEntry[]) => void
  onOpeningsChange: (value: TrialOpening[]) => void
  onScheduleLog: (activity: ScheduleLogInput) => void
}) {
  const [newInstrument, setNewInstrument] = useState('')
  const [newInstructorName, setNewInstructorName] = useState('')
  const [newInstructorInstruments, setNewInstructorInstruments] = useState<string[]>([])
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null)

  const instrumentIsUsed = (instrument: string) => leads.some((lead) => lead.instrument === instrument)
    || instructors.some((instructor) => instructor.instruments.includes(instrument))
    || entries.some((entry) => entry.instrument === instrument)
    || openings.some((opening) => opening.instruments.includes(instrument))

  const addInstrument = () => {
    const name = newInstrument.trim()
    if (!name) return
    if (instruments.some((instrument) => instrument.toLowerCase() === name.toLowerCase())) { window.alert('That instrument is already listed.'); return }
    onInstrumentsChange([...instruments, name]); setNewInstrument('')
  }

  const removeInstrument = (instrument: string) => {
    if (instruments.length === 1) { window.alert('At least one offered instrument must remain.'); return }
    if (instrumentIsUsed(instrument)) { window.alert(`${instrument} is currently attached to a lead, instructor, opening, or scheduled lesson. Update those records before removing it.`); return }
    onInstrumentsChange(instruments.filter((item) => item !== instrument))
  }

  const addInstructor = () => {
    const name = newInstructorName.trim()
    if (!name) return
    if (!newInstructorInstruments.length) { window.alert('Select at least one instrument.'); return }
    if (instructors.some((item) => item.name.toLowerCase() === name.toLowerCase())) { window.alert('That instructor already exists.'); return }
    const next = { id: crypto.randomUUID(), name, instruments: newInstructorInstruments }
    onInstructorsChange([...instructors, next]); setNewInstructorName(''); setNewInstructorInstruments([])
    onScheduleLog({ action: 'Instructor added', instructor: name, details: newInstructorInstruments.join(' / ') })
  }

  const removeInstructor = (item: Instructor) => {
    if (!window.confirm(`Remove ${item.name}? Their availability, scheduled lessons, and trial openings will also be removed.`)) return
    onInstructorsChange(instructors.filter((instructor) => instructor.id !== item.id))
    onAvailabilityChange(availability.filter((block) => block.instructorId !== item.id))
    onEntriesChange(entries.filter((entry) => entry.instructorId !== item.id))
    onOpeningsChange(openings.filter((opening) => opening.instructor !== item.name))
    onScheduleLog({ action: 'Instructor removed', instructor: item.name, details: `${item.instruments.join(' / ')} · Schedule data removed` })
  }

  const saveInstructorInstruments = (item: Instructor, nextInstruments: string[]) => {
    if (!nextInstruments.length) { window.alert('Select at least one instrument.'); return }
    const previous = item.instruments.join(' / ')
    onInstructorsChange(instructors.map((instructor) => instructor.id === item.id ? { ...item, instruments: nextInstruments } : instructor))
    onOpeningsChange(openings.map((opening) => opening.instructor === item.name ? { ...opening, instruments: nextInstruments } : opening))
    onScheduleLog({ action: 'Instructor instruments updated', instructor: item.name, details: `${previous} → ${nextInstruments.join(' / ')}` })
    setEditingInstructor(null)
  }

  return <><section className="settings-grid">
    <div className="card setting-card settings-wide"><h2>Instruments offered</h2><p>This list controls the instrument choices used throughout the lead manager.</p><form className="settings-add-row" onSubmit={(event) => { event.preventDefault(); addInstrument() }}><input value={newInstrument} onChange={(event) => setNewInstrument(event.target.value)} placeholder="Add an instrument" /><button className="primary" type="submit" disabled={!newInstrument.trim()}>＋ Add</button></form><div className="settings-item-list">{instruments.map((instrument) => { const used = instrumentIsUsed(instrument); return <span key={instrument}><b>{instrument}</b>{used && <small>In use</small>}<button disabled={used} title={used ? `${instrument} is currently in use` : `Remove ${instrument}`} onClick={() => removeInstrument(instrument)}>×</button></span> })}</div></div>
    <div className="card setting-card settings-wide"><h2>Instructor roster</h2><p>Add instructors and edit the instruments each person teaches.</p><label className="field">Name<input value={newInstructorName} onChange={(event) => setNewInstructorName(event.target.value)} placeholder="Instructor name" /></label><div className="instrument-checks settings-instrument-checks">{instruments.map((instrument) => <label key={instrument}><input type="checkbox" checked={newInstructorInstruments.includes(instrument)} onChange={(event) => setNewInstructorInstruments((current) => event.target.checked ? [...current, instrument] : current.filter((item) => item !== instrument))} /> {instrument}</label>)}</div><button className="secondary" onClick={addInstructor}>＋ Add instructor</button><div className="settings-instructor-list">{instructors.map((item) => <article key={item.id}><div><b>{item.name}</b><small>{item.instruments.join(' / ')}</small></div><button className="edit-instructor" onClick={() => setEditingInstructor(item)}>Edit</button><button className="remove-instructor" title={`Remove ${item.name}`} onClick={() => removeInstructor(item)}>×</button></article>)}</div></div>
    <div className="card setting-card"><h2>Contact availability</h2><p>Recommendations will land inside these windows.</p><div className="schedule-row"><span>Monday–Friday</span><strong>4:30–8:00 PM</strong></div><div className="schedule-row"><span>Saturday–Sunday</span><strong>10:00 AM–4:00 PM</strong></div><div className="blackout"><strong>Recurring exceptions</strong><span>Tuesday 5:00–5:30 PM</span><span>Thursday 4:30–5:30 PM</span></div><button className="secondary">Edit availability</button></div>
    <div className="card setting-card"><h2>Calendar rules</h2><p>The follow-up plan automatically recognizes the day of week and major U.S. holidays.</p><label className="toggle-row"><span><strong>Avoid major holidays</strong><small>Move planned outreach to the next open day</small></span><input type="checkbox" defaultChecked /></label><label className="toggle-row"><span><strong>Allow weekend outreach</strong><small>Use your weekend availability for fresh leads</small></span><input type="checkbox" defaultChecked /></label></div>
  </section>{editingInstructor && <InstructorEditor instrumentOptions={instruments} instructor={editingInstructor} lockedInstruments={Array.from(new Set(entries.filter((entry) => entry.instructorId === editingInstructor.id).map((entry) => entry.instrument)))} onClose={() => setEditingInstructor(null)} onSave={(nextInstruments) => saveInstructorInstruments(editingInstructor, nextInstruments)} />}</>
}

const scheduleDays = [
  { label: 'Monday', short: 'Mon', dayOfWeek: 1 }, { label: 'Tuesday', short: 'Tue', dayOfWeek: 2 },
  { label: 'Wednesday', short: 'Wed', dayOfWeek: 3 }, { label: 'Thursday', short: 'Thu', dayOfWeek: 4 },
  { label: 'Friday', short: 'Fri', dayOfWeek: 5 }, { label: 'Saturday', short: 'Sat', dayOfWeek: 6 },
]
const scheduleTimes = Array.from({ length: 55 }, (_, index) => {
  const minutes = 480 + index * 15
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

function lessonFitsAvailability(availability: InstructorAvailability[], instructorId: string, dayOfWeek: number, time: string, durationMinutes: number) {
  const start = timeMinutes(time)
  const end = start + durationMinutes
  return availability.some((block) => block.instructorId === instructorId && block.dayOfWeek === dayOfWeek && start >= timeMinutes(block.startTime) && end <= timeMinutes(block.endTime))
}

const EPOCH_MONDAY = new Date(2024, 0, 1)
const weekIndexSince = (date: Date) => Math.round((startOfScheduleWeek(date).getTime() - EPOCH_MONDAY.getTime()) / (7 * 86_400_000))

function onRecurrencePhase(entry: ScheduleEntry, date: Date) {
  if ((entry.repeatIntervalWeeks ?? 1) !== 2 || !entry.startsOn) return true
  const startWeek = weekIndexSince(new Date(`${entry.startsOn}T00:00:00`))
  const thisWeek = weekIndexSince(date)
  return ((thisWeek - startWeek) % 2 + 2) % 2 === 0
}

function biweeklyPhasesMatch(a: ScheduleEntry, b: ScheduleEntry) {
  if (!a.startsOn || !b.startsOn) return true
  const weekA = weekIndexSince(new Date(`${a.startsOn}T00:00:00`))
  const weekB = weekIndexSince(new Date(`${b.startsOn}T00:00:00`))
  return ((weekA - weekB) % 2 + 2) % 2 === 0
}

function entryOccursOnDate(entry: ScheduleEntry, date: Date) {
  if (entry.kind === 'regular') {
    const key = localDateKey(date)
    return entry.dayOfWeek === date.getDay()
      && (!entry.startsOn || key >= entry.startsOn)
      && (!entry.endsOn || key <= entry.endsOn)
      && !entry.skippedDates?.includes(key)
      && onRecurrencePhase(entry, date)
  }
  return Boolean(entry.startsAt && localDateKey(new Date(entry.startsAt)) === localDateKey(date))
}

function entryStartTime(entry: ScheduleEntry) {
  if (entry.kind === 'regular') return entry.startTime!
  const startsAt = new Date(entry.startsAt!)
  return `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
}

function timesOverlap(firstTime: string, firstDuration: number, secondTime: string, secondDuration: number) {
  const firstStart = timeMinutes(firstTime)
  const secondStart = timeMinutes(secondTime)
  return firstStart < secondStart + secondDuration && secondStart < firstStart + firstDuration
}

function entryAtSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  return entries.find((entry) => entry.instructorId === instructorId && entryOccursOnDate(entry, date) && entryStartTime(entry) === time)
}

function entryOccupyingSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  const slot = timeMinutes(time)
  return entries.find((entry) => {
    if (entry.instructorId !== instructorId || !entryOccursOnDate(entry, date)) return false
    const start = timeMinutes(entryStartTime(entry))
    return slot >= start && slot < start + (entry.durationMinutes ?? 30)
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

function UpcomingSlotNotes({ entries, onEdit }: { entries: ScheduleEntry[]; onEdit: (entry: ScheduleEntry) => void }) {
  if (!entries.length) return null
  return <div className="upcoming-notes">{entries.slice(0, 3).map((entry) => <button type="button" key={entry.id} title={`Edit ${entry.studentName}`} onClick={(event) => { event.stopPropagation(); onEdit(entry) }}><small>{upcomingEntryDate(entry).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} {entry.kind === 'regular' ? 'Starts' : entry.kind === 'trial' ? 'Trial' : 'One-time'}: {entry.studentName}</small></button>)}{entries.length > 3 && <small>+{entries.length - 3} more</small>}</div>
}

function describeScheduleEntry(entry: ScheduleEntry) {
  if (entry.kind === 'regular') return `${entry.instrument} · ${entry.repeatIntervalWeeks === 2 ? 'Every other' : 'Every'} ${scheduleDays.find((day) => day.dayOfWeek === entry.dayOfWeek)?.label} at ${formatClock(entry.startTime!)} · ${entry.durationMinutes ?? 30} minutes · Starting ${new Date(`${entry.startsOn}T00:00:00`).toLocaleDateString('en-US')}`
  return `${entry.instrument} · ${entry.kind === 'trial' ? 'Trial' : 'One-time lesson'} · ${formatTrialTime(entry.startsAt!)} · ${entry.durationMinutes ?? 30} minutes`
}

function upcomingEntryCoversSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  const slot = timeMinutes(time)
  return entries.filter((entry) => {
    if (entry.instructorId !== instructorId) return false
    if (entry.kind === 'regular') {
      if (!entry.startsOn || entry.dayOfWeek !== date.getDay()) return false
      const start = timeMinutes(entry.startTime!)
      const duration = entry.durationMinutes ?? 30
      if (slot < start || slot >= start + duration) return false
      const referenceSlot = dateAtTime(date, entry.startTime!)
      const cutoff = datePlusDays(referenceSlot, 42)
      const begins = new Date(`${entry.startsOn}T${entry.startTime}:00`)
      return begins > referenceSlot && begins <= cutoff
    }
    if (!entry.startsAt) return false
    const startsAt = new Date(entry.startsAt)
    if (startsAt.getDay() !== date.getDay()) return false
    const start = startsAt.getHours() * 60 + startsAt.getMinutes()
    const duration = entry.durationMinutes ?? 30
    if (slot < start || slot >= start + duration) return false
    const entryTime = `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
    const referenceSlot = dateAtTime(date, entryTime)
    const cutoff = datePlusDays(referenceSlot, 42)
    return startsAt > referenceSlot && startsAt <= cutoff
  })
}

function InstructorSchedule({ leads, instructors, availability, entries, openings, onAvailabilityChange, onEntriesChange, onOpeningsChange, onScheduleLog, onLeadTrialChange }: {
  leads: Lead[]
  instructors: Instructor[]
  availability: InstructorAvailability[]
  entries: ScheduleEntry[]
  openings: TrialOpening[]
  onAvailabilityChange: (value: InstructorAvailability[]) => void
  onEntriesChange: (value: ScheduleEntry[]) => void
  onOpeningsChange: (value: TrialOpening[]) => void
  onScheduleLog: (activity: ScheduleLogInput) => void
  onLeadTrialChange: (id: string, update: Partial<Lead>, outcome: string) => void
}) {
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? '')
  const instructor = instructors.find((item) => item.id === instructorId) ?? instructors[0]
  const [weekStart, setWeekStart] = useState(() => startOfScheduleWeek(new Date()))
  const [availabilityDay, setAvailabilityDay] = useState(1)
  const [availabilityStart, setAvailabilityStart] = useState('16:30')
  const [availabilityEnd, setAvailabilityEnd] = useState('20:00')
  const [slotEditor, setSlotEditor] = useState<{ date: Date; time: string; entry?: ScheduleEntry } | null>(null)
  const [removeChoice, setRemoveChoice] = useState<ScheduleEntry | null>(null)
  const [hoveredTime, setHoveredTime] = useState<string | null>(null)
  useEffect(() => {
    if (!instructors.some((item) => item.id === instructorId)) setInstructorId(instructors[0]?.id ?? '')
  }, [instructors, instructorId])

  if (!instructor) return <section className="card empty-instructors"><h2>No instructors yet</h2><p>Add your first instructor from Settings, then their schedule will appear here.</p></section>

  const weekDates = scheduleDays.map((_, index) => datePlusDays(weekStart, index))
  const instructorOpenings = openings.filter((opening) => opening.instructor === instructor.name && Date.parse(opening.startsAt) > Date.now())

  const changeInstructor = (id: string) => {
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

  const saveEntry = (next: ScheduleEntry) => {
    const existing = entries.find((entry) => entry.id === next.id)
    if (next.kind === 'trial' && !next.leadId) { window.alert('Choose a lead from the list before scheduling the trial.'); return }
    if (next.kind === 'trial' && entries.some((entry) => entry.id !== next.id && entry.kind === 'trial' && entry.leadId === next.leadId)) { window.alert('That lead already has a trial on the instructor schedule. Edit their existing trial instead.'); return }
    const date = next.kind === 'regular' ? new Date(`${next.startsOn}T${next.startTime}:00`) : new Date(next.startsAt!)
    const time = next.kind === 'regular' ? next.startTime! : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    if (next.kind === 'regular' && date.getDay() !== next.dayOfWeek) { window.alert(`The start date must fall on ${scheduleDays.find((day) => day.dayOfWeek === next.dayOfWeek)?.label}.`); return }
    if (!lessonFitsAvailability(availability, instructor.id, date.getDay(), time, next.durationMinutes ?? 30)) { window.alert(`${instructor.name} is not marked available for that entire lesson.`); return }
    if (next.kind === 'regular') {
      const nextStart = next.startsOn ?? '0000-00-00'
      const nextEnd = next.endsOn ?? '9999-12-31'
      const recurringConflict = entries.some((entry) => entry.id !== next.id
        && entry.instructorId === instructor.id
        && entry.kind === 'regular'
        && entry.dayOfWeek === next.dayOfWeek
        && timesOverlap(entry.startTime!, entry.durationMinutes ?? 30, next.startTime!, next.durationMinutes ?? 30)
        && (entry.startsOn ?? '0000-00-00') <= nextEnd
        && nextStart <= (entry.endsOn ?? '9999-12-31')
        && ((entry.repeatIntervalWeeks ?? 1) === 1 || (next.repeatIntervalWeeks ?? 1) === 1 || biweeklyPhasesMatch(entry, next)))
      if (recurringConflict) { window.alert('Another regular student already owns this weekly time. Open a specific absence date, then add a trial or one-time lesson there.'); return }
    }
    const conflictingEntry = entries.filter((entry) => entry.id !== next.id).find((entry) => entry.instructorId === instructor.id
      && entryOccursOnDate(entry, date)
      && timesOverlap(entryStartTime(entry), entry.durationMinutes ?? 30, time, next.durationMinutes ?? 30))
    if (conflictingEntry) { window.alert(`That lesson overlaps ${conflictingEntry.studentName}'s scheduled time.`); return }
    const duration = next.durationMinutes ?? 30
    const proposedStart = timeMinutes(time)
    const proposedEnd = proposedStart + duration
    const sameDayIntervals: [number, number][] = entries
      .filter((entry) => entry.id !== next.id && entry.instructorId === instructor.id && entryOccursOnDate(entry, date))
      .map((entry) => { const start = timeMinutes(entryStartTime(entry)); return [start, start + (entry.durationMinutes ?? 30)] })
    sameDayIntervals.push([proposedStart, proposedEnd])
    sameDayIntervals.sort((a, b) => a[0] - b[0])
    const mergedIntervals: [number, number][] = []
    for (const [start, end] of sameDayIntervals) {
      const last = mergedIntervals[mergedIntervals.length - 1]
      if (last && start - last[1] < 15) last[1] = Math.max(last[1], end)
      else mergedIntervals.push([start, end])
    }
    const block = mergedIntervals.find(([start, end]) => proposedStart < end && proposedEnd > start)
    const blockMinutes = block ? block[1] - block[0] : duration
    if (blockMinutes > 225) {
      const hours = (blockMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
      if (!window.confirm(`This gives ${instructor.name} ${hours} consecutive hours with no break of 15+ minutes on ${date.toLocaleDateString('en-US')}. A break is recommended after 3.75 hours. Schedule anyway?`)) return
    }
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
    if (existing?.kind === 'trial' && existing.leadId && (next.kind !== 'trial' || next.leadId !== existing.leadId)) {
      onLeadTrialChange(existing.leadId, { trialAt: undefined, holdFormComplete: false, trialAttended: false }, 'Trial removed from instructor schedule')
    }
    if (next.kind === 'trial' && next.leadId && next.startsAt) {
      const selectedLead = leads.find((lead) => lead.id === next.leadId)
      onLeadTrialChange(next.leadId, { trialAt: next.startsAt }, selectedLead?.trialAt ? `Trial rescheduled to ${formatTrialTime(next.startsAt)} from the instructor schedule` : `Trial booked for ${formatTrialTime(next.startsAt)} from the instructor schedule`)
    }
    setSlotEditor(null)
  }

  const removeEntireSeries = (entry: ScheduleEntry) => {
    onEntriesChange(entries.filter((item) => item.id !== entry.id))
    onScheduleLog({ action: 'Scheduled lesson removed', instructor: instructor.name, studentName: entry.studentName, details: describeScheduleEntry(entry) })
    if (entry.kind === 'trial' && entry.leadId) onLeadTrialChange(entry.leadId, { trialAt: undefined, holdFormComplete: false, trialAttended: false }, 'Trial removed from instructor schedule')
    setRemoveChoice(null); setSlotEditor(null)
  }

  const endSeriesFromDate = (entry: ScheduleEntry, fromDate: Date) => {
    const cutoffKey = localDateKey(datePlusDays(fromDate, -1))
    if (entry.startsOn && cutoffKey < entry.startsOn) { removeEntireSeries(entry); return }
    const next = { ...entry, endsOn: cutoffKey }
    onEntriesChange(entries.map((item) => item.id === entry.id ? next : item))
    onScheduleLog({ action: 'Recurring lesson ended', instructor: instructor.name, studentName: entry.studentName, details: `${describeScheduleEntry(entry)} · ends after ${new Date(`${cutoffKey}T00:00:00`).toLocaleDateString('en-US')}` })
    setRemoveChoice(null); setSlotEditor(null)
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

  const editUpcomingEntry = (entry: ScheduleEntry) => {
    const date = upcomingEntryDate(entry)
    const time = entry.kind === 'regular' ? entry.startTime! : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    setSlotEditor({ date, time, entry })
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
          <div className="field-pair"><label className="field">From<input type="time" step="900" value={availabilityStart} onChange={(event) => setAvailabilityStart(event.target.value)} /></label><label className="field">To<input type="time" step="900" value={availabilityEnd} onChange={(event) => setAvailabilityEnd(event.target.value)} /></label></div>
          <button className="secondary full" onClick={addAvailability}>＋ Add available hours</button>
          <div className="availability-chips">{availability.filter((block) => block.instructorId === instructor.id).map((block) => <span key={block.id}>{scheduleDays.find((day) => day.dayOfWeek === block.dayOfWeek)?.short} {formatClock(block.startTime)}–{formatClock(block.endTime)}<button onClick={() => removeAvailability(block)}>×</button></span>)}</div>
        </div>

        <div className="card schedule-tip"><strong>Add or edit lessons from the calendar</strong><p>Use the small <b>+</b> on an open slot to schedule a student. Click an occupied slot to edit it.</p></div>
      </aside>

      <div className="card schedule-board">
        <div className="schedule-grid">
          <div className="schedule-corner">Time</div>{weekDates.map((date, index) => <div className="schedule-day" key={date.toISOString()}><strong>{scheduleDays[index].short}</strong><small>{date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</small></div>)}
          {scheduleTimes.flatMap((time) => [<div className={time === hoveredTime ? 'schedule-time time-highlighted' : 'schedule-time'} key={`time-${time}`}>{formatClock(time)}</div>, ...weekDates.map((date) => {
            const available = slotIsAvailable(availability, instructor.id, date.getDay(), time)
            const entry = entryOccupyingSlot(entries, instructor.id, date, time)
            const entryStartsHere = entry ? entryAtSlot(entries, instructor.id, date, time)?.id === entry.id : false
            const skippedRegular = entry ? undefined : skippedRegularAtSlot(entries, instructor.id, date, time)
            const startsAt = dateAtTime(date, time)
            const opening = openings.find((item) => item.instructor === instructor.name && new Date(item.startsAt).getTime() === startsAt.getTime())
            const upcoming = upcomingEntriesAtSlot(entries, instructor.id, date, time)
            const upcomingContinuation = entry ? [] : upcomingEntryCoversSlot(entries, instructor.id, date, time).filter((item) => !upcoming.includes(item))
            const past = startsAt < new Date()
            const className = `${entry ? `schedule-cell ${entry.kind === 'regular' ? 'regular' : 'dated'}${entryStartsHere ? ' entry-start' : ' entry-continuation'}` : skippedRegular ? 'schedule-cell absence' : opening ? 'schedule-cell offered' : available ? `schedule-cell open${past ? ' past' : ''}` : 'schedule-cell unavailable'}${time === hoveredTime ? ' row-hovered' : ''}`
            return <div className={className} key={`${localDateKey(date)}-${time}`} onMouseEnter={() => setHoveredTime(time)} onMouseLeave={() => setHoveredTime((current) => current === time ? null : current)}>
              {entry ? <><button type="button" className="cell-main" aria-label={`Edit ${entry.studentName}`} onClick={() => setSlotEditor({ date, time: entryStartTime(entry), entry })}>{entryStartsHere && <><strong>{entry.kind === 'regular' ? '🔒 ' : ''}{entry.studentName}</strong><small>{entry.kind === 'regular' ? 'Regular' : entry.kind === 'trial' ? 'Trial' : 'One-time'} · {entry.durationMinutes ?? 30} min{entry.kind === 'regular' && entry.repeatIntervalWeeks === 2 ? ' · Biweekly' : ''}</small></>}</button>{entryStartsHere && <UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} />}</>
                : available ? <><button type="button" disabled={past} className="cell-main" onClick={() => toggleOpening(date, time)}>{opening ? <><strong>✓ Trial opening</strong><small>{opening.instruments.join(' / ')}</small></> : skippedRegular ? <><strong>Open this week</strong><small>{skippedRegular.studentName} absent</small></> : <span>{past ? '' : 'Open'}</span>}</button><UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} />{upcomingContinuation.length > 0 && <small className="upcoming-continuation-hint">Reserved soon · {upcomingContinuation[0].studentName}</small>}{!past && <button type="button" className="cell-add" title="Schedule a student here" onClick={() => setSlotEditor({ date, time })}>＋</button>}{skippedRegular && !past && <button type="button" className="cell-restore" title={`Restore ${skippedRegular.studentName}'s regular lesson`} onClick={() => restoreRegularDate(skippedRegular, date)}>↶</button>}</>
                  : <>{upcomingContinuation.length > 0 && <small className="upcoming-continuation-hint">Reserved soon · {upcomingContinuation[0].studentName}</small>}<UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} /></>}
            </div>
          })])}
        </div>
      </div>
    </div>
    <div className="selected-opening-summary"><strong>{instructorOpenings.length} upcoming {instructor.name} trial opening{instructorOpenings.length === 1 ? '' : 's'} available to Text Now</strong></div>
    {slotEditor && <ScheduleEntryEditor leads={leads} instructor={instructor} slot={slotEditor} onClose={() => setSlotEditor(null)} onSave={saveEntry} onDelete={slotEditor.entry ? () => setRemoveChoice(slotEditor.entry!) : undefined} onSkipDate={slotEditor.entry?.kind === 'regular' ? () => skipRegularDate(slotEditor.entry!, slotEditor.date) : undefined} />}
    {removeChoice && slotEditor && <RemoveEntryDialog entry={removeChoice} slotDate={slotEditor.date} onCancel={() => setRemoveChoice(null)} onRemoveAll={() => removeEntireSeries(removeChoice)} onRemoveForward={removeChoice.kind === 'regular' ? () => endSeriesFromDate(removeChoice, slotEditor.date) : undefined} />}
  </section>
}

function InstructorEditor({ instrumentOptions, instructor, lockedInstruments, onClose, onSave }: {
  instrumentOptions: string[]
  instructor: Instructor
  lockedInstruments: string[]
  onClose: () => void
  onSave: (instruments: string[]) => void
}) {
  const [selected, setSelected] = useState(instructor.instruments)
  const toggle = (instrument: string, checked: boolean) => setSelected((current) => checked ? Array.from(new Set([...current, instrument])) : current.filter((item) => item !== instrument))
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal instructor-editor" onSubmit={(event) => { event.preventDefault(); onSave(selected) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Edit instructor</p><h2>{instructor.name}</h2><p className="muted">Choose every instrument this instructor can teach. Their availability and scheduled lessons will stay exactly as they are.</p><div className="instrument-checks editor-instrument-checks">{instrumentOptions.map((instrument) => {
    const locked = lockedInstruments.includes(instrument)
    return <label className={locked ? 'locked-instrument' : ''} key={instrument}><input type="checkbox" checked={selected.includes(instrument)} disabled={locked} onChange={(event) => toggle(instrument, event.target.checked)} /> <span>{instrument}{locked && <small>Scheduled</small>}</span></label>
  })}</div><div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!selected.length}>Save instruments</button></div></form></div>
}

function ScheduleEntryEditor({ leads, instructor, slot, onClose, onSave, onDelete, onSkipDate }: {
  leads: Lead[]
  instructor: Instructor
  slot: { date: Date; time: string; entry?: ScheduleEntry }
  onClose: () => void
  onSave: (entry: ScheduleEntry) => void
  onDelete?: () => void
  onSkipDate?: () => void
}) {
  const existing = slot.entry
  const initialDate = existing?.startsAt ? new Date(existing.startsAt) : dateAtTime(slot.date, slot.time)
  const matchedExistingLead = leads.find((lead) => lead.id === existing?.leadId) ?? (existing?.kind === 'trial' ? leads.find((lead) => (lead.studentName ?? lead.name).toLowerCase() === existing.studentName.toLowerCase()) : undefined)
  const [selectedLeadId, setSelectedLeadId] = useState(matchedExistingLead?.id ?? '')
  const [studentName, setStudentName] = useState(existing?.studentName ?? matchedExistingLead?.studentName ?? matchedExistingLead?.name ?? '')
  const [kind, setKind] = useState<ScheduleEntryKind>(existing?.kind ?? 'regular')
  const [instrument, setInstrument] = useState(existing?.instrument ?? instructor.instruments[0])
  const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(existing?.durationMinutes ?? 30)
  const [dayOfWeek, setDayOfWeek] = useState(existing?.dayOfWeek ?? slot.date.getDay())
  const [time, setTime] = useState(existing?.startTime ?? slot.time)
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? localDateKey(slot.date))
  const [startsAt, setStartsAt] = useState(() => toDateTimeInput(initialDate))
  const [repeatIntervalWeeks, setRepeatIntervalWeeks] = useState<1 | 2>(existing?.repeatIntervalWeeks ?? 1)

  const save = () => {
    if (!selectedLeadId && !existing) { window.alert('Choose a student or lead from the search list.'); return }
    if (!studentName.trim()) return
    const base = { id: existing?.id ?? crypto.randomUUID(), instructorId: instructor.id, leadId: selectedLeadId || existing?.leadId, studentName: studentName.trim(), instrument, kind, durationMinutes }
    onSave(kind === 'regular' ? { ...base, dayOfWeek, startTime: time, startsOn, endsOn: existing?.endsOn, skippedDates: existing?.skippedDates, repeatIntervalWeeks } : { ...base, startsAt: new Date(startsAt).toISOString() })
  }

  return <div className="overlay modal-overlay schedule-editor-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal schedule-editor">
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">{existing ? 'Edit scheduled lesson' : 'Add scheduled lesson'}</p>
    <h2>{existing ? existing.studentName : `${scheduleDays.find((day) => day.dayOfWeek === slot.date.getDay())?.label} at ${formatClock(slot.time)}`}</h2>
    {existing?.kind === 'regular' && <p className="editor-caution">🔒 This weekly time belongs to {existing.studentName}. Use “Open this date” for a one-week absence.</p>}
    <LeadSearchPicker leads={leads} instructor={instructor} selectedLeadId={selectedLeadId} initialName={studentName} onClear={() => { setSelectedLeadId(''); setStudentName('') }} onSelect={(lead) => { setSelectedLeadId(lead.id); setStudentName(lead.studentName ?? lead.name); setInstrument(lead.instrument) }} />
    <div className="field-pair"><label className="field">Type<select disabled={existing?.kind === 'regular'} value={kind} onChange={(event) => setKind(event.target.value as ScheduleEntryKind)}><option value="regular">Regular student</option><option value="trial">Trial</option><option value="one_time">One-time lesson</option></select></label><label className="field">Instrument<select disabled={Boolean(selectedLeadId)} value={instrument} onChange={(event) => setInstrument(event.target.value)}>{instructor.instruments.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <label className="field">Lesson length<select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value) as 30 | 45 | 60)}><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></label>
    {kind === 'regular' ? <><div className="field-pair"><label className="field">Day<select value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))}>{scheduleDays.map((day) => <option value={day.dayOfWeek} key={day.dayOfWeek}>{day.label}</option>)}</select></label><label className="field">Time<input type="time" step="900" value={time} onChange={(event) => setTime(event.target.value)} /></label></div><label className="field">Repeats<select value={repeatIntervalWeeks} onChange={(event) => setRepeatIntervalWeeks(Number(event.target.value) as 1 | 2)}><option value={1}>Every week</option><option value={2}>Every other week</option></select></label><label className="field">Starts on<input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /><small>The recurring lesson will not occupy earlier weeks. For a biweekly lesson, this date sets which week it lands on.</small></label></> : <label className="field">Date and time<input type="datetime-local" step="900" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>}
    <div className="editor-actions">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Remove from schedule</button>}{onSkipDate && <button type="button" className="absence-button" onClick={onSkipDate}>Open this date</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" onClick={save}>{existing ? 'Save changes' : 'Add lesson'}</button></div>
  </section></div>
}

function RemoveEntryDialog({ entry, slotDate, onCancel, onRemoveAll, onRemoveForward }: {
  entry: ScheduleEntry
  slotDate: Date
  onCancel: () => void
  onRemoveAll: () => void
  onRemoveForward?: () => void
}) {
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><section className="modal remove-entry-dialog">
    <button type="button" className="close" onClick={onCancel}>×</button>
    <p className="eyebrow">Remove lesson</p>
    <h2>{entry.studentName}</h2>
    {onRemoveForward ? <>
      <p className="muted">This is a recurring lesson. Remove it entirely, or only from {slotDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} forward?</p>
      <div className="editor-actions remove-choice-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="button" className="danger-button" onClick={onRemoveForward}>Remove from {slotDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} forward</button><button type="button" className="danger-button" onClick={onRemoveAll}>Remove entire schedule</button></div>
    </> : <>
      <p className="muted">Remove this lesson from the schedule?</p>
      <div className="editor-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="button" className="danger-button" onClick={onRemoveAll}>Remove from schedule</button></div>
    </>}
  </section></div>
}

function LeadSearchPicker({ leads, instructor, selectedLeadId, initialName, onSelect, onClear }: { leads: Lead[]; instructor: Instructor; selectedLeadId: string; initialName?: string; onSelect: (lead: Lead) => void; onClear: () => void }) {
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId)
  const [query, setQuery] = useState(selectedLead?.name ?? initialName ?? '')
  const [open, setOpen] = useState(true)
  const matchingLeads = leads
    .filter((lead) => instructor.instruments.some((instrument) => instrument.toLowerCase() === lead.instrument.toLowerCase()))
    .filter((lead) => `${lead.name} ${lead.studentName ?? ''} ${lead.instrument} ${statusLabels[lead.status]}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  return <div className="field lead-search-field"><span>Student or lead</span><div className="lead-search"><input autoFocus required value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); if (event.target.value !== selectedLead?.name && event.target.value !== selectedLead?.studentName) onClear(); setOpen(true) }} placeholder="Start typing a name…" autoComplete="off" />{open && <div className="lead-search-options">{matchingLeads.map((lead) => <button type="button" className={lead.id === selectedLeadId ? 'selected' : ''} key={lead.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(lead); setQuery(lead.studentName ?? lead.name); setOpen(false) }}><strong>{lead.studentName ?? lead.name}</strong><small>{lead.studentName && lead.studentName !== lead.name ? `Lead: ${lead.name} · ` : ''}{lead.instrument} · {statusLabels[lead.status]}</small></button>)}{!matchingLeads.length && <p>No people match this instructor’s instruments and your search.</p>}</div>}</div><small>Only people whose instrument is taught by {instructor.name} are shown.</small></div>
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

function LeadPanel({ lead, instruments, trialOpenings, onClose, onLog, onAddNote, onTextNow, onTrialUpdate, onStatusChange, onDeleteActivity, onUpdateLead, onDeleteLead }: { lead: Lead; instruments: string[]; trialOpenings: TrialOpening[]; onClose: () => void; onLog: (id: string, type: ActivityType) => void; onAddNote: (id: string, note: string) => void; onTextNow: StartText; onTrialUpdate: (id: string, update: Partial<Lead>, outcome: string) => void; onStatusChange: (id: string, status: LeadStatus) => void; onDeleteActivity: (leadId: string, activityId: string) => void; onUpdateLead: (id: string, update: Partial<Lead>) => void; onDeleteLead: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const isNurture = lead.status === 'nurture' || lead.status === 'nurture_long_term'
  const isActiveHotLead = lead.status === 'hot' && !lead.trialAt
  const recommendation = isNurture ? nextNurtureContact(lead, defaultAvailability) : nextContact(lead, defaultAvailability)
  const matchingOpenings = trialOpenings.filter((opening) => opening.instruments.some((instrument) => instrument.toLowerCase() === lead.instrument.toLowerCase()) && Date.parse(opening.startsAt) > Date.now())
  const nurtureTemplate = isNurture ? nurtureMessageFor(lead, recommendation.at, matchingOpenings.length >= 2) : undefined
  const activeTemplate = isActiveHotLead ? activeFollowUpFor(lead) : undefined
  const messageTemplate = nurtureTemplate ?? activeTemplate
  const cadenceProgress = isNurture ? nurtureCadenceState(lead) : isActiveHotLead ? activeCadenceState(lead) : undefined
  const notes = lead.activities.filter((activity) => activity.type === 'note').reverse()
  return <><div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="drawer">
    <button className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>{lead.name}</h2>{lead.studentName && <p className="profile-student">Student: <strong>{lead.studentName}</strong></p>}<p className="muted">{lead.instrument} · {lead.phone}</p>
    <button className="edit-lead-button" onClick={() => setEditing(true)}>✎ Edit lead information</button>
    <div className="next-box"><small>Recommended next contact</small><strong>{recommendation.reason.includes('now') ? 'Call now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span>{messageTemplate && <><b>{messageTemplate.label}</b><small>{messageTemplate.message}</small></>}</div>
    {activeTemplate?.voicemail && <details className="script-box"><summary>{activeTemplate.voicemailLabel}</summary><p>{activeTemplate.voicemail}</p></details>}
    <div className="drawer-actions"><button className="primary" onClick={() => onTextNow(lead, messageTemplate)}>↗ Text now</button>{(!messageTemplate || messageTemplate.callFirst) && <button className="secondary" disabled={cadenceProgress?.callLogged} onClick={() => onLog(lead.id, 'call')}>{cadenceProgress?.callLogged ? '✓ Call logged' : '☎ Log call'}</button>}<button className="secondary" disabled={cadenceProgress?.textLogged} onClick={() => onLog(lead.id, 'text')}>{cadenceProgress?.textLogged ? '✓ Text logged' : '✓ Log text'}</button></div>
    <TrialWorkflowEditor key={`${lead.id}-${lead.trialAt ?? 'none'}`} lead={lead} onTrialUpdate={onTrialUpdate} />
    <LeadNoteComposer onSave={(note) => onAddNote(lead.id, note)} />
    {notes.length > 0 && <><h3>Saved notes</h3><div className="profile-notes">{notes.map((note) => <article key={note.id}><p>{note.outcome}</p><small>{formatDate(note.occurredAt)}</small></article>)}</div></>}
    <label className="field">Status<select value={lead.status} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <div className="details"><div><small>Received</small><strong>{formatDate(lead.receivedAt)}</strong></div><div><small>Campaign</small><strong>{lead.campaign}</strong></div><div><small>Total touches</small><strong>{touchCount(lead)}</strong></div></div>
    <h3>Activity</h3><div className="timeline">{[...lead.activities].reverse().map((activity) => <div key={activity.id}><i /><span><strong>{activity.type === 'call' ? 'Call' : activity.type === 'text' ? 'Text' : activity.type === 'note' ? 'Note' : activity.type === 'status_change' ? 'Status updated' : activity.type === 'trial_update' ? 'Trial updated' : activity.type === 'lead_created' ? 'New lead received' : activity.type === 'lead_update' ? 'Lead information updated' : activity.type}</strong><small>{formatDate(activity.occurredAt)}{activity.type === 'note' ? '' : ` · ${activity.outcome}`}</small>{activity.type === 'note' && <small className="timeline-note-preview" title={activity.outcome}>{activity.outcome}</small>}</span>{(activity.type === 'call' || activity.type === 'text' || activity.type === 'note') && <button className="timeline-delete" onClick={() => window.confirm('Delete this activity?') && onDeleteActivity(lead.id, activity.id)}>Delete</button>}</div>)}{!lead.activities.length && <p className="muted">No outreach logged yet.</p>}</div>
    <button className="delete-lead-button" onClick={() => onDeleteLead(lead.id)}>Delete lead permanently</button>
  </aside></div>{editing && <EditLeadModal lead={lead} instruments={instruments} onClose={() => setEditing(false)} onSave={(update) => { onUpdateLead(lead.id, update); setEditing(false) }} />}</>
}

function TrialWorkflowEditor({ lead, onTrialUpdate }: { lead: Lead; onTrialUpdate: (id: string, update: Partial<Lead>, outcome: string) => void }) {
  return <section className="trial-workflow"><div className="trial-workflow-head"><div><strong>Trial workflow</strong><small>{!lead.trialAt ? 'No trial booked' : lead.trialAttended ? 'Post-trial · waiting to book lessons' : lead.holdFormComplete ? 'Trial confirmed' : 'Trial booked · form pending'}</small></div></div>{lead.trialAt ? <div className="trial-booking-summary"><strong>{formatTrialTime(lead.trialAt)}</strong><small>Manage this booking from the Instructor Schedule.</small></div> : <p className="trial-schedule-guidance">Choose this lead from an instructor’s calendar to schedule their trial.</p>}{lead.trialAt && <div className="milestone-checks"><label><input type="checkbox" checked={lead.holdFormComplete} onChange={(event) => onTrialUpdate(lead.id, { holdFormComplete: event.target.checked }, event.target.checked ? 'Booking form completed' : 'Booking form marked incomplete')} /> Booking form completed</label><label><input type="checkbox" checked={lead.trialAttended} onChange={(event) => onTrialUpdate(lead.id, { trialAttended: event.target.checked }, event.target.checked ? 'Trial marked completed' : 'Trial marked not completed')} /> Trial completed</label></div>}</section>
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

function EditLeadModal({ lead, instruments, onClose, onSave }: { lead: Lead; instruments: string[]; onClose: () => void; onSave: (update: Partial<Lead>) => void }) {
  const [name, setName] = useState(lead.name)
  const [studentName, setStudentName] = useState(lead.studentName ?? '')
  const [sameAsLead, setSameAsLead] = useState(Boolean(lead.studentName && lead.studentName === lead.name))
  const [phone, setPhone] = useState(lead.phone)
  const [email, setEmail] = useState(lead.email)
  const [instrument, setInstrument] = useState(lead.instrument)
  const [source, setSource] = useState(lead.source)
  const [campaign, setCampaign] = useState(lead.campaign)
  const [receivedAt, setReceivedAt] = useState(() => toDateTimeInput(new Date(lead.receivedAt)))
  return <div className="overlay modal-overlay edit-lead-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal edit-lead-modal" onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim(), studentName: (sameAsLead ? name : studentName).trim() || undefined, phone: phone.trim(), email: email.trim(), instrument, source, campaign: campaign.trim(), receivedAt: new Date(receivedAt).toISOString() }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>Edit lead information</h2><label className="field">Lead name<input required value={name} onChange={(event) => { setName(event.target.value); if (sameAsLead) setStudentName(event.target.value) }} autoFocus /></label><label className="field">Student name <small>Optional</small><input value={sameAsLead ? name : studentName} disabled={sameAsLead} onChange={(event) => setStudentName(event.target.value)} /></label><label className="same-name-check"><input type="checkbox" checked={sameAsLead} onChange={(event) => { setSameAsLead(event.target.checked); if (event.target.checked) setStudentName(name) }} /> Student name is the same as lead name</label><div className="field-pair"><label className="field">Phone<input required value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="field">Email <small>Optional</small><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></div><label className="field">Inquiry received<input required type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label><div className="field-pair"><label className="field">Instrument<select required value={instrument} onChange={(event) => setInstrument(event.target.value)}>{instruments.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field">Source<select value={source} onChange={(event) => setSource(event.target.value)}><option>Meta</option><option>Website Traffic</option><option>WLS</option><option>Word of Mouth</option></select></label></div><label className="field">Campaign<input value={campaign} onChange={(event) => setCampaign(event.target.value)} /></label><div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save changes</button></div></form></div>
}

function NewLeadModal({ instruments, onClose, onSave }: { instruments: string[]; onClose: () => void; onSave: (lead: Lead) => void }) {
  const [name, setName] = useState('')
  const [studentName, setStudentName] = useState('')
  const [sameAsLead, setSameAsLead] = useState(false)
  const [phone, setPhone] = useState('')
  const [instrument, setInstrument] = useState(instruments[0] ?? '')
  const [source, setSource] = useState('Meta')
  const [receivedAt, setReceivedAt] = useState(() => toDateTimeInput(new Date()))
  return <div className="overlay modal-overlay"><form className="modal" onSubmit={(event) => { event.preventDefault(); onSave({ id: crypto.randomUUID(), name: name.trim(), studentName: (sameAsLead ? name : studentName).trim() || undefined, phone, email: '', instrument, source, campaign: 'Manual entry', receivedAt: new Date(receivedAt).toISOString(), status: 'hot', activities: [], holdFormComplete: false, trialAttended: false }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Add inquiry</p><h2>New lead</h2><label className="field">Lead name<input required value={name} onChange={(e) => { setName(e.target.value); if (sameAsLead) setStudentName(e.target.value) }} autoFocus /></label><label className="field">Student name <small>Optional</small><input value={sameAsLead ? name : studentName} disabled={sameAsLead} onChange={(e) => setStudentName(e.target.value)} /></label><label className="same-name-check"><input type="checkbox" checked={sameAsLead} onChange={(event) => { setSameAsLead(event.target.checked); if (event.target.checked) setStudentName(name) }} /> Student name is the same as lead name</label><label className="field">Phone<input required value={phone} onChange={(e) => setPhone(e.target.value)} /></label><label className="field">Inquiry received<input required type="datetime-local" value={receivedAt} max={toDateTimeInput(new Date())} onChange={(e) => setReceivedAt(e.target.value)} /><small>Change this if you are entering the lead later.</small></label><div className="field-pair"><label className="field">Instrument<select required value={instrument} onChange={(e) => setInstrument(e.target.value)}>{instruments.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field">Source<select value={source} onChange={(e) => setSource(e.target.value)}><option>Meta</option><option>Website Traffic</option><option>WLS</option><option>Word of Mouth</option></select></label></div><button className="primary full" type="submit">Save lead</button></form></div>
}

export default App
