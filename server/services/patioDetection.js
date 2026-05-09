// Patio / carport / awning detection on Google Solar API segments.
//
// =============================================================================
// WHY THIS EXISTS
// =============================================================================
// Google's Solar API `dataLayers` endpoint returns a roof mask designed for
// SOLAR PANEL PLACEMENT — not for roofing measurement. It treats any
// flat-roofed structure on the property as "roof", which means attached
// patio covers, carports, awnings, and lean-tos all show up inside the
// polygon and contribute to `wholeRoofStats.areaMeters2`.
//
// For a roofing contractor quoting a re-roof, those structures are NOT
// in scope. The contractor would either price them as a separate line item
// or skip them entirely. Including them in the measurement inflates the
// sqft we report and causes the polygon overlay to draw around the wrong
// structures.
//
// =============================================================================
// WHY WE'RE NOT USING A DIFFERENT DATA SOURCE
// =============================================================================
// We investigated alternatives to Solar's mask:
//
// - Google has internal building footprint data (the gray polygons on Maps),
//   but it is NOT exposed via any public API.
// - Microsoft Building Footprints — open dataset with ~125M US buildings,
//   typically excludes patios. Free, but it's a static 30 GB download
//   that would need to be hosted and queried locally. Out of scope for
//   this project's timeline.
// - OpenStreetMap (Overpass API) — has building polygons, free,
//   programmatic. But coverage of US residential suburbs is inconsistent
//   (volunteer-mapped); test set hits would be unreliable.
// - County GIS / parcel data — fragmented per-county, no general API.
//
// Conclusion: there is no clean drop-in replacement for Solar's mask. The
// pragmatic answer is to keep using Solar (which is excellent for
// measurement geometry) and apply a heuristic on its OWN per-segment data
// to exclude attached non-roof structures.
//
// =============================================================================
// HOW THIS HEURISTIC WORKS
// =============================================================================
// Solar API gives us a `roofSegmentStats` array. Each segment has:
//   - areaMeters2      (m² of that flat plane)
//   - pitchDegrees     (slope of that plane)
//   - azimuthDegrees   (compass direction the slope faces)
//
// Patio covers, carports, and awnings have a structural fingerprint that
// distinguishes them from main residential roof segments:
//
//   1. They are nearly flat (pitch typically 0:12 to 2:12) so water can
//      drain to a single edge. Main residential roofs are 4:12 to 12:12.
//
//   2. Their pitch is dramatically lower than the dominant roof pitch.
//      A house with an 8:12 main roof and a 1:12 attached structure is
//      almost certainly that structure being a patio cover.
//
//   3. They tend to be a meaningful fraction of total area (>50 sqft)
//      so we don't false-flag tiny architectural details.
//
// The detection finds the dominant pitch (weighted by segment area) and
// flags any segment whose pitch is far below it, subject to absolute and
// gap thresholds.
//
// =============================================================================
// KNOWN FAILURE MODES (do not silently ignore)
// =============================================================================
// 1. CONSTANT-PITCH PATIO: if the patio cover was built with the SAME pitch
//    as the main roof (rare but possible — homeowners sometimes match their
//    addition's pitch for aesthetics), this heuristic will not detect it.
//    Mitigation: vision-pass fallback (not yet implemented).
//
// 2. LOW-SLOPE MAIN ROOF: if the main roof is itself low pitch (e.g., <4:12
//    architectural style, mid-century modern), we can't disambiguate
//    between the main roof and a flat patio cover by pitch alone. We
//    intentionally DO NOT attempt detection in that case (returns
//    confidence: "low", patios: []).
//
// 3. INTENTIONAL LOW-SLOPE ADDITIONS: a sunroom or mansard transition with
//    legitimately low pitch could be flagged as a patio. The contractor
//    is the final judge — we surface this as "detected" with confidence,
//    not as ground truth.
//
// =============================================================================
// OUTPUT
// =============================================================================
// {
//   patioSegments: [{ index, areaSqft, pitchDegrees, ... }],
//   totalPatioSqft: number,
//   dominantPitchDegrees: number,
//   confidence: "high" | "medium" | "low",
//   reason: string  // human-readable explanation
// }

// Pitch thresholds in degrees:
//   18° ≈ 4:12, 15° ≈ 3:12, 10° ≈ 2:12, 5° ≈ 1:12
const MAIN_ROOF_MIN_PITCH_DEG = 18; // ≈ 4:12 — below this, can't disambiguate
const PATIO_MAX_PITCH_DEG = 15;     // ≈ 3:12 — patio covers commonly run 1:12 to 3:12
const PITCH_GAP_DEG = 8;            // ≈ 2:12 ratio gap between main and candidate
const MIN_PATIO_SQFT = 50;          // ignore tiny architectural slivers

export function detectPatioCovers(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return emptyResult('no segments to analyze');
  }

  const dominantPitchDeg = computeDominantPitch(segments);

  if (dominantPitchDeg < MAIN_ROOF_MIN_PITCH_DEG) {
    return emptyResult(
      `main roof pitch is low (${dominantPitchDeg.toFixed(1)}° ≈ ${degreesToRiseRun(dominantPitchDeg)}); ` +
      'cannot reliably distinguish patios from main roof by pitch alone',
      { dominantPitchDeg, confidence: 'low' }
    );
  }

  const patioSegments = segments.filter((seg) => isPatioCandidate(seg, dominantPitchDeg));
  const totalPatioSqft = patioSegments.reduce((sum, s) => sum + s.areaSqft, 0);

  if (patioSegments.length === 0) {
    return emptyResult('no pitch outliers detected', { dominantPitchDeg, confidence: 'high' });
  }

  // Confidence reflects how clear the pitch separation is.
  const minPatioPitch = Math.min(...patioSegments.map((s) => s.pitchDegrees));
  const gap = dominantPitchDeg - minPatioPitch;
  let confidence = 'medium';
  if (gap >= 15) confidence = 'high';
  else if (gap < 10) confidence = 'low';

  return {
    patioSegments,
    totalPatioSqft: Math.round(totalPatioSqft),
    dominantPitchDegrees: Math.round(dominantPitchDeg * 10) / 10,
    confidence,
    reason: `${patioSegments.length} segment${patioSegments.length === 1 ? '' : 's'} with pitch ` +
      `≤ ${PATIO_MAX_PITCH_DEG}° and ≥ ${PITCH_GAP_DEG}° below dominant ` +
      `${dominantPitchDeg.toFixed(1)}° pitch`,
  };
}

function isPatioCandidate(segment, dominantPitchDeg) {
  if (!segment) return false;
  if (segment.areaSqft < MIN_PATIO_SQFT) return false;
  if (segment.pitchDegrees > PATIO_MAX_PITCH_DEG) return false;
  if (dominantPitchDeg - segment.pitchDegrees < PITCH_GAP_DEG) return false;
  return true;
}

function computeDominantPitch(segments) {
  // Weighted by area so a small bumpout doesn't sway the dominant pitch.
  let totalArea = 0;
  let weighted = 0;
  for (const seg of segments) {
    totalArea += seg.areaSqft;
    weighted += seg.pitchDegrees * seg.areaSqft;
  }
  return totalArea === 0 ? 0 : weighted / totalArea;
}

function emptyResult(reason, extras = {}) {
  return {
    patioSegments: [],
    totalPatioSqft: 0,
    dominantPitchDegrees: extras.dominantPitchDeg ?? null,
    confidence: extras.confidence ?? 'low',
    reason,
  };
}

function degreesToRiseRun(deg) {
  const rise = Math.round(Math.tan((deg * Math.PI) / 180) * 12);
  return `${rise}:12`;
}
