import { useEffect, useRef, useState, useCallback } from 'react';
import { useLoadScript } from '@react-google-maps/api';
import { Input } from '@/components/ui/input';

export type Address = {
  street: string; city: string; state: string; postalCode: string;
  country: string; place_id: string; formatted_address: string;
  lat?: number; lng?: number;
};

interface Prediction {
  place_id: string;
  description: string;
}

const LIBRARIES: ('places')[] = ['places'];

function parseAddressComponents(comps: any[]): Omit<Address, 'place_id' | 'formatted_address'> {
  const getLong = (t: string) => comps.find((c: any) => c.types.includes(t))?.long_name || '';
  const getShort = (t: string) => comps.find((c: any) => c.types.includes(t))?.short_name || '';
  const street = [getLong('street_number'), getLong('route')].filter(Boolean).join(' ').trim();
  const city = getLong('locality') || getLong('sublocality') || getLong('postal_town');
  const state = getShort('administrative_area_level_1');
  const postalCode = getLong('postal_code');
  const country = getLong('country');
  return { street, city, state, postalCode, country };
}

export default function LocationInput({
  value, onChange, onAddressSelected, placeholder = 'Enter address', disabled = false,
}: {
  value: string; onChange: (v: string) => void;
  onAddressSelected: (a: Address) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [useBackend, setUseBackend] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSelectingRef = useRef(false);
  const autocompleteInitRef = useRef(false);
  // Stable refs so autocomplete listeners always call the latest callbacks
  const onAddressSelectedRef = useRef(onAddressSelected);
  useEffect(() => { onAddressSelectedRef.current = onAddressSelected; });
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  // Use the same loader id as ScheduleMapView so
  // @react-google-maps/api deduplicates the script and never injects it twice.
  const { isLoaded, loadError } = useLoadScript({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
    libraries: LIBRARIES,
  });

  useEffect(() => {
    // ── Diagnostic snapshot (runs every time isLoaded/loadError changes) ──
    const mapsScriptTags = Array.from(document.querySelectorAll('script[src*="maps.googleapis.com"]')).map((s) => (s as HTMLScriptElement).src.replace(/key=[^&]+/, 'key=REDACTED'));
    console.log(
      '[LocationInput][diag] isLoaded:', isLoaded,
      '| loadError:', loadError?.message ?? loadError ?? null,
      '| apiKey present:', !!apiKey,
      '| apiKey suffix:', apiKey.slice(-6) || '(empty)',
      '| origin:', window.location.origin,
      '| window.google:', !!(window as any).google,
      '| window.google.maps:', !!(window as any).google?.maps,
      '| window.google.maps.places:', !!(window as any).google?.maps?.places,
      '| maps script tags:', mapsScriptTags.length, mapsScriptTags,
    );

    if (loadError) {
      console.error('[LocationInput] Google Maps script FAILED to load — switching to backend fallback. Error:', loadError.message ?? loadError);
      setUseBackend(true);
      return;
    }

    if (!isLoaded || !inputRef.current || autocompleteInitRef.current) return;
    if (!apiKey) {
      console.warn('[LocationInput] No API key — switching to backend fallback');
      setUseBackend(true);
      return;
    }

    autocompleteInitRef.current = true;
    console.log('[LocationInput] Attaching google.maps.places.Autocomplete — Places API available:', !!(window as any).google?.maps?.places);

    const ac = new google.maps.places.Autocomplete(inputRef.current!, {
      fields: ['address_components', 'formatted_address', 'place_id', 'geometry'],
      types: ['address'],
    });

    ac.addListener('place_changed', () => {
      const p = ac.getPlace();
      console.log('[LocationInput][place_changed] raw place:', p?.formatted_address ?? '(no formatted_address)', '| has address_components:', !!p?.address_components);
      if (!p?.address_components) {
        console.warn('[LocationInput][place_changed] No address_components — selection ignored');
        return;
      }
      const parsed = parseAddressComponents(p.address_components);
      const loc = p.geometry?.location;
      const addr = {
        ...parsed,
        place_id: p.place_id || '',
        formatted_address: p.formatted_address || '',
        lat: typeof loc?.lat === 'function' ? loc.lat() : undefined,
        lng: typeof loc?.lng === 'function' ? loc.lng() : undefined,
      };
      console.log('[LocationInput][place_changed] parsed:', addr.formatted_address, '| lat:', addr.lat, '| lng:', addr.lng);
      // Update the controlled input value so the text field shows the selected address
      onChangeRef.current(p.formatted_address || parsed.street || '');
      onAddressSelectedRef.current(addr);
    });

    const repositionPacContainer = () => {
      if (!inputRef.current) return;
      const pacEl = document.querySelector('.pac-container') as HTMLElement | null;
      if (!pacEl) return;
      const rect = inputRef.current.getBoundingClientRect();
      pacEl.style.position = 'fixed';
      pacEl.style.top = `${rect.bottom + 2}px`;
      pacEl.style.left = `${rect.left}px`;
      pacEl.style.width = `${rect.width}px`;
      pacEl.style.zIndex = '99999';
    };

    const observer = new MutationObserver(() => repositionPacContainer());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    inputRef.current!.addEventListener('focus', repositionPacContainer);
    inputRef.current!.addEventListener('input', repositionPacContainer);

    const inputEl = inputRef.current!;
    cleanupRef.current = () => {
      observer.disconnect();
      inputEl.removeEventListener('focus', repositionPacContainer);
      inputEl.removeEventListener('input', repositionPacContainer);
    };

    return () => {
      cleanupRef.current?.();
    };
  }, [isLoaded, loadError, apiKey]);

  const fetchPredictions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }
    try {
      const resp = await fetch(`/api/google/places/autocomplete?q=${encodeURIComponent(query)}`);
      const data = await resp.json();
      setHasQueried(true);
      if (data.status === 'OK' && data.predictions?.length > 0) {
        setPredictions(data.predictions.map((p: any) => ({ place_id: p.place_id, description: p.description })));
        setBackendError(false);
        setShowDropdown(true);
      } else if (data.status === 'ZERO_RESULTS') {
        setPredictions([]);
        setShowDropdown(false);
        setBackendError(false);
      } else {
        setPredictions([]);
        setShowDropdown(false);
        setBackendError(true);
      }
    } catch {
      setHasQueried(true);
      setBackendError(true);
      setPredictions([]);
      setShowDropdown(false);
    }
  }, []);

  const selectPrediction = useCallback(async (prediction: Prediction) => {
    isSelectingRef.current = true;
    onChange(prediction.description);
    setPredictions([]);
    setShowDropdown(false);

    try {
      const resp = await fetch(`/api/google/places/details?placeId=${encodeURIComponent(prediction.place_id)}`);
      const data = await resp.json();
      if (data.status === 'OK' && data.result?.address_components) {
        const parsed = parseAddressComponents(data.result.address_components);
        const geoLoc = data.result.geometry?.location;
        const lat = typeof geoLoc?.lat === 'number' ? geoLoc.lat : undefined;
        const lng = typeof geoLoc?.lng === 'number' ? geoLoc.lng : undefined;
        onAddressSelectedRef.current({
          street: parsed.street || prediction.description,
          city: parsed.city,
          state: parsed.state,
          postalCode: parsed.postalCode,
          country: parsed.country,
          place_id: prediction.place_id,
          formatted_address: data.result.formatted_address || prediction.description,
          lat,
          lng,
        });
      } else {
        onAddressSelectedRef.current({
          street: prediction.description,
          city: '', state: '', postalCode: '', country: '',
          place_id: prediction.place_id,
          formatted_address: prediction.description,
        });
      }
    } catch {
      onAddressSelectedRef.current({
        street: prediction.description,
        city: '', state: '', postalCode: '', country: '',
        place_id: prediction.place_id,
        formatted_address: prediction.description,
      });
    }
    setTimeout(() => { isSelectingRef.current = false; }, 100);
  }, [onChange]);

  const handleChange = useCallback((val: string) => {
    onChange(val);
    if (!useBackend) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (val.length >= 3) {
      debounceTimerRef.current = setTimeout(() => fetchPredictions(val), 300);
    } else {
      setPredictions([]);
      setShowDropdown(false);
    }
  }, [onChange, useBackend, fetchPredictions]);

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      if (!isSelectingRef.current) {
        setShowDropdown(false);
      }
    }, 250);
  }, []);

  const showErrorBanner = useBackend && hasQueried && backendError;

  const dropdown = useBackend && showDropdown && predictions.length > 0
    ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto z-[9999]"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {predictions.map((p, idx) => (
            <li
              key={p.place_id + idx}
              role="option"
              className="px-3 py-2.5 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700 active:bg-blue-100 dark:active:bg-slate-600 text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 last:border-b-0 select-none"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                selectPrediction(p);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                selectPrediction(p);
              }}
            >
              {p.description}
            </li>
          ))}
        </ul>
      )
    : null;

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => {
          if (useBackend && predictions.length > 0) setShowDropdown(true);
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        inputMode="text"
        className="w-full h-9 text-sm"
      />
      {dropdown}
      {showErrorBanner && (
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
          Autocomplete unavailable. Manual entry still works.
        </p>
      )}
    </div>
  );
}
