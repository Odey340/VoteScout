import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001'

const INTERESTS = [
  'Economy',
  'Education',
  'Healthcare',
  'Environment',
  'Public safety',
  'Housing',
  'Transportation',
  'Immigration',
]

export default function VotingPlan({ elections, address }) {
  const races = elections.flatMap((e) =>
    e.contests.map((c) => ({ election: e.name, office: c.office })),
  )

  const [selectedRaces, setSelectedRaces] = useState(() => new Set())
  const [selectedInterests, setSelectedInterests] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [copied, setCopied] = useState(false)

  function toggleSet(set, value, setter) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  async function buildPlan() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/voting-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          interests: [...selectedInterests],
          selectedRaces: [...selectedRaces],
          elections,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? `Server responded ${res.status}`)
      setPlan(data)
      setCopied(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(plan.email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy failed — select the text and copy manually.')
    }
  }

  function downloadIcs() {
    const blob = new Blob([plan.ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'votescout-election-days.ics'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="plan-card">
      <h2>Build my voting plan</h2>
      <p className="plan-intro">
        Pick the races you care about and your issue interests — we'll draft a personalized
        voting-plan email plus calendar reminders for your election days.
      </p>

      {races.length > 0 && (
        <div className="plan-group">
          <h3>Races you care about</h3>
          <div className="plan-races">
            {races.map((r) => (
              <label key={`${r.election}|${r.office}`} className="plan-race">
                <input
                  type="checkbox"
                  checked={selectedRaces.has(r.office)}
                  onChange={() => toggleSet(selectedRaces, r.office, setSelectedRaces)}
                />
                <span>
                  {r.office}
                  <small>{r.election}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="plan-group">
        <h3>Your issue interests</h3>
        <div className="plan-chips">
          {INTERESTS.map((interest) => (
            <button
              key={interest}
              type="button"
              className={`chip${selectedInterests.has(interest) ? ' chip-on' : ''}`}
              onClick={() => toggleSet(selectedInterests, interest, setSelectedInterests)}
              aria-pressed={selectedInterests.has(interest)}
            >
              {interest}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="plan-build" onClick={buildPlan} disabled={loading}>
        {loading ? 'Building your plan…' : 'Build my voting plan'}
      </button>
      {error && <p className="plan-error">{error}</p>}

      {plan && (
        <div className="modal-backdrop" onClick={() => setPlan(null)}>
          <div
            className="modal"
            role="dialog"
            aria-label="Your voting plan"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Your voting plan</h3>
              <button type="button" className="modal-close" onClick={() => setPlan(null)} aria-label="Close">
                ×
              </button>
            </div>
            <p className="briefing-disclaimer">
              AI-generated summary — verify with official sources.
            </p>
            <pre className="plan-email">{plan.email}</pre>
            <div className="modal-actions">
              <button type="button" onClick={copyEmail}>
                {copied ? 'Copied!' : 'Copy email'}
              </button>
              <button type="button" className="secondary" onClick={downloadIcs}>
                Download calendar (.ics)
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
