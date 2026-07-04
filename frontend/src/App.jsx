import { useState } from 'react'
import ElectionMap from './ElectionMap.jsx'
import VotingPlan from './VotingPlan.jsx'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001'

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

function ElectionCard({ election }) {
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
          {election.contests.map((contest) => (
            <div className="contest" key={contest.office}>
              <strong>{contest.office}</strong>
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
              <RaceBriefing contest={contest} />
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function RaceBriefing({ contest }) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function toggle() {
    const opening = !open
    setOpen(opening)
    if (!opening || summary || loading) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/candidate-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          race: contest.office,
          candidates: contest.candidates.map((c) => ({ name: c.name, party: c.party })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? `Server responded ${res.status}`)
      setSummary(data.summary)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="briefing">
      <button type="button" className="briefing-toggle" onClick={toggle} aria-expanded={open}>
        <span className={`briefing-chevron${open ? ' open' : ''}`}>▸</span>
        AI Race Briefing
      </button>
      {open && (
        <div className="briefing-panel">
          <p className="briefing-disclaimer">
            AI-generated summary — verify with official sources.
          </p>
          {loading && <p className="briefing-loading">Generating briefing…</p>}
          {error && <p className="briefing-error">{error}</p>}
          {summary && <div className="briefing-text">{summary}</div>}
        </div>
      )}
    </div>
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
  const [emptyMessage, setEmptyMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [needsStreet, setNeedsStreet] = useState(false)

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
        {elections && <ElectionMap elections={elections} address={searchedAddress} />}
        {elections?.map((election) => (
          <ElectionCard key={election.id} election={election} />
        ))}
        {elections?.length > 0 && <VotingPlan elections={elections} address={searchedAddress} />}
      </main>

      <footer className="footer">
        <p>VoteScout is a nonpartisan tool. Always confirm details with your local election office.</p>
      </footer>
    </div>
  )
}
