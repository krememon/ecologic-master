import { Loader } from '@googlemaps/js-api-loader';

let loader: Loader | null = null;

export function getMapsLoader() {
  if (!loader) {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    loader = new Loader({
      apiKey: key!,
      libraries: ['places'],
    });
  }
  return loader;
}

export async function loadMapsOnce() {
  const l = getMapsLoader();
  await l.load();
  return window.google;
}
