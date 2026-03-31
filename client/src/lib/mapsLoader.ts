import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

// @googlemaps/js-api-loader v2 removed the Loader class.
// We now use the functional API: setOptions() + importLibrary().
// IMPORTANT: if @react-google-maps/api has already loaded the Maps script (via useJsApiLoader /
// useLoadScript with id='google-map-script'), we skip loading entirely and reuse window.google.

let loadPromise: Promise<any> | null = null;

export async function loadMapsOnce(): Promise<any> {
  // Fast path: already fully loaded by any loader (including @react-google-maps/api).
  if ((window as any).google?.maps?.places) {
    console.log('[MapsLoader] Google Maps + Places already loaded — skipping re-load');
    return (window as any).google;
  }

  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  console.log('[MapsLoader] key present:', Boolean(key), 'host:', window.location.hostname);

  if (!key) {
    const err = new Error('Missing VITE_GOOGLE_MAPS_API_KEY');
    console.error('[MapsLoader]', err.message);
    throw err;
  }

  loadPromise = (async () => {
    try {
      console.log('[MapsLoader] Starting load via setOptions/importLibrary...');
      setOptions({ apiKey: key });
      await importLibrary('places');

      if (!(window as any).google?.maps?.places) {
        throw new Error('Places library not available after import');
      }

      console.log('[MapsLoader] Loaded successfully');
      return (window as any).google as typeof window.google;
    } catch (err: any) {
      console.error('[MapsLoader] Load failed:', err.message ?? err);
      loadPromise = null;
      throw err;
    }
  })();

  return loadPromise;
}
