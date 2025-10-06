import { useRef, useState, useEffect } from "react";
import { useLoadScript, Autocomplete } from "@react-google-maps/api";
import { Input } from "@/components/ui/input";

interface AddressComponents {
  formatted: string;
  city: string;
  postalCode: string;
  state: string;
  country: string;
  lat: number | null;
  lng: number | null;
  placeId: string;
}

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string, addressComponents?: AddressComponents) => void;
  placeholder?: string;
  className?: string;
}

const libraries: ("places")[] = ["places"];

function extractAddressComponents(place: google.maps.places.PlaceResult): AddressComponents {
  const comps = place.address_components || [];
  const find = (type: string) => {
    const c = comps.find((x) => x.types.includes(type));
    return c ? c.long_name : '';
  };
  
  const postalCode = find('postal_code') || '';
  const city =
    find('locality') ||
    find('postal_town') ||
    find('sublocality_level_1') ||
    find('administrative_area_level_2') ||
    '';
  const state = find('administrative_area_level_1') || '';
  const country = find('country') || '';
  const formatted = place.formatted_address || '';
  const lat = place.geometry?.location?.lat() ?? null;
  const lng = place.geometry?.location?.lng() ?? null;
  const placeId = place.place_id || '';
  
  return { formatted, postalCode, city, state, country, lat, lng, placeId };
}

export function LocationAutocomplete({ 
  value, 
  onChange, 
  placeholder = "Enter location...",
  className 
}: LocationAutocompleteProps) {
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey || "",
    libraries,
    id: 'ecologic-places-loader',
  });

  useEffect(() => {
    if (loadError) {
      console.warn("Google Maps API failed to load:", loadError);
      setIsFallback(true);
    }
  }, [loadError]);

  const onLoad = (autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;

    autocomplete.setOptions({
      types: ["address"],
      componentRestrictions: { country: "us" },
      fields: ["address_components", "formatted_address", "geometry", "place_id"]
    });

    const longIslandBounds = new google.maps.LatLngBounds(
      new google.maps.LatLng(40.6, -73.8),
      new google.maps.LatLng(41.0, -71.8)
    );
    autocomplete.setBounds(longIslandBounds);
  };

  const onPlaceChanged = () => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      
      if (place.formatted_address && place.address_components) {
        const addressComponents = extractAddressComponents(place);
        onChange(addressComponents.formatted, addressComponents);
      } else if (place.formatted_address) {
        onChange(place.formatted_address);
      }
    }
  };

  // Determine helper text
  let helperText = null;
  if (!apiKey) {
    helperText = "Google Places not configured. Using manual entry.";
  } else if (loadError || isFallback) {
    helperText = "Autocomplete unavailable. Using manual entry.";
  } else if (!isLoaded) {
    helperText = "Loading autocomplete...";
  }

  // Single persistent input element
  const inputElement = (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      data-testid="input-location-autocomplete"
    />
  );

  // Wrap with Autocomplete only when fully loaded and API is available
  const shouldUseAutocomplete = apiKey && isLoaded && !loadError && !isFallback;

  return (
    <div>
      {shouldUseAutocomplete ? (
        <Autocomplete
          onLoad={onLoad}
          onPlaceChanged={onPlaceChanged}
        >
          {inputElement}
        </Autocomplete>
      ) : (
        inputElement
      )}
      {helperText && (
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
          {helperText}
        </p>
      )}
    </div>
  );
}
