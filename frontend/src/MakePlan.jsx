import { useEffect, useMemo, useState } from 'react'

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
}

const TIME_WINDOWS = [
  { key: 'morning', label: 'Morning', range: '7–10 AM', startHour: 7, endHour: 10 },
  { key: 'lunch', label: 'Lunchtime', range: '11 AM–1 PM', startHour: 11, endHour: 13 },
  { key: 'afternoon', label: 'Afternoon', range: '1–4 PM', startHour: 13, endHour: 16 },
  { key: 'evening', label: 'Evening', range: '4–7 PM', startHour: 16, endHour: 19 },
]

const TRAVEL_MODES = [
  { key: 'walk', label: 'Walking', emoji: '🚶', tip: 'Leave a few minutes early — lines are shortest mid-morning.' },
  { key: 'drive', label: 'Driving', emoji: '🚗', tip: 'Scope out parking near your polling place ahead of time.' },
  { key: 'transit', label: 'Transit', emoji: '🚌', tip: 'Check your route and schedule the night before.' },
]

// States broadly categorized as requiring photo ID for most in-person voters.
// Rules change — the checklist always links to the official checker.
const PHOTO_ID_STATES = new Set(['AR', 'GA', 'IN', 'KS', 'MS', 'MO', 'OH', 'TN', 'WI'])

function extractState(...addresses) {
  for (const a of addresses) {
    const m = a && a.match(/,\s*([A-Z]{2})[,\s]+\d{5}/)
    if (m) return m[1]
  }
  return null
}

function isoToLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/** Parse "Sun, Jul 19: 12 pm - 5 pm" lines out of a site's hours string. */
function parseEarlyDates(site, electionYear, todayIso, electionIso) {
  const out = []
  for (const line of (site.hours ?? '').split('\n')) {
    const m = line.match(/^[A-Za-z]{3},\s*([A-Za-z]{3})\s+(\d{1,2}):\s*(.+)$/)
    if (!m || !(m[1] in MONTHS)) continue
    const iso = `${electionYear}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`
    if (iso >= todayIso && iso < electionIso) {
      out.push({ iso, hoursText: m[3].trim() })
    }
  }
  return out
}

function buildDayOptions(elections) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const options = []

  for (const e of elections) {
    const site = e.pollingLocations?.[0] ?? e.earlyVoteSites?.[0] ?? null
    options.push({
      id: `eday|${e.id ?? e.name}`,
      kind: 'Election Day',
      iso: e.date,
      election: e,
      site,
      hoursText: site?.hours?.split('\n')[0] ?? null,
    })

    const year = e.date.slice(0, 4)
    const byDate = new Map()
    for (const s of e.earlyVoteSites ?? []) {
      for (const d of parseEarlyDates(s, year, todayIso, e.date)) {
        if (!byDate.has(d.iso)) {
          byDate.set(d.iso, {
            id: `early|${e.id ?? e.name}|${d.iso}`,
            kind: 'Early voting',
            iso: d.iso,
            election: e,
            site: s,
            hoursText: d.hoursText,
          })
        }
      }
    }
    options.push(...[...byDate.values()].sort((a, b) => a.iso.localeCompare(b.iso)))
  }

  return options
}

// ---------- Artifacts ----------

function icsEscape(s) {
  return String(s).replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n')
}

function buildPlanIcs(plan) {
  const d = plan.iso.replaceAll('-', '')
  const pad = (n) => String(n).padStart(2, '0')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Groma//Make a Plan//EN',
    'BEGIN:VEVENT',
    `UID:groma-plan-${d}@groma.local`,
    `DTSTAMP:${d}T000000Z`,
    `DTSTART:${d}T${pad(plan.window.startHour)}0000`,
    `DTEND:${d}T${pad(plan.window.endHour)}0000`,
    `SUMMARY:${icsEscape(`Vote: ${plan.election.name}`)}`,
  ]
  if (plan.site) {
    lines.push(`LOCATION:${icsEscape([plan.site.name, plan.site.address].filter(Boolean).join(', '))}`)
  }
  lines.push(
    `DESCRIPTION:${icsEscape(
      `${plan.kind} — going ${plan.mode.label.toLowerCase()}.\n` +
        (plan.hoursText ? `Hours: ${plan.hoursText}\n` : '') +
        'Made with Groma. Verify details with your local election office.',
    )}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`Time to vote: ${plan.election.name}`)}`,
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  )
  return lines.join('\r\n') + '\r\n'
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function renderShareImage(plan) {
  const W = 1080
  const H = 1080
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Ink backdrop with a soft gold glow; gold keyline top.
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.3, 80, W * 0.5, H * 0.3, W * 0.9)
  glow.addColorStop(0, '#1c2b42')
  glow.addColorStop(1, '#0b1522')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#c08a2d'
  ctx.fillRect(0, 0, W, 14)

  // The Groma mark: rotated surveying cross with sighting point.
  ctx.save()
  ctx.translate(W / 2, 200)
  ctx.rotate(Math.PI / 4)
  ctx.strokeStyle = '#c08a2d'
  ctx.lineWidth = 10
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, -64)
  ctx.lineTo(0, 64)
  ctx.moveTo(-64, 0)
  ctx.lineTo(64, 0)
  ctx.stroke()
  ctx.restore()
  ctx.beginPath()
  ctx.arc(W / 2, 200, 18, 0, Math.PI * 2)
  ctx.fillStyle = '#0b1522'
  ctx.fill()
  ctx.strokeStyle = '#faf8f5'
  ctx.lineWidth = 6
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#faf8f5'
  ctx.font = '600 88px Fraunces, Georgia, serif'
  ctx.fillText('I have a voting plan', W / 2, 400)

  ctx.font = '600 56px Fraunces, Georgia, serif'
  ctx.fillStyle = '#d9a441'
  ctx.fillText(plan.dateLabel, W / 2, 520)

  ctx.fillStyle = '#faf8f5'
  ctx.font = '44px "Public Sans", "Segoe UI", sans-serif'
  ctx.fillText(`${plan.window.label} (${plan.window.range})`, W / 2, 610)
  ctx.fillText(`${plan.mode.emoji} ${plan.mode.label}`, W / 2, 690)

  // City only — never the full address or site name.
  if (plan.city) {
    ctx.fillStyle = '#a9b2c4'
    ctx.font = '38px "Public Sans", "Segoe UI", sans-serif'
    ctx.fillText(plan.city, W / 2, 780)
  }

  ctx.fillStyle = '#a9b2c4'
  ctx.font = '36px "Public Sans", "Segoe UI", sans-serif'
  ctx.fillText(plan.election.name, W / 2, 868, W - 120)

  ctx.fillStyle = '#c08a2d'
  ctx.font = 'italic 30px Fraunces, Georgia, serif'
  ctx.fillText('Make yours with Groma', W / 2, 988)

  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, 'i-have-a-voting-plan.png')
  }, 'image/png')
}

// ---------- Component ----------

function extractCity(...addresses) {
  // "101 E Franklin St, Richmond, VA, 23219" -> "Richmond, VA"
  for (const a of addresses) {
    const m = a && a.match(/,\s*([^,]+),\s*([A-Z]{2})[,\s]+\d{5}/)
    if (m) return `${m[1].trim()}, ${m[2]}`
  }
  return null
}

export default function MakePlan({ elections, address, onPlanComplete }) {
  const dayOptions = useMemo(() => buildDayOptions(elections), [elections])

  const [modalOpen, setModalOpen] = useState(false)

  // Escape closes the wizard, matching platform modal conventions.
  useEffect(() => {
    if (!modalOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen])
  const [step, setStep] = useState(0)
  const [day, setDay] = useState(null)
  const [windowKey, setWindowKey] = useState(null)
  const [modeKey, setModeKey] = useState(null)
  const [plan, setPlan] = useState(null)

  const inProgress = !plan && (day || windowKey || modeKey)
  const state = extractState(day?.site?.address, address)

  function openModal() {
    setModalOpen(true)
    if (plan) setStep(3)
  }

  function finishPlan() {
    const window = TIME_WINDOWS.find((w) => w.key === windowKey)
    const mode = TRAVEL_MODES.find((m) => m.key === modeKey)
    setPlan({
      ...day,
      dateLabel: isoToLabel(day.iso),
      city: extractCity(day.site?.address, address),
      window,
      mode,
    })
    setStep(3)
    onPlanComplete?.()
  }

  function reset() {
    setPlan(null)
    setDay(null)
    setWindowKey(null)
    setModeKey(null)
    setStep(0)
  }

  const canNext = [day != null, windowKey != null, modeKey != null][step]

  const checklist = plan
    ? [
        PHOTO_ID_STATES.has(state)
          ? {
              text: `Bring photo ID — ${state} requires it for most in-person voters.`,
              href: 'https://www.usa.gov/voter-id',
              linkText: 'Verify ID rules',
            }
          : {
              text: `Bring ID just in case${state ? ` — ${state} rules vary` : ' — rules vary by state'}.`,
              href: 'https://www.usa.gov/voter-id',
              linkText: 'Check ID rules',
            },
        {
          text: 'Confirm your voter registration is current.',
          href: 'https://vote.gov',
          linkText: 'Check at vote.gov',
        },
        { text: plan.mode.tip },
        { text: 'Double-check hours with your local election office before you go.' },
      ]
    : []

  return (
    <section className="card plan-card">
      {inProgress && !modalOpen && (
        <div className="mp-banner">
          <span>You're partway through your voting plan.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={openModal}>
            Resume
          </button>
        </div>
      )}

      {!plan && (
        <>
          <h2>Make a plan to vote</h2>
          <p className="plan-intro">
            Voters who decide <em>when</em> and <em>how</em> they'll vote are far more likely to
            follow through. Three quick questions and you'll have a concrete plan.
          </p>
          <button type="button" className="btn btn-primary" onClick={openModal}>
            Make my voting plan
          </button>
        </>
      )}

      {plan && !modalOpen && <PlanResult plan={plan} checklist={checklist} onEdit={reset} />}

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label="Make my voting plan"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                {step < 3 ? `Step ${step + 1} of 3` : 'Your voting plan'}
              </h3>
              <button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            {step < 3 && (
              <div className="mp-progress" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`mp-dot${i <= step ? ' on' : ''}`} />
                ))}
              </div>
            )}

            {step === 0 && (
              <div className="mp-step">
                <h4>Which day will you vote?</h4>
                <div className="mp-days">
                  {dayOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`mp-daycard${day?.id === opt.id ? ' selected' : ''}`}
                      onClick={() => setDay(opt)}
                    >
                      <span className={`mp-kind${opt.kind === 'Election Day' ? ' mp-kind-eday' : ''}`}>
                        {opt.kind}
                      </span>
                      <strong>{isoToLabel(opt.iso)}</strong>
                      {opt.site?.name && <small>{opt.site.name}</small>}
                      {opt.hoursText && <small className="mp-hours">{opt.hoursText}</small>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="mp-step">
                <h4>What time of day works best?</h4>
                <div className="plan-chips">
                  {TIME_WINDOWS.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      className={`chip chip-big${windowKey === w.key ? ' chip-on' : ''}`}
                      onClick={() => setWindowKey(w.key)}
                      aria-pressed={windowKey === w.key}
                    >
                      {w.label}
                      <small>{w.range}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mp-step">
                <h4>How are you getting there?</h4>
                <div className="plan-chips">
                  {TRAVEL_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`chip chip-big${modeKey === m.key ? ' chip-on' : ''}`}
                      onClick={() => setModeKey(m.key)}
                      aria-pressed={modeKey === m.key}
                    >
                      {m.emoji} {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && plan && (
              <PlanResult plan={plan} checklist={checklist} onEdit={reset} inModal />
            )}

            {step < 3 && (
              <div className="modal-actions mp-nav">
                {step > 0 ? (
                  <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)}>
                    Back
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canNext}
                  onClick={() => (step === 2 ? finishPlan() : setStep(step + 1))}
                >
                  {step === 2 ? 'Create my plan' : 'Next'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function PlanResult({ plan, checklist, onEdit, inModal }) {
  const [copied, setCopied] = useState(null)

  async function copyText(label, text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // clipboard blocked — user can screenshot instead
    }
  }

  const pledgeText =
    `I have a voting plan 🗳️ ${plan.election.name} — ${plan.dateLabel}, ` +
    `${plan.window.label.toLowerCase()}${plan.city ? `, ${plan.city}` : ''}. ` +
    `Make yours in 2 minutes with Groma.`

  const inviteText =
    `I just made my voting plan for ${plan.election.name} — takes 2 minutes: ${window.location.origin}`

  return (
    <div className={inModal ? 'mp-result' : ''}>
      <div className="mp-plan-head">
        <span className="mp-plan-emoji" aria-hidden="true">🗳️</span>
        <div>
          <h4 className="mp-plan-title">You're voting {plan.dateLabel}</h4>
          <p className="mp-plan-sub">
            {plan.kind} · {plan.window.label} ({plan.window.range}) · {plan.mode.emoji}{' '}
            {plan.mode.label}
          </p>
        </div>
      </div>

      {plan.site && (
        <div className="mp-where">
          <strong>{plan.site.name}</strong>
          {plan.site.address && <span>{plan.site.address}</span>}
          {plan.site.hours && (
            <span className="mp-hours">
              {plan.site.hours.split('\n').slice(0, 2).join(' · ')}
              {plan.site.hours.includes('\n') ? ' …' : ''}
            </span>
          )}
        </div>
      )}

      <ul className="mp-checklist">
        {checklist.map((item, i) => (
          <li key={i}>
            {item.text}{' '}
            {item.href && (
              <a href={item.href} target="_blank" rel="noopener noreferrer">
                {item.linkText}
              </a>
            )}
          </li>
        ))}
      </ul>

      <div className="modal-actions mp-artifacts">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            downloadBlob(new Blob([buildPlanIcs(plan)], { type: 'text/calendar' }), 'my-voting-plan.ics')
          }
        >
          Add to calendar
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => renderShareImage(plan)}>
          Download pledge card 🗳️
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => copyText('pledge', pledgeText)}>
          {copied === 'pledge' ? 'Copied!' : 'Copy pledge text'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onEdit}>
          Start over
        </button>
      </div>

      <div className="mp-invite">
        <button type="button" className="btn btn-secondary" onClick={() => copyText('invite', inviteText)}>
          {copied === 'invite' ? 'Copied! Send it to a friend' : 'Invite friends to make a plan'}
        </button>
        <p className="mp-note">
          People who plan to vote with friends are more likely to follow through.
        </p>
      </div>

      <p className="mp-note">
        Your plan lives on this page only — download the calendar file or pledge card to keep it.
      </p>
    </div>
  )
}
