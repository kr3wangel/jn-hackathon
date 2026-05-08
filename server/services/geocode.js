export async function geocodeAddress(address) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY not set');

  const url = 'https://maps.googleapis.com/maps/api/geocode/json?' + new URLSearchParams({
    address,
    key,
  });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API error (${res.status})`);

  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Could not geocode address: ${data.status}`);
  }

  const result = data.results[0];
  const loc = result.geometry.location;

  let zip = '';
  let city = '';
  let state = '';
  for (const comp of result.address_components || []) {
    if (comp.types.includes('postal_code')) zip = comp.short_name;
    if (comp.types.includes('locality')) city = comp.short_name;
    if (comp.types.includes('administrative_area_level_1')) state = comp.short_name;
  }

  return {
    lat: loc.lat,
    lng: loc.lng,
    formatted_address: result.formatted_address,
    zip,
    city,
    state,
  };
}
