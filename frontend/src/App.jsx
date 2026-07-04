import { useEffect, useMemo, useState } from 'react'
import ElectionMap from './ElectionMap.jsx'
import MakePlan from './MakePlan.jsx'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001'

const raceKey = (election, contest) => `${election.id ?? election.name}::${contest.office}`

function loadReviewed(electionIds) {
  const out = new Set()
  for (const id of electionIds) {
    try {
      const stored = JSON.parse(localStorage.getItem(`votescout-reviewed-${id}`) ?? '[]')
      for (const office of stored) out.add(`${id}::${office}`)
    } catch {
      // corrupted entry — ignore
    }
  }
  return out
}

function persistReviewed(electionId, office) {
  const storageKey = `votescout-reviewed-${electionId}`
  try {
    const stored = new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]'))
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

function DaysBadge({ date }) {
  const days = daysUntil(date)
  if (days < 0) return <span className="badge badge-past">Past</span>
  if (days === 0) return <span className="badge badge-today">Today!</span>
  return (
    <span className="badge badge-upcoming">
      {days} day{days === 1 ? '' : 's'} left
    </span>
  )
}

function ElectionCard({ election, briefings, reviewed, onReview, onRetry }) {
  return (
    <article className="card">
      <div className="card-header">
        <div>
          {election.type && <span className="card-type">{election.type}</span>}
          <h2>{election.name}</h2>
          <p className="card-date">{formatDate(election.date)}</p>
        </div>
        <DaysBadge date={election.date} />
      </div>

      <LocationSection title="Polling locations" locations={election.pollingLocations} />
      <LocationSection title="Early voting" locations={election.earlyVoteSites} />
      <LocationSection title="Ballot drop-off" locations={election.dropOffLocations} />

      {election.contests?.length > 0 && (
        <div className="card-section">
          <h3>On the ballot</h3>
          {election.contests.map((contest) => {
            const key = raceKey(election, contest)
            return (
              <div className="contest" key={contest.office}>
                <strong>
                  {contest.office}
                  {reviewed.has(key) && (
                    <span className="reviewed-check" title="Briefing reviewed">✓</span>
                  )}
                </strong>
                {contest.subtitle && <p className="contest-subtitle">{contest.subtitle}</p>}
                <ul>
                  {contest.candidates.map((c) => (
                    <li key={c.name}>
                      {c.candidateUrl ? (
                        <a href={c.candidateUrl} target="_blank" rel="noopener noreferrer">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                      {c.party && <span className={`party party-${c.party.toLowerCase()}`}>{c.party}</span>}
                    </li>
                  ))}
                </ul>
                <RaceBriefing
                  briefing={briefings[key]}
                  onOpen={() => onReview(election, contest)}
                  onRetry={() => onRetry(election, contest)}
                />
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

function RaceBriefing({ briefing, onOpen, onRetry }) {
  const [open, setOpen] = useState(false)
  const status = briefing?.status ?? 'loading'

  function toggle() {
    const opening = !open
    setOpen(opening)
    if (opening && status === 'ready') onOpen()
  }

  // If the panel is open while the briefing arrives, count it as reviewed.
  useEffect(() => {
    if (open && status === 'ready') onOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status])

  return (
    <div className="briefing">
      <button type="button" className="briefing-toggle" onClick={toggle} aria-expanded={open}>
        <span className={`briefing-chevron${open ? ' open' : ''}`}>▸</span>
        AI Race Briefing
        {status === 'loading' && <span className="briefing-spinner" aria-hidden="true" />}
      </button>
      {open && (
        <div className="briefing-panel">
          <p className="briefing-disclaimer">
            AI-generated summary — verify with official sources.
          </p>
          {status === 'loading' && (
            <div className="skeleton-block" role="status" aria-label="Generating your briefing">
              <p className="briefing-loading">Generating your briefing…</p>
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          )}
          {status === 'error' && (
            <div>
              <p className="briefing-error">Couldn't generate this briefing.</p>
              <button type="button" className="briefing-retry" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}
          {status === 'ready' && <div className="briefing-text">{briefing.summary}</div>}
        </div>
      )}
    </div>
  )
}

function ReadinessBar({ total, reviewedCount, onMakePlan, onShare }) {
  const pct = total === 0 ? 0 : Math.round((reviewedCount / total) * 100)
  const done = total > 0 && reviewedCount >= total
  return (
    <div className={`readiness${done ? ' readiness-done' : ''}`}>
      {!done ? (
        <>
          <div className="readiness-head">
            <strong>Feel ready in 5 minutes</strong>
            <span>
              You've reviewed {reviewedCount} of {total} race{total === 1 ? '' : 's'}
            </span>
          </div>
          <div className="readiness-track" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100">
            <div className="readiness-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : (
        <div className="readiness-celebrate">
          <strong>You're ballot-ready ✅</strong>
          <span>You've reviewed every race. Two quick next steps:</span>
          <div className="readiness-actions">
            <button type="button" onClick={onMakePlan}>Make your voting plan</button>
            <button type="button" className="secondary" onClick={onShare}>Share your pledge card</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PledgeBanner({ count, zip }) {
  if (count == null) return null
  return (
    <p className="pledge-banner">
      🗳️ <strong>{count.toLocaleString()}</strong> people in {zip} have made a voting plan on VoteScout.
    </p>
  )
}

function LocationSection({ title, locations }) {
  if (!locations?.length) return null
  return (
    <div className="card-section">
      <h3>{title}</h3>
      <ul className="locations">
        {locations.map((loc, i) => (
          <li key={`${loc.name}-${i}`}>
            <strong>{loc.name}</strong>
            <span>{loc.address}</span>
            {loc.hours && <span className="hours">{loc.hours.split('\n').slice(0, 2).join(' · ')}{loc.hours.includes('\n') ? ' …' : ''}</span>}
          </li>
        ))}
      </ul>
    </div>
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
              [key]: item.error
                ? { status: 'error' }
                : { status: 'ready', summary: item.summary },
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
      setReviewed(loadReviewed(data.elections.map((el) => el.id ?? el.name)))
      setPledgeCount(null)

      // Kick off everything that doesn't need to block the results render.
      for (const el of data.elections) fetchBriefings(el)
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

  return (
    <div className="page">
      <header className="hero">
        <div className="flag-stripe" aria-hidden="true" />
        <h1>
          Vote<span className="accent">Scout</span>
        </h1>
        <p className="tagline">Find your upcoming elections, polling places, and ballot — in seconds.</p>

        <form className="search" onSubmit={handleSubmit}>
          <input
            className="zip-input"
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
            className={`street-input${needsStreet ? ' input-attention' : ''}`}
            type="text"
            placeholder={needsStreet ? 'Street address (required)' : 'Street address (optional)'}
            aria-label="Street address"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching…' : 'Find my elections'}
          </button>
        </form>
        {error && <p className="error">{needsStreet ? error : `Something went wrong: ${error}`}</p>}
      </header>

      <main className="results">
        {elections?.length === 0 && (
          <p className="empty">{emptyMessage ?? 'No upcoming elections found for that address.'}</p>
        )}
        {totalRaces > 0 && (
          <ReadinessBar
            total={totalRaces}
            reviewedCount={reviewedCount}
            onMakePlan={scrollToPlan}
            onShare={scrollToPlan}
          />
        )}
        {elections?.length > 0 && <PledgeBanner count={pledgeCount} zip={searchedZip} />}
        {elections && <ElectionMap elections={elections} address={searchedAddress} />}
        {elections?.map((election) => (
          <ElectionCard
            key={election.id}
            election={election}
            briefings={briefings}
            reviewed={reviewed}
            onReview={markReviewed}
            onRetry={retryBriefing}
          />
        ))}
        {elections?.length > 0 && (
          <MakePlan
            elections={elections}
            address={searchedAddress}
            onPlanComplete={handlePlanComplete}
          />
        )}
      </main>

      <footer className="footer">
        <p>VoteScout is a nonpartisan tool. Always confirm details with your local election office.</p>
      </footer>
    </div>
  )
}
