# JobNimbus Roofing Estimator

Address in, fully-prepped lead and quote-ready estimate in JobNimbus, in seconds.

A roofing contractor spends 30+ minutes on every lead before they can quote — measuring from satellite imagery, photographing the property, writing up condition notes, building line items. By the time the estimate goes out, the homeowner already called someone else. This pipeline collapses that workflow to ~15 seconds: type an address, get measurements, AI inspection notes, a tiered estimate (Good / Better / Best), a downloadable PDF, and a JobNimbus contact + job created — automatically.

Built for the [JobNimbus Hackathon 2026](https://github.com/JobNimbus/jobnimbus-hackathon-2026).

---

## What you get for an address

Captured for each of the 5 benchmark addresses under [`examples/`](./examples):

- **`satellite.jpg`** — Google satellite (zoom 20)
- **`streetview.jpg`** — Google Street View
- **`output.json`** — full pipeline payload (measurements, line items, vision analysis, tiered estimate, polygon coords)
- **`report.pdf`** — single-page contractor-ready PDF with a stable `EST-XXXXXXXX` ID

Run [`scripts/capture-artifacts.js`](./scripts/capture-artifacts.js) to regenerate everything.

---

## Pipeline

```
Address (Google Places autocomplete, server-proxied)
  └─ Geocode (Google) → lat / lng / zip
     ├─ Solar API buildingInsights ─────┐
     ├─ Static Maps satellite           ├─ run in parallel
     └─ Street View                     ┘
        └─ Patio detection (pitch outliers in Solar segments)
        └─ Solar dataLayers GeoTIFF → roof polygon
           └─ Patio bbox masking before contour extraction (with overtrim fallback)
              └─ Geometric line items: perimeter, eaves, rakes, gutter
                 └─ Claude Sonnet — street view inspection ─────┐
                 └─ Claude Sonnet — satellite ridge / hip /     ├─ in parallel
                                    valley enumeration          │
                 └─ Claude Haiku — property-type classifier ────┘
                    └─ Calibrated line items (vision + facet count)
                       └─ Tiered pricing (Good / Better / Best)
                          └─ JobNimbus contact + job push
                             (also runs in parallel with measurements / pricing)
```

Streamed to the client over Server-Sent Events. The client renders progress, an animated scan over the satellite during the vision pass, and the final results in one batched reveal.

---

## Design decisions

1. **Solar API for measurement, not vision.** Pre-computed roof area, pitch, segments. Numbers are defensible because they come from Google's aerial dataset. Vision is reserved for the qualitative half — material, condition, damage, line enumeration.
2. **Centroid-closest polygon picker, not largest.** Solar's mask covers a 60m radius and picks up neighbors. The centered house is the one closest to the image center, not the biggest.
3. **Patio detection via pitch outliers.** Solar's mask includes attached patio covers / carports because they look the same to a satellite. We pick those off by pitch (1:12–3:12 outliers) and erase those bboxes in the GeoTIFF before the contour stage.
4. **Facet-anchored calibration for interior lines.** Vision enumerates each ridge / hip / valley with notes, but undercounts on complex roofs. We anchor on facet count × 27 ft and only scale model output up if it falls below 90% of expected.
5. **Tiered pricing using "configured rates" framing.** The portal-spoof reframe lets us present Good / Better / Best as the contractor's own configured rates, not a generic public quote. Sources cited inline in [`pricing.js`](./server/services/pricing.js).
6. **Roofing squares = `ceil(sqft / 100)`, no waste factor.** Squares are sold as whole units; every contractor uses their own waste %; baking ours in conflicts with their bid math.
7. **Graceful failure on unsupported properties.** Solar 404 surfaces as a typed `PROPERTY_NOT_FOUND` and the UI renders an empty state with a "Try another address" button. Large commercial buildings short-circuit with a "Custom Quote Required" banner; small commercial runs the full residential flow because a residential crew can handle that roof.

---

## Tech stack

**Node 22 / Express** backend, **React / Vite** frontend, **Claude Sonnet** for dual-image vision analysis + **Haiku** for property classification, **Google Solar API** for roof geometry + GeoTIFF polygon extraction (`geotiff`, `proj4`, `d3-contour`), **Google Static Maps / Street View** for imagery, **PDFKit** for branded reports, **JobNimbus REST API** for CRM push.

---

## Accuracy

Measured against the reference benchmark set (`examples/` under [JobNimbus/jobnimbus-hackathon-2026](https://github.com/JobNimbus/jobnimbus-hackathon-2026)):

| Address | Ours | Ref A | Ref B | Δ vs avg |
|---|---|---|---|---|
| Humble TX | 2,389 | 2,443 | 2,343 | 0.2% |
| Spring TX | 4,369 | 4,391 | 4,296 | 0.6% |
| Cape Coral FL | 2,924 | 2,917 | 2,851 | 1.4% |
| Orland Park IL | 3,170 | 2,990 | 2,935 | 7.0% |
| Nixa MO | 3,070 | 3,070 | 3,017 | 0.9% |

Reference products themselves vary 2–4% on the same property; we land inside that band on 4 of 5 calibration addresses. Orland Park comes in 7% high vs the average — consistent across runs, sourced from Google's published Solar dataset, not tuned.

Total interior linear feet (ridges + hips + valleys combined) lands within the 25–30% tolerance band the references show against each other.

---

## Run it locally

Requires Node 22+. Copy `.env.example` to `.env` and fill in:

- `ANTHROPIC_API_KEY` — Sonnet + Haiku
- `GOOGLE_MAPS_API_KEY` — Geocoding, Places, Static Maps, Street View, Solar API (must be enabled on the GCP project)
- `JN_API_KEY` — JobNimbus REST API (optional; pipeline skips gracefully if absent)

```bash
npm install && npm run dev   # Express on :3001, Vite on :5173
```

---

## Methodology

Every numeric output is independently computed from raw Google data — no commercial measurement product is called.

- **Roof area + per-segment pitch / azimuth / facet count** come from Google Solar's `buildingInsights:findClosest`. Solar's mask is built for solar-panel placement and includes attached patios; we detect those by pitch outliers (patio covers run 1:12–3:12; main roofs 4:12+) and zero them out of both the area and the GeoTIFF before contour extraction. Documented in [`server/services/patioDetection.js`](./server/services/patioDetection.js).
- **Roof outline polygon** comes from Solar's `dataLayers:get` GeoTIFF, decoded with `geotiff`, contoured with `d3-contour`, and reprojected from UTM to WGS-84 with `proj4`. We pick the contour whose centroid is closest to the image center (not the largest — Solar's mask covers a 60m radius and picks up neighbors).
- **Line items** — perimeter, eaves, rakes, gutter come from polygon math (haversine edge length + per-edge bearing vs nearest Solar segment azimuth). Ridges, hips, valleys come from Claude vision enumeration of each line individually, with facet-anchored calibration as a safety net (industry rule of thumb: total interior ≈ facet count × 27 ft). Flashing comes from vision-counted obstacles × per-feature industry footage.
- **Pricing** is a tier engine that applies per-square / per-linear-foot / flat-fee rates to the measured quantities. Defaults are anchored to public industry sources (HomeAdvisor 2024, Roofing Calculator, IBHS Class 4 premium guidance), all cited inline in [`server/services/pricing.js`](./server/services/pricing.js). Framed in the UI as "your configured rates" — the contractor can override.

The single piece of model output we don't independently verify is the street-view condition / material / damage call. That's the qualitative inspection layer; geometry is all measurement.

---

## Known limitations

- **Orland Park IL** Solar reports ~7% high vs commercial measurement products. Hard to fix without overriding Solar.
- **Spring TX interior linear feet** still ~75–80% of references after calibration. Vision can't reliably trace 25+ distinct lines on a single satellite image.
- **Imagery quality varies by location** — Solar coverage and imagery date depend on Google's aerial dataset. Properties where Solar has no data return a clean empty state instead of a quote.
- **Patio detection caveats** — misses patios at the same pitch as the main roof; doesn't apply when the main roof is itself low-pitch architectural; may false-flag legitimate low-slope additions like sunrooms or mansards. Documented inline in [`patioDetection.js`](./server/services/patioDetection.js).
