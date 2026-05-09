## Always keep in mind

While working on this project, always keep these two sections of `PLAN.md` front-of-mind:

- **Judging Criteria** (`PLAN.md` → "Judging Criteria") — the 5 things we're scored on: Accuracy, Product, Experience, Craft, Demo. Every decision should ladder up to one of these.
- **Submission Requirements** (`PLAN.md` → "Submission Requirements") — what must be in by Saturday 1:30 PM: 5 test-property sqft values, Google Form, public repo with README + outputs.

Re-read both before suggesting new features or scope changes.

---

JobNimbus Hackathon — Build Brief
Bounty
$10K from JobNimbus (the #1 CRM for roofing/contracting). Build an AI pipeline that takes property information and produces an accurate customer-facing estimate, fully automated, end-to-end, in under 24 hours. Replaces a 30+ minute contractor workflow with seconds.
Strategic framing
The trap is building a roof measurement tool — that market is saturated (EagleView, Roofr, Hover, GeoQuote, QuoteIQ, iRoofing) and JobNimbus already integrates with EagleView. Measurement is a commodity. The actual win is the judgment layer on top: address → closeable, multi-tier proposal sitting in the JobNimbus CRM. Sell the deal, not the measurement.
Judges are JobNimbus engineers. They will try to break the demo. Build for that.
Pipeline architecture

Input — address (typed or voice via Web Speech API)
Property fetch — geocode (Google Maps), satellite imagery, Street View, parcel/county data, year built
Vision pass on satellite — Claude Sonnet 4.5 or Gemini, structured JSON output: roof outline polygon, facet count, obstacles (chimneys, skylights, vents). SAM via Replicate as fallback for hard cases.
Vision pass on Street View — material identification (3-tab / architectural / metal), pitch estimate, age/condition signals, visible damage with bounding boxes
Geometry math — pixel polygon → sqft using map scale at known zoom → pitch multiplier (1.06 @ 3:12, 1.12 @ 6:12, 1.25 @ 9:12, 1.42 @ 12:12) → 10–15% waste factor
Tiered package generation — Good/Better/Best (3-tab, architectural, impact-resistant). Three-tier pricing closes more deals than single-number quotes; this is sales psychology baked into the product.
Pricing — per-zip JSON config: materials + labor + tear-off + dump + permits + margin. Seed with public industry-average rates, document the source.
Proposal generation — branded PDF + web view: roof diagram with annotated facets, line items, scope, timeline, warranty, e-sign button (capture name + timestamp + IP, no DocuSign needed)
JobNimbus push — POST contact + job + estimate via REST API at app.jobnimbus.com/api1/. Critical. Have a sandbox tab open during demo; refresh it post-pipeline; estimate appears live.
Customer delivery — email/SMS link to view + sign

What must be real vs what can be shortcut
Real (no excuses):

Satellite imagery fetch
Vision model call
Measurement math
Proposal output (PDF/web)
JobNimbus API integration — judges WILL check this

Reasonable shortcuts:

Pricing data (per-zip JSON config, defensible methodology, not live scraping)
E-signature (custom, not DocuSign)
Voice intake (free Web Speech API, not paid Whisper)
Calibration set (15–20 houses, not 1,000)

Tempting to fake but don't:

The segmentation itself — must work on arbitrary addresses, even imperfectly
Accuracy claims — must be backed by calibration evidence
The JobNimbus push — has to be live, in front of judges

Differentiators (in priority order)

Live timer on screen during demo — counts up from 0, lands ~30–60s. "Their workflow: 30 minutes. Ours: 38 seconds."
Three-tier proposals — most teams will show one number; we show a closeable sales document
Damage callouts on satellite image — vision-model bounding boxes on hail damage / missing shingles
Confidence scoring + honesty — flag uncertain measurements ("verify pitch on-site"); judges trust this more than fake precision
Calibration evidence — pre-test on 15–20 houses with Google Earth ground truth. Show "X% mean absolute error" chart.
Live JobNimbus push — alt-tab, refresh, estimate appears. Mic-drop moment.
Voice intake — sales rep speaks address, gets proposal on iPad. Cheap to build, demo flair.

Skip
Training own models, real auth/multi-tenancy, native mobile, complex commercial roofs, heavy tree cover edge cases.
24-hour time budget
HoursFocus0–2Architecture, work split, API keys (Google Maps, vision model, JobNimbus sandbox). Verify JN integration loop end-to-end with curl before anything else.2–8"Address in, square footage out" working end-to-end. Ugly is fine. Do not move on until this works.8–14Pricing engine + three-tier package logic + PDF/web proposal generator14–18JobNimbus integration + customer-facing UI polish18–22Damage detection + voice intake + calibration test on 15 houses22–24Demo script rehearsal, buffer, sleep
Team split (4 people)

A: Vision + measurement — satellite fetch, segmentation prompts, geometry math
B: Pricing + proposal — pricing config, PDF/web template, e-sign capture
C: Frontend + JobNimbus — UI, voice intake, JN API integration
D: Calibration + demo — ground-truth dataset, accuracy chart, demo script, polish

If 3 people, fold D into the others and skip voice intake.
Demo script (90 seconds)

"Contractors lose deals to speed. We took the 30-minute quoting workflow and built it as one prompt. [types address] — 38 seconds later: roof measured, damage flagged, three-tier proposal generated, pushed to JobNimbus as a real estimate, sent to the homeowner for e-sign. We tested it on 20 houses against tape-measure ground truth: X% mean error. This is what JobNimbus AssistAI looks like when it ships."

The last line is intentional — frame this as a JobNimbus product, not a competitor.
Highest-leverage first move
Register for a JobNimbus trial → generate API key → POST a test contact + job + estimate from curl → confirm it appears in the UI. Hour 1, not hour 22. If anything is going to block (auth weirdness, missing endpoint, rate limit), find out now.
Tech stack assumptions
React/Vite frontend, Node or Python backend (Python likely better for vision pipeline glue). AWS deployment optional — local + ngrok is fine for the demo.
Key APIs / docs

JobNimbus REST API: https://app.jobnimbus.com/api1/
API key generation: Settings → Integrations → API → New API Key
Postman collection exists publicly (search "JobNimbus Public API Postman")
Google Static Maps API for satellite imagery
Google Street View Static API for street-level
Mapbox as alternative
