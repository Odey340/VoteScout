import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { DATE_LOCALES } from './i18n.js'

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
}

// labelKey/tipKey resolve through i18n at render time; ranges/hours are data.
const TIME_WINDOWS = [
  { key: 'morning', labelKey: 'plan.morning', range: '7–10 AM', startHour: 7, endHour: 10 },
  { key: 'lunch', labelKey: 'plan.lunch', range: '11 AM–1 PM', startHour: 11, endHour: 13 },
  { key: 'afternoon', labelKey: 'plan.afternoon', range: '1–4 PM', startHour: 13, endHour: 16 },
  { key: 'evening', labelKey: 'plan.evening', range: '4–7 PM', startHour: 16, endHour: 19 },
]

const TRAVEL_MODES = [
  { key: 'walk', labelKey: 'plan.walking', emoji: '🚶', tipKey: 'plan.tipWalk' },
  { key: 'drive', labelKey: 'plan.driving', emoji: '🚗', tipKey: 'plan.tipDrive' },
  { key: 'transit', labelKey: 'plan.transit', emoji: '🚌', tipKey: 'plan.tipTransit' },
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

function isoToLabel(iso, locale = 'en-US') {
  return new Date(iso + 'T00:00:00').toLocaleDateString(locale, {
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
      kindKey: 'plan.electionDay',
      isEday: true,
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
            kindKey: 'plan.earlyVoting',
            isEday: false,
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
      `${plan.kindLabel} — ${plan.modeLabel}.\n` +
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

function renderShareImage(plan, labels) {
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
  // CJK needs a system font fallback; Fraunces covers Latin + Vietnamese.
  ctx.font = '600 80px Fraunces, Georgia, "Microsoft YaHei", serif'
  ctx.fillText(labels.title, W / 2, 400, W - 100)

  ctx.font = '600 56px Fraunces, Georgia, "Microsoft YaHei", serif'
  ctx.fillStyle = '#d9a441'
  ctx.fillText(plan.dateLabel, W / 2, 520, W - 100)

  ctx.fillStyle = '#faf8f5'
  ctx.font = '44px "Public Sans", "Segoe UI", "Microsoft YaHei", sans-serif'
  ctx.fillText(`${plan.windowLabel} (${plan.window.range})`, W / 2, 610)
  ctx.fillText(`${plan.mode.emoji} ${plan.modeLabel}`, W / 2, 690)

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
  ctx.font = 'italic 30px Fraunces, Georgia, "Microsoft YaHei", serif'
  ctx.fillText(labels.footer, W / 2, 988)

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
  const { t, i18n } = useTranslation()
  const dateLocale = DATE_LOCALES[i18n.resolvedLanguage] ?? 'en-US'
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
      dateLabel: isoToLabel(day.iso, dateLocale),
      city: extractCity(day.site?.address, address),
      window,
      mode,
      // Resolved labels frozen at creation time for artifacts (ICS, image).
      kindLabel: t(day.kindKey),
      windowLabel: t(window.labelKey),
      modeLabel: t(mode.labelKey),
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
              text: t('plan.photoIDRequired', { state }),
              href: 'https://www.usa.gov/voter-id',
              linkText: t('plan.verifyIDLink'),
            }
          : {
              text: state ? t('plan.checkID', { state }) : t('plan.checkIDNoState'),
              href: 'https://www.usa.gov/voter-id',
              linkText: t('plan.checkIDLink'),
            },
        {
          text: t('plan.checkRegistration'),
          href: 'https://vote.gov',
          linkText: t('plan.registrationLink'),
        },
        { text: t(plan.mode.tipKey) },
        { text: t('plan.doubleCheck') },
      ]
    : []

  return (
    <section className="card plan-card">
      {inProgress && !modalOpen && (
        <div className="mp-banner">
          <span>{t('plan.inProgress')}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={openModal}>
            {t('plan.resume')}
          </button>
        </div>
      )}

      {!plan && (
        <>
          <h2>{t('plan.title')}</h2>
          <p className="plan-intro">
            <Trans i18nKey="plan.intro" components={{ em: <em /> }} />
          </p>
          <button type="button" className="btn btn-primary" onClick={openModal}>
            {t('plan.cta')}
          </button>
        </>
      )}

      {plan && !modalOpen && <PlanResult plan={plan} checklist={checklist} onEdit={reset} />}

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label={t('plan.cta')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{step < 3 ? t('plan.stepOf', { n: step + 1 }) : t('plan.yourPlan')}</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setModalOpen(false)}
                aria-label={t('plan.close')}
              >
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
                <h4>{t('plan.whichDay')}</h4>
                <div className="mp-days">
                  {dayOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`mp-daycard${day?.id === opt.id ? ' selected' : ''}`}
                      onClick={() => setDay(opt)}
                    >
                      <span className={`mp-kind${opt.isEday ? ' mp-kind-eday' : ''}`}>
                        {t(opt.kindKey)}
                      </span>
                      <strong>{isoToLabel(opt.iso, dateLocale)}</strong>
                      {opt.site?.name && <small>{opt.site.name}</small>}
                      {opt.hoursText && <small className="mp-hours">{opt.hoursText}</small>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="mp-step">
                <h4>{t('plan.whatTime')}</h4>
                <div className="plan-chips">
                  {TIME_WINDOWS.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      className={`chip chip-big${windowKey === w.key ? ' chip-on' : ''}`}
                      onClick={() => setWindowKey(w.key)}
                      aria-pressed={windowKey === w.key}
                    >
                      {t(w.labelKey)}
                      <small>{w.range}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mp-step">
                <h4>{t('plan.howGetting')}</h4>
                <div className="plan-chips">
                  {TRAVEL_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`chip chip-big${modeKey === m.key ? ' chip-on' : ''}`}
                      onClick={() => setModeKey(m.key)}
                      aria-pressed={modeKey === m.key}
                    >
                      {m.emoji} {t(m.labelKey)}
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
                    {t('plan.back')}
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
                  {step === 2 ? t('plan.create') : t('plan.next')}
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
  const { t } = useTranslation()
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

  const pledgeText = t('plan.pledgeText', {
    election: plan.election.name,
    date: plan.dateLabel,
    window: plan.windowLabel.toLowerCase(),
    city: plan.city ? `, ${plan.city}` : '',
  })

  const inviteText = t('plan.inviteText', {
    election: plan.election.name,
    url: window.location.origin,
  })

  return (
    <div className={inModal ? 'mp-result' : ''}>
      <div className="mp-plan-head">
        <span className="mp-plan-emoji" aria-hidden="true">🗳️</span>
        <div>
          <h4 className="mp-plan-title">{t('plan.youreVoting', { date: plan.dateLabel })}</h4>
          <p className="mp-plan-sub">
            {plan.kindLabel} · {plan.windowLabel} ({plan.window.range}) · {plan.mode.emoji}{' '}
            {plan.modeLabel}
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
          {t('plan.addToCalendar')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            renderShareImage(plan, {
              title: t('plan.pledgeCardTitle'),
              footer: t('plan.pledgeCardFooter'),
            })
          }
        >
          {t('plan.downloadPledge')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => copyText('pledge', pledgeText)}>
          {copied === 'pledge' ? t('plan.copied') : t('plan.copyPledge')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onEdit}>
          {t('plan.startOver')}
        </button>
      </div>

      <div className="mp-invite">
        <button type="button" className="btn btn-secondary" onClick={() => copyText('invite', inviteText)}>
          {copied === 'invite' ? t('plan.invited') : t('plan.invite')}
        </button>
        <p className="mp-note">{t('plan.inviteNote')}</p>
      </div>

      <p className="mp-note">{t('plan.keepNote')}</p>
    </div>
  )
}
