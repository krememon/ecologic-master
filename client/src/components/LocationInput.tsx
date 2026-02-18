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
  const dropdownRef = useRef<HTMLUListElement | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [useBackend, setUseBackend] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSelectingRef = useRef(false);

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
          const parsed = parseAddressComponents(p.address_components);
          onAddressSelected({
            ...parsed,
            place_id: p.place_id || '',
            formatted_address: p.formatted_address || '',
          });
        });
      })
      .catch((err: any) => {
        if (!active) return;
        setUseBackend(true);
      });

    return () => { active = false; };
  }, []);

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
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
  }, [updateDropdownPosition]);

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
        onAddressSelected({
          street: parsed.street || prediction.description,
          city: parsed.city,
          state: parsed.state,
          postalCode: parsed.postalCode,
          country: parsed.country,
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
    setTimeout(() => { isSelectingRef.current = false; }, 100);
  }, [onChange, onAddressSelected]);

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

  useEffect(() => {
    if (!showDropdown) return;
    const handleScroll = () => updateDropdownPosition();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [showDropdown, updateDropdownPosition]);

  const showErrorBanner = useBackend && hasQueried && backendError;

  const dropdown = useBackend && showDropdown && predictions.length > 0
    ? createPortal(
        <ul
          ref={dropdownRef}
          role="listbox"
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
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
