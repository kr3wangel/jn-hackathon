export async function fetchImagery(lat, lng) {
  const satellite = buildStaticMapUrl(lat, lng);
  const streetView = buildStreetViewUrl(lat, lng);

  return { satellite, streetView };
}

function buildStaticMapUrl(lat, lng) {
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '20',
    size: '640x640',
    maptype: 'satellite',
    key: process.env.GOOGLE_MAPS_API_KEY,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}

function buildStreetViewUrl(lat, lng) {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    size: '640x480',
    key: process.env.GOOGLE_MAPS_API_KEY,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params}`;
}
