import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import apolloIcon from './assets/apollo-icon.png'
import apolloLogoFull from './assets/apollo-logo-full.png'
import { activeFollowUpFor } from './activeTemplates'
import { activeCadenceState, nextContact, nextNurtureContact, nurtureCadenceState, nurtureRequiresCall, nurtureStartedAt } from './cadence'
import { defaultAvailability, demoInstructorAvailability, demoInstructors, demoLeads, demoScheduleEntries, demoTrialOpenings } from './data'
import { loadWorkspaceData, removeActivity as removeStoredActivity, removeLead as removeStoredLead, removeScheduleActivity as removeStoredScheduleActivity, saveActivity, saveLead, saveMessageTemplates, saveScheduleActivity, saveSettings, syncAvailability, syncEntries, syncInstructors, syncOpenings, updateLead } from './database'
import { applyTemplate, defaultMessageTemplates, messageTemplateGroups } from './messageTemplates'
import { nurtureMessageFor } from './nurtureTemplates'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Activity, ActivityType, Instructor, InstructorAvailability, Lead, LeadStatus, ScheduleActivity, ScheduleEntry, ScheduleEntryKind, TrialOpening } from './types'

type View = 'today' | 'leads' | 'openings' | 'activity' | 'settings'
type MessageTemplate = { label: string; message: string; needsTimes?: boolean; callFirst?: boolean }
type StartText = (lead: Lead, template?: MessageTemplate) => void
type TextDraft = { lead: Lead; label: string; message: string }
type ScheduleLogInput = Omit<ScheduleActivity, 'id' | 'occurredAt'>
type ManualActivityType = Extract<ActivityType, 'call' | 'text' | 'email' | 'note'>
type ManualEventType = ManualActivityType | 'trial_booked' | 'trial_form_completed' | 'trial_completed' | 'became_student' | 'unenrolled'
type ManualActivityInput = { leadId: string; activityId?: string; type: ManualEventType; occurredAt: string; outcome: string; trialAt?: string }
type LeadSortKey = 'name' | 'receivedAt' | 'source' | 'touches' | 'status'
type TrialPromptReason = 'booking_form' | 'trial_complete' | 'became_student'
type PendingActionItem = { lead: Lead; reason: 'manual' | 'enrollment_agreement' | 'follow_up' | TrialPromptReason; action: string; template?: MessageTemplate }
type TrialPromptState = { lead: Lead; reason: TrialPromptReason; decision: 'yes' | 'no' | 'second_trial' }

const defaultInstruments = ['Piano', 'Guitar', 'Voice', 'Drums', 'Violin', 'Saxophone', 'Trumpet', 'Trombone']

const statusLabels: Record<LeadStatus, string> = {
  active_student: 'Active Student', hot: 'Hot', action_pending: 'Action Pending', nurture: 'Nurture',
  nurture_long_term: 'Nurture Long Term', unresponsive: 'Unresponsive', unenrolled: 'Unenrolled',
}

const touchCount = (lead: Lead) => lead.activities.filter((activity) => activity.type === 'call' || activity.type === 'text').length
function revertForActivity(activity: Activity): Partial<Lead> | undefined {
  if (activity.type === 'trial_update') {
    if (/^(Trial lesson booked|Second trial lesson scheduled)/.test(activity.outcome)) return { trialAt: undefined, holdFormComplete: false, trialAttended: false }
    if (activity.outcome.startsWith('Trial confirmation form completed')) return { holdFormComplete: false }
    if (activity.outcome.startsWith('Trial lesson completed')) return { trialAttended: false }
  }
  if (activity.type === 'status_change' && activity.outcome.startsWith('Became an active student')) return { status: 'hot', enrolledAt: undefined }
  return undefined
}
const shareInstrument = (a: string[], b: string[]) => a.some((x) => b.some((y) => x.toLowerCase() === y.toLowerCase()))
const leadInstrumentLabel = (lead: Lead) => lead.instruments.join(' / ')
const leadInstrumentText = (lead: Lead) => lead.instruments.map((item) => item.toLowerCase()).join(' and ')
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

const trialFormReminderFor = (lead: Lead, templates: Record<string, string> = defaultMessageTemplates): MessageTemplate => ({
  label: 'TRIAL FORM REMINDER',
  message: applyTemplate(templates.trial_form_reminder ?? defaultMessageTemplates.trial_form_reminder, {
    firstName: lead.name.split(' ')[0],
    studentPossessive: lead.studentName && lead.studentName !== lead.name ? `${lead.studentName}'s` : 'your',
    instrument: leadInstrumentText(lead),
    trialTime: formatTrialTime(lead.trialAt!),
  }),
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

function parseAuthHashError() {
  const hash = window.location.hash
  if (!hash.includes('error=')) return ''
  const params = new URLSearchParams(hash.slice(1))
  const description = params.get('error_description')
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return description ? description.replace(/\+/g, ' ') : 'That link is invalid or has expired.'
}

function AuthenticatedApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [recovery, setRecovery] = useState(false)
  const [authLinkError, setAuthLinkError] = useState(() => parseAuthHashError())

  useEffect(() => {
    void supabase!.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase!.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <AppLoading message="Checking your secure session…" />
  if (recovery) return <SetNewPassword onDone={() => setRecovery(false)} />
  if (!session) return <Login initialError={authLinkError} onDismissInitialError={() => setAuthLinkError('')} />
  return <Workspace onSignOut={() => { void supabase!.auth.signOut() }} />
}

function Login({ initialError, onDismissInitialError }: { initialError: string; onDismissInitialError: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [forgotMode, setForgotMode] = useState(Boolean(initialError))
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [resetError, setResetError] = useState('')
  const [linkError, setLinkError] = useState(initialError)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true); setError('')
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) setError(signInError.message)
    setSubmitting(false)
  }

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault()
    setResetSubmitting(true); setResetError(''); setLinkError('')
    const { error: resetErr } = await supabase!.auth.resetPasswordForEmail(resetEmail.trim(), { redirectTo: window.location.origin })
    if (resetErr) setResetError(resetErr.message)
    else setResetSent(true)
    setResetSubmitting(false)
  }

  if (forgotMode) {
    return <main className="welcome-shell"><form className="welcome-card login-card" onSubmit={submitReset}>
      <img className="brand-mark" src={apolloIcon} alt="Apollo" /><p className="eyebrow">Apollo Music Academy</p><h1>Reset your password.</h1>
      {resetSent ? <p className="welcome-copy">Check {resetEmail} for a link to set a new password.</p> : <>
        {linkError && <p className="auth-error">{linkError} Request a new link below.</p>}
        <p className="welcome-copy">Enter your email and we’ll send you a link to set a new password.</p>
        <label className="field">Email<input required type="email" autoComplete="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} autoFocus /></label>
        {resetError && <p className="auth-error">{resetError}</p>}
        <button className="primary jumbo full" disabled={resetSubmitting}>{resetSubmitting ? 'Sending…' : 'Send reset link'}</button>
      </>}
      <button type="button" className="forgot-password-link" onClick={() => { setForgotMode(false); setResetSent(false); setResetError(''); setLinkError(''); onDismissInitialError() }}>← Back to sign in</button>
    </form></main>
  }

  return <main className="welcome-shell"><form className="welcome-card login-card" onSubmit={submit}>
    <img className="brand-mark" src={apolloIcon} alt="Apollo" /><p className="eyebrow">Apollo Music Academy</p><h1>Welcome back.</h1>
    <p className="welcome-copy">Sign in to your private lead manager.</p>
    <label className="field">Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus /></label>
    <label className="field">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error && <p className="auth-error">{error}</p>}
    <button className="primary jumbo full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
    <button type="button" className="forgot-password-link" onClick={() => setForgotMode(true)}>Forgot password?</button>
  </form></main>
}

function SetNewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true); setError('')
    const { error: updateError } = await supabase!.auth.updateUser({ password })
    if (updateError) setError(updateError.message)
    else setDone(true)
    setSubmitting(false)
  }

  return <main className="welcome-shell"><form className="welcome-card login-card" onSubmit={submit}>
    <img className="brand-mark" src={apolloIcon} alt="Apollo" /><p className="eyebrow">Apollo Music Academy</p><h1>Set a new password.</h1>
    {done ? <>
      <p className="welcome-copy">Your password has been updated.</p>
      <button type="button" className="primary jumbo full" onClick={onDone}>Continue to your workspace</button>
    </> : <>
      <label className="field">New password<input required type="password" autoComplete="new-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></label>
      <label className="field">Confirm password<input required type="password" autoComplete="new-password" minLength={6} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      {error && <p className="auth-error">{error}</p>}
      <button className="primary jumbo full" disabled={submitting}>{submitting ? 'Saving…' : 'Save new password'}</button>
    </>}
  </form></main>
}

function AppLoading({ message }: { message: string }) {
  return <main className="app-loading"><img className="brand-mark" src={apolloIcon} alt="Apollo" /><strong>{message}</strong></main>
}

function Welcome({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="welcome-shell">
      <section className="welcome-card">
        <img className="brand-mark" src={apolloIcon} alt="Apollo" />
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
  const [messageTemplates, setMessageTemplates] = useState(defaultMessageTemplates)
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
  const [pendingUndos, setPendingUndos] = useState<{ key: string; label: string; timerId: number; revert: () => void }[]>([])
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
      setMessageTemplates({ ...defaultMessageTemplates, ...(data.messageTemplates ?? {}) })
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

  const createLeadRemote = async (lead: Lead, activity: Activity) => {
    if (!isSupabaseConfigured) return
    try {
      await saveLead(lead)
      await saveActivity(lead.id, activity)
    } catch (error) {
      setDataError(`Your change is still visible here, but could not be saved: ${(error as Error).message}`)
    }
  }
  const addLead = (lead: Lead) => {
    const activity: Activity = { id: crypto.randomUUID(), type: 'lead_created', occurredAt: lead.receivedAt, outcome: 'New lead received' }
    const next = { ...lead, activities: [activity] }
    setLeads((current) => [next, ...current])
    void createLeadRemote(lead, activity)
    setShowNewLead(false)
  }
  const addLeadAwaitable = async (lead: Lead) => {
    const activity: Activity = { id: crypto.randomUUID(), type: 'lead_created', occurredAt: lead.receivedAt, outcome: 'New lead received' }
    const next = { ...lead, activities: [activity] }
    setLeads((current) => [next, ...current])
    await createLeadRemote(lead, activity)
  }
  const updateLeadInfo = (id: string, update: Partial<Lead>) => {
    const lead = leads.find((item) => item.id === id)
    if (!lead) return
    const labels: Partial<Record<keyof Lead, string>> = { name: 'lead name', studentName: 'student name', phone: 'phone', email: 'email', instruments: 'instrument(s)', receivedAt: 'inquiry date', source: 'source', campaign: 'campaign' }
    const changed = (Object.keys(update) as (keyof Lead)[]).filter((key) => {
      const before = lead[key]; const after = update[key]
      if (Array.isArray(before) && Array.isArray(after)) return before.join(',') !== after.join(',')
      return before !== after
    }).map((key) => labels[key]).filter(Boolean)
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
  const logActivity = (id: string, type: ActivityType, outcome?: string) => {
    const lead = leads.find((item) => item.id === id)
    const activity: Activity = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), outcome: outcome ?? (type === 'call' ? 'Attempted call' : 'Message sent') }
    queueReversible(
      `log-${activity.id}`,
      `Logged ${type === 'call' ? 'call' : type === 'text' ? 'text' : 'note'}${lead ? ` — ${lead.name}` : ''}`,
      () => setLeads((current) => current.map((item) => item.id === id ? { ...item, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === id ? { ...item, activities: item.activities.filter((a) => a.id !== activity.id) } : item)),
      () => persist(saveActivity(id, activity)),
    )
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
    const lead = leads.find((item) => item.id === leadId)
    const activity = lead?.activities.find((item) => item.id === activityId)
    if (!lead || !activity) return
    if (activity.type === 'lead_created') {
      if (!window.confirm(`This is ${lead.name}'s founding record. Deleting it will permanently delete ${lead.name} and their entire history, since they were never really added. Continue?`)) return
      setLeads((current) => current.filter((item) => item.id !== leadId))
      setScheduleEntries((current) => current.filter((entry) => entry.leadId !== leadId))
      setSelectedId((current) => current === leadId ? null : current)
      persist(removeStoredLead(leadId))
      return
    }
    const revert = revertForActivity(activity)
    setLeads((current) => current.map((item) => item.id === leadId ? { ...item, ...revert, activities: item.activities.filter((item2) => item2.id !== activityId) } : item))
    if (revert && 'trialAt' in revert) replaceEntries(scheduleEntries.filter((entry) => !(entry.leadId === leadId && entry.kind === 'trial')))
    persist(Promise.all([removeStoredActivity(activityId), ...(revert ? [updateLead(leadId, revert)] : [])]))
  }
  const editActivityFields = (leadId: string, activityId: string, occurredAt: string, outcome: string) => {
    let updated: Activity | undefined
    setLeads((current) => current.map((lead) => {
      if (lead.id !== leadId) return lead
      const activities = lead.activities.map((activity) => {
        if (activity.id !== activityId) return activity
        updated = { ...activity, occurredAt, outcome }
        return updated
      })
      return { ...lead, activities }
    }))
    if (updated) persist(saveActivity(leadId, updated))
  }
  const editScheduleActivityFields = (id: string, occurredAt: string, details: string) => {
    let updated: ScheduleActivity | undefined
    setScheduleActivities((current) => current.map((activity) => {
      if (activity.id !== id) return activity
      updated = { ...activity, occurredAt, details }
      return updated
    }))
    if (updated) persist(saveScheduleActivity(updated, instructors.find((item) => item.name === updated!.instructor)?.id))
  }
  const addNote = (id: string, note: string) => {
    const lead = leads.find((item) => item.id === id)
    const activity: Activity = { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: note.trim() }
    queueReversible(
      `log-${activity.id}`,
      `Added note${lead ? ` — ${lead.name}` : ''}`,
      () => setLeads((current) => current.map((item) => item.id === id ? { ...item, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === id ? { ...item, activities: item.activities.filter((a) => a.id !== activity.id) } : item)),
      () => persist(saveActivity(id, activity)),
    )
  }
  const queueReversible = (key: string, label: string, apply: () => void, revert: () => void, commit: () => void) => {
    apply()
    const timerId = window.setTimeout(() => {
      commit()
      setPendingUndos((current) => current.filter((item) => item.key !== key))
    }, 10_000)
    setPendingUndos((current) => [...current, { key, label, timerId, revert }])
  }
  const undoPending = (key: string) => {
    const pending = pendingUndos.find((item) => item.key === key)
    if (!pending) return
    window.clearTimeout(pending.timerId)
    pending.revert()
    setPendingUndos((current) => current.filter((item) => item.key !== key))
  }
  const trialPromptCopy: Record<TrialPromptReason, { update: (occurredAt: string) => Partial<Lead>; outcome: string; activityType: ActivityType }> = {
    booking_form: { update: () => ({ holdFormComplete: true }), outcome: 'Booking form completed', activityType: 'trial_update' },
    trial_complete: { update: () => ({ trialAttended: true }), outcome: 'Trial lesson completed', activityType: 'trial_update' },
    became_student: { update: (occurredAt) => ({ status: 'active_student', enrolledAt: occurredAt }), outcome: 'Became an active student', activityType: 'status_change' },
  }
  const resolveTrialYes = (lead: Lead, reason: TrialPromptReason, occurredAtInput: string) => {
    const occurredAt = new Date(occurredAtInput).toISOString()
    const copy = trialPromptCopy[reason]
    const leadUpdate = copy.update(occurredAt)
    const activity: Activity = { id: crypto.randomUUID(), type: copy.activityType, occurredAt, outcome: copy.outcome }
    const previousLead = lead
    queueReversible(
      `trial-${activity.id}`,
      `${copy.outcome} — ${lead.name}`,
      () => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...leadUpdate, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === lead.id ? previousLead : item)),
      () => persist(Promise.all([saveActivity(lead.id, activity), updateLead(lead.id, leadUpdate)])),
    )
  }
  const resolveTrialNo = (lead: Lead, comment: string) => {
    const activity: Activity = { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: comment.trim() }
    const previousLead = lead
    queueReversible(
      `trial-${activity.id}`,
      `Note added — ${lead.name}`,
      () => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === lead.id ? previousLead : item)),
      () => persist(saveActivity(lead.id, activity)),
    )
  }
  const resolveSecondTrial = (lead: Lead, instructorId: string, occurredAtInput: string) => {
    const iso = new Date(occurredAtInput).toISOString()
    if (!bookTrialOnSchedule(lead, instructorId, iso)) return
    const leadUpdate: Partial<Lead> = { trialAt: iso, holdFormComplete: false, trialAttended: false }
    const activity: Activity = { id: crypto.randomUUID(), type: 'trial_update', occurredAt: new Date().toISOString(), outcome: `Second trial lesson scheduled for ${formatTrialTime(iso)}` }
    const previousLead = lead
    queueReversible(
      `trial-${activity.id}`,
      `Second trial scheduled — ${lead.name}`,
      () => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...leadUpdate, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === lead.id ? previousLead : item)),
      () => persist(Promise.all([saveActivity(lead.id, activity), updateLead(lead.id, leadUpdate)])),
    )
  }
  const resolveEnrollmentAgreement = (lead: Lead) => {
    const leadUpdate: Partial<Lead> = { enrollmentAgreementSigned: true }
    const activity: Activity = { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: 'Enrollment agreement signature collected' }
    const previousLead = lead
    queueReversible(
      `agreement-${activity.id}`,
      `Signature collected — ${lead.name}`,
      () => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...leadUpdate, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === lead.id ? previousLead : item)),
      () => persist(Promise.all([saveActivity(lead.id, activity), updateLead(lead.id, leadUpdate)])),
    )
  }
  const overrideEnrollmentAgreement = (lead: Lead) => {
    const leadUpdate: Partial<Lead> = { enrollmentAgreementSigned: true }
    const activity: Activity = { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: 'Enrollment agreement requirement overridden — not collected' }
    const previousLead = lead
    queueReversible(
      `agreement-${activity.id}`,
      `Signature requirement overridden — ${lead.name}`,
      () => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...leadUpdate, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === lead.id ? previousLead : item)),
      () => persist(Promise.all([saveActivity(lead.id, activity), updateLead(lead.id, leadUpdate)])),
    )
  }
  const requestSignaturesFromAllStudents = () => {
    const activeStudents = leads.filter((lead) => lead.status === 'active_student')
    if (!activeStudents.length) { window.alert('There are no active students to collect signatures from.'); return }
    if (!window.confirm(`This will add ${activeStudents.length} active student${activeStudents.length === 1 ? '' : 's'} to Action Pending so you can track new Enrollment Agreement signatures. Continue?`)) return
    const occurredAt = new Date().toISOString()
    const activities = new Map<string, Activity>()
    activeStudents.forEach((lead) => activities.set(lead.id, { id: crypto.randomUUID(), type: 'note', occurredAt, outcome: 'Enrollment agreement reset — new signature needed for updated terms' }))
    setLeads((current) => current.map((lead) => activities.has(lead.id) ? { ...lead, enrollmentAgreementSigned: false, activities: [...lead.activities, activities.get(lead.id)!] } : lead))
    persist(Promise.all(activeStudents.flatMap((lead) => [saveActivity(lead.id, activities.get(lead.id)!), updateLead(lead.id, { enrollmentAgreementSigned: false })])))
  }
  const scheduleFollowUp = (id: string, note: string, atIso: string) => {
    const lead = leads.find((item) => item.id === id)
    if (!lead) return
    const leadUpdate: Partial<Lead> = { followUpAt: atIso, followUpNote: note.trim() }
    const activity: Activity = { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: `Follow-up scheduled for ${formatDate(new Date(atIso))}: ${note.trim()}` }
    setLeads((current) => current.map((item) => item.id === id ? { ...item, ...leadUpdate, activities: [...item.activities, activity] } : item))
    persist(Promise.all([saveActivity(id, activity), updateLead(id, leadUpdate)]))
  }
  const resolveFollowUp = (lead: Lead) => {
    const leadUpdate: Partial<Lead> = { followUpAt: undefined, followUpNote: undefined }
    const activity: Activity = { id: crypto.randomUUID(), type: 'note', occurredAt: new Date().toISOString(), outcome: 'Follow-up resolved' }
    const previousLead = lead
    queueReversible(
      `followup-${activity.id}`,
      `Follow-up resolved — ${lead.name}`,
      () => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...leadUpdate, activities: [...item.activities, activity] } : item)),
      () => setLeads((current) => current.map((item) => item.id === lead.id ? previousLead : item)),
      () => persist(Promise.all([saveActivity(lead.id, activity), updateLead(lead.id, leadUpdate)])),
    )
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
  const insertCadenceProgress = (leadId: string, activities: Activity[], leadUpdate?: Partial<Lead>) => {
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, ...(leadUpdate ?? {}), activities: [...lead.activities, ...activities] } : lead))
    persist(Promise.all([...activities.map((activity) => saveActivity(leadId, activity)), ...(leadUpdate ? [updateLead(leadId, leadUpdate)] : [])]))
  }
  const logScheduleActivity = (input: ScheduleLogInput) => {
    const activity: ScheduleActivity = { ...input, id: crypto.randomUUID(), occurredAt: new Date().toISOString() }
    setScheduleActivities((current) => [...current, activity])
    persist(saveScheduleActivity(activity, instructors.find((item) => item.name === input.instructor)?.id))
  }
  const replaceInstruments = (next: string[]) => { setOfferedInstruments(next); persist(saveSettings(next)) }
  const saveMessageTemplate = (key: string, value: string) => { setMessageTemplates((current) => { const next = { ...current, [key]: value }; persist(saveMessageTemplates(next)); return next }) }
  const resetMessageTemplate = (key: string) => { setMessageTemplates((current) => { const next = { ...current, [key]: defaultMessageTemplates[key] }; persist(saveMessageTemplates(next)); return next }) }
  const replaceInstructors = (next: Instructor[]) => { const previous = instructors; setInstructors(next); persist(syncInstructors(previous, next)) }
  const replaceAvailability = (next: InstructorAvailability[]) => { const previous = instructorAvailability; setInstructorAvailability(next); persist(syncAvailability(previous, next)) }
  const replaceEntries = (next: ScheduleEntry[]) => { const previous = scheduleEntries; setScheduleEntries(next); persist(syncEntries(previous, next)) }
  const replaceOpenings = (next: TrialOpening[]) => { const previous = trialOpenings; setTrialOpenings(next); persist(syncOpenings(previous, next, instructors)) }
  const deleteScheduleActivity = (id: string) => { setScheduleActivities((current) => current.filter((activity) => activity.id !== id)); persist(removeStoredScheduleActivity(id)) }
  const bookTrialOnSchedule = (lead: Lead, instructorId: string, startsAtIso: string, durationMinutes: 30 | 45 | 60 = 30): boolean => {
    const instructor = instructors.find((item) => item.id === instructorId)
    if (!instructor) { window.alert('Choose an instructor before scheduling the trial.'); return false }
    const result = bookTrialEntry(instructor, scheduleEntries, instructorAvailability, lead, startsAtIso, durationMinutes)
    if (!result.ok) { if (result.message) window.alert(result.message); return false }
    const withEntry = result.isUpdate ? scheduleEntries.map((entry) => entry.id === result.entry.id ? result.entry : entry) : [...scheduleEntries, result.entry]
    replaceEntries(result.autoBreak ? [...withEntry, result.autoBreak] : withEntry)
    replaceOpenings(trialOpenings.filter((opening) => opening.instructor !== instructor.name || new Date(opening.startsAt).getTime() !== new Date(result.entry.startsAt!).getTime()))
    logScheduleActivity({ action: result.isUpdate ? 'Scheduled lesson updated' : 'Scheduled lesson added', instructor: instructor.name, studentName: result.entry.studentName, details: describeScheduleEntry(result.entry) })
    if (result.autoBreak) logScheduleActivity({ action: 'Break auto-scheduled', instructor: instructor.name, details: `${formatClock(entryStartTime(result.autoBreak))}–${formatClock(`${String(Math.floor((timeMinutes(entryStartTime(result.autoBreak)) + 15) / 60)).padStart(2, '0')}:${String((timeMinutes(entryStartTime(result.autoBreak)) + 15) % 60).padStart(2, '0')}`)} · after 3.75 consecutive hours · remove it if you don't need it` })
    return true
  }

  if (loadingData) return <AppLoading message="Loading your lead manager…" />
  if (dataError && !leads.length && !instructors.length) return <main className="app-loading error-loading"><strong>We couldn’t load your data.</strong><span>{dataError}</span><button className="primary" onClick={() => window.location.reload()}>Try again</button></main>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo"><img src={apolloLogoFull} alt="Apollo Lead Manager" /></div>
        <nav>
          <NavButton active={view === 'today'} onClick={() => setView('today')} icon="⌂" label="Today" />
          <NavButton active={view === 'leads'} onClick={() => setView('leads')} icon="◎" label="All leads" />
          <NavButton active={view === 'openings'} onClick={() => setView('openings')} icon="◫" label="Instructor schedule" />
          <NavButton active={view === 'activity'} onClick={() => setView('activity')} icon="≡" label="Activity log" />
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="⚙" label="Settings" />
        </nav>
        <div className="sidebar-foot"><span className="avatar">CS</span><div>Conor<small>{isSupabaseConfigured ? 'Connected' : 'Demo mode'}</small></div>{onSignOut && <button className="sidebar-signout" onClick={onSignOut}>Sign out</button>}</div>
      </aside>

      <main className="content">
        {dataError && <div className="data-warning"><span>{dataError}</span><button onClick={() => setDataError('')}>×</button></div>}
        <header className="topbar">
          <div><p className="eyebrow">{formatDate(new Date(), false)}</p><h1>{view === 'today' ? 'Your follow-up plan' : view === 'leads' ? 'All leads' : view === 'openings' ? 'Instructor schedule' : view === 'activity' ? 'Activity log' : 'Settings'}</h1></div>
          <button className="primary" onClick={() => setShowNewLead(true)}>＋ New lead</button>
        </header>

        {view === 'today' && <Today leads={leads} instructors={instructors} trialOpenings={trialOpenings} messageTemplates={messageTemplates} onSelect={setSelectedId} onLog={logActivity} onTextNow={startText} onTakeNote={setQuickNoteId} onResolveTrialYes={resolveTrialYes} onResolveTrialNo={resolveTrialNo} onResolveSecondTrial={resolveSecondTrial} onCollectSignature={resolveEnrollmentAgreement} onOverrideSignature={overrideEnrollmentAgreement} onResolveFollowUp={resolveFollowUp} onScheduleFollowUp={scheduleFollowUp} />}
        {view === 'leads' && <LeadTable leads={leads} onSelect={setSelectedId} />}
        {view === 'openings' && <InstructorSchedule leads={leads} instructors={instructors} availability={instructorAvailability} entries={scheduleEntries} openings={trialOpenings} onAvailabilityChange={replaceAvailability} onEntriesChange={replaceEntries} onOpeningsChange={replaceOpenings} onScheduleLog={logScheduleActivity} onLeadTrialChange={updateTrial} />}
        {view === 'activity' && <ActivityLog leads={leads} instruments={offeredInstruments} instructors={instructors} scheduleActivities={scheduleActivities} onSelect={setSelectedId} onSaveActivity={saveManualActivity} onDelete={deleteActivity} onDeleteSchedule={deleteScheduleActivity} onInsertCadenceProgress={insertCadenceProgress} onAddLead={addLeadAwaitable} onEditActivity={editActivityFields} onEditScheduleActivity={editScheduleActivityFields} onBookTrial={bookTrialOnSchedule} />}
        {view === 'settings' && <Settings instruments={offeredInstruments} leads={leads} instructors={instructors} availability={instructorAvailability} entries={scheduleEntries} openings={trialOpenings} messageTemplates={messageTemplates} onInstrumentsChange={replaceInstruments} onInstructorsChange={replaceInstructors} onAvailabilityChange={replaceAvailability} onEntriesChange={replaceEntries} onOpeningsChange={replaceOpenings} onScheduleLog={logScheduleActivity} onRequestSignatures={requestSignaturesFromAllStudents} onSaveTemplate={saveMessageTemplate} onResetTemplate={resetMessageTemplate} />}
      </main>

      {selected && <LeadPanel lead={selected} instruments={offeredInstruments} trialOpenings={trialOpenings} messageTemplates={messageTemplates} onClose={() => setSelectedId(null)} onLog={logActivity} onAddNote={addNote} onTextNow={startText} onTrialUpdate={updateTrial} onStatusChange={changeStatus} onDeleteActivity={deleteActivity} onUpdateLead={updateLeadInfo} onDeleteLead={deleteLead} onScheduleFollowUp={scheduleFollowUp} onResolveFollowUp={resolveFollowUp} />}
      {showNewLead && <NewLeadModal instruments={offeredInstruments} onClose={() => setShowNewLead(false)} onSave={addLead} />}
      {quickNoteId && <QuickNoteModal lead={leads.find((lead) => lead.id === quickNoteId)!} onClose={() => setQuickNoteId(null)} onSave={(note) => { addNote(quickNoteId, note); setQuickNoteId(null) }} />}
      {textDraft && <TrialTimePicker draft={textDraft} openings={trialOpenings} onClose={() => setTextDraft(null)} onManage={() => { setTextDraft(null); setView('openings') }} onSend={(message) => { setTextDraft(null); void openMessages(textDraft.lead.phone, message) }} />}
      {pendingUndos.length > 0 && <div className="undo-toast" role="status"><span>{pendingUndos[pendingUndos.length - 1].label}. Saving in 10 seconds.</span><button onClick={() => undoPending(pendingUndos[pendingUndos.length - 1].key)}>Undo</button></div>}
    </div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return <button className={active ? 'nav-active' : ''} onClick={onClick}><span className="nav-icon">{icon}</span><span className="nav-label">{label}</span></button>
}

const DEFAULT_CALL_OUTCOMES = new Set(['Attempted call', 'Attempted call — no answer'])

function lastCallNote(lead: Lead) {
  const call = [...lead.activities].reverse().find((activity) => activity.type === 'call')
  if (!call || DEFAULT_CALL_OUTCOMES.has(call.outcome)) return null
  return call.outcome
}

function CallOutcomeModal({ lead, onClose, onSubmit, onScheduleFollowUp }: { lead: Lead; onClose: () => void; onSubmit: (outcome: string) => void; onScheduleFollowUp: (note: string, atIso: string) => void }) {
  const [answered, setAnswered] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [wantsFollowUp, setWantsFollowUp] = useState(false)
  const [followUpDate, setFollowUpDate] = useState(() => toDateTimeInput(new Date(Date.now() + 86_400_000)))
  const submit = () => {
    onSubmit(note.trim())
    if (wantsFollowUp) onScheduleFollowUp(note.trim(), new Date(followUpDate).toISOString())
  }
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal">
      <button type="button" className="close" onClick={onClose}>×</button>
      <p className="eyebrow">{lead.name}</p>
      <h2>Log call</h2>
      {answered === null ? <>
        <p className="muted">Did they answer?</p>
        <div className="editor-actions"><button type="button" className="prompt-no" onClick={() => onSubmit('Attempted call — no answer')}>✕ No answer</button><button type="button" className="prompt-yes" onClick={() => setAnswered(true)}>✓ Yes, answered</button></div>
      </> : <>
        <label className="field">What did you discuss?<textarea rows={4} autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="Notes from the call — this will show up next time they appear here." /></label>
        <label className="same-name-check"><input type="checkbox" checked={wantsFollowUp} onChange={(event) => setWantsFollowUp(event.target.checked)} /> Also schedule a follow-up outside the normal cadence</label>
        {wantsFollowUp && <label className="field">Follow up on<input required type="datetime-local" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>}
        <div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!note.trim()} onClick={submit}>Save</button></div>
      </>}
    </div>
  </div>
}

function Today({ leads, instructors, trialOpenings, messageTemplates, onSelect, onLog, onTextNow, onTakeNote, onResolveTrialYes, onResolveTrialNo, onResolveSecondTrial, onCollectSignature, onOverrideSignature, onResolveFollowUp, onScheduleFollowUp }: {
  leads: Lead[]
  instructors: Instructor[]
  trialOpenings: TrialOpening[]
  messageTemplates: Record<string, string>
  onSelect: (id: string) => void
  onLog: (id: string, type: ActivityType, outcome?: string) => void
  onTextNow: StartText
  onTakeNote: (id: string) => void
  onResolveTrialYes: (lead: Lead, reason: TrialPromptReason, occurredAt: string) => void
  onResolveTrialNo: (lead: Lead, comment: string) => void
  onResolveSecondTrial: (lead: Lead, instructorId: string, occurredAt: string) => void
  onCollectSignature: (lead: Lead) => void
  onOverrideSignature: (lead: Lead) => void
  onResolveFollowUp: (lead: Lead) => void
  onScheduleFollowUp: (id: string, note: string, atIso: string) => void
}) {
  const [trialPrompt, setTrialPrompt] = useState<TrialPromptState | null>(null)
  const [callOutcomeLead, setCallOutcomeLead] = useState<Lead | null>(null)
  const active = leads.filter((lead) => lead.status === 'hot' && !lead.trialAt)
  const pending: PendingActionItem[] = leads.flatMap<PendingActionItem>((lead) => {
    const items: PendingActionItem[] = []
    if (lead.trialAt && !lead.holdFormComplete && lead.status !== 'unenrolled') {
      items.push({ lead, reason: 'booking_form', action: 'Booking form complete?', template: trialFormReminderFor(lead, messageTemplates) })
    } else if (lead.trialAt && lead.holdFormComplete && !lead.trialAttended && Date.parse(lead.trialAt) <= Date.now() && lead.status !== 'unenrolled') {
      items.push({ lead, reason: 'trial_complete', action: 'Trial complete?' })
    } else if (lead.trialAttended && lead.status !== 'active_student' && lead.status !== 'unenrolled') {
      items.push({ lead, reason: 'became_student', action: 'Converted to student?' })
    } else if (lead.status === 'active_student' && !lead.enrollmentAgreementSigned) {
      items.push({ lead, reason: 'enrollment_agreement', action: 'Enrollment agreement signed?' })
    } else if (lead.status === 'action_pending') {
      items.push({ lead, reason: 'manual', action: 'Manual follow-up needed' })
    }
    if (lead.followUpAt && Date.parse(lead.followUpAt) <= Date.now()) {
      items.push({ lead, reason: 'follow_up', action: lead.followUpNote ? `Follow up: ${lead.followUpNote}` : 'Follow up now' })
    }
    return items
  })
  const nurture = leads.filter((lead) => lead.status === 'nurture' || lead.status === 'nurture_long_term')
  const planned = useMemo(() => [
    ...active.map((lead) => ({ lead, kind: 'active' as const, recommendation: nextContact(lead, defaultAvailability), template: activeFollowUpFor(lead, messageTemplates), progress: activeCadenceState(lead) })),
    ...nurture.map((lead) => {
      const recommendation = nextNurtureContact(lead, defaultAvailability)
      const matchingOpenings = trialOpenings.filter((opening) => shareInstrument(opening.instruments, lead.instruments) && Date.parse(opening.startsAt) > Date.now())
      return { lead, kind: 'nurture' as const, recommendation, template: nurtureMessageFor(lead, recommendation.at, matchingOpenings.length >= 2, messageTemplates), progress: nurtureCadenceState(lead) }
    }),
  ].filter((item) => !item.progress.complete).sort((a, b) => a.recommendation.at.getTime() - b.recommendation.at.getTime() || Date.parse(b.lead.receivedAt) - Date.parse(a.lead.receivedAt)), [leads, trialOpenings, messageTemplates])
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
            <div className="lead-main" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{statusLabels[lead.status]} · {leadInstrumentLabel(lead)} · {lead.source}</span>{lastCallNote(lead) && <small className="last-call-note">📞 {lastCallNote(lead)}</small>}</div>
            <div className="recommendation"><strong>{recommendation.at <= now ? 'Now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason} · {channel}</span><em>{template.label}</em>{template.needsTimes && <small>Two trial times still need to be filled in.</small>}</div>
            <div className="row-actions">{template.callFirst && <button disabled={progress.callLogged} onClick={() => setCallOutcomeLead(lead)}>{progress.callLogged ? '✓ Call logged' : '☎ Log call'}</button>}<button disabled={progress.textLogged} onClick={() => onLog(lead.id, 'text')}>{progress.textLogged ? '✓ Text logged' : '✓ Log text'}</button><button onClick={() => onTakeNote(lead.id)}>✎ Take note</button><button className="text-now" onClick={() => onTextNow(lead, template)}>↗ Text now</button></div>
          </article>
        })}
        {!queue.length && <div className="today-complete"><strong>All caught up for today</strong><span>Your next scheduled contacts are previewed below.</span></div>}
      </div>
    </section>
    <PendingActions leads={pending} onSelect={onSelect} onLog={onLog} onLogCall={setCallOutcomeLead} onTextNow={onTextNow} onTakeNote={onTakeNote} onPromptYes={(lead, reason) => setTrialPrompt({ lead, reason, decision: 'yes' })} onPromptNo={(lead, reason) => setTrialPrompt({ lead, reason, decision: 'no' })} onPromptSecondTrial={(lead, reason) => setTrialPrompt({ lead, reason, decision: 'second_trial' })} onCollectSignature={onCollectSignature} onOverrideSignature={onOverrideSignature} onResolveFollowUp={onResolveFollowUp} />
    <section className="card upcoming-outreach-card">
      <div className="section-head"><div><h2>Upcoming outreach</h2><p>A preview of the next days when you should plan to be available.</p></div></div>
      <div className="upcoming-outreach-list">{upcomingDays.map(({ date, items }) => {
        const earliest = items[0].recommendation.at
        return <article key={date.toDateString()}><div className="outreach-date"><strong>{date.toLocaleDateString('en-US', { weekday: 'short' })}</strong><span>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div><div className="outreach-preview"><strong>{items.length} planned {items.length === 1 ? 'contact' : 'contacts'}</strong><span>{items.slice(0, 4).map((item) => `${item.lead.name} · ${item.template.label}`).join('  •  ')}{items.length > 4 ? `  •  +${items.length - 4} more` : ''}</span></div><b>Be available around {earliest.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b></article>
      })}{!upcomingDays.length && <div className="today-complete"><strong>No upcoming outreach scheduled</strong><span>New leads and future cadence dates will appear here.</span></div>}</div>
    </section>
    {trialPrompt && <TrialPromptModal prompt={trialPrompt} instructors={instructors} onClose={() => setTrialPrompt(null)} onConfirmYes={(occurredAt) => { onResolveTrialYes(trialPrompt.lead, trialPrompt.reason, occurredAt); setTrialPrompt(null) }} onConfirmNo={(comment) => { onResolveTrialNo(trialPrompt.lead, comment); setTrialPrompt(null) }} onConfirmSecondTrial={(instructorId, occurredAt) => { onResolveSecondTrial(trialPrompt.lead, instructorId, occurredAt); setTrialPrompt(null) }} />}
    {callOutcomeLead && <CallOutcomeModal lead={callOutcomeLead} onClose={() => setCallOutcomeLead(null)} onSubmit={(outcome) => { onLog(callOutcomeLead.id, 'call', outcome); setCallOutcomeLead(null) }} onScheduleFollowUp={(note, atIso) => onScheduleFollowUp(callOutcomeLead.id, note, atIso)} />}
  </>
}

const isTrialPromptReason = (reason: PendingActionItem['reason']): reason is TrialPromptReason => reason === 'booking_form' || reason === 'trial_complete' || reason === 'became_student'

function PendingActions({ leads, onSelect, onLog, onLogCall, onTextNow, onTakeNote, onPromptYes, onPromptNo, onPromptSecondTrial, onCollectSignature, onOverrideSignature, onResolveFollowUp }: {
  leads: PendingActionItem[]
  onSelect: (id: string) => void
  onLog: (id: string, type: ActivityType, outcome?: string) => void
  onLogCall: (lead: Lead) => void
  onTextNow: StartText
  onTakeNote: (id: string) => void
  onPromptYes: (lead: Lead, reason: TrialPromptReason) => void
  onPromptNo: (lead: Lead, reason: TrialPromptReason) => void
  onPromptSecondTrial: (lead: Lead, reason: TrialPromptReason) => void
  onCollectSignature: (lead: Lead) => void
  onOverrideSignature: (lead: Lead) => void
  onResolveFollowUp: (lead: Lead) => void
}) {
  return <section className="card pending-card">
    <div className="section-head"><div><h2>Action pending</h2><p>Trial milestones and manual follow-ups that still need your attention.</p></div></div>
    <div className="pending-list">{leads.map(({ lead, reason, action, template }) => {
      return <article key={`${lead.id}-${reason}`} className={`pending-row pending-${reason}`}>
        <button className="pending-person" onClick={() => onSelect(lead.id)}><span><strong>{lead.name}</strong><small>{leadInstrumentLabel(lead)} · {lead.source}</small>{lastCallNote(lead) && <small className="last-call-note">📞 {lastCallNote(lead)}</small>}</span><b>{action}</b><i>Open →</i></button>
        <div className="row-actions">{reason === 'became_student' ? <>
          <button className="prompt-yes" onClick={() => onPromptYes(lead, reason)}>✓ Became student</button>
          <button className="prompt-second-trial" onClick={() => onPromptSecondTrial(lead, reason)}>↻ Second trial</button>
          <button className="prompt-no" onClick={() => onPromptNo(lead, reason)}>✕ Didn't become student</button>
        </> : isTrialPromptReason(reason) ? <>
          <button className="prompt-yes" onClick={() => onPromptYes(lead, reason)}>✓ Yes</button>
          <button className="prompt-no" onClick={() => onPromptNo(lead, reason)}>✕ No</button>
          {reason === 'booking_form' && <button className="text-now" onClick={() => onTextNow(lead, template)}>↗ Text reminder</button>}
        </> : reason === 'enrollment_agreement' ? <>
          <button className="prompt-yes" onClick={() => onCollectSignature(lead)}>✓ Collected signature</button>
          <button className="prompt-no" onClick={() => window.confirm(`Remove ${lead.name} from this list without collecting a signature?`) && onOverrideSignature(lead)}>✕ Not required</button>
        </> : reason === 'follow_up' ? <>
          <button className="prompt-yes" onClick={() => onResolveFollowUp(lead)}>✓ Done</button>
          <button onClick={() => onLogCall(lead)}>☎ Log call</button>
          <button onClick={() => onTakeNote(lead.id)}>✎ Take note</button>
        </> : <>
          <button onClick={() => onLogCall(lead)}>☎ Log call</button>
          <button onClick={() => onLog(lead.id, 'text')}>✓ Log text</button>
          <button onClick={() => onTakeNote(lead.id)}>✎ Take note</button>
        </>}</div>
      </article>
    })}{!leads.length && <div className="today-complete"><strong>No actions pending</strong><span>Scheduled trial reminders and manual follow-ups will appear here.</span></div>}</div>
  </section>
}

function TrialPromptModal({ prompt, instructors, onClose, onConfirmYes, onConfirmNo, onConfirmSecondTrial }: {
  prompt: TrialPromptState
  instructors: Instructor[]
  onClose: () => void
  onConfirmYes: (occurredAt: string) => void
  onConfirmNo: (comment: string) => void
  onConfirmSecondTrial: (instructorId: string, occurredAt: string) => void
}) {
  const eligibleInstructors = instructors.filter((item) => shareInstrument(item.instruments, prompt.lead.instruments))
  const [when, setWhen] = useState(() => toDateTimeInput(new Date()))
  const [comment, setComment] = useState('')
  const [instructorId, setInstructorId] = useState(eligibleInstructors[0]?.id ?? '')
  const label = prompt.reason === 'booking_form' ? 'Booking form complete' : prompt.reason === 'trial_complete' ? 'Trial complete' : prompt.decision === 'second_trial' ? 'Schedule second trial' : 'Converted to student'
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal trial-prompt-modal" onSubmit={(event) => { event.preventDefault(); prompt.decision === 'yes' ? onConfirmYes(new Date(when).toISOString()) : prompt.decision === 'second_trial' ? onConfirmSecondTrial(instructorId, new Date(when).toISOString()) : onConfirmNo(comment.trim()) }}>
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">{prompt.lead.name}</p>
    <h2>{label}{prompt.decision === 'no' ? '?' : ''}</h2>
    {prompt.decision === 'yes'
      ? <label className="field">When did this happen?<input required type="datetime-local" value={when} max={toDateTimeInput(new Date())} onChange={(event) => setWhen(event.target.value)} /></label>
      : prompt.decision === 'second_trial'
      ? <>
        <label className="field">Instructor<select required value={instructorId} onChange={(event) => setInstructorId(event.target.value)}><option value="">Choose an instructor</option>{eligibleInstructors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        {!eligibleInstructors.length && <p className="picker-warning"><strong>No instructor teaches {leadInstrumentLabel(prompt.lead)}.</strong><span>Add one in Settings before scheduling this trial.</span></p>}
        <label className="field">New trial date and time<input required type="datetime-local" value={when} min={toDateTimeInput(new Date())} onChange={(event) => setWhen(event.target.value)} /></label>
      </>
      : <label className="field">What happened?<textarea required rows={4} autoFocus value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a note…" /></label>}
    <div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={(prompt.decision === 'no' && !comment.trim()) || (prompt.decision === 'second_trial' && !instructorId)}>{prompt.decision === 'no' ? 'Save note' : 'Save'}</button></div>
  </form></div>
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
    <div className="table-wrap"><table><thead><tr>{sortHeader('name', 'Lead')}{sortHeader('receivedAt', 'Received')}{sortHeader('source', 'Source')}{sortHeader('touches', 'Touches')}{sortHeader('status', 'Status')}</tr></thead><tbody>{sortedLeads.map((lead) => <tr key={lead.id} onClick={() => onSelect(lead.id)}><td><strong>{lead.name}</strong><small>{leadInstrumentLabel(lead)}</small></td><td>{formatDate(lead.receivedAt)}</td><td>{lead.source}<small>{lead.campaign}</small></td><td>{touchCount(lead)}</td><td><span className={`status ${lead.status}`}>{statusLabels[lead.status]}</span></td></tr>)}</tbody></table></div>
  </section>
}


function ActivityLog({ leads, instruments, instructors, scheduleActivities, onSelect, onSaveActivity, onDelete, onDeleteSchedule, onInsertCadenceProgress, onAddLead, onEditActivity, onEditScheduleActivity, onBookTrial }: {
  leads: Lead[]
  instruments: string[]
  instructors: Instructor[]
  scheduleActivities: ScheduleActivity[]
  onSelect: (id: string) => void
  onSaveActivity: (input: ManualActivityInput) => void
  onDelete: (leadId: string, activityId: string) => void
  onDeleteSchedule: (id: string) => void
  onInsertCadenceProgress: (leadId: string, activities: Activity[], leadUpdate?: Partial<Lead>) => void
  onAddLead: (lead: Lead) => Promise<void>
  onEditActivity: (leadId: string, activityId: string, occurredAt: string, outcome: string) => void
  onEditScheduleActivity: (id: string, occurredAt: string, details: string) => void
  onBookTrial: (lead: Lead, instructorId: string, startsAtIso: string, durationMinutes?: 30 | 45 | 60) => boolean
}) {
  const [range, setRange] = useState<'month' | 'year'>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [nameFilter, setNameFilter] = useState('')
  const [activityEditor, setActivityEditor] = useState<ManualActivityInput | null>(null)
  const [simpleEditor, setSimpleEditor] = useState<{ leadId: string; activityId: string; typeLabel: string; occurredAt: string; outcome: string } | null>(null)
  const [scheduleEditor, setScheduleEditor] = useState<{ id: string; occurredAt: string; details: string } | null>(null)
  const [cadenceInsertOpen, setCadenceInsertOpen] = useState(false)
  const [pendingDeletions, setPendingDeletions] = useState<{ key: string; label: string; timerId: number }[]>([])
  const allEntries = [
    ...leads.flatMap((lead) => lead.activities.map((activity) => ({ kind: 'lead' as const, lead, activity, occurredAt: activity.occurredAt }))),
    ...scheduleActivities.map((activity) => ({ kind: 'schedule' as const, activity, occurredAt: activity.occurredAt })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const pendingKeys = new Set(pendingDeletions.map((item) => item.key))
  const normalizedNameFilter = nameFilter.trim().toLowerCase()
  const entries = allEntries.filter((entry) => {
    const key = `${entry.kind}-${entry.activity.id}`
    if (pendingKeys.has(key)) return false
    const date = new Date(entry.occurredAt)
    if (date.getFullYear() !== anchor.getFullYear() || (range === 'month' && date.getMonth() !== anchor.getMonth())) return false
    if (!normalizedNameFilter) return true
    const nameHaystack = entry.kind === 'lead' ? `${entry.lead.name} ${entry.lead.studentName ?? ''}` : `${entry.activity.studentName ?? ''} ${entry.activity.instructor}`
    return nameHaystack.toLowerCase().includes(normalizedNameFilter)
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
    <div className="section-head activity-head"><div><h2>Activity history</h2><p>Lead communication and instructor schedule changes, newest first.</p></div><div className="activity-controls"><button className="primary add-event-button" disabled={!leads.length} onClick={() => setActivityEditor({ leadId: leads[0]?.id ?? '', type: 'call', occurredAt: new Date().toISOString(), outcome: 'Attempted call' })}>＋ Add event</button><button className="insert-cadence-button" disabled={!leads.length} onClick={() => setCadenceInsertOpen(true)}>⇥ Insert into follow-up cycle</button><input className="search activity-name-filter" value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="Filter by name…" /><div className="range-toggle"><button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>Month</button><button className={range === 'year' ? 'active' : ''} onClick={() => setRange('year')}>Year</button></div><div className="period-switch"><button onClick={() => shiftPeriod(-1)}>←</button><strong>{periodLabel}</strong><button onClick={() => shiftPeriod(1)}>→</button></div><button className="export-button" disabled={!entries.length} onClick={exportCsv}>⇩ Export CSV</button><span className="count-pill">{entries.length} actions</span></div></div>
    <div className="activity-list">
      {entries.map((entry) => entry.kind === 'lead' ? <article className="activity-row" key={`lead-${entry.activity.id}`}>
        <div className={`activity-icon ${entry.activity.type}`}>{entry.activity.type === 'call' ? '☎' : entry.activity.type === 'text' ? '↗' : entry.activity.type === 'email' ? '✉' : entry.activity.type === 'note' ? '✎' : entry.activity.type === 'status_change' ? '↻' : entry.activity.type === 'trial_update' ? '◇' : entry.activity.type === 'lead_created' ? '＋' : entry.activity.type === 'lead_update' ? '✎' : '•'}</div>
        <button className="activity-person" onClick={() => onSelect(entry.lead.id)}><strong>{entry.lead.name}</strong><span>{leadInstrumentLabel(entry.lead)} · {entry.lead.phone}</span></button>
        <div className="activity-detail"><strong>{entry.activity.type === 'call' ? 'Call logged' : entry.activity.type === 'text' ? 'Text logged' : entry.activity.type === 'email' ? 'Email logged' : entry.activity.type === 'note' ? 'Note added' : entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.type === 'trial_update' ? 'Trial updated' : entry.activity.type === 'lead_created' ? 'New lead received' : entry.activity.type === 'lead_update' ? 'Lead information updated' : entry.activity.outcome}</strong><span>{entry.activity.outcome}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        <div className="activity-row-actions"><button className="edit-action" onClick={() => (entry.activity.type === 'call' || entry.activity.type === 'text' || entry.activity.type === 'note' || entry.activity.type === 'email')
          ? setActivityEditor({ leadId: entry.lead.id, activityId: entry.activity.id, type: entry.activity.type as ManualActivityType, occurredAt: entry.activity.occurredAt, outcome: entry.activity.outcome })
          : setSimpleEditor({ leadId: entry.lead.id, activityId: entry.activity.id, typeLabel: entry.activity.type === 'status_change' ? 'Status updated' : entry.activity.type === 'trial_update' ? 'Trial updated' : entry.activity.type === 'lead_created' ? 'New lead received' : 'Lead information updated', occurredAt: entry.activity.occurredAt, outcome: entry.activity.outcome })}>Edit</button><button className="delete-action" onClick={() => remove(entry.lead.id, entry.activity.id)} aria-label={`Delete ${entry.activity.type} for ${entry.lead.name}`}>Delete</button></div>
      </article> : <article className="activity-row" key={`schedule-${entry.activity.id}`}>
        <div className="activity-icon schedule">◫</div>
        <div className="activity-person static"><strong>{entry.activity.studentName ?? entry.activity.instructor}</strong><span>{entry.activity.studentName ? `${entry.activity.instructor} · Instructor schedule` : 'Instructor schedule'}</span></div>
        <div className="activity-detail"><strong>{entry.activity.action}</strong><span>{entry.activity.details}</span></div>
        <time>{formatDate(entry.activity.occurredAt)}</time>
        <div className="activity-row-actions"><button className="edit-action" onClick={() => setScheduleEditor({ id: entry.activity.id, occurredAt: entry.activity.occurredAt, details: entry.activity.details })}>Edit</button><button className="delete-action" onClick={() => removeSchedule(entry.activity.id)}>Delete</button></div>
      </article>)}
      {!entries.length && <div className="empty-state"><strong>No activity in {periodLabel}</strong><span>Use the arrows or switch to the yearly view.</span></div>}
    </div>
  </section>{latestDeletion && <div className="undo-toast" role="status"><span>{latestDeletion.label}. Permanently deleting in 10 seconds.</span><button onClick={() => undoDeletion(latestDeletion.key)}>Undo</button></div>}{activityEditor && <ActivityEditorModal leads={leads} instructors={instructors} initial={activityEditor} onClose={() => setActivityEditor(null)} onSave={(input) => { onSaveActivity(input); setAnchor(new Date(input.occurredAt)); setActivityEditor(null) }} onBookTrial={onBookTrial} />}{cadenceInsertOpen && <CadenceInsertModal leads={leads} instruments={instruments} instructors={instructors} onClose={() => setCadenceInsertOpen(false)} onSave={(leadId, activities, leadUpdate) => { onInsertCadenceProgress(leadId, activities, leadUpdate); setCadenceInsertOpen(false) }} onAddLead={onAddLead} onBookTrial={onBookTrial} />}{simpleEditor && <SimpleActivityEditModal editor={simpleEditor} onClose={() => setSimpleEditor(null)} onSave={(occurredAt, outcome) => { onEditActivity(simpleEditor.leadId, simpleEditor.activityId, occurredAt, outcome); setAnchor(new Date(occurredAt)); setSimpleEditor(null) }} />}{scheduleEditor && <ScheduleActivityEditModal editor={scheduleEditor} onClose={() => setScheduleEditor(null)} onSave={(occurredAt, details) => { onEditScheduleActivity(scheduleEditor.id, occurredAt, details); setAnchor(new Date(occurredAt)); setScheduleEditor(null) }} />}</>
}

function ActivityEditorModal({ leads, instructors, initial, onClose, onSave, onBookTrial }: {
  leads: Lead[]
  instructors: Instructor[]
  initial: ManualActivityInput
  onClose: () => void
  onSave: (input: ManualActivityInput) => void
  onBookTrial: (lead: Lead, instructorId: string, startsAtIso: string, durationMinutes?: 30 | 45 | 60) => boolean
}) {
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
  const lead = leads.find((item) => item.id === leadId)
  const eligibleInstructors = lead ? instructors.filter((item) => shareInstrument(item.instruments, lead.instruments)) : []
  const [instructorId, setInstructorId] = useState(eligibleInstructors[0]?.id ?? '')
  const changeType = (next: ManualEventType) => {
    if (outcome === defaults[type]) setOutcome(defaults[next])
    setType(next)
  }
  const trialDateRequired = type === 'trial_booked'
  const isNewTrialBooking = trialDateRequired && !initial.activityId
  const save = () => {
    if (!leadId || !occurredAt || !outcome.trim() || (trialDateRequired && !trialAt)) return
    if (isNewTrialBooking) {
      if (!lead || !instructorId) return
      if (!onBookTrial(lead, instructorId, new Date(trialAt).toISOString())) return
    }
    onSave({ leadId, activityId: initial.activityId, type, occurredAt: new Date(occurredAt).toISOString(), outcome: outcome.trim(), trialAt: trialDateRequired ? new Date(trialAt).toISOString() : undefined })
  }
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal activity-editor" onSubmit={(event) => { event.preventDefault(); save() }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">{initial.activityId ? 'Edit activity' : 'Add activity'}</p><h2>{initial.activityId ? 'Correct this event' : 'Log a past event'}</h2>{initial.activityId ? <label className="field">Lead<input value={`${lead?.studentName ?? lead?.name ?? ''}${lead?.studentName && lead.studentName !== lead.name ? ` (lead: ${lead.name})` : ''}`} disabled readOnly /></label> : <LeadSearchPicker leads={leads} selectedLeadId={leadId} onSelect={(item) => setLeadId(item.id)} onClear={() => setLeadId('')} />}<div className="field-pair"><label className="field">Event type<select value={type} onChange={(event) => changeType(event.target.value as ManualEventType)}><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="note">Note</option><option value="trial_booked">Trial lesson booked</option><option value="trial_form_completed">Trial confirmation form completed</option><option value="trial_completed">Trial lesson completed</option><option value="became_student">Became an active student</option><option value="unenrolled">Student unenrolled</option></select></label><label className="field">Event date and time<input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label></div>{trialDateRequired && <label className="field event-highlight">Trial lesson date and time<input required type="datetime-local" value={trialAt} onChange={(event) => setTrialAt(event.target.value)} /><small>This is the lesson time—not when it was booked.</small></label>}{isNewTrialBooking && <label className="field event-highlight">Instructor<select required value={instructorId} onChange={(event) => setInstructorId(event.target.value)}><option value="">Choose an instructor</option>{eligibleInstructors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>This creates a real trial on that instructor's schedule.</small></label>}<label className="field">Details<textarea required rows={4} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What happened?" /></label><div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!leadId || !occurredAt || !outcome.trim() || (trialDateRequired && !trialAt) || (isNewTrialBooking && !instructorId)}>{initial.activityId ? 'Save changes' : 'Add event'}</button></div></form></div>
}

function SimpleActivityEditModal({ editor, onClose, onSave }: { editor: { typeLabel: string; occurredAt: string; outcome: string }; onClose: () => void; onSave: (occurredAt: string, outcome: string) => void }) {
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeInput(new Date(editor.occurredAt)))
  const [outcome, setOutcome] = useState(editor.outcome)
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={(event) => { event.preventDefault(); if (occurredAt && outcome.trim()) onSave(new Date(occurredAt).toISOString(), outcome.trim()) }}>
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">{editor.typeLabel}</p>
    <h2>Correct this event</h2>
    <label className="field">Event date and time<input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
    <label className="field">Details<textarea required rows={4} value={outcome} onChange={(event) => setOutcome(event.target.value)} /></label>
    <div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!occurredAt || !outcome.trim()}>Save changes</button></div>
  </form></div>
}

function ScheduleActivityEditModal({ editor, onClose, onSave }: { editor: { occurredAt: string; details: string }; onClose: () => void; onSave: (occurredAt: string, details: string) => void }) {
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeInput(new Date(editor.occurredAt)))
  const [details, setDetails] = useState(editor.details)
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={(event) => { event.preventDefault(); if (occurredAt && details.trim()) onSave(new Date(occurredAt).toISOString(), details.trim()) }}>
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">Instructor schedule</p>
    <h2>Correct this event</h2>
    <label className="field">Event date and time<input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
    <label className="field">Details<textarea required rows={4} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
    <div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!occurredAt || !details.trim()}>Save changes</button></div>
  </form></div>
}

const ACTIVE_CADENCE_STEPS = [
  { label: 'Step 1 · Initial contact', detail: 'Day 0 — call and text', needsCall: true },
  { label: 'Step 2 · First follow-up', detail: 'Day 2 — call and text', needsCall: true },
  { label: 'Step 3 · Second follow-up', detail: 'Day 5 — call and text', needsCall: true },
  { label: 'Step 4 · Final follow-up', detail: 'Day 8 — call and text', needsCall: true },
]
type CadenceStepState = { date: string; callDone: boolean; textDone: boolean }
const emptyCadenceSteps = (): CadenceStepState[] => ACTIVE_CADENCE_STEPS.map(() => ({ date: '', callDone: true, textDone: true }))
const isCadenceStepComplete = (step: CadenceStepState, needsCall: boolean) => Boolean(step.date) && (needsCall ? step.callDone && step.textDone : step.textDone)
function realActiveSteps(lead: Lead): CadenceStepState[] {
  const steps = emptyCadenceSteps()
  const events = lead.activities
    .filter((activity) => activity.type === 'call' || activity.type === 'text')
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  let stage = 0
  let callLogged = false
  let textLogged = false
  for (const activity of events) {
    if (stage >= steps.length) break
    if (activity.type === 'call') callLogged = true
    if (activity.type === 'text') textLogged = true
    const needsCall = ACTIVE_CADENCE_STEPS[stage].needsCall
    if (textLogged && (!needsCall || callLogged)) {
      steps[stage] = { date: localDateKey(new Date(activity.occurredAt)), callDone: true, textDone: true }
      stage += 1; callLogged = false; textLogged = false
    }
  }
  return steps
}

function CadenceInsertModal({ leads, instruments, instructors, onClose, onSave, onAddLead, onBookTrial }: {
  leads: Lead[]
  instruments: string[]
  instructors: Instructor[]
  onClose: () => void
  onSave: (leadId: string, activities: Activity[], leadUpdate?: Partial<Lead>) => void
  onAddLead: (lead: Lead) => Promise<void>
  onBookTrial: (lead: Lead, instructorId: string, startsAtIso: string, durationMinutes?: 30 | 45 | 60) => boolean
}) {
  const [personMode, setPersonMode] = useState<'existing' | 'new'>('existing')
  const [leadId, setLeadId] = useState('')
  const lead = leads.find((item) => item.id === leadId)
  const [newName, setNewName] = useState('')
  const [newStudentName, setNewStudentName] = useState('')
  const [newSameAsLead, setNewSameAsLead] = useState(false)
  const [newInstruments, setNewInstruments] = useState<string[]>(instruments[0] ? [instruments[0]] : [])
  const [newPhone, setNewPhone] = useState('')
  const [newReceivedAt, setNewReceivedAt] = useState(() => toDateTimeInput(new Date()))
  const effectiveInstruments = personMode === 'new' ? newInstruments : lead?.instruments ?? []
  const eligibleInstructors = effectiveInstruments.length ? instructors.filter((item) => shareInstrument(item.instruments, effectiveInstruments)) : []

  const [steps, setSteps] = useState<CadenceStepState[]>(emptyCadenceSteps())
  const [nurtureDate, setNurtureDate] = useState('')
  const [nurtureCallDone, setNurtureCallDone] = useState(true)
  const [nurtureTextDone, setNurtureTextDone] = useState(true)

  const [trialBookedAt, setTrialBookedAtRaw] = useState('')
  const [trialInstructorId, setTrialInstructorId] = useState('')
  const [trialFormDate, setTrialFormDateRaw] = useState('')
  const [trialCompletedDate, setTrialCompletedDateRaw] = useState('')
  const [becameStudentDate, setBecameStudentDate] = useState('')
  const setTrialBookedAt = (value: string) => { setTrialBookedAtRaw(value); if (!value) { setTrialFormDateRaw(''); setTrialCompletedDateRaw(''); setBecameStudentDate('') } }
  const setTrialFormDate = (value: string) => { setTrialFormDateRaw(value); if (!value) { setTrialCompletedDateRaw(''); setBecameStudentDate('') } }
  const setTrialCompletedDate = (value: string) => { setTrialCompletedDateRaw(value); if (!value) setBecameStudentDate('') }

  const resetProgressFields = () => {
    setSteps(emptyCadenceSteps()); setNurtureDate(''); setNurtureCallDone(true); setNurtureTextDone(true)
    setTrialBookedAtRaw(''); setTrialInstructorId(''); setTrialFormDateRaw(''); setTrialCompletedDateRaw(''); setBecameStudentDate('')
  }

  const [outreachTrack, setOutreachTrack] = useState<'active' | 'nurture' | 'none'>('active')
  const trackFor = (status: LeadStatus) => status === 'nurture' || status === 'nurture_long_term' ? 'nurture' as const : status === 'hot' || status === 'action_pending' ? 'active' as const : 'none' as const
  const track = outreachTrack

  const selectLead = (item: Lead) => {
    setLeadId(item.id)
    resetProgressFields()
    setSteps(realActiveSteps(item))
    setOutreachTrack(trackFor(item.status))
  }
  const nurtureAnchor: Pick<Lead, 'receivedAt' | 'activities'> = lead ?? { receivedAt: newReceivedAt ? new Date(newReceivedAt).toISOString() : new Date().toISOString(), activities: [] }

  const realActiveProgress = lead ? activeCadenceState(lead) : null
  const realActiveStage = realActiveProgress?.stage ?? 0
  const realNurtureProgress = lead ? nurtureCadenceState(lead) : null
  const realNurtureStage = realNurtureProgress?.stage ?? 0
  const trialAlreadyBooked = Boolean(lead?.trialAt)
  const formAlreadyComplete = Boolean(lead?.holdFormComplete)
  const trialAlreadyAttended = Boolean(lead?.trialAttended)
  const alreadyStudent = lead?.status === 'active_student'

  const setStepDate = (index: number, value: string) => setSteps((current) => {
    const next = current.map((step) => ({ ...step }))
    next[index].date = value
    if (!value) next[index].callDone = next[index].textDone = true
    if (!value) for (let i = index + 1; i < next.length; i += 1) next[i] = { date: '', callDone: true, textDone: true }
    return next
  })
  const toggleStepFlag = (index: number, key: 'callDone' | 'textDone', checked: boolean) => setSteps((current) => {
    const next = current.map((step) => ({ ...step }))
    next[index][key] = checked
    if (!isCadenceStepComplete(next[index], ACTIVE_CADENCE_STEPS[index].needsCall)) for (let i = index + 1; i < next.length; i += 1) next[i] = { date: '', callDone: true, textDone: true }
    return next
  })
  let unlockedIndex = realActiveStage
  for (let i = realActiveStage; i < steps.length; i += 1) { if (isCadenceStepComplete(steps[i], ACTIVE_CADENCE_STEPS[i].needsCall)) unlockedIndex = i + 1; else break }
  const anyStepFilled = steps.some((step, index) => index >= realActiveStage && step.date)
  const anyTrialFilled = Boolean(trialBookedAt || trialFormDate || trialCompletedDate || becameStudentDate)
  const canFillForm = Boolean(trialBookedAt) || trialAlreadyBooked
  const canFillCompleted = Boolean(trialFormDate) || formAlreadyComplete
  const canFillBecameStudent = Boolean(trialCompletedDate) || trialAlreadyAttended

  const save = async () => {
    let targetLeadId = leadId
    let createdLead: Lead | null = null
    if (personMode === 'new') {
      if (!newName.trim() || !newInstruments.length) return
      createdLead = {
        id: crypto.randomUUID(), name: newName.trim(), studentName: (newSameAsLead ? newName : newStudentName).trim() || undefined, phone: newPhone.trim(), email: '', instruments: newInstruments,
        receivedAt: new Date(newReceivedAt).toISOString(), source: 'Manual entry', campaign: 'Manual entry', status: 'hot',
        activities: [], holdFormComplete: false, trialAttended: false,
      }
      targetLeadId = createdLead.id
      await onAddLead(createdLead)
    } else if (!lead) return

    const activities: Activity[] = []
    const leadUpdate: Partial<Lead> = {}

    if (track === 'active' && anyStepFilled) {
      steps.forEach((step, index) => {
        if (index < realActiveStage) return
        if (index > unlockedIndex || !step.date) return
        const needsCall = ACTIVE_CADENCE_STEPS[index].needsCall
        const date = new Date(`${step.date}T12:00:00`)
        if (needsCall) activities.push(step.callDone
          ? { id: crypto.randomUUID(), type: 'call', occurredAt: new Date(date.getTime() - 60_000).toISOString(), outcome: 'Attempted call (backfilled)' }
          : { id: crypto.randomUUID(), type: 'note', occurredAt: new Date(date.getTime() - 60_000).toISOString(), outcome: 'Call attempted — not completed (backfilled)' })
        activities.push(step.textDone
          ? { id: crypto.randomUUID(), type: 'text', occurredAt: date.toISOString(), outcome: 'Message sent (backfilled)' }
          : { id: crypto.randomUUID(), type: 'note', occurredAt: date.toISOString(), outcome: 'Text attempted — not completed (backfilled)' })
      })
    }
    if (track === 'nurture' && nurtureDate) {
      const date = new Date(`${nurtureDate}T12:00:00`)
      if (nurtureRequiresCall(createdLead ?? lead ?? nurtureAnchor, date)) activities.push(nurtureCallDone
        ? { id: crypto.randomUUID(), type: 'call', occurredAt: new Date(date.getTime() - 60_000).toISOString(), outcome: 'Attempted call (backfilled)' }
        : { id: crypto.randomUUID(), type: 'note', occurredAt: new Date(date.getTime() - 60_000).toISOString(), outcome: 'Call attempted — not completed (backfilled)' })
      activities.push(nurtureTextDone
        ? { id: crypto.randomUUID(), type: 'text', occurredAt: date.toISOString(), outcome: 'Message sent (backfilled)' }
        : { id: crypto.randomUUID(), type: 'note', occurredAt: date.toISOString(), outcome: 'Text attempted — not completed (backfilled)' })
    }
    if (trialBookedAt) {
      const bookingLead = createdLead ?? lead
      if (!bookingLead || !trialInstructorId) return
      const iso = new Date(trialBookedAt).toISOString()
      if (!onBookTrial(bookingLead, trialInstructorId, iso)) return
      activities.push({ id: crypto.randomUUID(), type: 'trial_update', occurredAt: iso, outcome: `Trial lesson booked for ${formatTrialTime(iso)} (backfilled)` })
      leadUpdate.trialAt = iso
    }
    if (trialFormDate) { activities.push({ id: crypto.randomUUID(), type: 'trial_update', occurredAt: new Date(trialFormDate).toISOString(), outcome: 'Trial confirmation form completed (backfilled)' }); leadUpdate.holdFormComplete = true }
    if (trialCompletedDate) { activities.push({ id: crypto.randomUUID(), type: 'trial_update', occurredAt: new Date(trialCompletedDate).toISOString(), outcome: 'Trial lesson completed (backfilled)' }); leadUpdate.trialAttended = true }
    if (becameStudentDate) {
      const iso = new Date(becameStudentDate).toISOString()
      activities.push({ id: crypto.randomUUID(), type: 'status_change', occurredAt: iso, outcome: 'Became an active student (backfilled)' })
      leadUpdate.status = 'active_student'; leadUpdate.enrolledAt = iso
    }

    if (!activities.length) return
    onSave(targetLeadId, activities, Object.keys(leadUpdate).length ? leadUpdate : undefined)
  }

  const personValid = personMode === 'existing' ? Boolean(lead) : Boolean(newName.trim() && newInstruments.length)
  const outreachFilled = track === 'active' ? anyStepFilled : track === 'nurture' ? Boolean(nurtureDate) : false
  const canSave = personValid && (outreachFilled || anyTrialFilled) && (!trialBookedAt || Boolean(trialInstructorId))

  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal cadence-insert-modal">
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">Insert into follow-up cycle</p>
    <h2>Backfill outreach &amp; trial history</h2>
    <p className="muted">For someone who was already partway through their follow-up cadence — or already trialed — before it was tracked here. This creates the history needed so future reminders land on the right day.</p>
    <div className="cadence-person-toggle">
      <button type="button" className={personMode === 'existing' ? 'active' : ''} onClick={() => { setPersonMode('existing'); resetProgressFields(); setOutreachTrack('active') }}>Existing lead</button>
      <button type="button" className={personMode === 'new' ? 'active' : ''} onClick={() => { setPersonMode('new'); resetProgressFields(); setOutreachTrack('active') }}>New person</button>
    </div>
    {personMode === 'existing'
      ? <LeadSearchPicker leads={leads} selectedLeadId={leadId} onClear={() => setLeadId('')} onSelect={selectLead} />
      : <div className="cadence-new-person">
        <label className="field">Lead name<input required value={newName} onChange={(event) => { setNewName(event.target.value); if (newSameAsLead) setNewStudentName(event.target.value) }} placeholder="Full name" /></label>
        <label className="field">Student name <small>Optional</small><input value={newSameAsLead ? newName : newStudentName} disabled={newSameAsLead} onChange={(event) => setNewStudentName(event.target.value)} /></label>
        <label className="same-name-check"><input type="checkbox" checked={newSameAsLead} onChange={(event) => { setNewSameAsLead(event.target.checked); if (event.target.checked) setNewStudentName(newName) }} /> Student name is the same as lead name</label>
        <label className="field">Instrument(s)<div className="instrument-checks">{instruments.map((item) => <label key={item}><input type="checkbox" checked={newInstruments.includes(item)} onChange={(event) => setNewInstruments((current) => event.target.checked ? [...current, item] : current.filter((entry) => entry !== item))} /> {item}</label>)}</div></label>
        <label className="field">Phone <small>Optional</small><input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} /></label>
        <label className="field">Inquiry received<input required type="datetime-local" value={newReceivedAt} max={toDateTimeInput(new Date())} onChange={(event) => setNewReceivedAt(event.target.value)} /></label>
      </div>}

    {personValid && <div className="cadence-track-toggle">
      <button type="button" className={outreachTrack === 'active' ? 'active' : ''} onClick={() => setOutreachTrack('active')}>Active outreach</button>
      <button type="button" className={outreachTrack === 'nurture' ? 'active' : ''} onClick={() => setOutreachTrack('nurture')}>Nurture check-ins</button>
      <button type="button" className={outreachTrack === 'none' ? 'active' : ''} onClick={() => setOutreachTrack('none')}>Doesn't apply</button>
    </div>}
    {lead && track !== 'none' && trackFor(lead.status) !== track && <p className="picker-warning"><span>{lead.name}'s current status is {statusLabels[lead.status]}. You're backfilling {track === 'active' ? 'active outreach' : 'nurture'} history anyway — that's fine if this is catching up their real history.</span></p>}

    {track === 'active' && <div className="cadence-steps">
      {realActiveStage > 0 && <p className="muted">Already at Step {Math.min(realActiveStage + 1, ACTIVE_CADENCE_STEPS.length)} for real{realActiveProgress?.lastCompletedAt ? ` — last completed ${formatDate(new Date(realActiveProgress.lastCompletedAt))}` : ''}. The steps below are auto-filled from real history and don't need to be backfilled.</p>}
      {ACTIVE_CADENCE_STEPS.map((step, index) => {
        const alreadyReal = index < realActiveStage
        const disabled = alreadyReal || index > unlockedIndex
        const current = steps[index]
        return <div className={`cadence-step${disabled ? ' step-disabled' : ''}${alreadyReal ? ' step-already-done' : ''}`} key={step.label}>
          <div className="cadence-step-row"><div><strong>{step.label}</strong><small>{step.detail}{alreadyReal ? ' · Already logged ✓' : disabled ? ' · Fill the previous step first' : ''}</small></div><input type="date" disabled={disabled} value={current.date} max={localDateKey(new Date())} onChange={(event) => setStepDate(index, event.target.value)} /></div>
          {current.date && <div className="cadence-step-flags">
            {step.needsCall && <label><input type="checkbox" disabled={disabled} checked={current.callDone} onChange={(event) => toggleStepFlag(index, 'callDone', event.target.checked)} /> Call completed</label>}
            <label><input type="checkbox" disabled={disabled} checked={current.textDone} onChange={(event) => toggleStepFlag(index, 'textDone', event.target.checked)} /> Text completed</label>
          </div>}
        </div>
      })}
    </div>}

    {track === 'nurture' && <>
      {lead && realNurtureStage > 0 && <p className="muted">Already at nurture round {realNurtureStage} for real{realNurtureProgress?.lastCompletedAt ? ` — last contact ${formatDate(new Date(realNurtureProgress.lastCompletedAt))}` : ''}.</p>}
      <p className="muted">Nurture check-ins repeat every two weeks indefinitely, so only the most recent one matters for scheduling the next.</p>
      <label className="field">Most recent check-in date<input type="date" value={nurtureDate} min={localDateKey(new Date(Math.max(nurtureStartedAt(nurtureAnchor).getTime(), realNurtureProgress?.lastCompletedAt ?? 0)))} max={localDateKey(new Date())} onChange={(event) => setNurtureDate(event.target.value)} /></label>
      {nurtureDate && <div className="cadence-step-flags">
        {nurtureRequiresCall(nurtureAnchor, new Date(`${nurtureDate}T12:00:00`)) && <label><input type="checkbox" checked={nurtureCallDone} onChange={(event) => setNurtureCallDone(event.target.checked)} /> Call completed</label>}
        <label><input type="checkbox" checked={nurtureTextDone} onChange={(event) => setNurtureTextDone(event.target.checked)} /> Text completed</label>
      </div>}
    </>}

    {personValid && <div className="cadence-trial-section">
      <h3>Trial &amp; enrollment milestones</h3>
      <p className="muted">Optional — backfill any of these that already happened, in order.</p>
      {trialAlreadyBooked ? <div className="cadence-already-done">✓ Trial already booked for {formatTrialTime(lead!.trialAt!)}</div>
        : <label className="field">Trial lesson booked for<input type="datetime-local" value={trialBookedAt} onChange={(event) => setTrialBookedAt(event.target.value)} /></label>}
      {trialBookedAt && <label className="field event-highlight">Instructor<select required value={trialInstructorId} onChange={(event) => setTrialInstructorId(event.target.value)}><option value="">Choose an instructor</option>{eligibleInstructors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>This creates a real trial on that instructor's schedule.</small></label>}
      {formAlreadyComplete ? <div className="cadence-already-done">✓ Trial confirmation form already completed</div>
        : <label className="field">Trial confirmation form completed<input type="datetime-local" disabled={!canFillForm} value={trialFormDate} max={toDateTimeInput(new Date())} onChange={(event) => setTrialFormDate(event.target.value)} /></label>}
      {trialAlreadyAttended ? <div className="cadence-already-done">✓ Trial lesson already completed</div>
        : <label className="field">Trial lesson completed<input type="datetime-local" disabled={!canFillCompleted} value={trialCompletedDate} max={toDateTimeInput(new Date())} onChange={(event) => setTrialCompletedDate(event.target.value)} /></label>}
      {alreadyStudent ? <div className="cadence-already-done">✓ Already an active student{lead?.enrolledAt ? ` since ${formatDate(new Date(lead.enrolledAt))}` : ''}</div>
        : <label className="field">Became an active student<input type="datetime-local" disabled={!canFillBecameStudent} value={becameStudentDate} max={toDateTimeInput(new Date())} onChange={(event) => setBecameStudentDate(event.target.value)} /></label>}
    </div>}

    <div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!canSave} onClick={save}>Add to activity log</button></div>
  </section></div>
}

function Settings({ instruments, leads, instructors, availability, entries, openings, messageTemplates, onInstrumentsChange, onInstructorsChange, onAvailabilityChange, onEntriesChange, onOpeningsChange, onScheduleLog, onRequestSignatures, onSaveTemplate, onResetTemplate }: {
  instruments: string[]
  leads: Lead[]
  instructors: Instructor[]
  availability: InstructorAvailability[]
  entries: ScheduleEntry[]
  openings: TrialOpening[]
  messageTemplates: Record<string, string>
  onInstrumentsChange: (value: string[]) => void
  onInstructorsChange: (value: Instructor[]) => void
  onAvailabilityChange: (value: InstructorAvailability[]) => void
  onEntriesChange: (value: ScheduleEntry[]) => void
  onOpeningsChange: (value: TrialOpening[]) => void
  onScheduleLog: (activity: ScheduleLogInput) => void
  onRequestSignatures: () => void
  onSaveTemplate: (key: string, value: string) => void
  onResetTemplate: (key: string) => void
}) {
  const [newInstrument, setNewInstrument] = useState('')
  const [newInstructorName, setNewInstructorName] = useState('')
  const [newInstructorInstruments, setNewInstructorInstruments] = useState<string[]>([])
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null)

  const instrumentIsUsed = (instrument: string) => leads.some((lead) => lead.instruments.includes(instrument))
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
    <div className="card setting-card"><h2>Contact availability</h2><p>Recommendations will land inside these windows.</p><div className="schedule-row"><span>Monday–Thursday</span><strong>4:30–5:30 PM</strong></div><div className="schedule-row"><span>Friday</span><strong>4:00–5:15 PM</strong></div><div className="schedule-row"><span>Saturday</span><strong>10:00 AM–12:00 PM</strong></div><div className="schedule-row"><span>Sunday</span><strong>1:00–3:00 PM</strong></div><div className="blackout"><strong>Note</strong><span>Sunday is hot leads only — nurture contacts wait until Monday.</span><span>A brand-new lead is contacted immediately, any day, regardless of these windows.</span></div><button className="secondary">Edit availability</button></div>
    <div className="card setting-card"><h2>Calendar rules</h2><p>The follow-up plan automatically recognizes the day of week and major U.S. holidays.</p><label className="toggle-row"><span><strong>Avoid major holidays</strong><small>Move planned outreach to the next open day</small></span><input type="checkbox" defaultChecked /></label><label className="toggle-row"><span><strong>Allow weekend outreach</strong><small>Use your weekend availability for fresh leads</small></span><input type="checkbox" defaultChecked /></label></div>
    <div className="card setting-card"><h2>Enrollment agreement</h2><p>Track signature collection for every active student. Use this after a terms update to have everyone re-sign.</p><button className="secondary full" onClick={onRequestSignatures}>⚠ Major update to terms — collect signatures from all students</button><small className="muted" style={{ display: 'block', marginTop: 10 }}>This adds every current active student to Action Pending until their signature is collected. Inactive or unenrolled leads are never included.</small></div>
  </section>
  <section className="card setting-card settings-wide message-templates-card">
    <h2>Message templates</h2>
    <p>Edit the wording sent at each outreach step. Variables in double curly braces are filled in automatically — leave them as-is. <code>[Day/Time 1]</code> and <code>[Day/Time 2]</code> are filled in when you pick trial times to offer.</p>
    {messageTemplateGroups.map((group) => <div className="template-group" key={group.title}>
      <h3>{group.title}</h3>
      {group.items.map((item) => <MessageTemplateEditor key={item.key} template={item} value={messageTemplates[item.key] ?? defaultMessageTemplates[item.key]} onSave={(value) => onSaveTemplate(item.key, value)} onReset={() => onResetTemplate(item.key)} />)}
    </div>)}
  </section>{editingInstructor && <InstructorEditor instrumentOptions={instruments} instructor={editingInstructor} lockedInstruments={Array.from(new Set(entries.filter((entry) => entry.instructorId === editingInstructor.id).map((entry) => entry.instrument)))} onClose={() => setEditingInstructor(null)} onSave={(nextInstruments) => saveInstructorInstruments(editingInstructor, nextInstruments)} />}</>
}

function MessageTemplateEditor({ template, value, onSave, onReset }: { template: { key: string; label: string; variables: string[] }; value: string; onSave: (value: string) => void; onReset: () => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const dirty = draft !== value
  return <div className="template-editor">
    <div className="template-editor-head"><strong>{template.label}</strong><small>Variables: {template.variables.map((item) => `{{${item}}}`).join(', ')}</small></div>
    <textarea rows={5} value={draft} onChange={(event) => setDraft(event.target.value)} />
    <div className="template-editor-actions">
      <button type="button" className="secondary" disabled={!dirty} onClick={() => setDraft(value)}>Cancel</button>
      <button type="button" className="secondary" onClick={onReset}>Reset to default</button>
      <button type="button" className="primary" disabled={!dirty} onClick={() => onSave(draft)}>Save</button>
    </div>
  </div>
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

function actualNextOccurrence(entry: ScheduleEntry): Date | null {
  if (entry.kind !== 'regular' || !entry.startsOn || !entry.startTime) return null
  const interval = (entry.repeatIntervalWeeks ?? 1) === 2 ? 2 : 1
  let candidate = new Date(`${entry.startsOn}T${entry.startTime}:00`)
  for (let guard = 0; guard < 104; guard += 1) {
    if (entry.endsOn && localDateKey(candidate) > entry.endsOn) return null
    if (entryOccursOnDate(entry, candidate)) return candidate
    candidate = datePlusDays(candidate, 7 * interval)
  }
  return null
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

function biweeklyOffWeekAtSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  const slot = timeMinutes(time)
  const key = localDateKey(date)
  return entries.find((entry) => entry.instructorId === instructorId
    && entry.kind === 'regular'
    && (entry.repeatIntervalWeeks ?? 1) === 2
    && entry.dayOfWeek === date.getDay()
    && slot >= timeMinutes(entry.startTime!) && slot < timeMinutes(entry.startTime!) + (entry.durationMinutes ?? 30)
    && Boolean(entry.startsOn) && key >= entry.startsOn!
    && (!entry.endsOn || key <= entry.endsOn)
    && !onRecurrencePhase(entry, date))
}

function skippedRegularAtSlot(entries: ScheduleEntry[], instructorId: string, date: Date, time: string) {
  const slot = timeMinutes(time)
  const key = localDateKey(date)
  return entries.find((entry) => entry.instructorId === instructorId
    && entry.kind === 'regular'
    && entry.dayOfWeek === date.getDay()
    && slot >= timeMinutes(entry.startTime!) && slot < timeMinutes(entry.startTime!) + (entry.durationMinutes ?? 30)
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
      const begins = actualNextOccurrence(entry)
      return Boolean(begins) && begins! > displayedSlot && begins! <= cutoff
    }
    if (!entry.startsAt) return false
    const startsAt = new Date(entry.startsAt)
    const entryTime = `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
    return startsAt > displayedSlot && startsAt <= cutoff && startsAt.getDay() === date.getDay() && entryTime === time
  }).sort((a, b) => upcomingEntryDate(a).getTime() - upcomingEntryDate(b).getTime())
}

function upcomingEntryDate(entry: ScheduleEntry) {
  if (entry.kind === 'regular') return actualNextOccurrence(entry) ?? new Date(`${entry.startsOn}T${entry.startTime}:00`)
  return new Date(entry.startsAt!)
}

function UpcomingSlotNotes({ entries, onEdit }: { entries: ScheduleEntry[]; onEdit: (entry: ScheduleEntry) => void }) {
  if (!entries.length) return null
  return <div className="upcoming-notes">{entries.slice(0, 3).map((entry) => <button type="button" key={entry.id} title={`Edit ${entry.studentName}`} onClick={(event) => { event.stopPropagation(); onEdit(entry) }}><small>{upcomingEntryDate(entry).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} {entry.kind === 'regular' ? 'Starts' : entry.kind === 'trial' ? 'Trial' : 'One-time'}: {entry.studentName}</small></button>)}{entries.length > 3 && <small>+{entries.length - 3} more</small>}</div>
}

function describeScheduleEntry(entry: ScheduleEntry) {
  if (entry.kind === 'regular') return `${entry.instrument} · ${entry.repeatIntervalWeeks === 2 ? 'Every other' : 'Every'} ${scheduleDays.find((day) => day.dayOfWeek === entry.dayOfWeek)?.label} at ${formatClock(entry.startTime!)} · ${entry.durationMinutes ?? 30} minutes · Starting ${new Date(`${entry.startsOn}T00:00:00`).toLocaleDateString('en-US')}`
  if (entry.kind === 'break') return `Break · ${formatTrialTime(entry.startsAt!)} · ${entry.durationMinutes ?? 15} minutes`
  return `${entry.instrument} · ${entry.kind === 'trial' ? 'Trial' : 'One-time lesson'} · ${formatTrialTime(entry.startsAt!)} · ${entry.durationMinutes ?? 30} minutes`
}

type TrialBookingResult = { ok: true; entry: ScheduleEntry; isUpdate: boolean; autoBreak?: ScheduleEntry } | { ok: false; message?: string }

function bookTrialEntry(instructor: Instructor, allEntries: ScheduleEntry[], availability: InstructorAvailability[], lead: Lead, startsAtIso: string, durationMinutes: 30 | 45 | 60): TrialBookingResult {
  const existingTrialEntry = allEntries.find((entry) => entry.kind === 'trial' && entry.leadId === lead.id)
  const entries = existingTrialEntry ? allEntries.filter((entry) => entry.id !== existingTrialEntry.id) : allEntries
  const date = new Date(startsAtIso)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (!lessonFitsAvailability(availability, instructor.id, date.getDay(), time, durationMinutes)) {
    return { ok: false, message: `${instructor.name} is not marked available for that entire lesson.` }
  }
  const conflictingEntry = entries.find((entry) => entry.instructorId === instructor.id
    && entryOccursOnDate(entry, date)
    && timesOverlap(entryStartTime(entry), entry.durationMinutes ?? 30, time, durationMinutes))
  if (conflictingEntry) {
    return { ok: false, message: `That time overlaps ${conflictingEntry.studentName}'s scheduled time.` }
  }

  const proposedStart = timeMinutes(time)
  const proposedEnd = proposedStart + durationMinutes
  const sameDayIntervals: [number, number][] = entries
    .filter((entry) => entry.instructorId === instructor.id && entryOccursOnDate(entry, date))
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
  const blockMinutes = block ? block[1] - block[0] : durationMinutes

  if (blockMinutes > 225) {
    const hours = (blockMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    if (!window.confirm(`This gives ${instructor.name} ${hours} consecutive hours with no break of 15+ minutes on ${date.toLocaleDateString('en-US')}. A break is recommended after 3.75 hours. Schedule anyway?`)) return { ok: false }
  }

  const entry: ScheduleEntry = { id: existingTrialEntry?.id ?? crypto.randomUUID(), instructorId: instructor.id, leadId: lead.id, studentName: lead.studentName ?? lead.name, instrument: lead.instruments[0] ?? instructor.instruments[0] ?? '', kind: 'trial', durationMinutes, startsAt: date.toISOString() }
  let autoBreak: ScheduleEntry | undefined
  if (block && blockMinutes > 225) {
    const breakStartMinutes = block[1]
    const breakTime = `${String(Math.floor(breakStartMinutes / 60)).padStart(2, '0')}:${String(breakStartMinutes % 60).padStart(2, '0')}`
    const breakFits = lessonFitsAvailability(availability, instructor.id, date.getDay(), breakTime, 15)
    const breakOccupied = entries.some((entry2) => entry2.instructorId === instructor.id && entryOccursOnDate(entry2, date) && timesOverlap(entryStartTime(entry2), entry2.durationMinutes ?? 30, breakTime, 15))
    if (breakFits && !breakOccupied) autoBreak = { id: crypto.randomUUID(), instructorId: instructor.id, studentName: 'Break', instrument: instructor.instruments[0], kind: 'break', durationMinutes: 15, startsAt: dateAtTime(date, breakTime).toISOString() }
  }
  return { ok: true, entry, isUpdate: Boolean(existingTrialEntry), autoBreak }
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
      const begins = actualNextOccurrence(entry)
      return Boolean(begins) && begins! > referenceSlot && begins! <= cutoff
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
  const [removeChoice, setRemoveChoice] = useState<{ entry: ScheduleEntry; date: Date } | null>(null)
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
    let autoBreak: ScheduleEntry | null = null
    let autoBreakTime = ''
    let autoBreakEndTime = ''
    if (blockMinutes > 225) {
      const hours = (blockMinutes / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
      if (!window.confirm(`This gives ${instructor.name} ${hours} consecutive hours with no break of 15+ minutes on ${date.toLocaleDateString('en-US')}. A break is recommended after 3.75 hours. Schedule anyway?`)) return
      if (block) {
        const breakStartMinutes = block[1]
        const breakEndMinutes = breakStartMinutes + 15
        const breakTime = `${String(Math.floor(breakStartMinutes / 60)).padStart(2, '0')}:${String(breakStartMinutes % 60).padStart(2, '0')}`
        const breakFits = lessonFitsAvailability(availability, instructor.id, date.getDay(), breakTime, 15)
        const breakOccupied = entries.some((entry) => entry.id !== next.id && entry.instructorId === instructor.id && entryOccursOnDate(entry, date) && timesOverlap(entryStartTime(entry), entry.durationMinutes ?? 30, breakTime, 15))
        if (breakFits && !breakOccupied) {
          autoBreak = { id: crypto.randomUUID(), instructorId: instructor.id, studentName: 'Break', instrument: instructor.instruments[0], kind: 'break', durationMinutes: 15, startsAt: dateAtTime(date, breakTime).toISOString() }
          autoBreakTime = breakTime
          autoBreakEndTime = `${String(Math.floor(breakEndMinutes / 60)).padStart(2, '0')}:${String(breakEndMinutes % 60).padStart(2, '0')}`
        }
      }
    }
    const savedEntries = entries.some((entry) => entry.id === next.id) ? entries.map((entry) => entry.id === next.id ? next : entry) : [...entries, next]
    onEntriesChange(autoBreak ? [...savedEntries, autoBreak] : savedEntries)
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
    if (autoBreak) onScheduleLog({ action: 'Break auto-scheduled', instructor: instructor.name, details: `${formatClock(autoBreakTime)}–${formatClock(autoBreakEndTime)} · after 3.75 consecutive hours · remove it if you don't need it` })
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

    <div className="schedule-legend"><span className="legend-open">Available</span><span className="legend-regular">🔒 Regular student</span><span className="legend-dated">Dated lesson</span><span className="legend-offered">Trial opening</span><span className="legend-break">☕ Break</span><small>Click an available green cell to add or remove it from Text Now.</small></div>

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
            const biweeklyOff = entry || skippedRegular ? undefined : biweeklyOffWeekAtSlot(entries, instructor.id, date, time)
            const startsAt = dateAtTime(date, time)
            const opening = openings.find((item) => item.instructor === instructor.name && new Date(item.startsAt).getTime() === startsAt.getTime())
            const upcoming = upcomingEntriesAtSlot(entries, instructor.id, date, time)
            const upcomingContinuation = entry ? [] : upcomingEntryCoversSlot(entries, instructor.id, date, time).filter((item) => !upcoming.includes(item))
            const past = startsAt < new Date()
            const className = `${entry ? `schedule-cell ${entry.kind === 'regular' ? 'regular' : entry.kind === 'break' ? 'break' : 'dated'}${entryStartsHere ? ' entry-start' : ' entry-continuation'}` : skippedRegular ? 'schedule-cell absence' : opening ? 'schedule-cell offered' : available ? `schedule-cell open${past ? ' past' : ''}` : 'schedule-cell unavailable'}${time === hoveredTime ? ' row-hovered' : ''}`
            return <div className={className} key={`${localDateKey(date)}-${time}`} onMouseEnter={() => setHoveredTime(time)} onMouseLeave={() => setHoveredTime((current) => current === time ? null : current)}>
              {entry ? <><button type="button" className="cell-main" aria-label={entry.kind === 'break' ? 'Remove break' : `Edit ${entry.studentName}`} onClick={() => entry.kind === 'break' ? setRemoveChoice({ entry, date }) : setSlotEditor({ date, time: entryStartTime(entry), entry })}>{entryStartsHere && <><strong>{entry.kind === 'regular' ? '🔒 ' : entry.kind === 'break' ? '☕ ' : ''}{entry.studentName}</strong><small>{entry.kind === 'regular' ? 'Regular' : entry.kind === 'trial' ? 'Trial' : entry.kind === 'break' ? 'Tap to remove' : 'One-time'} · {entry.durationMinutes ?? 30} min{entry.kind === 'regular' && entry.repeatIntervalWeeks === 2 ? ' · Biweekly' : ''}</small></>}</button>{entryStartsHere && <UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} />}</>
                : available ? <><button type="button" disabled={past} className="cell-main" onClick={() => toggleOpening(date, time)}>{opening ? <><strong>✓ Trial opening</strong><small>{opening.instruments.join(' / ')}</small></> : skippedRegular ? <><strong>Open this week</strong><small>{skippedRegular.startTime === time ? `${skippedRegular.studentName} absent` : `See above · ${skippedRegular.studentName}`}</small></> : biweeklyOff ? <><strong>Open this week</strong><small>{biweeklyOff.startTime === time ? `${biweeklyOff.studentName} · next ${datePlusDays(date, 7).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `See above · ${biweeklyOff.studentName}`}</small></> : <span>{past ? '' : 'Open'}</span>}</button><UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} />{upcomingContinuation.length > 0 && <small className="upcoming-continuation-hint">See above · {upcomingContinuation[0].studentName}</small>}{!past && <button type="button" className="cell-add" title="Schedule a student here" onClick={() => setSlotEditor({ date, time })}>＋</button>}{skippedRegular && skippedRegular.startTime === time && !past && <button type="button" className="cell-restore" title={`Restore ${skippedRegular.studentName}'s regular lesson`} onClick={() => restoreRegularDate(skippedRegular, date)}>↶</button>}</>
                  : <>{upcomingContinuation.length > 0 && <small className="upcoming-continuation-hint">See above · {upcomingContinuation[0].studentName}</small>}<UpcomingSlotNotes entries={upcoming} onEdit={editUpcomingEntry} /></>}
            </div>
          })])}
        </div>
      </div>
    </div>
    <div className="selected-opening-summary"><strong>{instructorOpenings.length} upcoming {instructor.name} trial opening{instructorOpenings.length === 1 ? '' : 's'} available to Text Now</strong></div>
    {slotEditor && <ScheduleEntryEditor leads={leads} instructor={instructor} slot={slotEditor} onClose={() => setSlotEditor(null)} onSave={saveEntry} onDelete={slotEditor.entry ? () => setRemoveChoice({ entry: slotEditor.entry!, date: slotEditor.date }) : undefined} onSkipDate={slotEditor.entry?.kind === 'regular' ? () => skipRegularDate(slotEditor.entry!, slotEditor.date) : undefined} />}
    {removeChoice && <RemoveEntryDialog entry={removeChoice.entry} slotDate={removeChoice.date} onCancel={() => setRemoveChoice(null)} onRemoveAll={() => removeEntireSeries(removeChoice.entry)} onRemoveForward={removeChoice.entry.kind === 'regular' ? () => endSeriesFromDate(removeChoice.entry, removeChoice.date) : undefined} />}
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
  const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(existing?.durationMinutes === 15 ? 30 : existing?.durationMinutes ?? 30)
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
    <LeadSearchPicker leads={leads} instructor={instructor} selectedLeadId={selectedLeadId} initialName={studentName} onClear={() => { setSelectedLeadId(''); setStudentName('') }} onSelect={(lead) => { setSelectedLeadId(lead.id); setStudentName(lead.studentName ?? lead.name); setInstrument(lead.instruments.find((item) => instructor.instruments.includes(item)) ?? lead.instruments[0] ?? instructor.instruments[0] ?? '') }} />
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
  return <div className="overlay modal-overlay remove-entry-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><section className="modal remove-entry-dialog">
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

function LeadSearchPicker({ leads, instructor, selectedLeadId, initialName, onSelect, onClear }: { leads: Lead[]; instructor?: Instructor; selectedLeadId: string; initialName?: string; onSelect: (lead: Lead) => void; onClear: () => void }) {
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId)
  const [query, setQuery] = useState(selectedLead?.name ?? initialName ?? '')
  const [open, setOpen] = useState(true)
  const matchingLeads = leads
    .filter((lead) => !instructor || shareInstrument(instructor.instruments, lead.instruments))
    .filter((lead) => `${lead.name} ${lead.studentName ?? ''} ${lead.instruments.join(' ')} ${statusLabels[lead.status]}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  return <div className="field lead-search-field"><span>Student or lead</span><div className="lead-search"><input autoFocus required value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); if (event.target.value !== selectedLead?.name && event.target.value !== selectedLead?.studentName) onClear(); setOpen(true) }} placeholder="Start typing a name…" autoComplete="off" />{open && <div className="lead-search-options">{matchingLeads.map((lead) => <button type="button" className={lead.id === selectedLeadId ? 'selected' : ''} key={lead.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(lead); setQuery(lead.studentName ?? lead.name); setOpen(false) }}><strong>{lead.studentName ?? lead.name}</strong><small>{lead.studentName && lead.studentName !== lead.name ? `Lead: ${lead.name} · ` : ''}{leadInstrumentLabel(lead)} · {statusLabels[lead.status]}</small></button>)}{!matchingLeads.length && <p>{instructor ? 'No people match this instructor’s instruments and your search.' : 'No one matches your search.'}</p>}</div>}</div>{instructor && <small>Only people whose instrument is taught by {instructor.name} are shown.</small>}</div>
}

function TrialTimePicker({ draft, openings, onClose, onManage, onSend }: { draft: TextDraft; openings: TrialOpening[]; onClose: () => void; onManage: () => void; onSend: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const matches = openings.filter((opening) => shareInstrument(opening.instruments, draft.lead.instruments) && Date.parse(opening.startsAt) > Date.now())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const chosen = selected.map((id) => matches.find((opening) => opening.id === id)).filter((opening): opening is TrialOpening => Boolean(opening))
  const preview = draft.message
    .replace('[Day/Time 1]', chosen[0] ? formatTrialTime(chosen[0].startsAt) : '[Choose first trial time]')
    .replace('[Day/Time 2]', chosen[1] ? formatTrialTime(chosen[1].startsAt) : '[Choose second trial time]')

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 2 ? [...current, id] : current)

  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal time-picker">
    <button type="button" className="close" onClick={onClose}>×</button>
    <p className="eyebrow">{draft.label}</p>
    <h2>Choose two {leadInstrumentText(draft.lead)} trial times</h2>
    <p className="muted">Select the two openings you want to offer {draft.lead.name.split(' ')[0]}.</p>
    <div className="time-options">{matches.map((opening) => <button type="button" key={opening.id} className={selected.includes(opening.id) ? 'time-option selected' : 'time-option'} onClick={() => toggle(opening.id)}><span>{selected.includes(opening.id) ? '✓' : '○'}</span><div><strong>{formatTrialTime(opening.startsAt)}</strong><small>Instructor: {opening.instructor}</small></div></button>)}
      {matches.length < 2 && <div className="picker-warning"><strong>Two openings are required.</strong><span>Add more {leadInstrumentText(draft.lead)} trial times before creating this message.</span></div>}
    </div>
    <div className="message-preview"><strong>Message preview</strong><p>{preview}</p></div>
    <div className="picker-actions"><button type="button" className="secondary" onClick={onManage}>Manage openings</button><button type="button" className="primary" disabled={selected.length !== 2} onClick={() => onSend(preview)}>Copy & open Messages</button></div>
  </section></div>
}

function LeadPanel({ lead, instruments, trialOpenings, messageTemplates, onClose, onLog, onAddNote, onTextNow, onTrialUpdate, onStatusChange, onDeleteActivity, onUpdateLead, onDeleteLead, onScheduleFollowUp, onResolveFollowUp }: { lead: Lead; instruments: string[]; trialOpenings: TrialOpening[]; messageTemplates: Record<string, string>; onClose: () => void; onLog: (id: string, type: ActivityType) => void; onAddNote: (id: string, note: string) => void; onTextNow: StartText; onTrialUpdate: (id: string, update: Partial<Lead>, outcome: string) => void; onStatusChange: (id: string, status: LeadStatus) => void; onDeleteActivity: (leadId: string, activityId: string) => void; onUpdateLead: (id: string, update: Partial<Lead>) => void; onDeleteLead: (id: string) => void; onScheduleFollowUp: (id: string, note: string, atIso: string) => void; onResolveFollowUp: (lead: Lead) => void }) {
  const [editing, setEditing] = useState(false)
  const isNurture = lead.status === 'nurture' || lead.status === 'nurture_long_term'
  const isActiveHotLead = lead.status === 'hot' && !lead.trialAt
  const recommendation = isNurture ? nextNurtureContact(lead, defaultAvailability) : nextContact(lead, defaultAvailability)
  const matchingOpenings = trialOpenings.filter((opening) => shareInstrument(opening.instruments, lead.instruments) && Date.parse(opening.startsAt) > Date.now())
  const nurtureTemplate = isNurture ? nurtureMessageFor(lead, recommendation.at, matchingOpenings.length >= 2, messageTemplates) : undefined
  const activeTemplate = isActiveHotLead ? activeFollowUpFor(lead, messageTemplates) : undefined
  const messageTemplate = nurtureTemplate ?? activeTemplate
  const cadenceProgress = isNurture ? nurtureCadenceState(lead) : isActiveHotLead ? activeCadenceState(lead) : undefined
  const notes = lead.activities.filter((activity) => activity.type === 'note').reverse()
  return <><div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="drawer">
    <button className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>{lead.name}</h2>{lead.studentName && <p className="profile-student">Student: <strong>{lead.studentName}</strong></p>}<p className="muted">{leadInstrumentLabel(lead)} · {lead.phone}</p>
    <button className="edit-lead-button" onClick={() => setEditing(true)}>✎ Edit lead information</button>
    <div className="next-box"><small>Recommended next contact</small><strong>{recommendation.reason.includes('now') ? 'Call now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span>{messageTemplate && <><b>{messageTemplate.label}</b><small>{messageTemplate.message}</small></>}</div>
    {activeTemplate?.voicemail && <details className="script-box"><summary>{activeTemplate.voicemailLabel}</summary><p>{activeTemplate.voicemail}</p></details>}
    <div className="drawer-actions"><button className="primary" onClick={() => onTextNow(lead, messageTemplate)}>↗ Text now</button>{(!messageTemplate || messageTemplate.callFirst) && <button className="secondary" disabled={cadenceProgress?.callLogged} onClick={() => onLog(lead.id, 'call')}>{cadenceProgress?.callLogged ? '✓ Call logged' : '☎ Log call'}</button>}<button className="secondary" disabled={cadenceProgress?.textLogged} onClick={() => onLog(lead.id, 'text')}>{cadenceProgress?.textLogged ? '✓ Text logged' : '✓ Log text'}</button></div>
    <TrialWorkflowEditor key={`${lead.id}-${lead.trialAt ?? 'none'}`} lead={lead} onTrialUpdate={onTrialUpdate} />
    <LeadNoteComposer onSave={(note) => onAddNote(lead.id, note)} />
    <FollowUpComposer lead={lead} onSchedule={(note, atIso) => onScheduleFollowUp(lead.id, note, atIso)} onResolve={() => onResolveFollowUp(lead)} />
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

function FollowUpComposer({ lead, onSchedule, onResolve }: { lead: Lead; onSchedule: (note: string, atIso: string) => void; onResolve: () => void }) {
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => toDateTimeInput(new Date(Date.now() + 86_400_000)))
  if (lead.followUpAt) {
    return <div className="follow-up-box"><strong>Follow up on {formatDate(new Date(lead.followUpAt))}</strong>{lead.followUpNote && <p>{lead.followUpNote}</p>}<button type="button" className="secondary" onClick={onResolve}>✓ Done — clear follow-up</button></div>
  }
  return <div className="note-composer"><label className="field">Follow up on a later date<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What do you want to remember to follow up about?" /></label><label className="field">Date<input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></label><button type="button" className="secondary" disabled={!note.trim() || !date} onClick={() => onSchedule(note.trim(), new Date(date).toISOString())}>📅 Schedule follow-up</button></div>
}

function QuickNoteModal({ lead, onClose, onSave }: { lead: Lead; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState('')
  return <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal quick-note" onSubmit={(event) => { event.preventDefault(); if (note.trim()) onSave(note.trim()) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Take note</p><h2>{lead.name}</h2><p className="muted">{leadInstrumentLabel(lead)} · This note will appear in the Activity Log.</p><label className="field">Note<textarea autoFocus required rows={6} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What do you want to remember?" /></label><button className="primary full" type="submit" disabled={!note.trim()}>Save note</button></form></div>
}

function EditLeadModal({ lead, instruments, onClose, onSave }: { lead: Lead; instruments: string[]; onClose: () => void; onSave: (update: Partial<Lead>) => void }) {
  const [name, setName] = useState(lead.name)
  const [studentName, setStudentName] = useState(lead.studentName ?? '')
  const [sameAsLead, setSameAsLead] = useState(Boolean(lead.studentName && lead.studentName === lead.name))
  const [phone, setPhone] = useState(lead.phone)
  const [email, setEmail] = useState(lead.email)
  const [leadInstruments, setLeadInstruments] = useState<string[]>(lead.instruments)
  const [source, setSource] = useState(lead.source)
  const [campaign, setCampaign] = useState(lead.campaign)
  const [receivedAt, setReceivedAt] = useState(() => toDateTimeInput(new Date(lead.receivedAt)))
  return <div className="overlay modal-overlay edit-lead-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal edit-lead-modal" onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim(), studentName: (sameAsLead ? name : studentName).trim() || undefined, phone: phone.trim(), email: email.trim(), instruments: leadInstruments, source, campaign: campaign.trim(), receivedAt: new Date(receivedAt).toISOString() }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>Edit lead information</h2><label className="field">Lead name<input required value={name} onChange={(event) => { setName(event.target.value); if (sameAsLead) setStudentName(event.target.value) }} autoFocus /></label><label className="field">Student name <small>Optional</small><input value={sameAsLead ? name : studentName} disabled={sameAsLead} onChange={(event) => setStudentName(event.target.value)} /></label><label className="same-name-check"><input type="checkbox" checked={sameAsLead} onChange={(event) => { setSameAsLead(event.target.checked); if (event.target.checked) setStudentName(name) }} /> Student name is the same as lead name</label><div className="field-pair"><label className="field">Phone<input required value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="field">Email <small>Optional</small><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></div><label className="field">Inquiry received<input required type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label><label className="field">Instrument(s)<div className="instrument-checks">{instruments.map((item) => <label key={item}><input type="checkbox" checked={leadInstruments.includes(item)} onChange={(event) => setLeadInstruments((current) => event.target.checked ? [...current, item] : current.filter((entry) => entry !== item))} /> {item}</label>)}</div></label><label className="field">Source<select value={source} onChange={(event) => setSource(event.target.value)}><option>Meta</option><option>Website Traffic</option><option>WLS</option><option>Word of Mouth</option></select></label><label className="field">Campaign<input value={campaign} onChange={(event) => setCampaign(event.target.value)} /></label><div className="editor-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={!leadInstruments.length}>Save changes</button></div></form></div>
}

function NewLeadModal({ instruments, onClose, onSave }: { instruments: string[]; onClose: () => void; onSave: (lead: Lead) => void }) {
  const [name, setName] = useState('')
  const [studentName, setStudentName] = useState('')
  const [sameAsLead, setSameAsLead] = useState(false)
  const [phone, setPhone] = useState('')
  const [leadInstruments, setLeadInstruments] = useState<string[]>(instruments[0] ? [instruments[0]] : [])
  const [source, setSource] = useState('Meta')
  const [receivedAt, setReceivedAt] = useState(() => toDateTimeInput(new Date()))
  return <div className="overlay modal-overlay"><form className="modal" onSubmit={(event) => { event.preventDefault(); if (!leadInstruments.length) return; onSave({ id: crypto.randomUUID(), name: name.trim(), studentName: (sameAsLead ? name : studentName).trim() || undefined, phone, email: '', instruments: leadInstruments, source, campaign: 'Manual entry', receivedAt: new Date(receivedAt).toISOString(), status: 'hot', activities: [], holdFormComplete: false, trialAttended: false }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Add inquiry</p><h2>New lead</h2><label className="field">Lead name<input required value={name} onChange={(e) => { setName(e.target.value); if (sameAsLead) setStudentName(e.target.value) }} autoFocus /></label><label className="field">Student name <small>Optional</small><input value={sameAsLead ? name : studentName} disabled={sameAsLead} onChange={(e) => setStudentName(e.target.value)} /></label><label className="same-name-check"><input type="checkbox" checked={sameAsLead} onChange={(event) => { setSameAsLead(event.target.checked); if (event.target.checked) setStudentName(name) }} /> Student name is the same as lead name</label><label className="field">Phone<input required value={phone} onChange={(e) => setPhone(e.target.value)} /></label><label className="field">Inquiry received<input required type="datetime-local" value={receivedAt} max={toDateTimeInput(new Date())} onChange={(e) => setReceivedAt(e.target.value)} /><small>Change this if you are entering the lead later.</small></label><label className="field">Instrument(s)<div className="instrument-checks">{instruments.map((item) => <label key={item}><input type="checkbox" checked={leadInstruments.includes(item)} onChange={(event) => setLeadInstruments((current) => event.target.checked ? [...current, item] : current.filter((entry) => entry !== item))} /> {item}</label>)}</div></label><label className="field">Source<select value={source} onChange={(e) => setSource(e.target.value)}><option>Meta</option><option>Website Traffic</option><option>WLS</option><option>Word of Mouth</option></select></label><button className="primary full" type="submit" disabled={!leadInstruments.length}>Save lead</button></form></div>
}

export default App
