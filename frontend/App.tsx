import { ChangeEvent, FormEvent, KeyboardEvent, ReactNode, useEffect, useState } from 'react';

type View = 'scheduled' | 'sent' | 'compose' | 'detail';
type Email = { id: string; email: string; subject: string; scheduledTime?: string; sentTime?: string; status: string };
type User = { sub: string; name: string; email: string; picture: string };
type Sender = { email: string; displayName?: string };
type IconName = 'search' | 'filter' | 'refresh' | 'clock' | 'send' | 'star' | 'trash' | 'archive' | 'back' | 'paperclip' | 'chevron' | 'upload' | 'calendar' | 'close' | 'check' | 'more' | 'edit' | 'bold' | 'italic' | 'underline' | 'list' | 'quote' | 'align';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, '');
const api = (path: string) => {
  if (import.meta.env.PROD && !API_BASE) throw new Error('VITE_API_URL is required for a production frontend build');
  return `${API_BASE}${path}`;
};
const apiFetch = (path: string, options: RequestInit = {}) => fetch(api(path), { ...options, credentials: 'include' });

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
    filter: <><path d="M4 5h16M7 12h10M10 19h4"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4L20 15"/><path d="M20 20v-5h-5"/></>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    send: <><path d="m21 3-7.4 18-3.5-7.1L3 10.4z"/><path d="M10.1 13.9 21 3"/></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
    archive: <><path d="M4 7h16v13H4zM3 4h18v3H3zM9 12h6"/></>,
    back: <><path d="m15 5-7 7 7 7"/><path d="M8 12h12"/></>,
    paperclip: <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1L13 4.3a3.5 3.5 0 0 1 5 5L9.8 17.5a2 2 0 0 1-2.8-2.8l7.1-7.1"/>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    upload: <><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 14v5h16v-5"/></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    edit: <><path d="m4 16-.8 4.8L8 20l11-11-4-4z"/><path d="m13.5 6.5 4 4"/></>,
    bold: <path d="M8 5h5a3 3 0 0 1 0 6H8zm0 6h6a3 3 0 0 1 0 6H8zM8 5v12"/>,
    italic: <><path d="M10 5h7M7 19h7M14 5 10 19"/></>,
    underline: <><path d="M7 5v5a5 5 0 0 0 10 0V5M5 20h14"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></>,
    quote: <><path d="M7 8H4v5h4v-5a4 4 0 0 0-4-4M17 8h-3v5h4v-5a4 4 0 0 0-4-4"/></>,
    align: <><path d="M4 6h16M4 10h12M4 14h16M4 18h10"/></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const formatTime = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';
const initials = (email: string) => email.split(/[ @]/)[0].slice(0, 2).toUpperCase();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('scheduled');
  const [scheduled, setScheduled] = useState<Email[]>([]);
  const [sent, setSent] = useState<Email[]>([]);
  const [selected, setSelected] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'failed'>('all');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [scheduledResponse, sentResponse] = await Promise.all([apiFetch('/api/emails/scheduled'), apiFetch('/api/emails/sent')]);
      if (scheduledResponse.status === 401 || sentResponse.status === 401) { setUser(null); return; }
      if (!scheduledResponse.ok || !sentResponse.ok) throw new Error('Unable to load mailbox data');
      setScheduled(await scheduledResponse.json()); setSent(await sentResponse.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect to the API'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void (async () => { try { const response = await apiFetch('/api/auth/me'); if (response.ok) { const data = await response.json() as { user: User }; setUser(data.user); } } finally { setAuthLoading(false); } })(); }, []);
  useEffect(() => { if (user) void load(); }, [user]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3600); return () => window.clearTimeout(timer); }, [toast]);

  const openDetail = (email: Email) => { setSelected(email); setView('detail'); };
  const afterSchedule = (message: string) => { setToast(message); setView('scheduled'); void load(); };
  const activeRows = (view === 'sent' ? sent : scheduled).filter((email) => (statusFilter === 'all' || email.status === statusFilter) && (!search.trim() || `${email.email} ${email.subject}`.toLowerCase().includes(search.trim().toLowerCase())));
  const logout = async () => { try { const response = await apiFetch('/api/auth/logout', { method: 'POST' }); if (!response.ok) throw new Error('Unable to log out'); setUser(null); setScheduled([]); setSent([]); setSelected(null); setView('scheduled'); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to log out'); } };

  if (authLoading) return <div className="auth-screen"><div className="auth-card"><div className="brand auth-brand">onB</div><div className="loading-ring"/><p>Checking your session…</p></div></div>;
  if (!user) return <Login />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">onB</div>
      <button className="profile-card" onClick={() => void logout()}><Avatar user={user} small/><div className="profile-copy"><strong>{user.name}</strong><span>{user.email}</span></div><Icon name="chevron" size={14}/></button>
      <button className="logout-button" onClick={() => void logout()}>Logout</button>
      <button className="compose-outline" onClick={() => setView('compose')}>Compose</button>
      <div className="nav-label">CORE</div>
      <button className={`nav-item ${view === 'scheduled' ? 'active' : ''}`} onClick={() => setView('scheduled')}><Icon name="clock"/><span>Scheduled</span><b>{scheduled.length}</b></button>
      <button className={`nav-item ${view === 'sent' ? 'active' : ''}`} onClick={() => setView('sent')}><Icon name="send"/><span>Sent</span><b>{sent.length}</b></button>
      <div className="sidebar-footer"><span className="status-dot"/> API connected through <code>{import.meta.env.VITE_API_URL ? 'VITE_API_URL' : 'proxy'}</code></div>
    </aside>
    <main className="main-panel">
      {view === 'compose' ? <Compose onBack={() => setView('scheduled')} onScheduled={afterSchedule} /> : view === 'detail' && selected ? <Detail email={selected} user={user} onBack={() => setView(selected.status === 'sent' ? 'sent' : 'scheduled')} /> : <>
        <header className="topbar"><div className="search-box"><Icon name="search"/><input aria-label="Search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /></div><div className="top-actions"><button aria-label="Filter" onClick={() => setFilterOpen((value) => !value)}><Icon name="filter"/></button>{filterOpen && <div className="filter-menu"><button onClick={() => { setStatusFilter('all'); setSearch(''); setFilterOpen(false); }}>All {view === 'sent' ? 'sent' : 'scheduled'} emails</button><button onClick={() => { setStatusFilter('failed'); setSearch(''); setFilterOpen(false); }}>Failed emails</button></div>}<button aria-label="Refresh" onClick={() => void load()}><Icon name="refresh"/></button><button className="user-menu" onClick={() => void logout()}><Avatar user={user}/><span>Logout</span></button></div></header>
        <section className="mailbox-head"><div><p className="eyebrow">CORE / MAILBOX</p><h1>{view === 'sent' ? 'Sent' : 'Scheduled'}</h1><p className="subtle">{view === 'sent' ? 'A record of the messages sent by your campaigns.' : 'Keep an eye on everything queued for delivery.'}</p></div><button className="primary-button" onClick={() => setView('compose')}><Icon name="edit" size={15}/> Compose</button></section>
        {error && <div className="error-banner">{error}<button onClick={() => void load()}><Icon name="refresh" size={14}/> Retry</button></div>}
        <div className="list-toolbar"><span>{view === 'sent' ? `${sent.length} sent emails` : `${scheduled.length} scheduled emails`}</span><button onClick={() => void load()}><Icon name="refresh" size={14}/> Refresh</button></div>
        <section className="mail-list" aria-live="polite">{loading ? <LoadingRows/> : activeRows.length ? activeRows.map((email) => <EmailRow key={email.id} email={email} onClick={() => openDetail(email)} />) : <EmptyState type={view} onCompose={() => setView('compose')}/>}</section>
      </>}
    </main>
    {toast && <div className="toast"><span className="toast-check"><Icon name="check" size={14}/></span>{toast}</div>}
  </div>;
}

function Avatar({ user, small = false }: { user: User; small?: boolean }) {
  return user.picture ? <img className={small ? 'avatar' : 'mini-avatar'} src={user.picture} alt={`${user.name} avatar`} referrerPolicy="no-referrer" /> : <span className={small ? 'avatar' : 'mini-avatar'}>{initials(user.email)}</span>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const loginUrl = `${API_BASE}/auth/google`;
  return <main className="auth-screen"><section className="auth-card"><div className="brand auth-brand">onB</div><p className="auth-kicker">REACHINBOX / MAILBOX</p><h1>Welcome back</h1><p className="auth-copy">Sign in to schedule and track your outreach.</p><a className="google-button" href={loginUrl}><span className="google-mark">G</span> Continue with Google</a><div className="auth-divider"><span/>or continue with email<span/></div><form className="email-login" onSubmit={(event) => { event.preventDefault(); setEmailMessage('Email sign-in is not configured yet. Continue with Google.'); }}><label>Email address<input aria-label="Email address" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input aria-label="Password" type="password" placeholder="Your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button type="submit">Continue with email</button></form>{emailMessage && <p className="auth-message">{emailMessage}</p>}<p className="auth-note">Google sign-in securely authenticates your account.</p></section></main>;
}

function EmailRow({ email, onClick }: { email: Email; onClick: () => void }) {
  const isSent = email.status === 'sent';
  return <button className="email-row" onClick={onClick}><span className="row-avatar">{initials(email.email)}</span><span className="row-main"><span className="row-to">To: {email.email}</span><span className="row-subject">{email.subject || '(no subject)'}</span><span className="row-preview">— Message queued from ReachInbox</span></span><span className={`status-pill ${isSent ? 'sent' : 'scheduled'}`}>{isSent ? 'Sent' : formatTime(email.scheduledTime)}</span><Icon name="star" size={16}/></button>;
}

function LoadingRows() { return <>{[1, 2, 3].map((item) => <div className="skeleton-row" key={item}><span/><div><i/><i/><i/></div></div>)}</>; }
function EmptyState({ type, onCompose }: { type: View; onCompose: () => void }) { return <div className="empty-state"><div className="empty-icon"><Icon name={type === 'sent' ? 'send' : 'clock'} size={22}/></div><h2>No {type === 'sent' ? 'sent' : 'scheduled'} emails yet</h2><p>{type === 'sent' ? 'Completed deliveries will appear here.' : 'Compose a campaign and your queued messages will appear here.'}</p><button className="primary-button" onClick={onCompose}><Icon name="edit" size={15}/> Compose email</button></div>; }

function Compose({ onBack, onScheduled }: { onBack: () => void; onScheduled: (message: string) => void }) {
  const [recipients, setRecipients] = useState<string[]>([]); const [recipientInput, setRecipientInput] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [delay, setDelay] = useState('2'); const [hourlyLimit, setHourlyLimit] = useState('200'); const [startTime, setStartTime] = useState(''); const [sendLaterOpen, setSendLaterOpen] = useState(false); const [sending, setSending] = useState(false); const [error, setError] = useState(''); const [senders, setSenders] = useState<Sender[]>([]); const [senderEmail, setSenderEmail] = useState('');
  useEffect(() => { void apiFetch('/api/senders').then(async (response) => { if (!response.ok) throw new Error('Unable to load senders'); const data = await response.json() as Sender[]; setSenders(data); setSenderEmail(data[0]?.email ?? ''); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load senders')); }, []);
  const addRecipient = (value: string) => { const clean = value.trim().replace(/,$/, '').toLowerCase(); if (/^\S+@\S+\.\S+$/.test(clean) && !recipients.includes(clean)) setRecipients((current) => [...current, clean]); setRecipientInput(''); };
  const onRecipientKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' || event.key === ',' || event.key === ' ') { event.preventDefault(); addRecipient(recipientInput); } };
  const parseFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2_000_000) { setError('List file is too large.'); return; } const reader = new FileReader(); reader.onload = () => { const found = String(reader.result).match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []; found.forEach(addRecipient); }; reader.readAsText(file); };
  const schedule = async (event?: FormEvent) => { event?.preventDefault(); if (!senders.length || !senderEmail || !recipients.length || !subject.trim() || !body.trim()) { setError('Choose a sender and add recipients, a subject, and a message.'); return; } setSending(true); setError(''); try { const response = await apiFetch('/api/emails/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients, senderEmail, subject, body, startTime: startTime || new Date().toISOString(), delayMs: Number(delay) * 1000, hourlyLimit: Number(hourlyLimit), idempotencyKey: `campaign-${Date.now()}` }) }); if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error ?? 'Unable to schedule campaign'); } onScheduled(`${recipients.length} email${recipients.length === 1 ? '' : 's'} scheduled`); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to schedule campaign'); } finally { setSending(false); } };
  return <section className="compose-page"><header className="compose-header"><button className="back-button" onClick={onBack}><Icon name="back"/> <span>Compose New Email</span></button><div className="compose-actions"><label className="icon-action" title="Attach list"><Icon name="paperclip"/><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={parseFile}/></label><button className="icon-action" title="Send later" onClick={() => setSendLaterOpen((value) => !value)}><Icon name="clock"/></button><button className="send-button" onClick={() => void schedule()} disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>{sendLaterOpen && <SendLater startTime={startTime} setStartTime={setStartTime} onDone={() => setSendLaterOpen(false)} onCancel={() => setSendLaterOpen(false)}/>}</div></header>
    <form className="compose-form" onSubmit={schedule}><div className="form-line"><label htmlFor="sender">From</label><select id="sender" className="sender-select" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} disabled={!senders.length}>{senders.length ? senders.map((sender) => <option value={sender.email} key={sender.email}>{sender.displayName ? `${sender.displayName} <${sender.email}>` : sender.email}</option>) : <option>Loading senders…</option>}</select></div><div className="form-line recipient-line"><label>To</label><div className="recipient-box">{recipients.map((recipient) => <span className="recipient-chip" key={recipient}>{recipient}<button type="button" onClick={() => setRecipients((current) => current.filter((item) => item !== recipient))}><Icon name="close" size={11}/></button></span>)}<input value={recipientInput} onChange={(event) => setRecipientInput(event.target.value)} onKeyDown={onRecipientKey} onBlur={() => recipientInput && addRecipient(recipientInput)} placeholder={recipients.length ? 'Add recipient' : 'recipient@example.com'}/><label className="upload-link"><Icon name="upload" size={13}/> Upload List<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={parseFile}/></label><span className="recipient-count" aria-live="polite">{recipients.length} email{recipients.length === 1 ? '' : 's'} detected</span></div></div><div className="form-line"><label htmlFor="subject">Subject</label><input id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject"/></div><div className="settings-line"><label>Delay between 2 emails <input type="number" min="0" value={delay} onChange={(event) => setDelay(event.target.value)}/></label><label>Hourly Limit <input type="number" min="1" value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)}/></label><label className="start-time">Start time <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)}/></label></div><div className="editor"><div className="editor-toolbar"><button type="button"><Icon name="back"/></button><button type="button"><Icon name="back"/></button><span/><button type="button"><Icon name="bold"/></button><button type="button"><Icon name="italic"/></button><button type="button"><Icon name="underline"/></button><span/><button type="button"><Icon name="align"/></button><button type="button"><Icon name="list"/></button><button type="button"><Icon name="quote"/></button></div><textarea aria-label="Email body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Type Your Reply..." /></div>{error && <div className="form-error">{error}</div>}<button className="mobile-send primary-button" disabled={sending}>{sending ? 'Scheduling…' : 'Schedule emails'}</button></form>
  </section>;
}

function SendLater({ startTime, setStartTime, onDone, onCancel }: { startTime: string; setStartTime: (value: string) => void; onDone: () => void; onCancel: () => void }) { const choose = (hours: number) => { const date = new Date(Date.now() + hours * 3600000); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); setStartTime(local); }; return <div className="send-later-popover"><h3>Send Later</h3><label className="date-picker">Pick date & time <Icon name="calendar" size={14}/><input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)}/></label><button onClick={() => choose(24)}>Tomorrow</button><button onClick={() => choose(24 + 10)}>Tomorrow, 10:00 AM</button><button onClick={() => choose(24 + 12)}>Tomorrow, 12:00 PM</button><button onClick={() => choose(24 + 15)}>Tomorrow, 3:00 PM</button><div className="popover-actions"><button onClick={onCancel}>Cancel</button><button className="done-button" onClick={onDone}>Done</button></div></div>; }

function Detail({ email, user, onBack }: { email: Email; user: User; onBack: () => void }) { const isSent = email.status === 'sent'; return <section className="detail-page"><header className="detail-header"><button className="back-button" onClick={onBack}><Icon name="back"/> <span>{email.subject || 'Email details'}</span></button><div className="detail-actions"><button><Icon name="star"/></button><button><Icon name="archive"/></button><button><Icon name="trash"/></button><Avatar user={user}/></div></header><article className="message-card"><div className="message-meta"><div className="sender-avatar">{initials(email.email)}</div><div><strong>{email.email}</strong><span>to {user.email}</span></div><time>{formatTime(email.sentTime ?? email.scheduledTime)}</time></div><div className="message-body"><p className="message-kicker">{isSent ? 'Sent message' : email.status === 'processing' ? 'Processing message' : email.status === 'failed' ? 'Failed message' : 'Scheduled message'}</p><h2>{email.subject || '(no subject)'}</h2><p>This message is managed by your ReachInbox scheduler.</p><div className="highlight-box">{isSent ? 'SMTP accepted this message.' : email.status === 'failed' ? 'SMTP delivery failed; see the sent list for details.' : 'This email is waiting in the delivery queue.'}</div><p className="message-muted">Recipient: {email.email}</p></div></article></section>; }
