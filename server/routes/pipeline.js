import { Router } from 'express';
import { randomUUID } from 'crypto';
import { fetchImagery } from '../services/imagery.js';
import { fetchBuildingInsights } from '../services/solar.js';
import { fetchRoofPolygon } from '../services/roofMask.js';
import { computeLineItems } from '../services/roofMeasurements.js';
import { computeTieredPricing } from '../services/pricing.js';
import { analyzeProperty } from '../services/vision.js';
import { pushToJobNimbus } from '../services/jobnimbus.js';
import { geocodeAddress } from '../services/geocode.js';

export const pipelineRouter = Router();

pipelineRouter.post('/pipeline', async (req, res) => {
  let { address, lat, lng, zip } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'address is required' });
  }

  if (!lat || !lng) {
    try {
      const geo = await geocodeAddress(address);
      lat = geo.lat;
      lng = geo.lng;
      zip = zip || geo.zip;
    } catch (e) {
      return res.status(400).json({ error: `Could not geocode address: ${e.message}` });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Step 1: Imagery + Solar
    send('step', { step: 'imagery', status: 'loading', message: 'Fetching property data...' });

    // Solar (buildingInsights) + static map imagery in parallel — both fast.
    const [roofData, imagery] = await Promise.all([
      fetchBuildingInsights(lat, lng),
      fetchImagery(lat, lng),
    ]);

    // Now fetch the roof outline polygon, passing patio segment bounding
    // boxes so they get masked out of the GeoTIFF before contour extraction.
    // This is serialized after solar (rather than parallel) because we need
    // the patio detection result first. Adds ~500ms of latency vs full
    // parallelism, which is worth it to get a correct main-roof-only outline.
    const patioBoundingBoxes = (roofData.patioInfo?.patioSegments || [])
      .map((s) => s.boundingBox)
      .filter(Boolean);
    // What fraction of the full structure we expect to keep after patio trim.
    // roofMask uses this to detect Solar bbox overlap (over-trim) and fall
    // back to the un-trimmed polygon if the erasure exceeds the budget.
    const expectedKeepFraction = roofData.fullStructureSqft > 0
      ? (roofData.fullStructureSqft - roofData.patioSqft) / roofData.fullStructureSqft
      : 1;
    const roofOutline = await fetchRoofPolygon(lat, lng, {
      excludeBoundingBoxes: patioBoundingBoxes,
      expectedKeepFraction,
    }).catch((e) => {
      console.warn('Roof mask fetch failed:', e.message);
      return null;
    });

    send('step', { step: 'imagery', status: 'done', data: { ...imagery, roofData, roofOutline } });

    // Compute geometric line items first (perimeter, eaves, rakes) — these
    // become scale anchors for the vision prompt.
    const geometricLineItems = computeLineItems({
      geoPolygon: roofOutline?.geoPolygon,
      segments: roofData.segments,
      visionData: null,
    });

    // Step 2: Vision (requires ANTHROPIC_API_KEY)
    let visionData = null;
    if (process.env.ANTHROPIC_API_KEY) {
      send('step', { step: 'vision', status: 'loading', message: 'Analyzing roof with AI...' });
      try {
        visionData = await analyzeProperty(imagery.satellite, imagery.streetView, {
          totalAreaSqft: roofData.totalAreaSqft,
          facetCount: roofData.facetCount,
          avgPitchRatio: roofData.avgPitchRatio,
          perimeterFeet: geometricLineItems?.perimeterFeet,
        });
        send('step', { step: 'vision', status: 'done', data: visionData });
      } catch (err) {
        send('step', { step: 'vision', status: 'done', data: { skipped: true, reason: err.message } });
      }
    } else {
      send('step', { step: 'vision', status: 'done', data: { skipped: true, reason: 'ANTHROPIC_API_KEY not set' } });
    }

    // Short-circuit: large commercial buildings need a custom quote
    const isLargeCommercial = visionData?.propertyType === 'commercial'
      && visionData?.commercialScale === 'large';

    if (isLargeCommercial) {
      let jnResult = null;
      if (process.env.JN_API_KEY) {
        try {
          jnResult = await pushToJobNimbus({ address, lat, lng, zip, roofData, visionData, lineItems: null });
        } catch (jnErr) {
          jnResult = { skipped: true, reason: jnErr.message };
        }
      }

      const estimateId = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      send('done', {
        message: 'Pipeline complete',
        estimateId, imagery, roofData, roofOutline, visionData,
        lineItems: null, pricing: null,
        jobnimbus: jnResult,
        shortCircuit: 'commercial-large',
      });
      res.end();
      return;
    }

    // Measurements + pricing are synchronous — the client auto-advances
    // through these loader steps on a timer, so no SSE events needed.
    let lineItems = null;
    try {
      lineItems = computeLineItems({
        geoPolygon: roofOutline?.geoPolygon,
        segments: roofData.segments,
        visionData,
      });
    } catch (e) {
      console.error('computeLineItems failed:', e);
    }

    let pricing = null;
    try {
      pricing = computeTieredPricing({
        totalAreaSqft: roofData.totalAreaSqft,
        flashingFeet: (lineItems?.wallFlashingFeet || 0) + (lineItems?.stepFlashingFeet || 0),
      });
    } catch (e) {
      console.error('computeTieredPricing failed:', e);
    }

    // JobNimbus push
    let jnResult = null;
    if (process.env.JN_API_KEY) {
      try {
        jnResult = await pushToJobNimbus({ address, lat, lng, zip, roofData, visionData, lineItems });
      } catch (jnErr) {
        jnResult = { skipped: true, reason: jnErr.message };
      }
    }

    // Strip the per-edge breakdown from lineItems before serializing — it's
    // a debug artifact (hundreds of 1ft entries on detailed polygons) that
    // the UI doesn't render and that bloats the SSE payload to ~100KB,
    // increasing the chance of the `done` record getting split across TCP
    // chunks.
    const lineItemsForClient = lineItems ? (() => { const { edges, ...rest } = lineItems; return rest; })() : null;

    // Stable estimate ID — generated once at pipeline completion so the UI
    // and any subsequent PDF download stamp the same number.
    const estimateId = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

    send('done', {
      message: 'Pipeline complete',
      estimateId,
      imagery,
      roofData,
      roofOutline,
      visionData,
      lineItems: lineItemsForClient,
      pricing,
      jobnimbus: jnResult,
    });
  } catch (err) {
    console.error('Pipeline error:', err);
    send('error', { message: err.message, code: err.code || null });
  } finally {
    res.end();
  }
});
