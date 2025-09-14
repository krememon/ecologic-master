import { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
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

// Helper function to extract address components from a place
function extractAddressComponents(place: any): AddressComponents {
  const comps = place.address_components || [];
  const find = (type: string) => {
    const c = comps.find((x: any) => x.types.includes(type));
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
  const lat = place.geometry?.location?.lat?.() ?? null;
  const lng = place.geometry?.location?.lng?.() ?? null;
  const placeId = place.place_id || '';
  
  return { formatted, postalCode, city, state, country, lat, lng, placeId };
}

export function LocationAutocomplete({ 
  value, 
  onChange, 
  placeholder = "Enter location...",
  className 
}: LocationAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const initializeAutocomplete = async () => {
      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
          console.warn("Google Maps API key not found, autocomplete disabled");
          return;
        }

        const loader = new Loader({
          apiKey,
          version: "weekly",
          libraries: ["places"]
        });

        await loader.load();
        setIsLoaded(true);

        if (inputRef.current && !autocompleteRef.current && (window as any).google) {
          const autocomplete = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
            types: ["address"],
            componentRestrictions: { country: "us" },
            fields: ["place_id", "formatted_address", "name"]
          });

          // Initialize Places service for getting details
          const service = new (window as any).google.maps.places.PlacesService(document.createElement('div'));
          placesServiceRef.current = service;

          // Bias results toward Long Island, NY
          const longIslandBounds = new (window as any).google.maps.LatLngBounds(
            new (window as any).google.maps.LatLng(40.6, -73.8), // Southwest
            new (window as any).google.maps.LatLng(41.0, -71.8)  // Northeast
          );
          autocomplete.setBounds(longIslandBounds);

          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();
            
            if (place.place_id && placesServiceRef.current) {
              // Get detailed place information
              placesServiceRef.current.getDetails({
                placeId: place.place_id,
                fields: ['address_components', 'formatted_address', 'geometry', 'place_id']
              }, (detailedPlace: any, status: any) => {
                if (status === (window as any).google.maps.places.PlacesServiceStatus.OK && detailedPlace) {
                  const addressComponents = extractAddressComponents(detailedPlace);
                  onChange(addressComponents.formatted, addressComponents);
                } else {
                  // Fallback to basic place info if getDetails fails
                  console.warn("Places getDetails failed, using basic place info");
                  if (place.formatted_address) {
                    onChange(place.formatted_address);
                  }
                }
              });
            } else if (place.formatted_address) {
              // Fallback for places without place_id
              onChange(place.formatted_address);
            }
          });

          autocompleteRef.current = autocomplete;
        }
      } catch (error) {
        console.warn("Failed to load Google Maps API:", error);
      }
    };

    initializeAutocomplete();

    // Cleanup
    return () => {
      if (autocompleteRef.current && (window as any).google) {
        (window as any).google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
      placesServiceRef.current = null;
    };
  }, []);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      data-testid="input-location-autocomplete"
    />
  );
}