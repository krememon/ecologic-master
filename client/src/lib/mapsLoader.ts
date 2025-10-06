import { Loader } from '@googlemaps/js-api-loader';

let loader: Loader | null = null;
let loaded = false;

export async function loadMapsOnce() {
  if (loaded && (window as any).google?.maps?.places) return (window as any).google;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY');

  if (!loader) loader = new Loader({ apiKey: key, libraries: ['places'] });

  await loader.load();
  if (!(window as any).google?.maps?.places) {
    throw new Error('Places library failed to load');
  }
  loaded = true;
  return (window as any).google;
}
