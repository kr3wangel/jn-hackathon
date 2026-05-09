import * as GeoTIFF from 'geotiff';
import { contours } from 'd3-contour';
import proj4 from 'proj4';

const SOLAR_API_BASE = 'https://solar.googleapis.com/v1';
const STATIC_MAP_ZOOM = 20;
const STATIC_MAP_SIZE = 640;

export async function fetchRoofPolygon(lat, lng, options = {}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY not set');

  const dataLayers = await fetchDataLayers(lat, lng, key);
  if (!dataLayers?.maskUrl) return null;

  const maskBuffer = await fetchAuthedBuffer(dataLayers.maskUrl, key);
  const { mask, width, height, origin, resolution, geoKeys } = await decodeMask(maskBuffer);

  // Optionally zero out regions of the mask before contour extraction. We use
  // this to remove patio cover / carport / awning areas that Solar's mask
  // includes by default (since Solar treats every flat-roofed structure as
  // a panel-mountable surface). The bounding boxes come from Solar's
  // `roofSegmentStats` and have already been classified as non-roof by
  // patioDetection.js. Zeroing here is the cleanest fix because it makes
  // the polygon AND every downstream perimeter measurement reflect the
  // main roof only — no separate clip/subtract logic needed.
  //
  // FAILURE MODE: Solar's segment bounding boxes are AXIS-ALIGNED rectangles
  // around possibly-diagonal/irregular roof planes. When a patio segment is
  // diagonal or sits between main-roof segments, its bbox can overlap with
  // real-roof segment bboxes. Zeroing those overlapping pixels erases real
  // roof. We protect against this by computing the polygon BOTH ways and
  // sanity-checking the trimmed area against the expected main-roof fraction;
  // if the trim erased too much, we fall back to the un-trimmed polygon.
  let ring;
  let trimApplied = false;
  if (Array.isArray(options.excludeBoundingBoxes) && options.excludeBoundingBoxes.length > 0) {
    const untrimmedRing = extractLargestPolygon(mask, width, height);

    const trimmedMask = mask.slice();
    maskOutBoundingBoxes(trimmedMask, width, height, origin, resolution, geoKeys, options.excludeBoundingBoxes);
    const trimmedRing = extractLargestPolygon(trimmedMask, width, height);

    const picked = pickSafelyTrimmedRing(untrimmedRing, trimmedRing, options.expectedKeepFraction);
    ring = picked.ring;
    trimApplied = picked.trimApplied;
  } else {
    ring = extractLargestPolygon(mask, width, height);
  }
  if (!ring) return null;

  // Simplify in mask pixel space — 1.5 px tolerance ≈ 0.4 m. This is for the
  // VISUAL outline (clean corners, no zigzag) only. We keep the unsimplified
  // ring for measurement so we don't lose perimeter from small bumpouts.
  const simplifiedMaskRing = simplifyDouglasPeucker(ring, 1.5);

  const toLatLng = makeProjector(geoKeys);
  const center = { lat, lng };
  // North-up GeoTIFFs: x increases east, y decreases as we go down rows.
  const xRes = Math.abs(resolution[0]);
  const yRes = Math.abs(resolution[1]);

  const projectMaskPoint = ([px, py]) => {
    const projX = origin[0] + px * xRes;
    const projY = origin[1] - py * yRes;
    return toLatLng(projX, projY);
  };

  const visualGeoRing = simplifiedMaskRing.map(projectMaskPoint);
  const detailedGeoRing = ring.map(projectMaskPoint);

  const polygon = visualGeoRing.map((point) =>
    latLngToStaticMapNorm(point, center, STATIC_MAP_ZOOM, STATIC_MAP_SIZE)
  );

  return {
    polygon: removeClosingDuplicate(polygon),
    geoPolygon: removeClosingGeoDuplicate(detailedGeoRing),
    confidence: 'high',
    source: 'google-solar-datalayers',
    patioTrimApplied: trimApplied,
  };
}

function removeClosingGeoDuplicate(points) {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lng - last.lng) < 1e-9) {
    return points.slice(0, -1);
  }
  return points;
}

async function fetchDataLayers(lat, lng, key) {
  const url = `${SOLAR_API_BASE}/dataLayers:get?` + new URLSearchParams({
    'location.latitude': String(lat),
    'location.longitude': String(lng),
    radiusMeters: '60',
    view: 'IMAGERY_LAYERS',
    requiredQuality: 'HIGH',
    pixelSizeMeters: '0.25',
    key,
  });

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Solar dataLayers failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function fetchAuthedBuffer(url, key) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}key=${key}`);
  if (!res.ok) throw new Error(`Mask fetch failed (${res.status})`);
  return res.arrayBuffer();
}

async function decodeMask(buffer) {
  const tiff = await GeoTIFF.fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const geoKeys = image.getGeoKeys();
  const rasters = await image.readRasters();
  const mask = Array.from(rasters[0]);
  return { mask, width, height, origin, resolution, geoKeys };
}

function extractLargestPolygon(mask, width, height) {
  const generator = contours().size([width, height]).thresholds([0.5]);
  const result = generator(mask);
  if (!result.length) return null;

  const polygons = [];
  for (const polygon of result[0].coordinates) {
    const ring = polygon[0];
    if (!ring) continue;
    const area = Math.abs(signedRingArea(ring));
    const centroid = ringCentroid(ring);
    polygons.push({ ring, area, centroid });
  }

  // Pick the polygon whose centroid is closest to the image center —
  // the address point is the geometric center of the requested mask area,
  // so the centered house's footprint will have the centroid nearest there.
  const cx = width / 2;
  const cy = height / 2;
  polygons.sort((a, b) => {
    const da = (a.centroid.x - cx) ** 2 + (a.centroid.y - cy) ** 2;
    const db = (b.centroid.x - cx) ** 2 + (b.centroid.y - cy) ** 2;
    return da - db;
  });

  return polygons[0]?.ring || null;
}

function simplifyDouglasPeucker(ring, tolerance) {
  if (ring.length < 4) return ring;
  const tolSq = tolerance * tolerance;

  // Treat the ring as closed: simplify in two halves anchored on the
  // farthest pair so we don't lose either endpoint of an arbitrary cut.
  let maxDistSq = -1;
  let farthest = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i][0] - ring[0][0];
    const dy = ring[i][1] - ring[0][1];
    const d = dx * dx + dy * dy;
    if (d > maxDistSq) {
      maxDistSq = d;
      farthest = i;
    }
  }

  const first = simplifySegment(ring, 0, farthest, tolSq);
  const second = simplifySegment(ring, farthest, ring.length - 1, tolSq);
  return [...first.slice(0, -1), ...second];
}

function simplifySegment(points, start, end, tolSq) {
  if (end <= start + 1) return [points[start], points[end]];

  let maxDistSq = 0;
  let maxIdx = start;
  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistanceSq(points[i], points[start], points[end]);
    if (d > maxDistSq) {
      maxDistSq = d;
      maxIdx = i;
    }
  }

  if (maxDistSq <= tolSq) {
    return [points[start], points[end]];
  }
  const left = simplifySegment(points, start, maxIdx, tolSq);
  const right = simplifySegment(points, maxIdx, end, tolSq);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistanceSq(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    const ddx = p[0] - a[0];
    const ddy = p[1] - a[1];
    return ddx * ddx + ddy * ddy;
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const cx = a[0] + clamped * dx;
  const cy = a[1] + clamped * dy;
  const ddx = p[0] - cx;
  const ddy = p[1] - cy;
  return ddx * ddx + ddy * ddy;
}

function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  return { x: x / ring.length, y: y / ring.length };
}

// Decide whether to trust the patio-trimmed polygon or fall back to the
// un-trimmed one. Patio bbox erasure can over-trim when Solar's axis-aligned
// segment bboxes overlap with neighboring real-roof segments. If the trimmed
// polygon's area is significantly below what we'd expect from "full minus
// patio", that's the over-trim signature — bail out.
function pickSafelyTrimmedRing(untrimmedRing, trimmedRing, expectedKeepFraction) {
  if (!trimmedRing) return { ring: untrimmedRing, trimApplied: false };
  if (!untrimmedRing) return { ring: trimmedRing, trimApplied: true };

  const untrimmedArea = Math.abs(signedRingArea(untrimmedRing));
  const trimmedArea = Math.abs(signedRingArea(trimmedRing));
  if (untrimmedArea === 0) return { ring: trimmedRing, trimApplied: true };

  // Expected fraction = (full structure - patio) / full structure. If we
  // weren't told, default to 0.5 so any trim removing more than half the
  // structure looks suspicious.
  const expected = typeof expectedKeepFraction === 'number' ? expectedKeepFraction : 0.5;
  // Allow up to 15% extra erosion below the expected keep fraction before we
  // call it over-trim. This tolerates the small over-trim that's normal
  // (patio bbox is a tight box, real patio is slightly smaller).
  const minAcceptableFraction = expected * 0.85;
  const actualFraction = trimmedArea / untrimmedArea;

  if (actualFraction >= minAcceptableFraction) {
    return { ring: trimmedRing, trimApplied: true };
  }
  console.warn(
    `[roofMask] patio trim erased ${((1 - actualFraction) * 100).toFixed(0)}% of polygon ` +
    `(expected to erase ~${((1 - expected) * 100).toFixed(0)}%); ` +
    'Solar bbox overlap detected, falling back to un-trimmed polygon for visual'
  );
  return { ring: untrimmedRing, trimApplied: false };
}

function signedRingArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return a / 2;
}

// Zero out mask pixels inside any of the given lat/lng bounding boxes. Used
// to remove non-roof structures (patio covers, carports) before contour
// extraction. Works in the GeoTIFF's native projection so we project each
// bbox corner from WGS84 → mask CRS once, then compute pixel ranges.
function maskOutBoundingBoxes(mask, width, height, origin, resolution, geoKeys, bboxes) {
  const fromLatLng = makeReverseProjector(geoKeys);
  const xRes = Math.abs(resolution[0]);
  const yRes = Math.abs(resolution[1]);
  // Small dilation so we don't leave a single-pixel halo at the boundary.
  const PADDING_PX = 2;

  for (const bbox of bboxes) {
    if (!bbox?.ne || !bbox?.sw) continue;
    const ne = fromLatLng(bbox.ne.latitude, bbox.ne.longitude);
    const sw = fromLatLng(bbox.sw.latitude, bbox.sw.longitude);
    const pxA = (ne.x - origin[0]) / xRes;
    const pyA = (origin[1] - ne.y) / yRes;
    const pxB = (sw.x - origin[0]) / xRes;
    const pyB = (origin[1] - sw.y) / yRes;

    const minX = Math.max(0, Math.floor(Math.min(pxA, pxB)) - PADDING_PX);
    const maxX = Math.min(width - 1, Math.ceil(Math.max(pxA, pxB)) + PADDING_PX);
    const minY = Math.max(0, Math.floor(Math.min(pyA, pyB)) - PADDING_PX);
    const maxY = Math.min(height - 1, Math.ceil(Math.max(pyA, pyB)) + PADDING_PX);

    for (let y = minY; y <= maxY; y++) {
      const rowStart = y * width;
      for (let x = minX; x <= maxX; x++) {
        mask[rowStart + x] = 0;
      }
    }
  }
}

function makeReverseProjector(geoKeys) {
  // 4326 (WGS84 lat/lng) → mask's projected CRS. Mirror of makeProjector.
  const epsg = geoKeys?.ProjectedCSTypeGeoKey || geoKeys?.GeographicTypeGeoKey;
  if (!epsg || epsg === 4326) {
    return (lat, lng) => ({ x: lng, y: lat });
  }
  const targetProj = `EPSG:${epsg}`;
  if (!proj4.defs(targetProj)) {
    if (epsg >= 32601 && epsg <= 32660) {
      const zone = epsg - 32600;
      proj4.defs(targetProj, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
    } else if (epsg >= 32701 && epsg <= 32760) {
      const zone = epsg - 32700;
      proj4.defs(targetProj, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
    } else {
      throw new Error(`Unsupported GeoTIFF projection EPSG:${epsg}`);
    }
  }
  return (lat, lng) => {
    const [x, y] = proj4('EPSG:4326', targetProj, [lng, lat]);
    return { x, y };
  };
}

function makeProjector(geoKeys) {
  const epsg = geoKeys?.ProjectedCSTypeGeoKey || geoKeys?.GeographicTypeGeoKey;
  if (!epsg || epsg === 4326) {
    return (x, y) => ({ lng: x, lat: y });
  }
  const sourceProj = `EPSG:${epsg}`;
  if (!proj4.defs(sourceProj)) {
    // proj4 has UTM definitions built-in for codes 32601-32660 (north) / 32701-32760 (south)
    if (epsg >= 32601 && epsg <= 32660) {
      const zone = epsg - 32600;
      proj4.defs(sourceProj, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
    } else if (epsg >= 32701 && epsg <= 32760) {
      const zone = epsg - 32700;
      proj4.defs(sourceProj, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
    } else {
      throw new Error(`Unsupported GeoTIFF projection EPSG:${epsg}`);
    }
  }
  return (x, y) => {
    const [lng, lat] = proj4(sourceProj, 'EPSG:4326', [x, y]);
    return { lat, lng };
  };
}

function latLngToStaticMapNorm(point, center, zoom, size) {
  const scale = 256 * Math.pow(2, zoom);

  const project = ({ lat, lng }) => {
    const x = (lng + 180) / 360 * scale;
    const sin = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    return { x, y };
  };

  const c = project(center);
  const p = project(point);

  return {
    x: (p.x - c.x + size / 2) / size,
    y: (p.y - c.y + size / 2) / size,
  };
}

function removeClosingDuplicate(points) {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
    return points.slice(0, -1);
  }
  return points;
}
