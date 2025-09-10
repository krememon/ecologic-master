import { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import { Input } from "@/components/ui/input";

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string, place?: any) => void;
  placeholder?: string;
  className?: string;
}

export function LocationAutocomplete({ 
  value, 
  onChange, 
  placeholder = "Enter location...",
  className 
}: LocationAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
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
            fields: ["formatted_address", "geometry", "place_id", "name"]
          });

          // Bias results toward Long Island, NY
          const longIslandBounds = new (window as any).google.maps.LatLngBounds(
            new (window as any).google.maps.LatLng(40.6, -73.8), // Southwest
            new (window as any).google.maps.LatLng(41.0, -71.8)  // Northeast
          );
          autocomplete.setBounds(longIslandBounds);

          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();
            if (place.formatted_address) {
              onChange(place.formatted_address, place);
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
    };
  }, []);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}