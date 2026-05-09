import { Router } from 'express';
import { fetchImagery } from '../services/imagery.js';
import { fetchBuildingInsights } from '../services/solar.js';
import { fetchRoofPolygon } from '../services/roofMask.js';
import { computeLineItems } from '../services/roofMeasurements.js';
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

    const [roofData, imagery, roofOutline] = await Promise.all([
      fetchBuildingInsights(lat, lng),
      fetchImagery(lat, lng),
      fetchRoofPolygon(lat, lng).catch((e) => {
        console.warn('Roof mask fetch failed:', e.message);
        return null;
      }),
    ]);

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
      jobnimbus: jnResult,
    });
  } catch (err) {
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});
