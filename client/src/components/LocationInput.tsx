import { useEffect, useRef } from 'react';
import { loadMapsOnce } from '@/lib/mapsLoader';

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

  useEffect(() => {
    let active = true;
    loadMapsOnce().then(() => {
      if (!active || !inputRef.current) return;

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
    });

    return () => { active = false; };
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      inputMode="text"
    />
  );
}
