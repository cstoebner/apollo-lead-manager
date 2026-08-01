import { useMemo, useState } from 'react'
import { nextContact } from './cadence'
import { defaultAvailability, demoLeads } from './data'
import { isSupabaseConfigured } from './supabase'
import type { ActivityType, Lead, LeadStatus } from './types'

type View = 'today' | 'leads' | 'trials' | 'marketing' | 'settings'

const statusLabels: Record<LeadStatus, string> = {
  new: 'New', contacting: 'Contacting', trial_booked: 'Trial booked', trial_complete: 'Trial complete', enrolled: 'Enrolled', lost: 'Lost',
}

const formatDate = (value: string | Date, includeTime = true) => new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
}).format(new Date(value))

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
    status: lead.status === 'new' ? 'contacting' : lead.status,
    activities: [...lead.activities, { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), outcome: type === 'call' ? 'Attempted call' : 'Message sent' }],
  } : lead))

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo"><span>A</span><div>Apollo<small>Lead manager</small></div></div>
        <nav>
          <NavButton active={view === 'today'} onClick={() => setView('today')} icon="⌂" label="Today" />
          <NavButton active={view === 'leads'} onClick={() => setView('leads')} icon="◎" label="All leads" />
          <NavButton active={view === 'trials'} onClick={() => setView('trials')} icon="◇" label="Trials" />
          <NavButton active={view === 'marketing'} onClick={() => setView('marketing')} icon="↗" label="Marketing" />
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon="⚙" label="Availability" />
        </nav>
        <div className="sidebar-foot"><span className="avatar">CS</span><div>Conor<small>{isSupabaseConfigured ? 'Connected' : 'Demo mode'}</small></div></div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div><p className="eyebrow">{formatDate(new Date(), false)}</p><h1>{view === 'today' ? 'Your follow-up plan' : view === 'leads' ? 'All leads' : view === 'trials' ? 'Trial pipeline' : view === 'marketing' ? 'Advertising yield' : 'Contact availability'}</h1></div>
          <button className="primary" onClick={() => setShowNewLead(true)}>＋ New lead</button>
        </header>

        {view === 'today' && <Today leads={leads} onSelect={setSelectedId} onLog={logActivity} />}
        {view === 'leads' && <LeadTable leads={leads} onSelect={setSelectedId} />}
        {view === 'trials' && <Trials leads={leads} onSelect={setSelectedId} onUpdate={updateLead} />}
        {view === 'marketing' && <Marketing leads={leads} />}
        {view === 'settings' && <Settings />}
      </main>

      {selected && <LeadPanel lead={selected} onClose={() => setSelectedId(null)} onLog={logActivity} onUpdate={updateLead} />}
      {showNewLead && <NewLeadModal onClose={() => setShowNewLead(false)} onSave={(lead) => { setLeads((current) => [lead, ...current]); setShowNewLead(false) }} />}
    </div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return <button className={active ? 'nav-active' : ''} onClick={onClick}><span>{icon}</span>{label}</button>
}

function Today({ leads, onSelect, onLog }: { leads: Lead[]; onSelect: (id: string) => void; onLog: (id: string, type: ActivityType) => void }) {
  const active = leads.filter((lead) => !['enrolled', 'lost'].includes(lead.status))
  const queue = useMemo(() => active.map((lead) => ({ lead, recommendation: nextContact(lead, defaultAvailability) })).sort((a, b) => a.recommendation.at.getTime() - b.recommendation.at.getTime()), [active])
  const fresh = queue.filter(({ recommendation }) => recommendation.reason.includes('now')).length

  return <>
    <section className="stats-grid">
      <Stat value={String(queue.length)} label="Active follow-ups" note={`${fresh} needs a quick response`} tone="coral" />
      <Stat value={String(leads.filter((l) => l.status === 'trial_booked').length)} label="Trials booked" note="Upcoming trial lessons" tone="gold" />
      <Stat value={`${Math.round(leads.filter((l) => l.status === 'enrolled').length / leads.length * 100)}%`} label="Lead-to-student" note="Current sample conversion" tone="green" />
    </section>

    <section className="card queue-card">
      <div className="section-head"><div><h2>Next actions</h2><p>Ordered by urgency and your available calling times.</p></div><span className="live-pill">● Live plan</span></div>
      <div className="queue-list">
        {queue.map(({ lead, recommendation }, index) => <article className="queue-row" key={lead.id}>
          <div className={`priority ${recommendation.reason.includes('now') ? 'urgent' : ''}`}>{index + 1}</div>
          <div className="lead-main" onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><span>{lead.instrument} · {lead.source}</span></div>
          <div className="recommendation"><strong>{recommendation.reason.includes('now') ? 'Now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span></div>
          <div className="row-actions"><button onClick={() => onLog(lead.id, 'call')}>☎ Call</button><button onClick={() => onLog(lead.id, 'text')}>↗ Text</button></div>
        </article>)}
      </div>
    </section>
  </>
}

function Stat({ value, label, note, tone }: { value: string; label: string; note: string; tone: string }) {
  return <div className={`stat-card ${tone}`}><span className="stat-value">{value}</span><strong>{label}</strong><small>{note}</small></div>
}

function LeadTable({ leads, onSelect }: { leads: Lead[]; onSelect: (id: string) => void }) {
  return <section className="card"><div className="section-head"><div><h2>Lead directory</h2><p>{leads.length} total leads in this workspace</p></div><input className="search" placeholder="Search leads" /></div>
    <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Received</th><th>Source</th><th>Touches</th><th>Status</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id} onClick={() => onSelect(lead.id)}><td><strong>{lead.name}</strong><small>{lead.instrument}</small></td><td>{formatDate(lead.receivedAt)}</td><td>{lead.source}<small>{lead.campaign}</small></td><td>{lead.activities.length}</td><td><span className={`status ${lead.status}`}>{statusLabels[lead.status]}</span></td></tr>)}</tbody></table></div>
  </section>
}

function Trials({ leads, onSelect, onUpdate }: { leads: Lead[]; onSelect: (id: string) => void; onUpdate: (id: string, update: Partial<Lead>) => void }) {
  const trials = leads.filter((lead) => lead.trialAt)
  return <section className="card"><div className="section-head"><div><h2>Trial readiness</h2><p>See what must happen before each lesson.</p></div></div><div className="trial-grid">{trials.map((lead) => <article key={lead.id} className="trial-card"><div className="trial-date"><strong>{new Date(lead.trialAt!).getDate()}</strong><span>{new Date(lead.trialAt!).toLocaleDateString('en-US', { month: 'short' })}</span></div><div className="trial-info" onClick={() => onSelect(lead.id)}><h3>{lead.name}</h3><p>{lead.instrument} · {formatDate(lead.trialAt!)}</p><label><input type="checkbox" checked={lead.holdFormComplete} onChange={(event) => onUpdate(lead.id, { holdFormComplete: event.target.checked })} /> Hold form complete</label><label><input type="checkbox" checked={lead.trialAttended} onChange={(event) => onUpdate(lead.id, { trialAttended: event.target.checked })} /> Attended trial</label></div></article>)}</div></section>
}

function Marketing({ leads }: { leads: Lead[] }) {
  const sources = Object.values(leads.reduce<Record<string, { source: string; leads: number; spend: number; students: number }>>((result, lead) => {
    result[lead.source] ??= { source: lead.source, leads: 0, spend: 0, students: 0 }
    result[lead.source].leads += 1; result[lead.source].spend += lead.adCost; result[lead.source].students += lead.status === 'enrolled' ? 1 : 0
    return result
  }, {}))
  const totalSpend = sources.reduce((sum, item) => sum + item.spend, 0)
  return <><section className="stats-grid"><Stat value={`$${totalSpend}`} label="Tracked spend" note={`$${Math.round(totalSpend / leads.length)} per lead`} tone="coral" /><Stat value={String(leads.length)} label="Leads generated" note="Across all campaigns" tone="gold" /><Stat value={`$${Math.round(totalSpend / Math.max(1, leads.filter(l => l.status === 'enrolled').length))}`} label="Cost per student" note="Based on enrollments" tone="green" /></section><section className="card"><div className="section-head"><div><h2>Performance by source</h2><p>Use this to decide where the next advertising dollar goes.</p></div></div><div className="source-list">{sources.map((item) => <div className="source-row" key={item.source}><strong>{item.source}</strong><span>{item.leads} leads</span><div className="bar"><i style={{ width: `${Math.max(10, item.leads / leads.length * 100)}%` }} /></div><span>${Math.round(item.spend / item.leads)}/lead</span><span>{item.students} students</span></div>)}</div></section></>
}

function Settings() {
  return <section className="settings-grid"><div className="card setting-card"><h2>Weekly availability</h2><p>Recommendations will land inside these windows.</p><div className="schedule-row"><span>Monday–Friday</span><strong>After 4:30 PM</strong></div><div className="schedule-row"><span>Saturday–Sunday</span><strong>10:00 AM–4:00 PM</strong></div><div className="blackout"><strong>Recurring exceptions</strong><span>Tuesday 5:00–5:30 PM</span><span>Thursday 4:30–5:30 PM</span></div><button className="secondary">Edit availability</button></div><div className="card setting-card"><h2>Calendar rules</h2><p>The follow-up plan automatically recognizes the day of week and major U.S. holidays.</p><label className="toggle-row"><span><strong>Avoid major holidays</strong><small>Move planned outreach to the next open day</small></span><input type="checkbox" defaultChecked /></label><label className="toggle-row"><span><strong>Allow weekend outreach</strong><small>Use your weekend availability for fresh leads</small></span><input type="checkbox" defaultChecked /></label></div></section>
}

function LeadPanel({ lead, onClose, onLog, onUpdate }: { lead: Lead; onClose: () => void; onLog: (id: string, type: ActivityType) => void; onUpdate: (id: string, update: Partial<Lead>) => void }) {
  const recommendation = nextContact(lead, defaultAvailability)
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="drawer"><button className="close" onClick={onClose}>×</button><p className="eyebrow">Lead profile</p><h2>{lead.name}</h2><p className="muted">{lead.instrument} · {lead.phone}</p><div className="next-box"><small>Recommended next contact</small><strong>{recommendation.reason.includes('now') ? 'Call now' : formatDate(recommendation.at)}</strong><span>{recommendation.reason}</span></div><div className="drawer-actions"><button className="primary" onClick={() => onLog(lead.id, 'call')}>☎ Log call</button><button className="secondary" onClick={() => onLog(lead.id, 'text')}>↗ Log text</button></div><label className="field">Pipeline stage<select value={lead.status} onChange={(event) => onUpdate(lead.id, { status: event.target.value as LeadStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="details"><div><small>Received</small><strong>{formatDate(lead.receivedAt)}</strong></div><div><small>Campaign</small><strong>{lead.campaign}</strong></div><div><small>Ad cost</small><strong>${lead.adCost}</strong></div><div><small>Total touches</small><strong>{lead.activities.length}</strong></div></div><h3>Activity</h3><div className="timeline">{[...lead.activities].reverse().map((activity) => <div key={activity.id}><i /><span><strong>{activity.type === 'call' ? 'Call' : activity.type === 'text' ? 'Text' : activity.type}</strong><small>{formatDate(activity.occurredAt)} · {activity.outcome}</small></span></div>)}{!lead.activities.length && <p className="muted">No outreach logged yet.</p>}</div></aside></div>
}

function NewLeadModal({ onClose, onSave }: { onClose: () => void; onSave: (lead: Lead) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [instrument, setInstrument] = useState('Piano')
  const [source, setSource] = useState('Google')
  return <div className="overlay modal-overlay"><form className="modal" onSubmit={(event) => { event.preventDefault(); onSave({ id: crypto.randomUUID(), name, phone, email: '', instrument, source, campaign: 'Manual entry', receivedAt: new Date().toISOString(), status: 'new', activities: [], holdFormComplete: false, trialAttended: false, adCost: 0 }) }}><button type="button" className="close" onClick={onClose}>×</button><p className="eyebrow">Add inquiry</p><h2>New lead</h2><label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label><label className="field">Phone<input required value={phone} onChange={(e) => setPhone(e.target.value)} /></label><div className="field-pair"><label className="field">Instrument<select value={instrument} onChange={(e) => setInstrument(e.target.value)}><option>Piano</option><option>Guitar</option><option>Voice</option><option>Drums</option><option>Violin</option></select></label><label className="field">Source<select value={source} onChange={(e) => setSource(e.target.value)}><option>Google</option><option>Facebook</option><option>Instagram</option><option>Referral</option></select></label></div><button className="primary full" type="submit">Save lead</button></form></div>
}

export default App
