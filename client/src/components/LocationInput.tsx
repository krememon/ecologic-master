import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { loadMapsOnce } from '@/lib/mapsLoader';
import { Input } from '@/components/ui/input';

export type Address = {
  street: string; city: string; state: string; postalCode: string;
  country: string; place_id: string; formatted_address: string;
};

interface Prediction {
  place_id: string;
  description: string;
}

export default function LocationInput({
  value, onChange, onAddressSelected, placeholder = 'Enter address', disabled = false,
}: {
  value: string; onChange: (v: string) => void;
  onAddressSelected: (a: Address) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [useBackend, setUseBackend] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectingRef = useRef(false);

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
        console.error('[LocationInput] Client-side autocomplete unavailable, using backend proxy:', err?.message || err);
        setUseBackend(true);
      });

    return () => { active = false; };
  }, []);

  const updateDropdownPosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

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
        updateDropdownPosition();
        setShowDropdown(true);
      } else if (data.status === 'ZERO_RESULTS') {
        setPredictions([]);
        setShowDropdown(false);
        setBackendError(false);
      } else {
        console.error('[LocationInput] Backend autocomplete error:', data.status, data.error_message || '');
        setPredictions([]);
        setShowDropdown(false);
        setBackendError(true);
      }
    } catch (err: any) {
      console.error('[LocationInput] Backend fetch failed:', err.message || err);
      setHasQueried(true);
      setBackendError(true);
      setPredictions([]);
      setShowDropdown(false);
    }
  }, [updateDropdownPosition]);

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

  const handleSelectPrediction = useCallback(async (prediction: Prediction) => {
    selectingRef.current = true;
    onChange(prediction.description);
    setPredictions([]);
    setShowDropdown(false);

    try {
      const resp = await fetch(`/api/google/places/details?placeId=${encodeURIComponent(prediction.place_id)}`);
      const data = await resp.json();
      if (data.status === 'OK' && data.result) {
        const comps = data.result.address_components || [];
        const get = (t: string) => comps.find((c: any) => c.types.includes(t))?.long_name || '';
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ').trim();
        const city = get('locality') || get('sublocality') || get('postal_town');
        const state = get('administrative_area_level_1');
        const postalCode = get('postal_code');
        const country = get('country');

        onAddressSelected({
          street: street || prediction.description,
          city, state, postalCode, country,
          place_id: prediction.place_id,
          formatted_address: data.result.formatted_address || prediction.description,
        });
      } else {
        onAddressSelected({
          street: prediction.description,
          city: '', state: '', postalCode: '', country: '',
          place_id: prediction.place_id,
          formatted_address: prediction.description,
        });
      }
    } catch {
      onAddressSelected({
        street: prediction.description,
        city: '', state: '', postalCode: '', country: '',
        place_id: prediction.place_id,
        formatted_address: prediction.description,
      });
    }
    selectingRef.current = false;
  }, [onChange, onAddressSelected]);

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      if (!selectingRef.current) {
        setShowDropdown(false);
      }
    }, 200);
  }, []);

  const showErrorBanner = useBackend && hasQueried && backendError;

  const dropdown = useBackend && showDropdown && predictions.length > 0
    ? createPortal(
        <ul
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 99999,
          }}
        >
          {predictions.map((p) => (
            <li
              key={p.place_id}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectPrediction(p);
              }}
            >
              {p.description}
            </li>
          ))}
        </ul>,
        document.body
      )
    : null;

  return (
    <div>
      <Input
        ref={inputRef}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => {
          updateDropdownPosition();
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
