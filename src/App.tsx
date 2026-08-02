import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { activeFollowUpFor } from './activeTemplates'
import { activeCadenceState, nextContact, nextNurtureContact, nurtureCadenceState } from './cadence'
import { defaultAvailability, demoInstructorAvailability, demoInstructors, demoLeads, demoScheduleEntries, demoTrialOpenings } from './data'
import { loadWorkspaceData, removeActivity as removeStoredActivity, removeScheduleActivity as removeStoredScheduleActivity, saveActivity, saveLead, saveScheduleActivity, saveSettings, syncAvailability, syncEntries, syncInstructors, syncOpenings, updateLead } from './database'
import { nurtureMessageFor } from './nurtureTemplates'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Activity, ActivityType, Instructor, InstructorAvailability, Lead, LeadStatus, ScheduleActivity, ScheduleEntry, ScheduleEntryKind, TrialOpening } from './types'

type View = 'today' | 'leads' | 'trials' | 'openings' | 'activity' | 'settings'
type MessageTemplate = { label: string; message: string; needsTimes?: boolean; callFirst?: boolean }
type StartText = (lead: Lead, template?: MessageTemplate) => void
type TextDraft = { lead: Lead; label: string; message: string }
type ScheduleLogInput = Omit<ScheduleActivity, 'id' | 'occurredAt'>
type ManualActivityType = Exclude<ActivityType, 'status_change' | 'trial_update'>
type ManualActivityInput = { leadId: string; activityId?: string; type: ManualActivityType; occurredAt: string; outcome: string }
type LeadSortKey = 'name' | 'receivedAt' | 'source' | 'touches' | 'status'

const defaultInstruments = ['Piano', 'Guitar', 'Voice', 'Drums', 'Violin', 'Saxophone', 'Trumpet', 'Trombone']

const statusLabels: Record<LeadStatus, string> = {
  active_student: 'Active Student', hot: 'Hot', action_pending: 'Action Pending', nurture: 'Nurture',
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
        <div className="recent-updates"><strong>Recently updated · August 1, 2026</strong><span>Secure Supabase sign-in and permanent data storage are connected.</span><span>Upcoming outreach is previewed below Action Pending.</span><span>Sidebar labels and Next Actions columns stay aligned.</span></div>
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
      setLeads(data.leads)
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

  const addLead = (lead: Lead) => { setLeads((current) => [lead, ...current]); persist(saveLead(lead)); setShowNewLead(false) }
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
  const saveManualActivity = ({ leadId, activityId, type, occurredAt, outcome }: ManualActivityInput) => {
    const activity: Activity = { id: activityId ?? crypto.randomUUID(), type, occurredAt, outcome: outcome.trim() }
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, activities: activityId ? lead.activities.map((item) => item.id === activityId ? activity : item) : [...lead.activities, activity] } : lead))
    persist(saveActivity(leadId, activity))
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
        {view === 'activity' && <ActivityLog leads={leads} scheduleActivities={scheduleActivities} onSelect={setSelectedId} onSaveActivity={saveManualActivity} onDelete={deleteActivity} onDeleteSchedule={deleteScheduleActivity} />}
        {view === 'settings' && <Settings instruments={offeredInstruments} leads={leads} instructors={instructors} availability={instructorAvailability} entries={scheduleEntries} openings={trialOpenings} onInstrumentsChange={replaceInstruments} onInstructorsChange={replaceInstructors} onAvailabilityChange={replaceAvailability} onEntriesChange={replaceEntries} onOpeningsChange={replaceOpenings} onScheduleLog={logScheduleActivity} />}
      </main>

      {selected && <LeadPanel lead={selected} trialOpenings={trialOpenings} onClose={() => setSelectedId(null)} onLog={logActivity} onAddNote={addNote} onTextNow={startText} onTrialUpdate={updateTrial} onStatusChange={changeStatus} onDelete={deleteActivity} />}
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
  const pending = leads.filter((lead) => lead.status === 'action_pending')
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

function PendingActions({ leads, onSelect, onLog, onTextNow, onTakeNote }: { leads: Lead[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void; onTextNow: StartText; onTakeNote: (id: string) => void }) {
  return <section className="card pending-card">
    <div className="section-head"><div><h2>Action pending</h2><p>Leads you manually marked for a specific follow-up.</p></div></div>
    <div className="pending-list">{leads.map((lead) => {
      const action = lead.trialAt ? lead.trialAttended ? 'Trial completed · follow-up needed' : `Trial ${formatDate(lead.trialAt)}` : 'Manual follow-up needed'
      return <article key={lead.id} className="pending-row">
        <button className="pending-person" onClick={() => onSelect(lead.id)}><span><strong>{lead.name}</strong><small>{lead.instrument} · {lead.source}</small></span><b>{action}</b><i>Open →</i></button>
        <div className="row-actions"><button onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><button onClick={() => onLog(lead.id, 'text')}>✓ Log text</button><button onClick={() => onTakeNote(lead.id)}>✎ Take note</button><button onClick={() => onTextNow(lead)}>↗ Text now</button></div>
      </article>
    })}{!leads.length && <div className="today-complete"><strong>No actions pending</strong><span>Change a lead’s status to Action Pending when you need a manual reminder.</span></div>}</div>
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

function ActivityLog({ leads, scheduleActivities, onSelect, onSaveActivity, onDelete, onDeleteSchedule }: { leads: Lead[]; scheduleActivities: ScheduleActivity[]; onSelect: (id: string) => void; onSaveActivity: (input: ManualActivityInput) => void; onDelete: (leadId: string, activityId: string) => void; onDeleteSchedule: (id: string) => void }) {
  const [range, setRange] = useState<'month' | 'year'>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [activityEditor, setActivityEditor] = useState<ManualActivityInput | null>(null)
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
        const action = entry.activity.type === 'call' ? 'Call logged' : entry.activity.type === 'text' ? 'Text logged' : entry.activity.type === 'email' ? 'Email logged' : entry.activity.type === 'note' ? 'Note added' : entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.type === 'trial_update' ? 'Trial updated' : entry.activity.outcome
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

  return <><section className="card activity-card">
    <div className="section-head activity-head"><div><h2>Activity history</h2><p>Lead communication and instructor schedule changes, newest first.</p></div><div className="activity-controls"><button className="primary add-event-button" disabled={!leads.length} onClick={() => setActivityEditor({ leadId: leads[0]?.id ?? '', type: 'call', occurredAt: new Date().toISOString(), outcome: 'Attempted call' })}>＋ Add event</button><div className="range-toggle"><button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>Month</button><button className={range === 'year' ? 'active' : ''} onClick={() => setRange('year')}>Year</button></div><div className="period-switch"><button onClick={() => shiftPeriod(-1)}>←</button><strong>{periodLabel}</strong><button onClick={() => shiftPeriod(1)}>→</button></div><button className="export-button" disabled={!entries.length} onClick={exportCsv}>⇩ Export CSV</button><span className="count-pill">{entries.length} actions</span></div></div>
    <div className="activity-list">
      {entries.map((entry) => entry.kind === 'lead' ? <article className="activity-row" key={`lead-${entry.activity.id}`}>
        <div className={`activity-icon ${entry.activity.type}`}>{entry.activity.type === 'call' ? '☎' : entry.activity.type === 'text' ? '↗' : entry.activity.type === 'email' ? '✉' : entry.activity.type === 'note' ? '✎' : entry.activity.type === 'status_change' ? '↻' : entry.activity.type === 'trial_update' ? '◇' : '•'}</div>
        <button className="activity-person" onClick={() => onSelect(entry.lead.id)}><strong>{entry.lead.name}</strong><span>{entry.lead.instrument} · {entry.lead.phone}</span></button>
        <div className="activity-detail"><strong>{entry.activity.type === 'call' ? 'Call logged' : entry.activity.type === 'text' ? 'Text logged' : entry.activity.type === 'email' ? 'Email logged' : entry.activity.type === 'note' ? 'Note added' : entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.type === 'trial_update' ? 'Trial updated' : entry.activity.outcome}</strong><span>{entry.activity.outcome}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        {(entry.activity.type === 'call' || entry.activity.type === 'text' || entry.activity.type === 'note' || entry.activity.type === 'email') && <div className="activity-row-actions"><button className="edit-action" onClick={() => setActivityEditor({ leadId: entry.lead.id, activityId: entry.activity.id, type: entry.activity.type as ManualActivityType, occurredAt: entry.activity.occurredAt, outcome: entry.activity.outcome })}>Edit</button><button className="delete-action" onClick={() => remove(entry.lead.id, entry.activity.id)} aria-label={`Delete ${entry.activity.type} for ${entry.lead.name}`}>Delete</button></div>}
      </article> : <article className="activity-row" key={`schedule-${entry.activity.id}`}>
        <div className="activity-icon schedule">◫</div>
        <div className="activity-person static"><strong>{entry.activity.studentName ?? entry.activity.instructor}</strong><span>{entry.activity.studentName ? `${entry.activity.instructor} · Instructor schedule` : 'Instructor schedule'}</span></div>
        <div className="activity-detail"><strong>{entry.activity.action}</strong><span>{entry.activity.details}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        <button className="delete-action" onClick={() => removeSchedule(entry.activity.id)}>Delete</button>
      </article>)}
      {!entries.length && <div className="empty-state"><strong>No activity in {periodLabel}</strong><span>Use the arrows or switch to the yearly view.</span></div>}
    </div>
  </section>{activityEditor && <ActivityEditorModal leads={leads} initial={activityEditor} onClose={() => setActivityEditor(null)} onSave={(input) => { onSaveActivity(input); setAnchor(new Date(input.occurredAt)); setActivityEditor(null) }} />}</>
}

function ActivityEditorModal({ leads, initial, onClose, onSave }: { leads: Lead[]; initial: ManualActivityInput; onClose: () => void; onSave: (input: ManualActivityInput) => void }) {
  const defaults: Record<ManualActivityType, string> = { call: 'Attempted call', text: 'Message sent', email: 'Email sent', note: '' }
  const [leadId, setLeadId] = useState(initial.leadId)
  const [type, setType] = useState<ManualActivityType>(initial.type)
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeInput(new Date(initial.occurredAt)))
  const [outcome, setOutcome] = useState(initial.outcome)
  const changeType = (next: ManualActivityType) => {
    if (outcome === defaults[type]) setOutcome(defaults[next])
    setType(next)
  }
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal activity-editor" onSubmit={(event) => { event.preventDefault(); if (leadId && occurredAt && outcome.trim()) onSave({ leadId, activityId: initial.activityId, type, occurredAt: new Date(occurredAt).toISOString(), outcome: outcome.trim() }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">{initial.activityId ? 'Edit activity' : 'Add activity'}</p><h2>{initial.activityId ? 'Correct this event' : 'Log a past event'}</h2><label className="field">Lead<select required disabled={Boolean(initial.activityId)} value={leadId} onChange={(event) => setLeadId(event.target.value)}><option value="">Choose a lead</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.name} · {lead.instrument}</option>)}</select></label><div className="field-pair"><label className="field">Event type<select value={type} onChange={(event) => changeType(event.target.value as ManualActivityType)}><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="note">Note</option></select></label><label className="field">Date and time<input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label></div><label className="field">Details<textarea required rows={4} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What happened?" /></label><div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!leadId || !occurredAt || !outcome.trim()}>{initial.activityId ? 'Save changes' : 'Add event'}</button></div></form></div>
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

function UpcomingSlotNotes({ entries, onEdit }: { entries: ScheduleEntry[]; onEdit: (entry: ScheduleEntry) => void }) {
  if (!entries.length) return null
  return <div className="upcoming-notes">{entries.slice(0, 3).map((entry) => <button type="button" key={entry.id} title={`Edit ${entry.studentName}`} onClick={(event) => { event.stopPropagation(); onEdit(entry) }}><small>{upcomingEntryDate(entry).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} {entry.kind === 'regular' ? 'Starts' : entry.kind === 'trial' ? 'Trial' : 'One-time'}: {entry.studentName}</small></button>)}{entries.length > 3 && <small>+{entries.length - 3} more</small>}</div>
}

function describeScheduleEntry(entry: ScheduleEntry) {
  if (entry.kind === 'regular') return `${entry.instrument} · Every ${scheduleDays.find((day) => day.dayOfWeek === entry.dayOfWeek)?.label} at ${formatClock(entry.startTime!)} · Starting ${new Date(`${entry.startsOn}T00:00:00`).toLocaleDateString('en-US')}`
  return `${entry.instrument} · ${entry.kind === 'trial' ? 'Trial' : 'One-time lesson'} · ${formatTrialTime(entry.startsAt!)}`
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
    if (existing?.kind === 'trial' && existing.leadId && (next.kind !== 'trial' || next.leadId !== existing.leadId)) {
      onLeadTrialChange(existing.leadId, { trialAt: undefined, holdFormComplete: false, trialAttended: false }, 'Trial removed from instructor schedule')
    }
    if (next.kind === 'trial' && next.leadId && next.startsAt) {
      const selectedLead = leads.find((lead) => lead.id === next.leadId)
      onLeadTrialChange(next.leadId, { trialAt: next.startsAt }, selectedLead?.trialAt ? `Trial rescheduled to ${formatTrialTime(next.startsAt)} from the instructor schedule` : `Trial booked for ${formatTrialTime(next.startsAt)} from the instructor schedule`)
    }
    setSlotEditor(null)
  }

  const removeEntry = (entry: ScheduleEntry) => {
    if (!window.confirm(`Remove ${entry.studentName} from the schedule?`)) return
    onEntriesChange(entries.filter((item) => item.id !== entry.id))
    onScheduleLog({ action: 'Scheduled lesson removed', instructor: instructor.name, studentName: entry.studentName, details: describeScheduleEntry(entry) })
    if (entry.kind === 'trial' && entry.leadId) onLeadTrialChange(entry.leadId, { trialAt: undefined, holdFormComplete: false, trialAttended: false }, 'Trial removed from instructor schedule')
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
          <div className="field-pair"><label className="field">From<input type="time" step="1800" value={availabilityStart} onChange={(event) => setAvailabilityStart(event.target.value)} /></label><label className="field">To<input type="time" step="1800" value={availabilityEnd} onChange={(event) => setAvailabilityEnd(event.target.value)} /></label></div>
          <button className="secondary full" onClick={addAvailability}>＋ Add available hours</button>
          <div className="availability-chips">{availability.filter((block) => block.instructorId === instructor.id).map((block) => <span key={block.id}>{scheduleDays.find((day) => day.dayOfWeek === block.dayOfWeek)?.short} {formatClock(block.startTime)}–{formatClock(block.endTime)}<button onClick={() => removeAvailability(block)}>×</button></span>)}</div>
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
              {entry ? <><button type="button" className="cell-main" onClick={() => setSlotEditor({ date, time, entry })}><strong>{entry.kind === 'regular' ? '🔒 ' : ''}{entry.studentName}</strong><small>{entry.kind === 'regular' ? 'Regular' : `${entry.kind === 'trial' ? 'Trial' : 'One-time'} · ${date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`}</small></button><UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} /></>
                : available ? <><button type="button" disabled={past} className="cell-main" onClick={() => toggleOpening(date, time)}>{opening ? <><strong>✓ Trial opening</strong><small>{opening.instruments.join(' / ')}</small></> : skippedRegular ? <><strong>Open this week</strong><small>{skippedRegular.studentName} absent</small></> : <span>{past ? '' : 'Open'}</span>}</button><UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} />{!past && <button type="button" className="cell-add" title="Schedule a student here" onClick={() => setSlotEditor({ date, time })}>＋</button>}{skippedRegular && !past && <button type="button" className="cell-restore" title={`Restore ${skippedRegular.studentName}'s regular lesson`} onClick={() => restoreRegularDate(skippedRegular, date)}>↶</button>}</>
                  : <UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} />}
            </div>
          })])}
        </div>
      </div>
    </div>
    <div className="selected-opening-summary"><strong>{instructorOpenings.length} upcoming {instructor.name} trial opening{instructorOpenings.length === 1 ? '' : 's'} available to Text Now</strong></div>
    {slotEditor && <ScheduleEntryEditor leads={leads} instructor={instructor} slot={slotEditor} onClose={() => setSlotEditor(null)} onSave={saveEntry} onDelete={slotEditor.entry ? () => removeEntry(slotEditor.entry!) : undefined} onSkipDate={slotEditor.entry?.kind === 'regular' ? () => skipRegularDate(slotEditor.entry!, slotEditor.date) : undefined} />}
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
  const [dayOfWeek, setDayOfWeek] = useState(existing?.dayOfWeek ?? slot.date.getDay())
  const [time, setTime] = useState(existing?.startTime ?? slot.time)
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? localDateKey(slot.date))
  const [startsAt, setStartsAt] = useState(() => toDateTimeInput(initialDate))

  const save = () => {
    if (!selectedLeadId && !existing) { window.alert('Choose a student or lead from the search list.'); return }
    if (!studentName.trim()) return
    const base = { id: existing?.id ?? crypto.randomUUID(), instructorId: instructor.id, leadId: selectedLeadId || existing?.leadId, studentName: studentName.trim(), instrument, kind }
    onSave(kind === 'regular' ? { ...base, dayOfWeek, startTime: time, startsOn, endsOn: existing?.endsOn, skippedDates: existing?.skippedDates } : { ...base, startsAt: new Date(startsAt).toISOString() })
  }

  return <div className="overlay modal-overlay schedule-editor-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal schedule-editor">
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">{existing ? 'Edit scheduled lesson' : 'Add scheduled lesson'}</p>
    <h2>{existing ? existing.studentName : `${scheduleDays.find((day) => day.dayOfWeek === slot.date.getDay())?.label} at ${formatClock(slot.time)}`}</h2>
    {existing?.kind === 'regular' && <p className="editor-caution">🔒 This weekly time belongs to {existing.studentName}. Use “Open this date” for a one-week absence.</p>}
    <LeadSearchPicker leads={leads} instructor={instructor} selectedLeadId={selectedLeadId} initialName={studentName} onClear={() => { setSelectedLeadId(''); setStudentName('') }} onSelect={(lead) => { setSelectedLeadId(lead.id); setStudentName(lead.studentName ?? lead.name); setInstrument(lead.instrument) }} />
    <div className="field-pair"><label className="field">Type<select disabled={existing?.kind === 'regular'} value={kind} onChange={(event) => setKind(event.target.value as ScheduleEntryKind)}><option value="regular">Regular student</option><option value="trial">Trial</option><option value="one_time">One-time lesson</option></select></label><label className="field">Instrument<select disabled={Boolean(selectedLeadId)} value={instrument} onChange={(event) => setInstrument(event.target.value)}>{instructor.instruments.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    {kind === 'regular' ? <><div className="field-pair"><label className="field">Day<select value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))}>{scheduleDays.map((day) => <option value={day.dayOfWeek} key={day.dayOfWeek}>{day.label}</option>)}</select></label><label className="field">Time<input type="time" step="1800" value={time} onChange={(event) => setTime(event.target.value)} /></label></div><label className="field">Starts on<input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /><small>The recurring lesson will not occupy earlier weeks.</small></label></> : <label className="field">Date and time<input type="datetime-local" step="1800" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>}
    <div className="editor-actions">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Remove from schedule</button>}{onSkipDate && <button type="button" className="absence-button" onClick={onSkipDate}>Open this date</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" onClick={save}>{existing ? 'Save changes' : 'Add lesson'}</button></div>
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

function LeadPanel({ lead, trialOpenings, onClose, onLog, onAddNote, onTextNow, onTrialUpdate, onStatusChange, onDelete }: { lead: Lead; trialOpenings: TrialOpening[]; onClose: () => void; onLog: (id: string, type: ActivityType) => void; onAddNote: (id: string, note: string) => void; onTextNow: StartText; onTrialUpdate: (id: string, update: Partial<Lead>, outcome: string) => void; onStatusChange: (id: string, status: LeadStatus) => void; onDelete: (leadId: string, activityId: string) => void }) {
  const isNurture = lead.status === 'nurture' || lead.status === 'nurture_long_term'
  const isActiveHotLead = lead.status === 'hot' && !lead.trialAt
  const recommendation = isNurture ? nextNurtureContact(lead, defaultAvailability) : nextContact(lead, defaultAvailability)
  const matchingOpenings = trialOpenings.filter((opening) => opening.instruments.some((instrument) => instrument.toLowerCase() === lead.instrument.toLowerCase()) && Date.parse(opening.startsAt) > Date.now())
  const nurtureTemplate = isNurture ? nurtureMessageFor(lead, recommendation.at, matchingOpenings.length >= 2) : undefined
  const activeTemplate = isActiveHotLead ? activeFollowUpFor(lead) : undefined
  const messageTemplate = nurtureTemplate ?? activeTemplate
  const cadenceProgress = isNurture ? nurtureCadenceState(lead) : isActiveHotLead ? activeCadenceState(lead) : undefined
  const notes = lead.activities.filter((activity) => activity.type === 'note').reverse()
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="drawer">
    <button className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>{lead.name}</h2>{lead.studentName && <p className="profile-student">Student: <strong>{lead.studentName}</strong></p>}<p className="muted">{lead.instrument} · {lead.phone}</p>
    <div className="next-box"><small>Recommended next contact</small><strong>{recommendation.reason.includes('now') ? 'Call now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span>{messageTemplate && <><b>{messageTemplate.label}</b><small>{messageTemplate.message}</small></>}</div>
    {activeTemplate?.voicemail && <details className="script-box"><summary>{activeTemplate.voicemailLabel}</summary><p>{activeTemplate.voicemail}</p></details>}
    <div className="drawer-actions"><button className="primary" onClick={() => onTextNow(lead, messageTemplate)}>↗ Text now</button>{(!messageTemplate || messageTemplate.callFirst) && <button className="secondary" disabled={cadenceProgress?.callLogged} onClick={() => onLog(lead.id, 'call')}>{cadenceProgress?.callLogged ? '✓ Call logged' : '☎ Log call'}</button>}<button className="secondary" disabled={cadenceProgress?.textLogged} onClick={() => onLog(lead.id, 'text')}>{cadenceProgress?.textLogged ? '✓ Text logged' : '✓ Log text'}</button></div>
    <TrialWorkflowEditor key={`${lead.id}-${lead.trialAt ?? 'none'}`} lead={lead} onTrialUpdate={onTrialUpdate} />
    <LeadNoteComposer onSave={(note) => onAddNote(lead.id, note)} />
    {notes.length > 0 && <><h3>Saved notes</h3><div className="profile-notes">{notes.map((note) => <article key={note.id}><p>{note.outcome}</p><small>{formatDate(note.occurredAt)}</small></article>)}</div></>}
    <label className="field">Status<select value={lead.status} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <div className="details"><div><small>Received</small><strong>{formatDate(lead.receivedAt)}</strong></div><div><small>Campaign</small><strong>{lead.campaign}</strong></div><div><small>Total touches</small><strong>{touchCount(lead)}</strong></div></div>
    <h3>Activity</h3><div className="timeline">{[...lead.activities].reverse().map((activity) => <div key={activity.id}><i /><span><strong>{activity.type === 'call' ? 'Call' : activity.type === 'text' ? 'Text' : activity.type === 'note' ? 'Note' : activity.type === 'status_change' ? 'Status updated' : activity.type === 'trial_update' ? 'Trial updated' : activity.type}</strong><small>{formatDate(activity.occurredAt)}{activity.type === 'note' ? '' : ` · ${activity.outcome}`}</small>{activity.type === 'note' && <small className="timeline-note-preview" title={activity.outcome}>{activity.outcome}</small>}</span>{(activity.type === 'call' || activity.type === 'text' || activity.type === 'note') && <button className="timeline-delete" onClick={() => window.confirm('Delete this activity?') && onDelete(lead.id, activity.id)}>Delete</button>}</div>)}{!lead.activities.length && <p className="muted">No outreach logged yet.</p>}</div>
  </aside></div>
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
