import { useEffect, useRef, useState, useCallback } from 'react';
import { loadMapsOnce } from '@/lib/mapsLoader';
import { Input } from '@/components/ui/input';

export type Address = {
  street: string; city: string; state: string; postalCode: string;
  country: string; place_id: string; formatted_address: string;
};

export default function LocationInput({
  value, onChange, onAddressSelected, placeholder = 'Enter address', disabled = false,
}: {
  value: string; onChange: (v: string) => void;
  onAddressSelected: (a: Address) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    loadMapsOnce()
      .then(() => {
        if (!active || !inputRef.current) return;
        setMapsLoaded(true);

        const ac = new google.maps.places.Autocomplete(inputRef.current!, {
          fields: ['address_components', 'formatted_address', 'place_id'],
          types: ['address'],
        });
        autocompleteRef.current = ac;

        ac.addListener('place_changed', () => {
          const p = ac.getPlace();
          if (!p?.address_components) return;
          const get = (t: string) => p.address_components!.find(c => c.types.includes(t))?.long_name || '';
          const street = [get('street_number'), get('route')].filter(Boolean).join(' ').trim();
          const city = get('locality') || get('sublocality') || get('postal_town');
          const state = get('administrative_area_level_1');
          const postalCode = get('postal_code');
          const country = get('country');

          onAddressSelected({
            street, city, state, postalCode, country,
            place_id: p.place_id || '',
            formatted_address: p.formatted_address || '',
          });
        });
      })
      .catch((err: any) => {
        if (!active) return;
        const msg = err?.message || String(err);
        console.error('[LocationInput] Failed to load Google Maps:', msg);
        setLoadError(msg);
        tryBackendFallback(active);
      });

    return () => { active = false; };
  }, []);

  const tryBackendFallback = useCallback((active: boolean) => {
    if (!active) return;
    console.error('[LocationInput] Client-side autocomplete unavailable. Use backend /api/google/places/autocomplete for diagnostics.');
  }, []);

  const handleChange = useCallback((val: string) => {
    onChange(val);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!mapsLoaded && val.length >= 3) {
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const resp = await fetch(`/api/google/places/autocomplete?q=${encodeURIComponent(val)}`);
          const data = await resp.json();
          if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            console.error('[LocationInput] Backend autocomplete error:', data.status, data.error_message || data);
          }
        } catch (err: any) {
          console.error('[LocationInput] Backend autocomplete fetch failed:', err.message || err);
        }
      }, 400);
    }
  }, [onChange, mapsLoaded]);

  return (
    <div>
      <Input
        ref={inputRef}
        value={value}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        inputMode="text"
        className="w-full h-9 text-sm"
      />
      {loadError && (
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
          Autocomplete unavailable. Manual entry still works.
        </p>
      )}
    </div>
  );
}
