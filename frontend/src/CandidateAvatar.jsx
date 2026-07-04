import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001'

// Neutral, party-agnostic palette derived from the name hash.
const AVATAR_COLORS = [
  '#5b6478', '#6d5f74', '#5f7268', '#75685a', '#566d7d',
  '#7a6252', '#616e5c', '#6a5d6e', '#54677a', '#726a4f',
]

function initials(name) {
  const words = name.trim().split(/\s+/).filter((w) => /^[a-z]/i.test(w))
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

function colorFor(name) {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// Module-level so every tile for the same candidate shares one lookup.
const photoPromises = new Map()

function lookupPhoto(candidate, context) {
  const key = `${candidate.name}|${context}`
  if (!photoPromises.has(key)) {
    const params = new URLSearchParams({ name: candidate.name, context })
    if (candidate.photoUrl) params.set('photo_url', candidate.photoUrl)
    if (candidate.candidateUrl) params.set('candidate_url', candidate.candidateUrl)
    photoPromises.set(
      key,
      fetch(`${API_BASE}/api/candidate-photo?${params}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    )
  }
  return photoPromises.get(key)
}

export default function CandidateAvatar({ candidate, context }) {
  const [photo, setPhoto] = useState(null)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    let alive = true
    // Skip lookups for referendum options — initials are fine for "Yes"/"No".
    if (/^(yes|no)$/i.test(candidate.name.trim())) return
    lookupPhoto(candidate, context).then((data) => {
      if (alive && data?.url) setPhoto(data)
    })
    return () => {
      alive = false
    }
  }, [candidate, context])

  const showImage = photo?.url && !broken

  return (
    <span
      className="avatar"
      title={showImage && photo.source ? `Photo: ${photo.source}` : undefined}
    >
      <span className="avatar-initials" style={{ background: colorFor(candidate.name) }} aria-hidden="true">
        {initials(candidate.name)}
      </span>
      {showImage && (
        <img
          className="avatar-img"
          src={photo.url}
          alt=""
          loading="lazy"
          onLoad={(e) => e.target.classList.add('loaded')}
          onError={() => setBroken(true)}
        />
      )}
    </span>
  )
}
