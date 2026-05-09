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
| 5 — UX polish | ✅ Done (this session) |
| 6 — JobNimbus integration | ⏸ Skips gracefully without `JN_API_KEY`; needs real key + verify against sandbox |
| 7 — Demo prep + reliability test | ⏳ Pending |
| 8 — Submission (public repo + examples + sqft form) | ⏳ Pending |

**Submission deadline:** Saturday 1:30 PM — submit total sqft for the 5 benchmark *test* addresses via the [submission form](https://github.com/JobNimbus/jobnimbus-hackathon-2026/blob/main/SUBMISSION.md). Also need a public GitHub repo with `examples/` folder.

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

**No pricing.** Variance between contractors is too high to publish a generic quote. The deliverable is a fully-prepped lead — measurements, photos, AI condition notes, and quantities — so the contractor applies their own pricing.

---

## What's Built — Architecture Summary

### Backend (`server/`)

- **`routes/pipeline.js`** — orchestrates the SSE pipeline. Steps: imagery → vision → JobNimbus. Geometric line items computed before vision (provides scale anchor for vision prompt); final line items merged with vision results.
- **`routes/autocomplete.js`** — proxies Google Places Autocomplete server-side (Google JS API was blocked on the key).
- **`services/geocode.js`** — Google Geocoding API for address → lat/lng.
- **`services/imagery.js`** — Static Maps satellite (zoom 20, 640×640) + Street View URLs.
- **`services/solar.js`** — Google Solar `buildingInsights:findClosest`. Returns total area, per-segment pitch/azimuth/bbox, facet count, dominant pitch (computed from main-roof segments only). Subtracts detected patios from sqft.
- **`services/patioDetection.js`** — heuristic detection of attached non-roof structures (patio covers, carports, awnings) via pitch outliers in Solar segments. Heavily commented with reasoning, alternatives audited (Microsoft Building Footprints / OSM / county GIS), and three known failure modes. Constants are roofing-industry rules of thumb, not example-set-tuned.
- **`services/roofMask.js`** — fetches Solar `dataLayers:get` GeoTIFF, decodes with `geotiff` lib, runs `d3-contour` to extract roof outline, picks the contour whose centroid is closest to the image center (not the largest — important for getting the right house), reprojects from UTM→WGS84 via `proj4`, projects to normalized 0-1 coords matching the static map, simplifies with Douglas-Peucker (1.5 px tolerance) for visual rendering, keeps the unsimplified ring for measurement. Patio bbox masking happens before contour extraction; sanity-check falls back to un-trimmed polygon if over-trim detected.
- **`services/roofMeasurements.js`** — eave/rake classification via per-edge bearing vs nearest Solar segment azimuth; haversine for edge length; facet-anchored calibration for vision-estimated ridges/hips/valleys (FT_PER_FACET = 27, threshold 0.9). Industry rules-of-thumb for flashing per chimney/skylight/dormer. **Always returns a populated object** even when polygon is missing — geometric fields fall back to null, vision-based items still populate.
- **`services/vision.js`** — three Claude calls in parallel: street-view inspection (material/condition/age/damage/obstacles), satellite analysis (shape/material/damage/obstacles + line enumeration with notes), polygon detection prompt (deprecated — replaced by Solar mask). Satellite prompt includes ground-truth scale anchors (perimeter, facet count, area, pitch) and roof-shape-specific heuristic ranges. `max_tokens: 3072` for satellite to handle full enumeration.
- **`services/jobnimbus.js`** — REST client: POST contact → POST job (no estimate, per "no pricing" decision). Job description embeds measurements + line items + AI analysis.

### Frontend (`client/src/`)

- **`App.jsx`** — SSE consumer with AbortController, buffer flush on stream close, and done-event safety net (so the UI never hangs in `running`). Hero hides once pipeline starts; address input collapses to a slim bar. Results render as a single batched reveal (not piecemeal pop-in) once pipeline is `done`.
- **`components/AddressInput.jsx`** — debounced server-side autocomplete with dropdown, keyboard nav, and "submitted-once" guard so the dropdown doesn't reappear after pipeline runs.
- **`components/RoofOverlay.jsx`** — 16:9 hero card with the satellite image + SVG polygon overlay + sqft label at centroid. Conditional patio note when trim fell back to un-trimmed.
- **`components/RoofStats.jsx`** — 4 tiles for first-glance: Total Roof Area (with whole-square subtext), Avg Pitch, Material, Est. Age. Material/age pulled from vision so the contractor doesn't have to scroll.
- **`components/LineItems.jsx`** — 2-card grid (Perimeter & Edges / Interior Lines & Flashing) mirroring AI Analysis layout. Reuses `.kv-table` classes. **No source tags** (they undermine confidence) — pure linear-feet numbers.
- **`components/VisionAnalysis.jsx`** — 2-card grid for AI inspection results. Material & Condition / Features & Obstacles.
- **`components/StatusTracker.jsx`** — pipeline progress dots + cycling per-step loader phrases (8 imagery / 10 vision / 6 JobNimbus messages).
- **`components/Timer.jsx`** — live elapsed timer; freezes on done.

### Layout flow (top to bottom)

1. Slim header (title + timer)
2. Compact address input (or hero with title + subtitle when idle)
3. Status tracker with cycling loader messages (during pipeline)
4. **Imagery row**: Street View (left) + Satellite-with-polygon (right), 50/50, 16:9 each
5. **4 stat tiles**: Total Roof Area · Avg Pitch · Material · Est. Age
6. **Line Items** (2-card grid)
7. **AI Roof Analysis** (2-card grid)
8. JobNimbus push confirmation banner (or skipped banner if no key)

---

## Key Technical Decisions

1. **Solar API for measurement, not vision** — pre-computed roof area, pitch, segments. Numbers are defensible because they come from Google's aerial data.
2. **Polygon outline from Solar `dataLayers` GeoTIFF, not vision** — Claude vision attempted polygon detection first; was unreliable (rough rectangles, occasionally wrong house). Switched to Google's actual roof mask. Pixel-accurate, comes from the same source as the sqft figure.
3. **Centroid-closest polygon picker** — not largest. Solar's mask covers a 60m radius and picks up neighbors; the centered house is the one closest to image center, not the largest.
4. **Patio detection via pitch outliers** — Solar's mask is built for solar panel placement and includes attached patio covers / carports / awnings. We detect these by pitch outliers (patio covers run 1:12–3:12; main roofs run 4:12+). Cleanest fix: zero those bboxes in the GeoTIFF before contour extraction. Sanity check on over-trim falls back to un-trimmed polygon when Solar's axis-aligned bboxes overlap with main-roof segments.
5. **Vision for the qualitative half** — material, condition, damage, obstacles, line enumeration. Solar gives geometry; vision gives judgment. Without vision, this is a tape measure, not an inspection.
6. **Facet-anchored calibration for interior lines** — vision enumerates each ridge/hip/valley with notes, but undercounts on complex roofs. We anchor on facet count × 27 ft/facet (industry rule of thumb) and only scale model output up if it falls below 90% of expected. Calibration constants documented inline as industry rules of thumb, not example-set-tuned.
7. **No pricing** — variance between contractors is too high. The lead lands in JN with full quantities; the contractor applies their own pricing.
8. **Roofing squares = ceil(sqft/100), no waste factor** — squares are sold as whole units; every contractor uses their own waste percentage; applying ours conflicts with their bid math.
9. **SSE for pipeline progress** — Server-Sent Events from Express. AbortController on the client cancels superseded requests; buffer flush + done-event safety net so the UI never hangs.
10. **No database** — everything flows through the pipeline and lands in JN.

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

### JobNimbus integration (Phase 6 — pending real key)
- Get a JN trial account + generate API key, drop into `.env` as `JN_API_KEY`.
- Test end-to-end: address → contact + job appears in the JN sandbox UI.
- Verify the job description renders cleanly (line items in the body).
- The "mic-drop moment" of the demo: alt-tab to JN, refresh, the job is there.

### Demo prep (Phase 7)
- Test on 5–10 addresses (including all 5 benchmark example properties) to verify reliability.
- Pre-record a fallback video of a successful run (insurance against demo-day API hiccups).
- Rehearse 90-second demo script.
- Backup slides: architecture diagram, accuracy chart vs benchmark references.

### Submission (Phase 8)
- **Submit benchmark sqft values** for the 5 test properties via the form (deadline Saturday 1:30 PM):
  1. 3561 E 102nd Ct, Thornton, CO 80229
  2. 1612 S Canton Ave, Springfield, MO 65802
  3. 6310 Laguna Bay Court, Houston, TX 77041
  4. 3820 E Rosebrier St, Springfield, MO 65809
  5. 1261 20th Street, Newport News, VA 23607
- **Public GitHub repo**:
  - Verify `.env` is gitignored, no secrets in commits
  - Clean commit history (already coherent — see git log)
  - Top-level `README.md`: project overview, architecture diagram, setup instructions, how to run, screenshot
- **`examples/` folder** with 3–5 captured runs:
  - One folder per address (slug name), containing `satellite.jpg`, `streetview.jpg`, `output.json` (full pipeline output)
  - Pick diverse addresses (regions, sizes, materials, conditions); at least one Utah address (JN is in Orem)
  - Top-level `examples/README.md` with a table: address, sqft, total interior LF, pipeline time

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
├── README.md                       # TODO — for submission
├── package.json
├── examples/                       # TODO — for submission
│   └── README.md                   # Table of addresses + outputs
├── server/
│   ├── index.js                    # Express entry
│   ├── routes/
│   │   ├── pipeline.js             # SSE pipeline orchestration
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
│       └── jobnimbus.js            # JN REST client
├── client/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                 # SSE consumer + layout
│       ├── main.jsx
│       ├── components/
│       │   ├── AddressInput.jsx
│       │   ├── Timer.jsx
│       │   ├── StatusTracker.jsx
│       │   ├── RoofOverlay.jsx
│       │   ├── RoofStats.jsx
│       │   ├── LineItems.jsx
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
2. **The solve** (40s) — Type/speak an address. Pipeline runs live: geocode → satellite + Solar → measurement → AI vision → polygon → line items → JN push. Timer running. Lands in 6–8 seconds.
3. **The proof** (20s) — Alt-tab to JN sandbox, refresh, contact + job are there with measurements, polygon image, AI condition notes, and full line-item table in the description. Contractor applies their pricing → quote out the door.
4. **The frame** (20s) — "This is what AssistAI looks like when it ships. Address in, fully-prepped lead in JobNimbus — contractor quotes it with their own pricing in seconds instead of hours."

**Key audience decisions:**
- **Visible pipeline steps with cycling phrases** — not a spinner. Product people see the "how"; tech leads see it's real.
- **No fake pricing** — deliberately doesn't generate a price. Tells contractors the tool is honest about what it knows.
- **Roof outline overlaid on the satellite** — single biggest confidence visual. Pixel-accurate, sourced from Google Solar (same data behind the sqft).
- **Timer front and center** — 6–8s vs 30 minutes needs no explanation.
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

**Gap to address:** the "Product" criterion explicitly asks if we bridged into a *usable estimate*. We deliver measurements + line items + AI inspection but skip pricing by design. Worth considering: a contractor-facing PDF report (no pricing, but a deliverable they can hand off) or a simple tiered estimate placeholder to check the "estimate" box without overclaiming.

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
- [ ] Pipeline completes in 6–8 seconds end-to-end
- [ ] Roof outline traces the correct house (centroid-closest works)
- [ ] Patios excluded from sqft + outline (or fallback flag shown)
- [ ] 4 stat tiles render with sqft + squares + pitch + material + age
- [ ] Line Items render in 2-card layout (perimeter side / interior side)
- [ ] AI Analysis renders in 2-card layout (material & condition / features & obstacles)
- [ ] Street View renders alongside satellite at 50/50
- [ ] JN contact + job created, visible in JN UI within ~10 seconds *(needs API key)*
- [ ] Public GitHub repo — no secrets, clear README, AI bot can navigate
- [ ] `examples/` folder has 3–5 captured outputs
- [ ] Benchmark sqft submitted for the 5 test properties before Saturday 1:30 PM
