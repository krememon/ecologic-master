import { useCallback, useState, useRef, useEffect } from "react";
import { GoogleMap, useJsApiLoader, InfoWindow } from "@react-google-maps/api";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { MapPin, Clock, User, ChevronRight, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface ScheduleItem {
  type: 'job' | 'estimate';
  id: number;
  title: string;
  customerName: string | null;
  scheduledTime: string | null;
  scheduledEndTime: string | null;
  address: string | null;
  status: string;
  customerId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface ScheduleMapViewProps {
  items: ScheduleItem[];
  selectedDate: Date;
}

interface MarkerData extends ScheduleItem {
  lat: number;
  lng: number;
}

const containerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '400px'
};

const defaultCenter = { lat: 39.8283, lng: -98.5795 };

const mapStyles: google.maps.MapTypeStyle[] = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] }
];

function formatTimeDisplay(time: string | null): string {
  if (!time) return '';
  try {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  } catch {
    return time;
  }
}

export function ScheduleMapView({ items, selectedDate }: ScheduleMapViewProps) {
  const [, setLocation] = useLocation();
  const [selectedMarker, setSelectedMarker] = useState<MarkerData | null>(null);
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const googleMarkersRef = useRef<google.maps.Marker[]>([]);
  
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
    libraries: ['places']
  });

  const geocodeAddresses = useCallback(async () => {
    if (!items.length) {
      setMarkers([]);
      return;
    }

    setIsGeocoding(true);
    const geocoded: MarkerData[] = [];

    for (const item of items) {
      if (!item.address) continue;

      if (item.latitude && item.longitude) {
        geocoded.push({ ...item, lat: item.latitude, lng: item.longitude });
        continue;
      }

      try {
        const response = await apiRequest('POST', '/api/geocode', {
          address: item.address,
          customerId: item.customerId
        });
        if (response.ok) {
          const data = await response.json();
          geocoded.push({ ...item, lat: data.latitude, lng: data.longitude });
        }
      } catch (error) {
        console.warn(`Failed to geocode: ${item.address}`);
      }
    }

    setMarkers(geocoded);
    setIsGeocoding(false);
  }, [items]);

  useEffect(() => {
    geocodeAddresses();
  }, [geocodeAddresses]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded || markers.length === 0) return;

    googleMarkersRef.current.forEach(m => m.setMap(null));
    googleMarkersRef.current = [];
    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
    }

    const newGoogleMarkers: google.maps.Marker[] = [];

    markers.forEach((markerData) => {
      const googleMarker = new google.maps.Marker({
        position: { lat: markerData.lat, lng: markerData.lng },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: markerData.type === 'estimate' ? '#9333ea' : '#16a34a',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        }
      });

      googleMarker.addListener('click', () => {
        setSelectedMarker(markerData);
      });

      newGoogleMarkers.push(googleMarker);
    });

    googleMarkersRef.current = newGoogleMarkers;

    clustererRef.current = new MarkerClusterer({
      map: mapRef.current,
      markers: newGoogleMarkers,
      renderer: {
        render: ({ count, position }) => {
          return new google.maps.Marker({
            position,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 18,
              fillColor: '#3b82f6',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 3
            },
            label: {
              text: String(count),
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 'bold'
            },
            zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count
          });
        }
      }
    });

    const bounds = new google.maps.LatLngBounds();
    markers.forEach(m => bounds.extend({ lat: m.lat, lng: m.lng }));
    mapRef.current.fitBounds(bounds, 50);

    if (markers.length === 1) {
      setTimeout(() => {
        mapRef.current?.setZoom(15);
      }, 100);
    }

    return () => {
      googleMarkersRef.current.forEach(m => m.setMap(null));
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
      }
    };
  }, [markers, isLoaded]);

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = useCallback(() => {
    googleMarkersRef.current.forEach(m => m.setMap(null));
    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }
    mapRef.current = null;
  }, []);

  const handleInfoCardClick = (marker: MarkerData) => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    if (marker.type === 'estimate') {
      setLocation(`/estimates/${marker.id}?from=schedule&view=map&date=${dateStr}`);
    } else {
      setLocation(`/jobs/${marker.id}?from=schedule&view=map&date=${dateStr}`);
    }
  };

  const getTimeRange = (item: MarkerData) => {
    const start = formatTimeDisplay(item.scheduledTime);
    const end = formatTimeDisplay(item.scheduledEndTime);
    if (start && end) return `${start} – ${end}`;
    if (start) return start;
    return 'Scheduled';
  };

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
        <MapPin className="h-16 w-16 text-slate-300 dark:text-slate-600 mb-4" />
        <p className="text-lg font-medium text-slate-600 dark:text-slate-400">Map view requires setup</p>
        <p className="text-sm text-slate-500 dark:text-slate-500 mt-2 text-center">
          Please add your Google Maps API key to enable the map view.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
        <MapPin className="h-16 w-16 text-red-300 dark:text-red-600 mb-4" />
        <p className="text-lg font-medium text-red-600 dark:text-red-400">Failed to load map</p>
        <p className="text-sm text-slate-500 mt-2">{loadError.message}</p>
      </div>
    );
  }

  if (!isLoaded || isGeocoding) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg">
        <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
        <p className="text-sm text-slate-500">
          {isGeocoding ? 'Loading locations...' : 'Loading map...'}
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
        <MapPin className="h-16 w-16 text-slate-300 dark:text-slate-600 mb-4" />
        <p className="text-lg font-medium text-slate-600 dark:text-slate-400">No scheduled items</p>
        <p className="text-sm text-slate-500 mt-2">
          There are no jobs or estimates scheduled for this day.
        </p>
      </div>
    );
  }

  if (markers.length === 0 && !isGeocoding) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
        <MapPin className="h-16 w-16 text-slate-300 dark:text-slate-600 mb-4" />
        <p className="text-lg font-medium text-slate-600 dark:text-slate-400">No locations available</p>
        <p className="text-sm text-slate-500 mt-2 text-center">
          Scheduled items don't have valid addresses to display on the map.
        </p>
      </div>
    );
  }

  const center = markers.length > 0 
    ? { lat: markers[0].lat, lng: markers[0].lng }
    : defaultCenter;

  return (
    <div className="h-full w-full relative rounded-lg overflow-hidden">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={12}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          styles: mapStyles,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControlOptions: {
            position: google.maps.ControlPosition.RIGHT_CENTER
          }
        }}
      >
        {selectedMarker && (
          <InfoWindow
            position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
            onCloseClick={() => setSelectedMarker(null)}
            options={{ maxWidth: 320 }}
          >
            <div 
              className="p-1 cursor-pointer hover:bg-slate-50 rounded transition-colors"
              onClick={() => handleInfoCardClick(selectedMarker)}
            >
              <div className="flex items-start gap-2 mb-2">
                <Badge 
                  variant={selectedMarker.type === 'estimate' ? 'secondary' : 'default'}
                  className={selectedMarker.type === 'estimate' 
                    ? 'bg-purple-100 text-purple-700 text-xs' 
                    : 'bg-green-100 text-green-700 text-xs'
                  }
                >
                  {selectedMarker.type === 'estimate' ? 'Estimate' : 'Job'}
                </Badge>
              </div>
              
              <h3 className="font-semibold text-slate-900 text-sm mb-1 line-clamp-2">
                {selectedMarker.title}
              </h3>
              
              {selectedMarker.customerName && (
                <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-1">
                  <User className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{selectedMarker.customerName}</span>
                </div>
              )}
              
              <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-1">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span>{getTimeRange(selectedMarker)}</span>
              </div>
              
              {selectedMarker.address && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="line-clamp-2">{selectedMarker.address}</span>
                </div>
              )}
              
              <div className="flex items-center justify-end mt-2 text-xs text-primary font-medium">
                <span>View details</span>
                <ChevronRight className="h-3 w-3" />
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      <div className="absolute bottom-4 left-4 bg-white dark:bg-slate-800 rounded-lg shadow-lg px-3 py-2">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-slate-600 dark:text-slate-300">Jobs ({markers.filter(m => m.type === 'job').length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-purple-500" />
            <span className="text-slate-600 dark:text-slate-300">Estimates ({markers.filter(m => m.type === 'estimate').length})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
