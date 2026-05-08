# RoofSnap — JobNimbus Hackathon Plan

## Context

Build an AI pipeline that takes a property address and produces a fully-prepped JobNimbus lead — measurements, photos, and AI condition notes — in ~30-60 seconds. Replaces the 30+ minutes a contractor spends on intake before they can quote. $10K bounty.

**Stack:** Node (Express) backend, React + Vite frontend, Claude Sonnet for vision analysis.

**Team size:** TBD — plan assumes solo-capable scope with room to parallelize.

---

## Pipeline Overview

```
Address input (Google Places Autocomplete)
  → Google Solar API → roof area (m2), pitch (degrees), segments, facet count
  → Fetch satellite image (Google Static Maps) + Street View
  → Claude Sonnet on Street View → material, condition, damage
  → JobNimbus push: POST contact → POST job (with measurements + AI analysis)
```

**No pricing.** Pricing varies too much between contractors for a one-size-fits-all
quote to be honest. The deliverable is a fully-prepped lead in JobNimbus —
measurements, photos, and AI condition notes — so the contractor can quote it
with their own numbers in seconds instead of hours.

---

## Project Structure

```
jn-hackathon/
├── CLAUDE.md
├── PLAN.md
├── README.md                     # Setup, architecture, how to run
├── package.json                  # root — workspaces or simple scripts
├── examples/                     # 3-5 example pipeline runs (committed for submission)
│   ├── README.md                 # Table of addresses, sqft, pipeline times
│   └── 123-main-st-provo-ut/    # One folder per address
│       ├── satellite.jpg
│       ├── streetview.jpg
│       └── output.json           # Full pipeline output (roof stats, AI analysis, JN response)
├── server/
│   ├── package.json
│   ├── index.js                  # Express entry point
│   ├── routes/
│   │   ├── pipeline.js           # POST /api/pipeline — full address→JN-job flow
│   │   ├── jobnimbus.js          # JN API proxy routes
│   │   └── health.js
│   ├── services/
│   │   ├── solar.js              # Google Solar API → roof area, pitch, segments
│   │   ├── imagery.js            # Satellite + Street View image URLs
│   │   ├── vision.js             # Claude Sonnet on Street View (material, condition)
│   │   └── jobnimbus.js          # JN API client (contacts, jobs)
│   └── config/
│       └── prompts/              # Vision model prompt templates
│           ├── satellite.txt
│           └── streetview.txt
├── client/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── components/
│       │   ├── AddressInput.jsx   # Google Places Autocomplete input
│       │   ├── Timer.jsx          # Live stopwatch during pipeline
│       │   ├── RoofStats.jsx      # Roof measurements card
│       │   ├── VisionAnalysis.jsx # AI roof analysis card
│       │   └── StatusTracker.jsx  # Pipeline progress steps
│       ├── hooks/
│       │   └── usePipeline.js     # WebSocket/SSE for pipeline progress
│       └── styles/
└── .env.example                   # API key template
```

---

## Implementation Phases

### Phase 1 — App Shell + Google Maps
**Goal:** Working app that takes an address and shows satellite + Street View imagery.
**Demoable output:** Type an address → see the property on screen.

- Init git repo, scaffold Express server + React/Vite client
- Set up `.env` with API keys (Google Maps, Anthropic, JN)
- JN design system: Figtree font, JN color palette, CSS variables
- Google Places Autocomplete input → structured address + lat/lng
- Fetch satellite image (Google Static Maps API, zoom 20, 640x640)
- Fetch Street View image (Google Street View Static API)
- Display both images in the UI
- Live timer component (starts on address submit)
- SSE endpoint for pipeline progress updates
- Pipeline status tracker in the UI

### Phase 2 — Roof Measurement + AI Analysis
**Goal:** Google Solar API provides roof geometry; Claude analyzes material/condition.
**Demoable output:** Type an address → see sqft, segments, pitch, material, and condition.

- **Google Solar API** (`buildingInsights:findClosest`) → structured roof data:
  - `wholeRoofStats.areaMeters2` → total roof area (convert to sqft × 10.764)
  - `roofSegmentStats[]` → per-segment area, `pitchDegrees`, `azimuthDegrees`
  - Facet count = length of segments array
- Convert pitch degrees → rise:run → pitch multiplier for waste/material calc
- Add 10-15% waste factor, convert to roofing squares (÷ 100)
- Claude Sonnet vision on satellite + Street View → structured JSON with **detailed roofing terminology**:
  - Material type (3-tab, architectural, metal, tile, slate, wood shake)
  - Condition assessment (excellent, good, fair, poor)
  - Visible damage (missing shingles, curling, moss/algae, storm damage)
  - Roof features: valleys, ridges, hips, eaves, rakes, gables, dormers
  - Obstacles: chimneys, skylights, vents (plumbing, ridge, turbine), satellite dishes
  - Flashing points: wall flashing, chimney flashing, valley flashing, pipe boots
  - Drainage: gutters, downspouts, gullies
  - Estimated age, estimated layers
- The more fine-grained the detail, the more credible the estimate looks to judges and contractors
- Display roof stats + analysis results in the UI with proper roofing terminology

### Phase 3 — JobNimbus Integration
**Goal:** Lead lands in JN CRM automatically with all the inspection data attached.
**Demoable output:** Type an address → alt-tab to JN → refresh → contact + job are there with measurements and AI notes in the description.

- `POST /api1/contacts` — create homeowner
- `POST /api1/jobs` — link to contact via `primary.id`, include roof stats and
  AI analysis in the description so the contractor sees everything they need
  to quote it themselves
- Bearer token auth, Unix timestamps, `jnid` chaining
- Success confirmation in the UI ("Pushed to JobNimbus")
- Timer stops when JN push completes
- **No estimate push.** Pricing is left to the contractor — variance between
  shops is too high to publish a generic quote.

### Phase 5 — Polish + Demo Prep
**Goal:** Reliable, presentable, rehearsed.

- Test on 10-15 addresses to verify reliability
- Error handling and edge cases (bad address, API timeout, etc.)
- Loading states and visual polish
- Pre-record one fallback video as insurance
- Rehearse 90-second demo script

### Phase 6 — Submission
**Goal:** Public repo with example pipeline outputs, ready for AI bot review.

- **Public GitHub repo** — push to a public repo for submission
  - Ensure `.env` is in `.gitignore` (already is), no API keys in committed code
  - Clean commit history that tells a coherent build story
  - README.md with: project overview, architecture diagram, setup instructions, how to run
- **Example outputs** — run the full pipeline on 3-5 addresses, commit the outputs:
  - `examples/` folder at repo root
  - Each example is a subfolder named by address slug (e.g., `examples/123-main-st-provo-ut/`)
  - Each subfolder contains: satellite image, Street View image, pipeline output JSON (roof stats, AI analysis, JN response)
  - Pick diverse addresses: different regions, roof sizes, materials, conditions
  - At least one Utah address (JobNimbus is based in Orem, UT — judges will recognize local properties)
- **Example address candidates** (verify these work with Google Solar API before committing):
  1. A residential home in Orem/Provo, UT (JN home turf)
  2. A home in a different state (e.g., TX or FL — common roofing markets)
  3. A larger/complex roof (multi-facet, steeper pitch)
  4. A home with visible damage or older roof (shows damage detection)
  5. Optional: a newer construction with clean roof (shows range)
- **`examples/README.md`** — table listing each address, roof sqft, tier prices, and pipeline time

---

## API Keys

| Service | Env Var | Status |
|---------|---------|--------|
| Anthropic | `ANTHROPIC_API_KEY` | Ready |
| Google Maps | `GOOGLE_MAPS_API_KEY` | Ready |
| JobNimbus | `JN_API_KEY` | Need trial account + key |

---

## Design System (JobNimbus-aligned)

Source: [brand.jobnimbus.com](https://brand.jobnimbus.com/)

**Fonts:** Figtree (primary, Google Fonts) + DM Mono (labels/badges, all-caps)
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Figtree:wght@400;500;600;700&display=swap');
```

**Colors:**
| Token | Hex | Use |
|-------|-----|-----|
| JN Blue | `#3968C6` | Primary CTAs, links |
| JN Deep Blue | `#1F3E7A` | Headers, dark accents |
| JN Night | `#1F2C47` | Darkest text (never use pure `#000`) |
| JN Slate | `#475C85` | Secondary text |
| JN Green | `#33CC99` | Success states |
| JN Sunset | `#FF704C` | Warnings, attention |
| JN Cloud | `#E3E5E9` | Light backgrounds |
| BG Primary | `#F7F9FD` | Page background |

**Style notes:**
- Rounded corners: ~8px cards, ~6px buttons
- Cool-toned grey palette (blue undertone, not warm)
- Flat with subtle box-shadow depth, no heavy gradients
- Generous whitespace
- Card-based layouts with subtle shadows

**CSS variables to set up in the app:**
```css
:root {
  --jn-blue: #3968C6;
  --jn-deep-blue: #1F3E7A;
  --jn-night: #1F2C47;
  --jn-slate: #475C85;
  --jn-steel: #B8C5E0;
  --jn-cloud: #E3E5E9;
  --jn-green: #33CC99;
  --jn-sunset: #FF704C;
  --jn-bg: #F7F9FD;
  --jn-border: #D9E1F2;
  --jn-text: #1F2C47;
  --jn-text-secondary: #475C85;
  --jn-text-muted: #7A8FB8;
  --font-primary: 'Figtree', sans-serif;
  --font-mono: 'DM Mono', monospace;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgba(31,44,71,0.06);
  --shadow-md: 0 4px 12px rgba(31,44,71,0.08);
  --shadow-lg: 0 8px 24px rgba(31,44,71,0.12);
}
```

---

## Key Technical Decisions

1. **Google Solar API for measurement** — Pre-computed roof area, pitch, and segments. No vision-based guesswork. Numbers are defensible because they come from Google's aerial data.

2. **Claude Sonnet for Street View only** — Material ID, condition, and damage detection. The part Google doesn't do.

3. **SSE for pipeline progress** — Server-Sent Events from Express to stream step-by-step status to the frontend. Simpler than WebSocket for one-way updates.

4. **No pricing** — Variance between contractors is too high to publish a generic quote. The deliverable is a fully-prepped lead with all the data the contractor needs to quote it themselves.

5. **No database** — Everything flows through the pipeline and lands in JN. No persistence needed for the demo.

---

## Presentation Strategy

**Audience:** 3 tech leads + 2-3 product people + an AI bot reviewer. Half the human panel won't read code — they need to see the problem being solved. The AI bot will read it.

**Coding for AI review:**
- Clean, well-structured code — the bot will evaluate code quality and organization
- Meaningful variable/function names that make intent obvious without comments
- Clear separation of concerns (services, routes, components)
- Consistent patterns across the codebase
- No dead code, no leftover TODOs, no placeholder hacks
- README with clear setup instructions and architecture overview
- Commit history that tells a coherent story

**Narrative arc (90 seconds):**
1. **The problem** (10s) — "A roofing contractor spends 30+ minutes on intake — measuring, photographing, and writing up every lead — before they can even start quoting. By the time the estimate goes out, the homeowner called someone else."
2. **The solve** (40s) — Type/speak an address. The UI shows every pipeline step in real-time: geocoding → satellite fetch → measurement → AI analysis → JN push. Timer running the whole time. Lands in ~30-60 seconds.
3. **The proof** (20s) — Alt-tab to JN sandbox, refresh, contact + job are there with measurements and AI condition notes already filled in. Contractor opens the job, types in their numbers, sends the quote.
4. **The frame** (20s) — "This is what AssistAI looks like when it ships. Address in, fully-prepped lead in JobNimbus — contractor quotes it with their own pricing in seconds instead of hours."

**Key design decisions for the audience split:**
- **Visible pipeline steps** — not a loading spinner. Each step (geocode, satellite, measurement, vision, JN push) updates live. Product people see the "how". Tech leads see it's real.
- **No fake pricing** — we deliberately do NOT generate a price. Every contractor will respect this; it tells them the tool is honest about what it knows. The lead that lands in JN has everything they need to quote it themselves in seconds.
- **Timer front and center** — the single most persuasive visual. 38 seconds vs 30 minutes needs no explanation.
- **Confidence scores + honesty** — "Verify pitch on-site" flags show the system knows its limits. Tech leads trust this more than fake precision.
- **Annotated imagery** — roof facets drawn on the satellite photo, damage boxes on Street View. Visual proof the AI actually analyzed the property.

**Presentation assets to build:**
- [ ] Live demo (primary — this IS the presentation)
- [ ] 2-3 backup slides if something breaks: architecture diagram, accuracy chart, before/after workflow comparison
- [ ] Pre-recorded fallback video of a successful run (insurance)

---

## Verification / Demo Checklist

- [ ] Type an address → JN contact + job created within 60 seconds
- [ ] Roof stats card renders with sqft, pitch, and facet count
- [ ] AI analysis card renders with material, condition, and any visible damage
- [ ] Satellite + Street View images load
- [ ] Timer displays elapsed time prominently
- [ ] Alt-tab to JN, refresh, contact + job are there with measurements and AI notes in the job description (the mic-drop moment)
- [ ] Public GitHub repo — no secrets committed, README is clear, AI bot can understand the codebase
- [ ] `examples/` folder has 3-5 addresses with images + pipeline output JSON
