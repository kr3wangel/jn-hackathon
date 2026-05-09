import { detectPatioCovers } from './patioDetection.js';

const SOLAR_API_BASE = 'https://solar.googleapis.com/v1';

const SQ_METERS_TO_SQ_FEET = 10.764;

export async function fetchBuildingInsights(lat, lng) {
  const url = `${SOLAR_API_BASE}/buildingInsights:findClosest?` + new URLSearchParams({
    'location.latitude': lat,
    'location.longitude': lng,
    requiredQuality: 'HIGH',
    key: process.env.GOOGLE_MAPS_API_KEY,
  });

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Solar API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return parseRoofData(data);
}

function parseRoofData(data) {
  const solar = data.solarPotential;
  if (!solar) throw new Error('No solar potential data available for this address');

  const totalAreaM2 = solar.wholeRoofStats?.areaMeters2 || 0;
  const totalAreaSqft = totalAreaM2 * SQ_METERS_TO_SQ_FEET;

  const segments = (solar.roofSegmentStats || []).map((seg, i) => {
    const areaM2 = seg.stats?.areaMeters2 || 0;
    const pitchDeg = seg.pitchDegrees || 0;
    const azimuth = seg.azimuthDegrees || 0;

    return {
      index: i,
      areaSqft: areaM2 * SQ_METERS_TO_SQ_FEET,
      pitchDegrees: pitchDeg,
      pitchRatio: degreesToRiseRun(pitchDeg),
      azimuthDegrees: azimuth,
      boundingBox: seg.boundingBox || null,
    };
  });

  // Detect attached non-roof structures (patio covers, carports, awnings) by
  // pitch outliers. See server/services/patioDetection.js for full reasoning
  // and known limitations. We exclude these from the main-roof sqft because
  // a roofing contractor is not quoting them as part of a re-roof.
  const patioInfo = detectPatioCovers(segments);
  const patioIndexes = new Set(patioInfo.patioSegments.map((p) => p.index));
  const mainRoofSegments = segments.filter((s) => !patioIndexes.has(s.index));
  const mainRoofAreaSqft = totalAreaSqft - patioInfo.totalPatioSqft;

  // Compute average pitch from main-roof segments only — including a low-pitch
  // patio cover would skew the average downward and mis-classify the roof.
  const pitchSource = mainRoofSegments.length > 0 ? mainRoofSegments : segments;
  const avgPitchDeg = pitchSource.length > 0
    ? pitchSource.reduce((sum, s) => sum + s.pitchDegrees, 0) / pitchSource.length
    : 0;

  // Solar API areaMeters2 is already the 3D roof plane area (accounts for pitch).
  // Only apply waste factor for material ordering — do NOT re-apply pitch multiplier.
  const wasteFactor = 1.10;
  const materialSqft = mainRoofAreaSqft * wasteFactor;
  const roofingSquares = materialSqft / 100;

  return {
    totalAreaSqft: Math.round(mainRoofAreaSqft),
    fullStructureSqft: Math.round(totalAreaSqft), // includes patios — kept for transparency
    patioSqft: patioInfo.totalPatioSqft,
    patioInfo, // segments, confidence, reason
    materialSqft: Math.round(materialSqft),
    roofingSquares: Math.round(roofingSquares * 10) / 10,
    facetCount: mainRoofSegments.length,
    fullStructureFacetCount: segments.length,
    avgPitchDegrees: Math.round(avgPitchDeg * 10) / 10,
    avgPitchRatio: degreesToRiseRun(avgPitchDeg),
    wasteFactor,
    segments: mainRoofSegments, // downstream measurement uses main-roof segments only
    allSegments: segments,       // includes patios — kept for diagnostic display
    imageryDate: data.imageryDate,
    imageryQuality: data.imageryQuality,
    postalCode: data.postalCode,
  };
}

function degreesToRiseRun(deg) {
  const rise = Math.round(Math.tan(deg * Math.PI / 180) * 12);
  return `${rise}:12`;
}
