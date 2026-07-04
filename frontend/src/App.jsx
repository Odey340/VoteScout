import { useEffect, useMemo, useState } from 'react'
import CandidateAvatar from './CandidateAvatar.jsx'
import ElectionMap from './ElectionMap.jsx'
import GromaMark from './GromaMark.jsx'
import MakePlan from './MakePlan.jsx'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001'

const raceKey = (election, contest) => `${election.id ?? election.name}::${contest.office}`

function loadReviewed(electionIds) {
  const out = new Set()
  for (const id of electionIds) {
    // Read groma-* plus legacy votescout-* keys so pre-rename progress survives.
    for (const prefix of ['groma', 'votescout']) {
      try {
        const stored = JSON.parse(localStorage.getItem(`${prefix}-reviewed-${id}`) ?? '[]')
        for (const office of stored) out.add(`${id}::${office}`)
      } catch {
        // corrupted entry — ignore
      }
    }
  }
  return out
}

function persistReviewed(electionId, office) {
  const storageKey = `groma-reviewed-${electionId}`
  try {
    const stored = new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]'))
    // Migrate any legacy progress into the new key while we're here.
    for (const legacy of JSON.parse(
      localStorage.getItem(`votescout-reviewed-${electionId}`) ?? '[]',
    )) {
      stored.add(legacy)
    }
    stored.add(office)
    localStorage.setItem(storageKey, JSON.stringify([...stored]))
  } catch {
    // storage unavailable (private mode) — progress just won't persist
  }
}

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    try {
      localStorage.setItem('groma-theme', next ? 'dark' : 'light')
    } catch {
      // fine — theme just won't persist
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  )
}

function Countdown({ date }) {
  const days = daysUntil(date)
  if (days < 0)
    return (
      <div className="countdown">
        <strong>—</strong>
        <span>Past</span>
      </div>
    )
  if (days === 0)
    return (
      <div className="countdown">
        <strong>Today</strong>
        <span>Vote now</span>
      </div>
    )
  return (
    <div className="countdown">
      <strong>{days}</strong>
      <span>day{days === 1 ? '' : 's'} left</span>
    </div>
  )
}

/** Official-notice masthead with the readiness bar integrated. */
function Masthead({ election, total, reviewedCount, onMakePlan }) {
  const pct = total === 0 ? 0 : Math.round((reviewedCount / total) * 100)
  const done = total > 0 && reviewedCount >= total
  return (
    <div className="masthead">
      <p className="masthead-notice">Official election information · {formatDate(election.date)}</p>
      <div className="masthead-row">
        <div>
          <h2>{election.name}</h2>
          <p className="masthead-date">
            Polls and deadlines vary by locality — confirm with your election office.
          </p>
        </div>
        <Countdown date={election.date} />
      </div>

      {total > 0 && (
        <div className="readiness">
          {!done ? (
            <>
              <div className="readiness-head">
                <strong>Ballot readiness</strong>
                <span>
                  {reviewedCount} of {total} race{total === 1 ? '' : 's'} reviewed
                </span>
              </div>
              <div
                className="readiness-track"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <div className="readiness-fill" style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : (
            <div className="readiness-celebrate">
              <strong>✓ You're ballot-ready</strong>
              <div className="readiness-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={onMakePlan}>
                  Make your voting plan
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Collapsible({ label, loading, children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="collapse-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={`collapse-chevron${open ? ' open' : ''}`}>▶</span>
        {label}
        {loading && <span className="spinner" aria-hidden="true" />}
      </button>
      <div className={`collapse-body${open ? ' open' : ''}`}>
        <div>{typeof children === 'function' ? children(open) : children}</div>
      </div>
    </>
  )
}

function OfficeContext({ officeCtx, onRetry }) {
  const status = officeCtx?.status ?? 'loading'
  const asOf = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="office-ctx">
      <Collapsible label="About this seat" loading={status === 'loading'}>
        <div className="panel">
          <p className="panel-disclaimer">
            AI-generated context · as of {asOf} — verify with official sources.
          </p>
          {status === 'loading' && (
            <div role="status" aria-label="Generating office context">
              <p className="panel-loading">Researching this office…</p>
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          )}
          {status === 'error' && (
            <div>
              <p className="panel-error">Couldn't generate office context.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}
          {status === 'ready' && (
            <>
              <div className="panel-text">{officeCtx.context}</div>
              {officeCtx.sources?.length > 0 && (
                <p className="office-sources">
                  Sources:{' '}
                  {officeCtx.sources.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && ' · '}
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.label}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </div>
      </Collapsible>
    </div>
  )
}

function RaceBriefing({ briefing, onOpen, onRetry }) {
  const [open, setOpen] = useState(false)
  const status = briefing?.status ?? 'loading'

  // Reviewed when the panel is open and the content is there to read.
  useEffect(() => {
    if (open && status === 'ready') onOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status])

  return (
    <div className="briefing">
      <button
        type="button"
        className="collapse-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={`collapse-chevron${open ? ' open' : ''}`}>▶</span>
        Candidate briefing
        {status === 'loading' && <span className="spinner" aria-hidden="true" />}
      </button>
      <div className={`collapse-body${open ? ' open' : ''}`}>
        <div>
          <div className="panel">
            <p className="panel-disclaimer">AI-generated summary — verify with official sources.</p>
            {status === 'loading' && (
              <div role="status" aria-label="Generating your briefing">
                <p className="panel-loading">Generating your briefing…</p>
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
              </div>
            )}
            {status === 'error' && (
              <div>
                <p className="panel-error">Couldn't generate this briefing.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                  Retry
                </button>
              </div>
            )}
            {status === 'ready' && <div className="panel-text">{briefing.summary}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function RaceCard({
  election,
  contest,
  briefing,
  officeCtx,
  isReviewed,
  onReview,
  onRetry,
  onRetryOffice,
  showElectionTag,
}) {
  return (
    <article className="card race-card">
      {showElectionTag && <div className="race-election-tag">{election.name}</div>}
      <h3>
        {contest.office}
        {isReviewed && <span className="reviewed-check" title="Briefing reviewed">✓</span>}
      </h3>
      {contest.subtitle && <p className="contest-subtitle">{contest.subtitle}</p>}

      <OfficeContext officeCtx={officeCtx} onRetry={onRetryOffice} />

      <ul className="candidates">
        {contest.candidates.map((c) => (
          <li key={c.name}>
            <CandidateAvatar candidate={c} context={`${contest.office} ${election.name}`} />
            <span className="candidate-meta">
              <span className="candidate-name">
                {c.candidateUrl ? (
                  <a href={c.candidateUrl} target="_blank" rel="noopener noreferrer">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </span>
              {c.party && (
                <span className={`party party-${c.party.toLowerCase()}`}>{c.party}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <RaceBriefing briefing={briefing} onOpen={onReview} onRetry={onRetry} />
    </article>
  )
}

function PledgeBanner({ count, zip }) {
  if (count == null) return null
  return (
    <p className="pledge-banner">
      🗳️ <strong>{count.toLocaleString()}</strong> people in {zip} have made a voting plan on Groma.
    </p>
  )
}

function LocationSection({ title, locations }) {
  if (!locations?.length) return null
  return (
    <div className="card side-card">
      <h3>{title}</h3>
      <ul className="locations">
        {locations.map((loc, i) => (
          <li key={`${loc.name}-${i}`}>
            <strong>{loc.name}</strong>
            <span>{loc.address}</span>
            {loc.hours && (
              <span className="hours">
                {loc.hours.split('\n').slice(0, 2).join(' · ')}
                {loc.hours.includes('\n') ? ' …' : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Custom empty state: the groma finds no elections on the horizon. */
function EmptyState({ message }) {
  return (
    <div className="empty">
      <svg width="120" height="90" viewBox="0 0 120 90" fill="none" aria-hidden="true">
        <line x1="10" y1="78" x2="110" y2="78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="60" y1="78" x2="60" y2="30" stroke="currentColor" strokeWidth="2.5" />
        <g transform="rotate(45 60 22)">
          <line x1="60" y1="8" x2="60" y2="36" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="46" y1="22" x2="74" y2="22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <circle cx="60" cy="22" r="4" fill="currentColor" />
        <circle cx="26" cy="70" r="1.6" fill="currentColor" />
        <circle cx="90" cy="72" r="1.6" fill="currentColor" />
        <circle cx="100" cy="64" r="1.6" fill="currentColor" />
      </svg>
      <h3>Nothing on the horizon here</h3>
      <p>{message ?? 'No upcoming elections found for that address.'}</p>
      <p>
        Election data comes from official sources and covers supported upcoming elections — your
        local election office always has the fullest picture.
      </p>
    </div>
  )
}

function HowItWorks() {
  const steps = [
    {
      title: 'Look up your ballot',
      body: 'Enter your address and we pull your exact elections, races, and polling places from official election data.',
    },
    {
      title: 'Get briefed on every race',
      body: 'Clearly-labeled AI summaries explain each office and introduce every candidate evenhandedly — never who to pick.',
    },
    {
      title: 'Make a plan to vote',
      body: 'Choose your day, time, and route. Get a calendar reminder and a checklist so nothing surprises you.',
    },
  ]
  return (
    <section className="how">
      <h2>How Groma works</h2>
      <div className="how-steps">
        {steps.map((s, i) => (
          <div className="how-step" key={s.title}>
            <div className="how-num">{i + 1}</div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <div className="footer-brand">
            <GromaMark size={22} className="mark" />
            <span>Groma</span>
          </div>
          <p>
            Groma is a nonpartisan tool that helps you understand your ballot and make a plan to
            vote. Named for the Roman surveying instrument used to map and lay out cities — Groma
            maps your civic landscape.
          </p>
        </div>
        <div>
          <h4>Data sources</h4>
          <ul>
            <li><a href="https://developers.google.com/civic-information" target="_blank" rel="noopener noreferrer">Google Civic Information API</a></li>
            <li><a href="https://en.wikipedia.org" target="_blank" rel="noopener noreferrer">Wikipedia</a></li>
            <li>AI summaries: Claude (clearly labeled)</li>
          </ul>
        </div>
        <div>
          <h4>Official resources</h4>
          <ul>
            <li><a href="https://vote.gov" target="_blank" rel="noopener noreferrer">Register to vote — vote.gov</a></li>
            <li><a href="https://www.usa.gov/election-office" target="_blank" rel="noopener noreferrer">Find your election office</a></li>
            <li><a href="https://www.usa.gov/voter-id" target="_blank" rel="noopener noreferrer">Voter ID requirements</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-legal">
        Groma is not affiliated with any government agency, party, or campaign. AI-generated
        content is clearly labeled and can contain mistakes — always confirm details with your
        local election office.
      </div>
    </footer>
  )
}

export default function App() {
  const [zip, setZip] = useState('')
  const [street, setStreet] = useState('')
  const [elections, setElections] = useState(null)
  const [searchedAddress, setSearchedAddress] = useState('')
  const [searchedZip, setSearchedZip] = useState('')
  const [emptyMessage, setEmptyMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [needsStreet, setNeedsStreet] = useState(false)
  const [briefings, setBriefings] = useState({})
  const [officeCtxs, setOfficeCtxs] = useState({})
  const [reviewed, setReviewed] = useState(() => new Set())
  const [pledgeCount, setPledgeCount] = useState(null)

  const totalRaces = useMemo(
    () => (elections ?? []).reduce((n, e) => n + (e.contests?.length ?? 0), 0),
    [elections],
  )
  const reviewedCount = useMemo(() => {
    if (!elections) return 0
    let n = 0
    for (const e of elections) {
      for (const c of e.contests ?? []) {
        if (reviewed.has(raceKey(e, c))) n++
      }
    }
    return n
  }, [elections, reviewed])

  /** Stream batch briefings for one election; each NDJSON line fills a card. */
  async function fetchBriefings(election, onlyOffices = null) {
    const contests = (election.contests ?? []).filter(
      (c) => !onlyOffices || onlyOffices.includes(c.office),
    )
    if (!contests.length) return

    setBriefings((prev) => {
      const next = { ...prev }
      for (const c of contests) next[raceKey(election, c)] = { status: 'loading' }
      return next
    })

    const markErrored = () =>
      setBriefings((prev) => {
        const next = { ...prev }
        for (const c of contests) {
          if (next[raceKey(election, c)]?.status === 'loading') {
            next[raceKey(election, c)] = { status: 'error' }
          }
        }
        return next
      })

    try {
      const res = await fetch(`${API_BASE}/api/briefings/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          electionId: election.id ?? election.name,
          races: contests.map((c) => ({
            race: c.office,
            candidates: c.candidates.map((cand) => ({ name: cand.name, party: cand.party })),
          })),
        }),
      })
      if (!res.ok || !res.body) {
        markErrored()
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const item = JSON.parse(line)
            const key = `${election.id ?? election.name}::${item.race}`
            setBriefings((prev) => ({
              ...prev,
              [key]: item.error ? { status: 'error' } : { status: 'ready', summary: item.summary },
            }))
          } catch {
            // skip malformed line
          }
        }
      }
      markErrored() // anything still loading when the stream closed failed server-side
    } catch {
      markErrored()
    }
  }

  /** Fetch office context for one contest; independent per race like briefings. */
  async function fetchOfficeContext(election, contest, address) {
    const key = raceKey(election, contest)
    setOfficeCtxs((prev) => ({ ...prev, [key]: { status: 'loading' } }))

    const stateMatch = (address ?? '').match(/,\s*([A-Z]{2})[,\s]+\d{5}/) ?? []
    const params = new URLSearchParams({
      office: contest.office,
      state: stateMatch[1] ?? '',
      candidates: contest.candidates.map((c) => c.name).join(', '),
    })
    // Civic API marks incumbency on candidates when it knows it.
    const incumbent = contest.candidates.find((c) => c.incumbent)
    if (incumbent) params.set('incumbent_hint', incumbent.name)

    try {
      const res = await fetch(`${API_BASE}/api/office-context?${params}`)
      const data = await res.json()
      setOfficeCtxs((prev) => ({
        ...prev,
        [key]: res.ok
          ? { status: 'ready', context: data.context, sources: data.sources }
          : { status: 'error' },
      }))
    } catch {
      setOfficeCtxs((prev) => ({ ...prev, [key]: { status: 'error' } }))
    }
  }

  function markReviewed(election, contest) {
    const key = raceKey(election, contest)
    if (reviewed.has(key)) return
    setReviewed((prev) => new Set(prev).add(key))
    persistReviewed(election.id ?? election.name, contest.office)
  }

  function retryBriefing(election, contest) {
    fetchBriefings(election, [contest.office])
  }

  async function handlePlanComplete() {
    if (!searchedZip) return
    try {
      const res = await fetch(`${API_BASE}/api/pledges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip: searchedZip }),
      })
      const data = await res.json()
      if (res.ok) setPledgeCount(data.count)
    } catch {
      // counter is decorative; never block the plan on it
    }
  }

  function scrollToPlan() {
    document.querySelector('.plan-card')?.scrollIntoView({ behavior: 'smooth' })
  }

  function scrollToMap() {
    document.querySelector('.map-card')?.scrollIntoView({ behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!zip.trim()) return
    setLoading(true)
    setError(null)
    setNeedsStreet(false)
    setEmptyMessage(null)
    try {
      const address = [street.trim(), zip.trim()].filter(Boolean).join(', ')
      const res = await fetch(`${API_BASE}/api/elections?address=${encodeURIComponent(address)}`)
      const data = await res.json()
      if (!res.ok) {
        if (data?.error?.code === 'ADDRESS_TOO_VAGUE') {
          setNeedsStreet(true)
          setError(data.error.message)
        } else {
          setError(data?.error?.message ?? `Server responded ${res.status}`)
        }
        setElections(null)
        return
      }
      setElections(data.elections)
      setSearchedAddress(address)
      setEmptyMessage(data.message)

      const zip5 = (zip.match(/\d{5}/) ?? [''])[0]
      setSearchedZip(zip5)
      setBriefings({})
      setOfficeCtxs({})
      setReviewed(loadReviewed(data.elections.map((el) => el.id ?? el.name)))
      setPledgeCount(null)

      // Kick off everything that doesn't need to block the results render.
      for (const el of data.elections) {
        fetchBriefings(el)
        for (const contest of el.contests ?? []) fetchOfficeContext(el, contest, address)
      }
      if (zip5) {
        fetch(`${API_BASE}/api/pledges?zip=${zip5}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setPledgeCount(d.count))
          .catch(() => {})
      }
    } catch (err) {
      setError(err.message)
      setElections(null)
    } finally {
      setLoading(false)
    }
  }

  const hasResults = elections != null
  const multipleElections = (elections?.length ?? 0) > 1

  return (
    <div className={`page${hasResults ? ' has-results' : ''}`}>
      <ThemeToggle />

      <header className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-inner">
          <div className="brand">
            <GromaMark size={30} className="mark" />
            <span className="brand-name">Groma</span>
          </div>

          <h1 className="hero-headline">
            Know your ballot in <em>five minutes</em>
          </h1>
          <p className="tagline">
            Your elections, your polling place, and every race explained — clearly, evenhandedly,
            and free.
          </p>

          <form className="search" onSubmit={handleSubmit}>
            <input
              className="input zip-input"
              type="text"
              inputMode="numeric"
              pattern="\d{5}(-\d{4})?"
              placeholder="ZIP code"
              aria-label="ZIP code"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              required
            />
            <input
              className={`input street-input${needsStreet ? ' input-error' : ''}`}
              type="text"
              placeholder={needsStreet ? 'Street address (required)' : 'Street address (optional)'}
              aria-label="Street address"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Searching…' : 'Find my ballot'}
            </button>
          </form>
          {error && <p className="error">{needsStreet ? error : `Something went wrong: ${error}`}</p>}

          <div className="trust-row">
            <span><span className="dot">●</span> Official election data</span>
            <span><span className="dot">●</span> AI summaries clearly labeled</span>
            <span><span className="dot">●</span> Nonpartisan &amp; free</span>
          </div>
        </div>
        {!hasResults && <p className="hero-scroll">How it works ↓</p>}
      </header>

      {!hasResults && <HowItWorks />}

      {hasResults && (
        <main className="results">
          {elections.length === 0 ? (
            <>
              <EmptyState message={emptyMessage} />
              <ElectionMap elections={elections} address={searchedAddress} />
            </>
          ) : (
            <>
              {elections.map((election) => (
                <Masthead
                  key={`m-${election.id ?? election.name}`}
                  election={election}
                  total={totalRaces}
                  reviewedCount={reviewedCount}
                  onMakePlan={scrollToPlan}
                />
              ))}
              <PledgeBanner count={pledgeCount} zip={searchedZip} />

              <div className="results-grid">
                <div className="results-main">
                  {totalRaces > 0 && <p className="races-title">On your ballot</p>}
                  {elections.flatMap((election) =>
                    (election.contests ?? []).map((contest) => (
                      <RaceCard
                        key={raceKey(election, contest)}
                        election={election}
                        contest={contest}
                        briefing={briefings[raceKey(election, contest)]}
                        officeCtx={officeCtxs[raceKey(election, contest)]}
                        isReviewed={reviewed.has(raceKey(election, contest))}
                        onReview={() => markReviewed(election, contest)}
                        onRetry={() => retryBriefing(election, contest)}
                        onRetryOffice={() => fetchOfficeContext(election, contest, searchedAddress)}
                        showElectionTag={multipleElections}
                      />
                    )),
                  )}

                  <MakePlan
                    elections={elections}
                    address={searchedAddress}
                    onPlanComplete={handlePlanComplete}
                  />
                </div>

                <aside className="results-side">
                  <ElectionMap elections={elections} address={searchedAddress} />
                  {elections.map((election) => (
                    <div key={`side-${election.id ?? election.name}`} style={{ display: 'contents' }}>
                      <LocationSection title="Polling locations" locations={election.pollingLocations} />
                      <LocationSection title="Early voting" locations={election.earlyVoteSites} />
                      <LocationSection title="Ballot drop-off" locations={election.dropOffLocations} />
                    </div>
                  ))}
                </aside>
              </div>

              <div className="mobile-bar">
                <button type="button" className="btn btn-secondary" onClick={scrollToMap}>
                  Where to vote
                </button>
                <button type="button" className="btn btn-primary" onClick={scrollToPlan}>
                  Make a plan
                </button>
              </div>
            </>
          )}
        </main>
      )}

      <Footer />
    </div>
  )
}
