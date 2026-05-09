const METERS_PER_FOOT = 0.3048;

// Industry rules of thumb for flashing line items.
// Chimney step flashing: typical chimney is ~3-4' wide, flashing runs both
// sides + back saddle, ≈ 12 linear ft per chimney.
// Skylight step flashing: typical 4'×6' skylight needs flashing on all four
// sides (perimeter ~20 ft), so ≈ 18 ft accounting for overlap.
// Dormer wall flashing: typical dormer needs flashing along the head wall
// where it meets the main roof, ≈ 10 ft per dormer.
const STEP_FLASHING_PER_CHIMNEY_FT = 12;
const STEP_FLASHING_PER_SKYLIGHT_FT = 18;
const WALL_FLASHING_PER_DORMER_FT = 10;

// Roofing industry rule of thumb: total interior linear feet (ridges + hips
// + valleys) on a typical residential roof runs ~25-30 ft per distinct roof
// facet. A simple gable has fewer interior lines per facet; a complex hip
// has more. We use 27 (the midpoint) as the expected total.
//
// The vision pass enumerates each ridge/hip/valley individually, so this
// value only acts as a safety-net floor: if the model's total comes in
// significantly below expected (model_total < expected × 0.9), we scale its
// distribution proportionally to hit the expected total. This catches cases
// where vision can't trace every line on a complex roof but still got the
// per-line classification right.
const FT_PER_FACET = 27;
const CALIBRATION_THRESHOLD = 0.9;

export function computeLineItems({ geoPolygon, segments, visionData }) {
  if (!geoPolygon || geoPolygon.length < 3) return null;

  const edges = classifyEdges(geoPolygon, segments || []);

  const eaveFeet = sumByType(edges, 'eave');
  const rakeFeet = sumByType(edges, 'rake');
  const unknownFeet = sumByType(edges, 'unknown');
  const perimeterFeet = eaveFeet + rakeFeet + unknownFeet;
  const gutterFeet = eaveFeet;

  const interior = visionData?.satellite?.interiorLinearFeet || {};
  const facetCount = segments?.length || 0;
  const calibrated = calibrateInterior(
    {
      ridges: numberOrNull(interior.ridges),
      hips: numberOrNull(interior.hips),
      valleys: numberOrNull(interior.valleys),
    },
    facetCount
  );
  const ridgeFeet = calibrated.ridges;
  const hipFeet = calibrated.hips;
  const valleyFeet = calibrated.valleys;
  const ridgesSource = calibrated.calibrationApplied ? 'calibrated' : (ridgeFeet != null ? 'estimated' : 'unmeasured');
  const hipsSource = calibrated.calibrationApplied ? 'calibrated' : (hipFeet != null ? 'estimated' : 'unmeasured');
  const valleysSource = calibrated.calibrationApplied ? 'calibrated' : (valleyFeet != null ? 'estimated' : 'unmeasured');

  const obstacles = visionData?.streetView?.obstacles || {};
  const features = visionData?.streetView?.features || {};
  const stepFlashingFeet =
    (obstacles.chimneys || 0) * STEP_FLASHING_PER_CHIMNEY_FT +
    (obstacles.skylights || 0) * STEP_FLASHING_PER_SKYLIGHT_FT;
  const wallFlashingFeet = (features.dormers || 0) * WALL_FLASHING_PER_DORMER_FT;

  return {
    perimeterFeet: round(perimeterFeet),
    eaveFeet: round(eaveFeet),
    rakeFeet: round(rakeFeet),
    gutterFeet: round(gutterFeet),
    ridgeFeet,
    hipFeet,
    valleyFeet,
    wallFlashingFeet: round(wallFlashingFeet),
    stepFlashingFeet: round(stepFlashingFeet),
    edges, // detailed per-edge breakdown for debugging / segment overlay
    sources: {
      perimeter: 'measured', // from roof outline polygon
      eaveRake: segments?.length ? 'measured' : 'unmeasured',
      gutter: 'measured', // = eave
      ridges: ridgesSource,
      hips: hipsSource,
      valleys: valleysSource,
      wallFlashing: 'estimated',
      stepFlashing: 'estimated',
    },
  };
}

function classifyEdges(geoPolygon, segments) {
  const edges = [];
  for (let i = 0; i < geoPolygon.length; i++) {
    const a = geoPolygon[i];
    const b = geoPolygon[(i + 1) % geoPolygon.length];

    const lengthMeters = haversineMeters(a, b);
    const lengthFeet = lengthMeters / METERS_PER_FOOT;
    if (lengthFeet < 0.5) continue; // skip degenerate edges

    const midpoint = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    const bearing = bearingDegrees(a, b);

    const segment = nearestSegment(midpoint, segments);
    let type = 'unknown';
    if (segment) {
      const azimuth = segment.azimuthDegrees;
      const delta = angleDelta(bearing, azimuth);
      // delta is 0..90: 0 = parallel to slope direction (rake), 90 = perpendicular (eave)
      type = delta > 45 ? 'eave' : 'rake';
    }

    edges.push({
      lengthFeet: round(lengthFeet),
      bearing: round(bearing),
      type,
      midpoint,
      segmentIndex: segment?.index ?? null,
    });
  }
  return edges;
}

function nearestSegment(point, segments) {
  let best = null;
  let bestDist = Infinity;
  for (const seg of segments) {
    const center = segmentCenter(seg);
    if (!center) continue;
    const d = haversineMeters(point, center);
    if (d < bestDist) {
      bestDist = d;
      best = seg;
    }
  }
  return best;
}

function segmentCenter(segment) {
  const bb = segment.boundingBox;
  if (!bb || !bb.sw || !bb.ne) return null;
  return {
    lat: (bb.sw.latitude + bb.ne.latitude) / 2,
    lng: (bb.sw.longitude + bb.ne.longitude) / 2,
  };
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDegrees(a, b) {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDelta(bearing, azimuth) {
  // edge runs in 2 directions (bearing or bearing+180); take the closer one
  const diff1 = Math.abs(((bearing - azimuth + 540) % 360) - 180);
  const diff2 = Math.abs(((bearing + 180 - azimuth + 540) % 360) - 180);
  // We want angle between edge orientation and slope direction, 0..90
  return Math.min(diff1, diff2);
}

function sumByType(edges, type) {
  return edges
    .filter((e) => e.type === type)
    .reduce((sum, e) => sum + e.lengthFeet, 0);
}

function calibrateInterior(model, facetCount) {
  const r = model.ridges;
  const h = model.hips;
  const v = model.valleys;

  // No vision data, or no facet count to anchor on — pass through unchanged.
  if (r == null || h == null || v == null || !facetCount) {
    return { ridges: r, hips: h, valleys: v, calibrationApplied: false };
  }

  const modelTotal = r + h + v;
  const expectedTotal = facetCount * FT_PER_FACET;

  // Already in range — trust the model.
  if (modelTotal >= expectedTotal * CALIBRATION_THRESHOLD) {
    return { ridges: r, hips: h, valleys: v, calibrationApplied: false };
  }

  // Model under-counted. Scale its distribution up to hit the expected total.
  if (modelTotal === 0) {
    return { ridges: r, hips: h, valleys: v, calibrationApplied: false };
  }
  const scale = expectedTotal / modelTotal;
  return {
    ridges: Math.round(r * scale),
    hips: Math.round(h * scale),
    valleys: Math.round(v * scale),
    calibrationApplied: true,
  };
}

function numberOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function round(v) {
  return Math.round(v);
}

function toRad(d) {
  return (d * Math.PI) / 180;
}

function toDeg(r) {
  return (r * 180) / Math.PI;
}
