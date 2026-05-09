# JobNimbus Roofing Estimator — Hackathon Plan

## Context

Build an AI pipeline that takes a property address and produces a fully-prepped JobNimbus lead — measurements, photos, AI inspection notes, and a contractor-ready line-item scope — in ~6–8 seconds. Replaces the 30+ minutes a contractor spends on intake before they can quote. $10K bounty.

**Stack:** Node (Express) backend, React + Vite frontend, Claude Sonnet for vision analysis, Google Solar API + Static Maps + Geocoding, Google Places Autocomplete (server-side proxy).

**App name:** "JobNimbus Roofing Estimator" (was "RoofSnap" — renamed to avoid implying a separate product; positioned as what AssistAI looks like when it ships).

**Audience:** roofing contractors. Every product decision filtered through "would a roofer use this?" — see the contractor-first memory note.

---

## Status Snapshot (current state)

| Phase | Status |
|---|---|
| 1 — App shell + imagery | ✅ Done |
| 2 — Roof measurement + AI analysis | ✅ Done |
| 3 — Line-item report (linear feet) | ✅ Done |
| 4 — Patio / non-roof structure detection | ✅ Done |
| 5 — UX polish | ✅ Done |
| 5.5 — Portal-spoof reframe + pricing | ✅ Done |
| 5.7 — PDF report (1-page, branded, EST-id) | ✅ Done (this session) |
| 5.8 — Graceful failure (404 empty state, commercial short-circuit) | ✅ Done (this session) |
| 5.9 — Loader refactor + vision-prompt tuning + benchmark harness | ✅ Done (this session) |
| 6 — JobNimbus integration | ✅ Wired (parallelized with measurements/pricing); needs sandbox verification |
| 7 — Demo prep + reliability test | ⏳ Pending |
| 8 — Submission (public repo + examples + sqft form) | ✅ Repo public, examples captured, README in place. Form submission in flight. |
| 9 — Vercel deploy + repo organization | ⏳ Deferred (not a hard requirement) |

**Submission deadline:** Saturday May 9, 2026 at **1:30 PM** — submit total sqft for the 5 benchmark *test* addresses via the [submission form](https://docs.google.com/forms/d/e/1FAIpQLSfTL58Z0rVBgfx9l81lV7GpryhF7kDEuFKCgNG5i-m1RWDyUg/viewform). Also need a public GitHub repo with output artifacts per test property.

---

## Pipeline Overview

```
Address input (server-side Google Places Autocomplete)
  → Google Geocoding → lat/lng/zip
  → [parallel] Google Solar buildingInsights, Static Maps satellite + Street View
  → Patio detection on Solar segments (pitch outliers)
  → Solar dataLayers (GeoTIFF mask) → polygon contour
     ↳ patio bbox masking before contour extraction
     ↳ over-trim sanity check + fallback to un-trimmed polygon
  → Geometric line items (perimeter, eaves, rakes, gutter) from polygon math
  → Claude Sonnet on Street View + satellite (with perimeter/facets as scale anchors)
  → Calibrated line items (ridges, hips, valleys + flashing) from vision + facet count
  → JobNimbus push: POST contact → POST job with full inspection in description
```

**Pricing reframed:** the app now lives inside a JobNimbus portal spoof, so the "no pricing" stance shifted to "using your configured rates." Tiered estimate (Good / Better / Best) renders in the results and applies industry-anchored per-square / per-linear-foot / flat-fee defaults — defensible because the framing is "the contractor configured these rates," not "we guessed national averages." The contractor can still override; the demo never has to.

---

## What's Built — Architecture Summary

### Backend (`server/`)

- **`routes/pipeline.js`** — orchestrates the SSE pipeline. Step events: imagery → vision (measurements + pricing run synchronously after vision; the loader auto-advances those cosmetically). JobNimbus push runs in parallel with measurements + pricing so it doesn't add wall-clock time. Mints a stable `estimateId` (8-char hex) on the `done` event so the UI chip and PDF stamp/filename match. Detects "large commercial" properties from the vision pass and short-circuits — emits a `shortCircuit: 'commercial-large'` flag so the client renders a "Custom Quote Required" banner instead of line items + pricing. Emits `code` field on the error event so the client can branch on `PROPERTY_NOT_FOUND` (Solar 404).
- **`routes/report.js`** — `/api/report` POST endpoint that takes the pipeline's results + base64-encoded imagery and returns a PDF buffer with `Content-Disposition: attachment; filename="roof-report-<EST-ID>.pdf"`. Falls back to a fresh estimate ID if the pipeline didn't supply one.
- **`routes/autocomplete.js`** — proxies Google Places Autocomplete server-side (Google JS API was blocked on the key).
- **`services/pdfReport.js`** — single-page PDF generator built on PDFKit. `margin: 0` + explicit `addPage` to prevent auto-pagination. Layout: full-bleed JN deep-blue header (brand + Roofing Estimator + BETA pill + date, all baseline-aligned via real font ascender values) → "Property" section title with EST-XXXXXXXX stamp → side-by-side imagery (`drawImageCover` clips + scales like CSS object-fit:cover so both slots fill uniformly) → 4-col measurements grid → 3-card pricing tiers (with "MOST SELECTED" badge + vector checkmarks) → side-by-side Line Items + AI Analysis → slim tinted footer (brand left, © year right).
- **`services/geocode.js`** — Google Geocoding API for address → lat/lng.
- **`services/imagery.js`** — Static Maps satellite (zoom 20, 640×640) + Street View URLs.
- **`services/solar.js`** — Google Solar `buildingInsights:findClosest`. Returns total area, per-segment pitch/azimuth/bbox, facet count, dominant pitch (computed from main-roof segments only). Subtracts detected patios from sqft. **404 throws a typed error with `code: 'PROPERTY_NOT_FOUND'`** so the UI can render a friendly empty state instead of the raw API message.
- **`services/patioDetection.js`** — heuristic detection of attached non-roof structures (patio covers, carports, awnings) via pitch outliers in Solar segments. Heavily commented with reasoning, alternatives audited (Microsoft Building Footprints / OSM / county GIS), and three known failure modes. Constants are roofing-industry rules of thumb, not example-set-tuned.
- **`services/roofMask.js`** — fetches Solar `dataLayers:get` GeoTIFF, decodes with `geotiff` lib, runs `d3-contour` to extract roof outline, picks the contour whose centroid is closest to the image center (not the largest — important for getting the right house), reprojects from UTM→WGS84 via `proj4`, projects to normalized 0-1 coords matching the static map, simplifies with Douglas-Peucker (1.5 px tolerance) for visual rendering, keeps the unsimplified ring for measurement. Patio bbox masking happens before contour extraction; sanity-check falls back to un-trimmed polygon if over-trim detected.
- **`services/roofMeasurements.js`** — eave/rake classification via per-edge bearing vs nearest Solar segment azimuth; haversine for edge length; facet-anchored calibration for vision-estimated ridges/hips/valleys (FT_PER_FACET = 27, threshold 0.9). Industry rules-of-thumb for flashing per chimney/skylight/dormer. **Always returns a populated object** even when polygon is missing — geometric fields fall back to null, vision-based items still populate.
- **`services/vision.js`** — three Claude calls in parallel: street-view inspection (Sonnet, material/condition/age/damage/obstacles), satellite analysis (Sonnet, shape/material/damage/obstacles + line enumeration with notes), and a property-type classifier (Haiku — cheap, fast, returns `{ propertyType, commercialScale }`). Satellite prompt includes ground-truth scale anchors (perimeter, facet count, area, pitch), tightened ridge/hip/valley definitions with proportion sanity checks (ridges ≤ 25% of interior total on hip roofs), and length-scaling guidance for larger footprints. `max_tokens: 3072` for satellite. `analyzeProperty(satelliteUrl, streetViewUrl, ctx, modelOverride?)` accepts a model override so the benchmark harness can sweep models without code changes.
- **`services/jobnimbus.js`** — REST client: POST contact → POST job (no estimate object — pricing is part of the job description body, not a JN Estimate record). Job description embeds measurements + line items + AI analysis.
- **`services/pricing.js`** — tiered package generator (Good / Better / Best). Per-square + per-linear-foot + flat-fee defaults applied to measured quantities. Sources cited inline (HomeAdvisor 2024, Roofing Calculator, IBHS Class 4 premium guidance). Architectural tier flagged `recommended: true` so the UI can highlight it ("Most Selected" badge).

### Frontend (`client/src/`)

- **`App.jsx`** — SSE consumer with AbortController, buffer flush on stream close, and done-event safety net (so the UI never hangs in `running`). The SSE parser hoists `pendingEvent` outside `processLines` so events that span multiple TCP chunks aren't dropped (the `done` event ran ~70-100KB and was being silently lost on slower connections). `handleDownloadPdf` base64-encodes the imagery and composites the orange roof outline + sqft label onto the satellite via canvas before sending to `/api/report` — the Maps API key is referrer-restricted to the browser, so server-side fetch returned 403. Branches the results UI on three states: `PROPERTY_NOT_FOUND` (centered empty-state card with Try-another-address), `shortCircuit === 'commercial-large'` (banner + measurements only, no line items / pricing), normal (full results). `handleReset` clears all pipeline state. Results render as a single batched reveal once pipeline is `done`.
- **`components/PortalNav.jsx`** — spoofed JobNimbus top-nav. JN wordmark + horizontal icon-on-top/label-below items (Home, Jobs, Calendar, Insights, Engage, Payments, **Roofing Estimator** active with PDF doc icon and blue underline). Right cluster: Create + button, search input, AH avatar (green circle). Inactive items are static stubs (`tabIndex=-1`, `cursor: default`) — only the estimator is functional. Mobile collapses to JN logo + active item pill + Create.
- **`components/PageHeader.jsx`** — JN-style "← Page Title [Beta]" strip below the nav. Back arrow calls `handleReset`. The Beta badge mirrors JN's actual "Smart Estimate Setup [Beta]" treatment. Renders the Timer in its actions slot.
- **`components/AddressInput.jsx`** — debounced server-side autocomplete with dropdown, keyboard nav, and a clear (×) button that calls the parent's `onReset` to fully clear pipeline state. "Submitted-once" guard so the dropdown doesn't reappear after pipeline runs.
- **`components/PipelineLoader.jsx`** — replaces the old StatusTracker. During the wait it shows: a beefier step tracker (custom icons per step, pulse-ring on the active step, gradient connector lines that fill as steps complete), the cycling status message (positioned ABOVE the imagery so it's the most visible element), and a live imagery preview that reveals as soon as imagery is fetched. While vision is running, an animated scan sweep + grid overlay runs across the satellite — sells "AI is looking at your roof right now."
- **`components/RoofOverlay.jsx`** — satellite card with SVG polygon overlay + sqft label at centroid. Conditional patio note when trim fell back to un-trimmed.
- **`components/RoofStats.jsx`** — 4 tiles: Total Roof Area, Avg Pitch, Material, Est. Age.
- **`components/LineItems.jsx`** — 2-card grid: Perimeter & Edges / Interior Lines & Flashing.
- **`components/PricingEstimate.jsx`** — 3-card grid: Good / Better / Best. Each card shows tier name, material, big total in JN deep-blue, warranty term, 3 highlight bullets (warranty / underlayment / wind-rating / hail-rating), and a breakdown footer (squares × rate, flashing × rate, permits + cleanup). Header reads "Estimate" + "USING YOUR CONFIGURED RATES" caption — sells the portal-spoof framing without apologizing.
- **`components/VisionAnalysis.jsx`** — 2-card grid: Material & Condition / Features & Obstacles.
- **`components/Timer.jsx`** — live elapsed timer; freezes on done. Renders inside the PageHeader actions slot.
- **`public/jn-logo.svg`** + **`jn-logo-white.svg`** — JobNimbus wordmarks (downloaded from jobnimbus.com CDN, recolored for our light header).
- **`public/jn-favicon.svg`** — JN icon glyph in JN blue.

### Layout flow (top to bottom)

1. **PortalNav** — spoofed JN top-bar (sticky)
2. **PageHeader** — `← Roofing Estimator [Beta]` with Timer
3. **Address input** (empty state of the Roofing Estimator page; no hero)
4. **PipelineLoader** during run: step tracker → cycling status message → imagery preview with scan animation
5. **Imagery row**: Street View + Satellite-with-polygon, 50/50, 16:9 each
6. **4 stat tiles**: Total Roof Area · Avg Pitch · Material · Est. Age
7. **Line Items** (2-card grid)
8. **Pricing Estimate** (3-card grid: Good / Better / Best)
9. **AI Roof Analysis** (2-card grid)
10. JobNimbus push confirmation banner (or skipped banner if no key)
11. **Footer** — "BUILT BY Angel Herrera" / "JN HACKATHON · 2026"

---

## Key Technical Decisions

1. **Solar API for measurement, not vision** — pre-computed roof area, pitch, segments. Numbers are defensible because they come from Google's aerial data.
2. **Polygon outline from Solar `dataLayers` GeoTIFF, not vision** — Claude vision attempted polygon detection first; was unreliable (rough rectangles, occasionally wrong house). Switched to Google's actual roof mask. Pixel-accurate, comes from the same source as the sqft figure.
3. **Centroid-closest polygon picker** — not largest. Solar's mask covers a 60m radius and picks up neighbors; the centered house is the one closest to image center, not the largest.
4. **Patio detection via pitch outliers** — Solar's mask is built for solar panel placement and includes attached patio covers / carports / awnings. We detect these by pitch outliers (patio covers run 1:12–3:12; main roofs run 4:12+). Cleanest fix: zero those bboxes in the GeoTIFF before contour extraction. Sanity check on over-trim falls back to un-trimmed polygon when Solar's axis-aligned bboxes overlap with main-roof segments.
5. **Vision for the qualitative half** — material, condition, damage, obstacles, line enumeration. Solar gives geometry; vision gives judgment. Without vision, this is a tape measure, not an inspection.
6. **Facet-anchored calibration for interior lines** — vision enumerates each ridge/hip/valley with notes, but undercounts on complex roofs. We anchor on facet count × 27 ft/facet (industry rule of thumb) and only scale model output up if it falls below 90% of expected. Calibration constants documented inline as industry rules of thumb, not example-set-tuned.
7. **Tiered pricing using "configured rates" framing** — judges' rubric explicitly asks "did you bridge measurements into a usable estimate?" so we ship Good / Better / Best totals. The portal-spoof reframe (#11 below) lets us present these as the contractor's configured rates rather than a generic public quote — confident UI copy ("Using your configured rates") with no apologetic language. Per-square / per-LF / flat-fee constants are anchored to public industry sources (HomeAdvisor 2024, Roofing Calculator, IBHS) and cited inline so the AI scoring agent can verify "Build, don't buy."
8. **Roofing squares = ceil(sqft/100), no waste factor** — squares are sold as whole units; every contractor uses their own waste percentage; applying ours conflicts with their bid math. (Pricing service follows the same rule — contractors' configured rates would already bake in their waste %.)
9. **SSE for pipeline progress** — Server-Sent Events from Express. AbortController on the client cancels superseded requests; buffer flush + done-event safety net so the UI never hangs.
10. **No database** — everything flows through the pipeline and lands in JN.
11. **Portal spoof, not marketing site** — the app is framed as a feature *inside* JobNimbus (top nav, page header with Beta badge, "Roofing Estimator" as an active nav item), not a third-party tool with a hero. Judges are JN engineers; this lands the "what AssistAI looks like when it ships" frame the moment they open the page, before they read a word of copy. Inactive nav items are static stubs to keep risk low — only the estimator is functional.
12. **Live imagery preview during the ~15s wait** — instead of hiding the satellite + street view until pipeline `done`, PipelineLoader reveals them as soon as fetched and runs an animated scan sweep across the satellite while vision is working. Fills dead air with "the tool is doing something" motion; the cycling status message sits above the preview as the most visible element.

---

## Known Issues / Future Work

- **`Orland Park IL` sqft is ~7% high vs reference average** (3,170 vs 2,963). Solar API is just reporting a higher value for this property than commercial measurement products. Borderline within the implied 5–10% tolerance band. Hard to fix without overriding Solar.
- **Spring TX interior linear feet still ~75–80% of references** even after calibration. Vision can't reliably trace 25+ distinct lines on a single satellite image. Calibration kicks in but caps at the expected total.
- **Vision occasionally returns wrong material confidence** for unclear street-view angles. Currently we don't surface confidence in the UI (per user direction); we use vision's primary label as-is.
- **Patio detection caveats** (documented in `patioDetection.js`):
  - Misses patios with the same pitch as the main roof (rare).
  - Doesn't apply when the main roof is itself low-pitch (<4:12 architectural).
  - May false-flag legitimate low-slope additions (sunrooms, mansards).
- **Patio polygon trim falls back when Solar segment bboxes overlap** with main-roof segments. The sqft adjustment still applies; the visual outline reverts to the un-trimmed mask + a small yellow flag explains.
- **Imagery quality varies by location** — Solar coverage and imagery date depend on Google's aerial coverage. The benchmark properties all have HIGH-quality imagery; some test addresses might not.

---

## Pending Work

### ✅ Submission — Saturday May 9, 1:30 PM

Done:
- Pipeline run on the 5 test properties (sqft below)
- Per-property artifacts captured under [`examples/<slug>/`](./examples) — `satellite.jpg`, `streetview.jpg`, `output.json`, `report.pdf`
- `examples/summary.json` with sqft + facets + pipeline time per address
- Public GitHub repo with top-level `README.md`
- `.env` gitignored, no secrets in history

In flight:
- Google Form submission (handled in another session)

| Address | Sqft submitted |
|---|---|
| 3561 E 102nd Ct, Thornton, CO 80229 | 2,081 |
| 1612 S Canton Ave, Springfield, MO 65802 | 2,757 |
| 6310 Laguna Bay Court, Houston, TX 77041 | 4,186 |
| 3820 E Rosebrier St, Springfield, MO 65809 | 5,566 |
| 1261 20th Street, Newport News, VA 23607 | 6,118 |

### Vercel deploy + repo organization (deferred — not a requirement)

When picked up later, the agent should:
- Restructure the repo for clarity (suggested: flatter `client/` + `api/` for Vercel serverless). Confirm before destructive moves.
- Migrate the Express API to Vercel — likely serverless functions or a single Express handler under `api/index.js`. SSE works on Vercel but has a 60s execution limit on Pro, 10s on Hobby — current pipeline lands in ~10–15s so this is tight on Hobby.
- PDF route returns a buffer; Vercel's 4.5MB response limit is fine (<300KB current).
- Static assets (JN logo, favicon) just deploy with the Vite build.
- `.env` → Vercel env vars: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `JN_API_KEY`. Verify the Google Maps key's referrer restrictions allow the deployed domain.
- Keep the `scripts/` benchmark harness as a local-only tool — don't deploy it.
- Don't break the local dev workflow (`launch.json` server + client).

### After submission: finalist round (2:00 PM if selected)

- Top 5 finalists notified by text at 2:00 PM → live demo (~5 min + Q&A) 2:00–3:30 PM → winner at 4:00 PM.
- Pre-record a fallback video of a successful run before 2:00 PM (insurance against demo-day API hiccups).
- Rehearse 90-second demo script.

### Stretch

- **JobNimbus sandbox verification** — code path is wired and skips gracefully without `JN_API_KEY`; need a JN trial account + key + verify a contact + job actually land in the sandbox UI. The mic-drop demo moment.
- **Voice intake** — Web Speech API for "speak the address" demo flair.
- **More test addresses for benchmark.js** — current set is 5 calibration properties; expanding to 15–20 would tighten the accuracy story.

---

## Benchmark Results (current state)

Reference values from the JobNimbus benchmark (`https://github.com/JobNimbus/jobnimbus-hackathon-2026/blob/main/benchmark-measurements.md`).

**Total sqft accuracy** (the submitted metric):

| Address | Ours | Ref A | Ref B | % off avg |
|---|---|---|---|---|
| Humble TX | 2,389 | 2,443 | 2,343 | 0.2% ✓ |
| Spring TX | 4,369 | 4,391 | 4,296 | 0.6% ✓ |
| Cape Coral FL | 2,924 | 2,917 | 2,851 | 1.4% ✓ |
| Orland Park IL | 3,170 | 2,990 | 2,935 | 7.0% ⚠️ |
| Nixa MO | 3,070 | 3,070 | 3,017 | 0.9% ✓ |

**Total interior linear feet** (R + H + V combined):

| Address | Ours | Ref Avg | % of ref |
|---|---|---|---|
| Humble TX | 215 | 173 | +24% |
| Spring TX | 539 | 608 | -11% |
| Cape Coral FL | 163 | 162 | ✓ |
| Orland Park IL | 334 | 316 | +5.7% ✓ |
| Nixa MO | 319 | 367 | -13% |

**Tolerance bands** (derived from references' mutual variance):
- Sqft: ~5–10% (refs themselves vary 2–4%)
- Line items: ~25–30% (refs vary up to 33% on eaves)
- Total interior: ~10–25%

We meet the practical-accuracy bar on all 5 properties.

> **Important framing from the benchmark doc**: "These properties are provided so you can validate your tool. They are not the addresses you'll be scored on." Don't overfit constants to the example set — keep heuristics industry-grounded.

---

## Project Structure

```
jn-hackathon/
├── CLAUDE.md
├── PLAN.md
├── README.md
├── package.json
├── examples/                       # Per-property artifact captures (5 benchmark addresses)
│   └── summary.json                # Aggregated capture results
├── server/
│   ├── index.js                    # Express entry
│   ├── routes/
│   │   ├── pipeline.js             # SSE pipeline orchestration (now also includes pricing)
│   │   ├── autocomplete.js         # Google Places proxy
│   │   ├── jobnimbus.js            # JN API proxy (currently inline in services)
│   │   └── health.js
│   └── services/
│       ├── solar.js                # Solar API wrapper
│       ├── roofMask.js             # GeoTIFF mask → polygon
│       ├── patioDetection.js       # Pitch-outlier patio detection
│       ├── roofMeasurements.js     # Polygon math + line items
│       ├── imagery.js              # Static Maps URLs
│       ├── geocode.js              # Geocoding API
│       ├── vision.js               # Claude vision pipeline
│       ├── pricing.js              # Tiered estimate (Good/Better/Best) — industry-anchored rates
│       └── jobnimbus.js            # JN REST client
├── client/
│   ├── index.html                  # Tab title + favicon link
│   ├── public/
│   │   ├── jn-logo.svg             # Deep-blue wordmark for the portal nav
│   │   ├── jn-logo-white.svg       # Original CDN download (kept for reference)
│   │   └── jn-favicon.svg          # JN icon glyph in JN blue
│   └── src/
│       ├── App.jsx                 # SSE consumer + layout (no hero — portal-shell framing)
│       ├── main.jsx
│       ├── components/
│       │   ├── PortalNav.jsx       # Spoofed JN top-nav
│       │   ├── PageHeader.jsx      # ← Roofing Estimator [Beta] strip
│       │   ├── AddressInput.jsx    # Autocomplete + clear (×) reset button
│       │   ├── Timer.jsx
│       │   ├── PipelineLoader.jsx  # Replaces StatusTracker — live preview + scan animation
│       │   ├── RoofOverlay.jsx
│       │   ├── RoofStats.jsx
│       │   ├── LineItems.jsx
│       │   ├── PricingEstimate.jsx # 3-tier package cards
│       │   └── VisionAnalysis.jsx
│       └── styles/
│           ├── global.css
│           └── app.css
└── .env                            # Gitignored
```

---

## API Keys

| Service | Env Var | Status |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Set |
| Google Maps (Geocoding, Places, Static Maps, Street View, Solar) | `GOOGLE_MAPS_API_KEY` | Set |
| JobNimbus | `JN_API_KEY` | **Missing** — pipeline skips JN step gracefully |

---

## Design System (JobNimbus-aligned)

Source: [brand.jobnimbus.com](https://brand.jobnimbus.com/)

**Fonts:** Figtree (primary) + DM Mono (labels/badges, all-caps)

**Colors:**
| Token | Hex | Use |
|---|---|---|
| JN Blue | `#3968C6` | Primary CTAs, primary tile border |
| JN Deep Blue | `#1F3E7A` | Headers |
| JN Night | `#1F2C47` | Body text (never pure black) |
| JN Slate | `#475C85` | Secondary text |
| JN Green | `#33CC99` | Success, timer-done state |
| JN Sunset | `#FF704C` | Warnings (also used for the polygon stroke at 70% opacity) |

**CSS variables in `client/src/styles/global.css`** — full palette + `--font-primary` / `--font-mono` / `--radius-{sm,md,lg}` / `--shadow-{sm,md,lg}`.

**Style notes:**
- 8px radius cards, 6px buttons
- Cool-toned grey palette (blue undertone)
- Flat with subtle box-shadow depth
- Generous whitespace (40px between major result sections)
- Card-based with subtle shadows

---

## Presentation Strategy

**Audience:** 3 tech leads + 2-3 product people + an AI bot reviewer.

**Coding for AI review:** clean structure, meaningful names, separation of concerns (services / routes / components), no dead code, no leftover TODOs, defensive-but-readable comments where the methodology isn't obvious (`patioDetection.js`, `roofMask.js`).

**Narrative arc (90 seconds):**
1. **The problem** (10s) — "A roofing contractor spends 30+ minutes on every lead before they can even quote — measuring, photographing, writing it up. By the time the estimate goes out, the homeowner called someone else."
2. **The solve** (40s) — Type/speak an address. Pipeline runs live: geocode → satellite + Solar → measurement → AI vision → polygon → line items → tiered estimate → JN push. Timer running. Lands in ~15 seconds.
3. **The proof** (20s) — Alt-tab to JN sandbox, refresh, contact + job are there with measurements, polygon image, AI condition notes, and full line-item table in the description. Three-tier estimate (Good / Better / Best) ready to send to the homeowner.
4. **The frame** (20s) — "This is what AssistAI looks like when it ships. Address in, fully-prepped lead and quote-ready estimate in JobNimbus, in seconds."

**Key audience decisions:**
- **Portal-spoof framing** — JN top-nav with Roofing Estimator as an active item, page header with Beta badge. Frames the whole demo as "this is a JobNimbus feature" before judges read a word.
- **Live imagery preview during the wait** — satellite + street view reveal as soon as fetched, scan animation across the satellite during the vision step. ~15s wait reads as motion, not dead air.
- **Tiered estimate using "configured rates" framing** — three packages (Good / Better / Best) with confident totals. The portal-spoof reframe lets us present these as the contractor's own configured rates, not a generic public quote.
- **Roof outline overlaid on the satellite** — single biggest confidence visual. Pixel-accurate, sourced from Google Solar.
- **Timer front and center** — ~15s vs 30 minutes needs no explanation.
- **Two image views (street + satellite)** — homeowner recognition + contractor verification in one row.

**Presentation assets:**
- [ ] Live demo (primary)
- [ ] 2–3 backup slides (architecture, benchmark accuracy chart, before/after workflow)
- [ ] Pre-recorded fallback video

---

## Judging Criteria

Top 5 advance to live finals. Five criteria:

1. **Accuracy** — measurements close to reference data, consistent across test properties.
2. **Product** — did you bridge from measurements into a *usable estimate*? Would a roofer actually use the output?
3. **Experience** — how the tool feels end-to-end (address in → estimate out).
4. **Craft** — code quality, novel use of AI, engineering judgment.
5. **Demo** — how you bring it to life Saturday. Creativity. Wow factor.

**Product criterion now covered** — tiered estimate (Good / Better / Best) with industry-anchored rates renders below the line items, framed as "Using your configured rates" via the portal spoof. Pricing service in `server/services/pricing.js` cites every constant inline so the AI scoring agent can verify methodology.

**Possible bonus:** PDF deliverable for the homeowner (branded report = measurements + AI inspection + tiered estimate). Doubles as the per-property output artifact for the `examples/` folder.

---

## Submission Requirements (Saturday May 9, 1:30 PM)

### Must-do

1. **Run the 5 test properties** and record total sqft for each:
   - 3561 E 102nd Ct, Thornton, CO 80229
   - 1612 S Canton Ave, Springfield, MO 65802
   - 6310 Laguna Bay Court, Houston, TX 77041
   - 3820 E Rosebrier St, Springfield, MO 65809
   - 1261 20th Street, Newport News, VA 23607

2. **Fill out the Google Form** (~5 min): team name, members, 200-word approach summary, phone number, sqft for each test property, optional demo video/example link.
   - Form: https://docs.google.com/forms/d/e/1FAIpQLSfTL58Z0rVBgfx9l81lV7GpryhF7kDEuFKCgNG5i-m1RWDyUg/viewform

3. **Public GitHub repo** with:
   - `README.md` — what it does, how to run, anything notable
   - Source code (already done)
   - **Output for each test property** (PDF, screenshot, JSON — whatever the tool produces)

### Good to have

- Demo video or hosted link
- Note on AI model choices and why
- Known limitations / edge cases

### Scoring notes

- **"Build, don't buy"** — they'll flag submissions that match commercial reports without independent computation in the code. Our Solar API + polygon + vision pipeline is clearly independent work.
- **AI scoring agent** inspects the repo during preliminary scoring — clean code and structure matter.
- **Sqft must be roof area** (with pitch multiplier), not footprint. We already do this via Solar API.
- Top 5 finalists notified by text at 2:00 PM → live demo (~5 min + Q&A) → winner at 4:00 PM.

---

## Verification / Demo Checklist

- [ ] Address autocomplete fires within ~250ms
- [ ] Pipeline completes in ~15 seconds end-to-end
- [ ] PortalNav renders with Roofing Estimator as the active item (PDF icon, blue underline)
- [ ] PageHeader renders `← Roofing Estimator [Beta]` with Timer in the actions slot
- [ ] PipelineLoader during run: step tracker → status message → live imagery preview with scan animation
- [ ] Roof outline traces the correct house (centroid-closest works)
- [ ] Patios excluded from sqft + outline (or fallback flag shown)
- [ ] 4 stat tiles render with sqft + squares + pitch + material + age
- [ ] Line Items render in 2-card layout (perimeter side / interior side)
- [ ] **Pricing Estimate renders as a 3-card grid** (Good / Better / Best) with the Architectural tier highlighted as Most Selected
- [ ] AI Analysis renders in 2-card layout (material & condition / features & obstacles)
- [ ] Street View renders alongside satellite at 50/50
- [ ] Clear (×) on the address input fully resets to the empty state
- [ ] Footer shows "BUILT BY Angel Herrera" / "JN HACKATHON · 2026"
- [ ] JN contact + job created, visible in JN UI within ~10 seconds *(needs API key — stretch)*
- [ ] Public GitHub repo — no secrets, clear README, AI bot can navigate
- [ ] `examples/` folder has captured outputs for the 5 test properties
- [ ] Benchmark sqft submitted for the 5 test properties before Saturday 1:30 PM
