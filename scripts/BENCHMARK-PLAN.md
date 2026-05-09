# Benchmark Testing & Prompt Iteration Plan

## Goal

Systematically test 5 calibration properties against published reference values, identify which line-item measurements fall outside acceptable thresholds, and iterate on the satellite vision prompt to improve per-line-item accuracy — without overfitting to specific properties.

## What we're optimizing

The satellite vision prompt in `server/services/vision.js` (`buildSatellitePrompt` function). This controls how Claude Sonnet enumerates ridges, hips, and valleys from the satellite image. Sqft comes from Google Solar API and is not tunable.

## Per-line-item reference data

Source: [JobNimbus hackathon benchmark-measurements.md](https://github.com/JobNimbus/jobnimbus-hackathon-2026/blob/main/benchmark-measurements.md)

Ref A sometimes combines Ridge/Hip into one number. Ref B always splits them. Ref B is primary for per-line-item comparison; Ref A for totals.

### Humble TX — 21106 Kenswick Meadows Ct, Humble, TX 77338

| Item | Ref A | Ref B | Avg |
|---|---|---|---|
| Sqft | 2,443 | 2,343 | 2,393 |
| Ridge | (141 R+H) | 26 | ~26 |
| Hip | (141 R+H) | 101 | ~101 |
| Valley | 40 | 38 | 39 |
| Rake | 101 | 83 | 92 |
| Eave | 187 | 164 | 176 |

### Spring TX — 5914 Copper Lilly Lane, Spring, TX 77389

| Item | Ref A | Ref B | Avg |
|---|---|---|---|
| Sqft | 4,391 | 4,296 | 4,344 |
| Ridge | 79 | 77 | 78 |
| Hip | 321 | 348 | 335 |
| Valley | 197 | 195 | 196 |
| Rake | 121 | 119 | 120 |
| Eave | 324 | 293 | 309 |

### Cape Coral FL — 122 NW 13th Ave, Cape Coral, FL 33993

| Item | Ref A | Ref B | Avg |
|---|---|---|---|
| Sqft | 2,917 | 2,851 | 2,884 |
| Ridge | 59 | 59 | 59 |
| Hip | 83 | 81 | 82 |
| Valley | 22 | 21 | 22 |
| Rake | 51 | 49 | 50 |
| Eave | 201 | 198 | 200 |

### Orland Park IL — 14132 Trenton Ave, Orland Park, IL 60462

| Item | Ref A | Ref B | Avg |
|---|---|---|---|
| Sqft | 2,990 | 2,935 | 2,963 |
| Ridge | (241 R+H) | 48 | ~48 |
| Hip | (241 R+H) | 187 | ~187 |
| Valley | 78 | 78 | 78 |
| Rake | 0 | 0 | 0 |
| Eave | 255 | 251 | 253 |

### Nixa MO — 835 S Cobble Creek, Nixa, MO 65714

| Item | Ref A | Ref B | Avg |
|---|---|---|---|
| Sqft | 3,070 | 3,017 | 3,044 |
| Ridge | (232 R+H) | 79 | ~79 |
| Hip | (232 R+H) | 150 | ~150 |
| Valley | 113 | 111 | 112 |
| Rake | 50 | 48 | 49 |
| Eave | 211 | 208 | 210 |

## Thresholds

- **Sqft:** ≤10% off reference average
- **Per-line-item (ridges, hips, valleys):** ≤25% off reference — tracked individually
- **Perimeter/eaves/rakes:** informational (geometric, not prompt-dependent)

## Methodology

1. Run all 5 calibration properties through the full pipeline
2. Compare each line item individually against reference values
3. Identify systematic biases (e.g., "hips are consistently 30% short across all properties")
4. Make structural prompt changes that address the bias generally
5. Re-run and verify improvement without regression
6. Accept changes only if they improve the target line item across the majority of properties

**Constraint:** All prompt changes must be general/structural. No property-specific tuning.
