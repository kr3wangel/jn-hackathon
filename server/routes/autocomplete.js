import { Router } from 'express';

export const autocompleteRouter = Router();

autocompleteRouter.get('/autocomplete', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ predictions: [] });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not set' });

  const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json?' + new URLSearchParams({
    input: q,
    types: 'address',
    components: 'country:us',
    key,
  });

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(502).json({ error: data.status, message: data.error_message });
    }
    const predictions = (data.predictions || []).map(p => ({
      description: p.description,
      placeId: p.place_id,
    }));
    res.json({ predictions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
