import * as GeoTIFF from 'geotiff';
import { contours } from 'd3-contour';
import proj4 from 'proj4';

const SOLAR_API_BASE = 'https://solar.googleapis.com/v1';
const STATIC_MAP_ZOOM = 20;
const STATIC_MAP_SIZE = 640;

export async function fetchRoofPolygon(lat, lng) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY not set');

  const dataLayers = await fetchDataLayers(lat, lng, key);
  if (!dataLayers?.maskUrl) return null;

  const maskBuffer = await fetchAuthedBuffer(dataLayers.maskUrl, key);
  const { mask, width, height, origin, resolution, geoKeys } = await decodeMask(maskBuffer);

  const ring = extractLargestPolygon(mask, width, height);
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

function signedRingArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return a / 2;
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
