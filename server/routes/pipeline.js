import { Router } from 'express';
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

    // Re-run with vision data to fill in interior lines + flashing.
    const lineItems = computeLineItems({
      geoPolygon: roofOutline?.geoPolygon,
      segments: roofData.segments,
      visionData,
    });

    // Tiered pricing — applies the contractor's "configured rates" to the
    // measured quantities. Flashing input combines wall + step flashing.
    const pricing = computeTieredPricing({
      totalAreaSqft: roofData.totalAreaSqft,
      flashingFeet: (lineItems?.wallFlashingFeet || 0) + (lineItems?.stepFlashingFeet || 0),
    });

    // Step 3: JobNimbus (requires JN_API_KEY)
    let jnResult = null;
    if (process.env.JN_API_KEY) {
      send('step', { step: 'jobnimbus', status: 'loading', message: 'Pushing to JobNimbus...' });
      try {
        jnResult = await pushToJobNimbus({ address, lat, lng, zip, roofData, visionData, lineItems });
        send('step', { step: 'jobnimbus', status: 'done', data: jnResult });
      } catch (jnErr) {
        send('step', { step: 'jobnimbus', status: 'done', data: { skipped: true, reason: jnErr.message } });
      }
    } else {
      send('step', { step: 'jobnimbus', status: 'done', data: { skipped: true, reason: 'JN_API_KEY not set' } });
    }

    send('done', {
      message: 'Pipeline complete',
      imagery,
      roofData,
      roofOutline,
      visionData,
      lineItems,
      pricing,
      jobnimbus: jnResult,
    });
  } catch (err) {
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});
