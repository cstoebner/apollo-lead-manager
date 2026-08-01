import { useMemo, useState } from 'react'
import { nextContact, nextNurtureContact } from './cadence'
import { defaultAvailability, demoLeads } from './data'
import { isSupabaseConfigured } from './supabase'
import type { ActivityType, Lead, LeadStatus } from './types'

type View = 'today' | 'leads' | 'trials' | 'activity' | 'marketing' | 'settings'

const statusLabels: Record<LeadStatus, string> = {
  active_student: 'Active Student', hot: 'Hot', nurture: 'Nurture',
  nurture_long_term: 'Nurture Long Term', unresponsive: 'Unresponsive',
}

const touchCount = (lead: Lead) => lead.activities.filter((activity) => activity.type === 'call' || activity.type === 'text').length
const smsLink = (phone: string) => `sms:${phone.replace(/[^+\d]/g, '')}`

const formatDate = (value: string | Date, includeTime = true) => new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
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
      </section>
    </main>
  )
}

function Workspace() {
  const [view, setView] = useState<View>('today')
  const [leads, setLeads] = useState(demoLeads)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewLead, setShowNewLead] = useState(false)
  const selected = leads.find((lead) => lead.id === selectedId)

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo"><span>A</span><div>Apollo<small>Lead manager</small></div></div>
        <nav>
          <NavButton active={view === 'today'} onClick={() => setView('today')} icon="⌂" label="Today" />
          <NavButton active={view === 'leads'} onClick={() => setView('leads')} icon="◎" label="All leads" />
          <NavButton active={view === 'trials'} onClick={() => setView('trials')} icon="◇" label="Trials" />
          <NavButton active={view === 'activity'} onClick={() => setView('activity')} icon="≡" label="Activity log" />
          <NavButton active={view === 'marketing'} onClick={() => setView('marketing')} icon="↗" label="Marketing" />
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="⚙" label="Availability" />
        </nav>
        <div className="sidebar-foot"><span className="avatar">CS</span><div>Conor<small>{isSupabaseConfigured ? 'Connected' : 'Demo mode'}</small></div></div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div><p className="eyebrow">{formatDate(new Date(), false)}</p><h1>{view === 'today' ? 'Your follow-up plan' : view === 'leads' ? 'All leads' : view === 'trials' ? 'Trial pipeline' : view === 'activity' ? 'Activity log' : view === 'marketing' ? 'Advertising yield' : 'Contact availability'}</h1></div>
          <button className="primary" onClick={() => setShowNewLead(true)}>＋ New lead</button>
        </header>

        {view === 'today' && <Today leads={leads} onSelect={setSelectedId} onLog={logActivity} />}
        {view === 'leads' && <LeadTable leads={leads} onSelect={setSelectedId} />}
        {view === 'trials' && <Trials leads={leads} onSelect={setSelectedId} onUpdate={updateLead} />}
        {view === 'activity' && <ActivityLog leads={leads} onSelect={setSelectedId} onDelete={deleteActivity} />}
        {view === 'marketing' && <Marketing leads={leads} />}
        {view === 'settings' && <Settings />}
      </main>

      {selected && <LeadPanel lead={selected} onClose={() => setSelectedId(null)} onLog={logActivity} onUpdate={updateLead} onStatusChange={changeStatus} onDelete={deleteActivity} />}
      {showNewLead && <NewLeadModal onClose={() => setShowNewLead(false)} onSave={(lead) => { setLeads((current) => [lead, ...current]); setShowNewLead(false) }} />}
    </div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return <button className={active ? 'nav-active' : ''} onClick={onClick}><span>{icon}</span>{label}</button>
}

function Today({ leads, onSelect, onLog }: { leads: Lead[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void }) {
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
        {queue.map(({ lead, recommendation }, index) => <article className="queue-row" key={lead.id}>
          <div className={`priority ${recommendation.reason.includes('now') ? 'urgent' : ''}`}>{index + 1}</div>
          <div className="lead-main" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{lead.instrument} · {lead.source}</span></div>
          <div className="recommendation"><strong>{recommendation.reason.includes('now') ? 'Now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span></div>
          <div className="row-actions"><button onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><a href={smsLink(lead.phone)}>↗ Text now</a></div>
        </article>)}
      </div>
    </section>
    <PendingActions leads={pending} onSelect={onSelect} />
    <NurtureCadence leads={nurture} onSelect={onSelect} onLog={onLog} />
  </>
}

function PendingActions({ leads, onSelect }: { leads: Lead[]; onSelect: (id: string) => void }) {
  if (!leads.length) return null
  return <section className="card pending-card">
    <div className="section-head"><div><h2>Action pending</h2><p>These leads have moved beyond the outreach cadence and need a specific next step.</p></div></div>
    <div className="pending-list">{leads.map((lead) => {
      const action = lead.trialAttended || new Date(lead.trialAt!).getTime() < Date.now() ? 'Follow up and close enrollment' : 'Get the trial hold form completed'
      return <button key={lead.id} className="pending-row" onClick={() => onSelect(lead.id)}><span><strong>{lead.name}</strong><small>{lead.instrument} · {statusLabels[lead.status]}</small></span><b>{action}</b><i>→</i></button>
    })}</div>
  </section>
}

function NurtureCadence({ leads, onSelect, onLog }: { leads: Lead[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void }) {
  if (!leads.length) return null
  const recommendations = leads.map((lead) => ({ lead, recommendation: nextNurtureContact(lead, defaultAvailability) }))
    .sort((a, b) => a.recommendation.at.getTime() - b.recommendation.at.getTime())

  return <section className="card nurture-card">
    <div className="section-head"><div><h2>Nurture cadence</h2><p>Periodic, lower-priority outreach kept separate from active leads.</p></div></div>
    <div className="nurture-list">{recommendations.map(({ lead, recommendation }) => <article className="nurture-row" key={lead.id}>
      <button className="nurture-person" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{statusLabels[lead.status]} · {lead.instrument}</span></button>
      <div className="nurture-next"><strong>{formatDate(recommendation.at)}</strong><span>{recommendation.reason} · {recommendation.channel === 'text' ? 'Text next' : 'Call next'}</span></div>
      <div className="row-actions">{recommendation.channel === 'text' ? <><a href={smsLink(lead.phone)}>↗ Text now</a><button onClick={() => onLog(lead.id, 'text')}>✓ Log text</button></> : <button onClick={() => onLog(lead.id, 'call')}>☎ Log call</button>}</div>
    </article>)}</div>
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

function ActivityLog({ leads, onSelect, onDelete }: { leads: Lead[]; onSelect: (id: string) => void; onDelete: (leadId: string, activityId: string) => void }) {
  const entries = leads.flatMap((lead) => lead.activities.map((activity) => ({ lead, activity })))
    .sort((a, b) => Date.parse(b.activity.occurredAt) - Date.parse(a.activity.occurredAt))

  const remove = (leadId: string, activityId: string) => {
    if (window.confirm('Delete this activity? This will also correct the lead’s call/text count.')) onDelete(leadId, activityId)
  }

  return <section className="card activity-card">
    <div className="section-head"><div><h2>Communication history</h2><p>Every logged call and text, newest first.</p></div><span className="count-pill">{entries.length} actions</span></div>
    <div className="activity-list">
      {entries.map(({ lead, activity }) => <article className="activity-row" key={activity.id}>
        <div className={`activity-icon ${activity.type}`}>{activity.type === 'call' ? '☎' : activity.type === 'text' ? '↗' : activity.type === 'status_change' ? '↻' : '•'}</div>
        <button className="activity-person" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{lead.instrument} · {lead.phone}</span></button>
        <div className="activity-detail"><strong>{activity.type === 'call' ? 'Call logged' : activity.type === 'text' ? 'Text logged' : activity.type === 'status_change' ? 'Status updated' : activity.outcome}</strong><span>{activity.outcome}</span></div>
        <time>{formatDate(activity.occurredAt)}</time>
        {(activity.type === 'call' || activity.type === 'text') && <button className="delete-action" onClick={() => remove(lead.id, activity.id)} aria-label={`Delete ${activity.type} for ${lead.name}`}>Delete</button>}
      </article>)}
      {!entries.length && <div className="empty-state"><strong>No activity yet</strong><span>Calls and texts will appear here as you log them.</span></div>}
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

function LeadPanel({ lead, onClose, onLog, onUpdate, onStatusChange, onDelete }: { lead: Lead; onClose: () => void; onLog: (id: string, type: ActivityType) => void; onUpdate: (id: string, update: Partial<Lead>) => void; onStatusChange: (id: string, status: LeadStatus) => void; onDelete: (leadId: string, activityId: string) => void }) {
  const recommendation = nextContact(lead, defaultAvailability)
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="drawer"><button className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>{lead.name}</h2><p className="muted">{lead.instrument} · {lead.phone}</p><div className="next-box"><small>Recommended next contact</small><strong>{recommendation.reason.includes('now') ? 'Call now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span></div><div className="drawer-actions"><a className="primary" href={smsLink(lead.phone)}>↗ Text now</a><button className="secondary" onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><button className="secondary" onClick={() => onLog(lead.id, 'text')}>✓ Log text</button></div><label className="field">Status<select value={lead.status} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="details"><div><small>Received</small><strong>{formatDate(lead.receivedAt)}</strong></div><div><small>Campaign</small><strong>{lead.campaign}</strong></div><div><small>Ad cost</small><strong>${lead.adCost}</strong></div><div><small>Total touches</small><strong>{touchCount(lead)}</strong></div></div><h3>Activity</h3><div className="timeline">{[...lead.activities].reverse().map((activity) => <div key={activity.id}><i /><span><strong>{activity.type === 'call' ? 'Call' : activity.type === 'text' ? 'Text' : activity.type === 'status_change' ? 'Status updated' : activity.type}</strong><small>{formatDate(activity.occurredAt)} · {activity.outcome}</small></span>{(activity.type === 'call' || activity.type === 'text') && <button className="timeline-delete" onClick={() => window.confirm('Delete this activity?') && onDelete(lead.id, activity.id)}>Delete</button>}</div>)}{!lead.activities.length && <p className="muted">No outreach logged yet.</p>}</div></aside></div>
}

function NewLeadModal({ onClose, onSave }: { onClose: () => void; onSave: (lead: Lead) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [instrument, setInstrument] = useState('Piano')
  const [source, setSource] = useState('Google')
  const [receivedAt, setReceivedAt] = useState(() => toDateTimeInput(new Date()))
  return <div className="overlay modal-overlay"><form className="modal" onSubmit={(event) => { event.preventDefault(); onSave({ id: crypto.randomUUID(), name, phone, email: '', instrument, source, campaign: 'Manual entry', receivedAt: new Date(receivedAt).toISOString(), status: 'hot', activities: [], holdFormComplete: false, trialAttended: false, adCost: 0 }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Add inquiry</p><h2>New lead</h2><label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label><label className="field">Phone<input required value={phone} onChange={(e) => setPhone(e.target.value)} /></label><label className="field">Inquiry received<input required type="datetime-local" value={receivedAt} max={toDateTimeInput(new Date())} onChange={(e) => setReceivedAt(e.target.value)} /><small>Change this if you are entering the lead later.</small></label><div className="field-pair"><label className="field">Instrument<select value={instrument} onChange={(e) => setInstrument(e.target.value)}><option>Piano</option><option>Guitar</option><option>Voice</option><option>Drums</option><option>Violin</option><option>Saxophone</option><option>Trumpet</option><option>Trombone</option></select></label><label className="field">Source<select value={source} onChange={(e) => setSource(e.target.value)}><option>Google</option><option>Facebook</option><option>Instagram</option><option>Referral</option></select></label></div><button className="primary full" type="submit">Save lead</button></form></div>
}

export default App
