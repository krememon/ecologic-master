import { Loader } from '@googlemaps/js-api-loader';

let loaded = false;

export async function loadMapsOnce() {
  if (loaded && (window as any).google?.maps?.places) return (window as any).google;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error('[MapsLoader] Missing VITE_GOOGLE_MAPS_API_KEY env variable');
    throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY');
  }

  try {
    const loader = new Loader({ apiKey: key, libraries: ['places'] });
    await (loader as any).load();
  } catch (err: any) {
    console.error('[MapsLoader] Google Maps JS API load failed:', err.message || err);
    throw err;
  }

  if (!(window as any).google?.maps?.places) {
    console.error('[MapsLoader] Places library not available after load');
    throw new Error('Places library failed to load');
  }
  loaded = true;
  return (window as any).google;
}
