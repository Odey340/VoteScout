import { useEffect, useRef } from 'react'
import Map from '@arcgis/core/Map.js'
import MapView from '@arcgis/core/views/MapView.js'
import Graphic from '@arcgis/core/Graphic.js'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js'
import '@arcgis/core/assets/esri/themes/light/main.css'

const GEOCODE_URL =
  'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'

const LOCATION_TYPES = [
  { key: 'pollingLocations', label: 'Polling place', color: [192, 138, 45] }, // gold
  { key: 'earlyVoteSites', label: 'Early voting', color: [31, 78, 121] }, // info blue
  { key: 'dropOffLocations', label: 'Ballot drop-off', color: [15, 27, 45] }, // ink
]

async function geocode(address) {
  const params = new URLSearchParams({
    SingleLine: address,
    f: 'json',
    maxLocations: '1',
    forStorage: 'false',
    outFields: 'none',
  })
  const res = await fetch(`${GEOCODE_URL}?${params}`)
  const data = await res.json()
  const best = data?.candidates?.[0]
  return best ? { lat: best.location.y, lng: best.location.x } : null
}

function markerSymbol(color) {
  return {
    type: 'simple-marker',
    style: 'circle',
    color: [...color, 0.9],
    size: 13,
    outline: { color: [255, 255, 255], width: 1.5 },
  }
}

function homeSymbol() {
  return {
    type: 'simple-marker',
    style: 'diamond',
    color: [255, 255, 255, 0.95],
    size: 14,
    outline: { color: [34, 41, 58], width: 2 },
  }
}

export default function ElectionMap({ elections, address }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    // Dedupe across elections: the same site often appears in several.
    const seen = new Set()
    const graphics = []
    for (const type of LOCATION_TYPES) {
      for (const election of elections) {
        for (const loc of election[type.key] ?? []) {
          if (loc.lat == null || loc.lng == null) continue
          const id = `${type.key}|${loc.lat}|${loc.lng}`
          if (seen.has(id)) continue
          seen.add(id)
          graphics.push(
            new Graphic({
              geometry: { type: 'point', latitude: loc.lat, longitude: loc.lng },
              symbol: markerSymbol(type.color),
              attributes: {
                name: loc.name || type.label,
                address: loc.address || '',
                hours: (loc.hours || '').replaceAll('\n', '<br>'),
                kind: type.label,
              },
              popupTemplate: {
                title: '{name}',
                content:
                  '<p><b>{kind}</b></p><p>{address}</p><p style="white-space:normal">{hours}</p>',
              },
            }),
          )
        }
      }
    }

    const layer = new GraphicsLayer({ graphics })
    const map = new Map({ basemap: 'osm', layers: [layer] })
    const view = new MapView({
      container: containerRef.current,
      map,
      center: graphics.length
        ? [graphics[0].geometry.longitude, graphics[0].geometry.latitude]
        : [-98.58, 39.83],
      // Country-level until we know where to look; zoomed in once we have pins.
      zoom: graphics.length ? 12 : 4,
      popupEnabled: true,
    })

    ;(async () => {
      let home = null
      try {
        home = await geocode(address)
      } catch {
        // Geocoding is best-effort; the map still shows the location pins.
      }
      if (cancelled) return

      if (home) {
        layer.add(
          new Graphic({
            geometry: { type: 'point', latitude: home.lat, longitude: home.lng },
            symbol: homeSymbol(),
            attributes: { name: 'Your address', address, hours: '', kind: 'Search location' },
            popupTemplate: { title: 'Your address', content: address },
          }),
        )
        view.center = [home.lng, home.lat]
        view.zoom = Math.max(view.zoom, 12)
      }

      // Fit everything in view once all pins are placed.
      if (layer.graphics.length > 1) {
        try {
          await view.when()
          if (!cancelled) {
            await view.goTo(layer.graphics.toArray(), { animate: false })
            view.zoom = Math.min(view.zoom, 14)
          }
        } catch {
          // goTo can reject if the view is destroyed mid-flight; ignore.
        }
      }
    })()

    return () => {
      cancelled = true
      view.destroy()
    }
  }, [elections, address])

  const presentTypes = LOCATION_TYPES.filter((t) =>
    elections.some((e) => (e[t.key] ?? []).some((l) => l.lat != null && l.lng != null)),
  )

  return (
    <div className="card map-card">
      <div className="map-container" ref={containerRef} />
      <div className="map-legend">
        <span className="legend-item">
          <span className="legend-swatch legend-home" />
          Your address
        </span>
        {presentTypes.map((t) => (
          <span className="legend-item" key={t.key}>
            <span
              className="legend-swatch"
              style={{ background: `rgb(${t.color.join(',')})` }}
            />
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}
