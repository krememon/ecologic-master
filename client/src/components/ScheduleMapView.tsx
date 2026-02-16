import { useCallback, useState, useRef, useEffect, Component, ReactNode } from "react";
import { GoogleMap, useJsApiLoader, InfoWindow, Circle } from "@react-google-maps/api";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { MapPin, Clock, User, ChevronRight, Loader2, RefreshCw, AlertCircle, Calendar, Navigation, LocateFixed } from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

class MapErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Map Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
          <AlertCircle className="h-16 w-16 text-red-400 dark:text-red-500 mb-4" />
          <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">Map couldn't load</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred while loading the map.'}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onRetry();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

const containerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '400px'
};

const defaultCenter = { lat: 40.7282, lng: -73.0861 };

const mapStyles = [
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

function createJobMarkerIcon(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
      </filter>
    </defs>
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26s18-12.5 18-26C36 8.06 27.94 0 18 0z" fill="#16a34a" filter="url(#shadow)"/>
    <circle cx="18" cy="16" r="12" fill="#ffffff" fill-opacity="0.2"/>
    <path d="M12 14h12v2H12v-2zm0 4h8v2h-8v-2zm10-6h-8v-2h8v2z" fill="#ffffff" transform="translate(0, 2)"/>
    <path d="M24 16l-2-2h-4v4h6v-2zm-8 0v-2h-4l-2 2v2h6v-2z" fill="#ffffff" transform="translate(0, 2)"/>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function createEstimateMarkerIcon(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
      </filter>
    </defs>
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26s18-12.5 18-26C36 8.06 27.94 0 18 0z" fill="#9333ea" filter="url(#shadow)"/>
    <circle cx="18" cy="16" r="12" fill="#ffffff" fill-opacity="0.2"/>
    <text x="18" y="21" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="bold" font-family="Arial, sans-serif">$</text>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function ScheduleMapViewInner({ items, selectedDate }: ScheduleMapViewProps) {
  const [, setLocation] = useLocation();
  const [selectedMarker, setSelectedMarker] = useState<MarkerData | null>(null);
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [userAccuracy, setUserAccuracy] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [geoStatus, setGeoStatus] = useState<'unknown' | 'granted' | 'prompt' | 'denied' | 'iframe'>('unknown');
  const [geoError, setGeoError] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const googleMarkersRef = useRef<google.maps.Marker[]>([]);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const hasApiKey = Boolean(apiKey);
  
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
    libraries: ['places']
  });

  const isInIframe = (): boolean => {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  const startWatchingLocation = useCallback(() => {
    if (watchIdRef.current !== null) return;
    if (!navigator.geolocation) return;

    console.log('[Geolocation] Starting watchPosition...');
    setIsLocating(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        console.log('[Geolocation] Position update:', position.coords);
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(coords);
        setUserAccuracy(position.coords.accuracy);
        setIsLocating(false);
        setGeoError(null);
        setGeoStatus('granted');
      },
      (error) => {
        console.error('[Geolocation] Watch error:', error.code, error.message);
        setIsLocating(false);
        if (error.code === 1) {
          setGeoStatus('denied');
          setGeoError('denied');
        } else if (error.code === 2) {
          setGeoError('Location unavailable. Turn on Location Services on your device.');
        } else if (error.code === 3) {
          setGeoError('Location request timed out. Try again.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }, []);

  const stopWatchingLocation = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const requestLocationPermission = useCallback(() => {
    if (isInIframe()) {
      setGeoStatus('iframe');
      return;
    }

    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by this browser.');
      return;
    }

    setIsLocating(true);
    console.log('[Geolocation] Requesting permission via getCurrentPosition...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('[Geolocation] Permission granted:', position.coords);
        setGeoStatus('granted');
        startWatchingLocation();
      },
      (error) => {
        console.error('[Geolocation] Permission error:', error.code, error.message);
        setIsLocating(false);
        if (error.code === 1) {
          setGeoStatus('denied');
          setGeoError('denied');
        } else {
          setGeoError('Could not get location. Please try again.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [startWatchingLocation]);

  useEffect(() => {
    if (!isLoaded) return;

    if (isInIframe()) {
      setGeoStatus('iframe');
      return;
    }

    const checkPermissionAndStart = async () => {
      if (navigator.permissions?.query) {
        try {
          const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          console.log('[Geolocation] Permission state:', perm.state);
          
          if (perm.state === 'granted') {
            setGeoStatus('granted');
            startWatchingLocation();
          } else if (perm.state === 'prompt') {
            setGeoStatus('prompt');
          } else if (perm.state === 'denied') {
            setGeoStatus('denied');
          }

          perm.addEventListener('change', () => {
            console.log('[Geolocation] Permission changed to:', perm.state);
            if (perm.state === 'granted') {
              setGeoStatus('granted');
              startWatchingLocation();
            } else if (perm.state === 'denied') {
              setGeoStatus('denied');
              stopWatchingLocation();
            }
          });
        } catch (e) {
          console.log('[Geolocation] Permissions API not supported, will prompt on button click');
          setGeoStatus('prompt');
        }
      } else {
        setGeoStatus('prompt');
      }
    };

    checkPermissionAndStart();

    return () => {
      stopWatchingLocation();
    };
  }, [isLoaded, startWatchingLocation, stopWatchingLocation]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded || !userLocation) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(userLocation);
    } else {
      const blueDotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="#4285F4" fill-opacity="0.2" stroke="#4285F4" stroke-width="2"/>
        <circle cx="12" cy="12" r="6" fill="#4285F4"/>
        <circle cx="12" cy="12" r="3" fill="#ffffff"/>
      </svg>`;
      
      userMarkerRef.current = new google.maps.Marker({
        position: userLocation,
        map: mapRef.current,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(blueDotSvg),
          scaledSize: new google.maps.Size(24, 24),
          anchor: new google.maps.Point(12, 12)
        },
        zIndex: 999
      });
    }

    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
    };
  }, [userLocation, isLoaded]);

  const handleLocateMe = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.panTo(userLocation);
      mapRef.current.setZoom(15);
    } else if (geoStatus === 'prompt' || geoStatus === 'unknown') {
      requestLocationPermission();
    } else if (geoStatus === 'iframe') {
      openInNewTab();
    }
  };

  const geocodeAddresses = useCallback(async () => {
    console.log('[Map] Starting geocode, items count:', items.length);
    if (!items.length) {
      setMarkers([]);
      return;
    }

    setIsGeocoding(true);
    const geocoded: MarkerData[] = [];

    for (const item of items) {
      console.log('[Map] Processing item:', item.type, item.id, 'address:', item.address, 'lat/lng:', item.latitude, item.longitude);
      
      if (!item.address && !item.latitude) {
        console.log('[Map] Skipping item - no address or coords');
        continue;
      }

      if (item.latitude && item.longitude) {
        console.log('[Map] Using cached coords:', item.latitude, item.longitude);
        geocoded.push({ ...item, lat: item.latitude, lng: item.longitude });
        continue;
      }

      if (!item.address) continue;

      try {
        console.log('[Map] Geocoding address:', item.address);
        const response = await apiRequest('POST', '/api/geocode', {
          address: item.address,
          customerId: item.customerId
        });
        if (response.ok) {
          const data = await response.json();
          console.log('[Map] Geocode result:', data.latitude, data.longitude);
          geocoded.push({ ...item, lat: data.latitude, lng: data.longitude });
        } else {
          console.warn('[Map] Geocode failed:', response.status, await response.text());
        }
      } catch (error) {
        console.warn('[Map] Failed to geocode:', item.address, error);
      }
    }

    console.log('[Map] Final markers count:', geocoded.length);
    setMarkers(geocoded);
    setIsGeocoding(false);
  }, [items]);

  useEffect(() => {
    if (isLoaded) {
      geocodeAddresses();
    }
  }, [geocodeAddresses, isLoaded]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded || markers.length === 0) return;

    googleMarkersRef.current.forEach(m => m.setMap(null));
    googleMarkersRef.current = [];
    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
    }

    const newGoogleMarkers: google.maps.Marker[] = [];

    markers.forEach((markerData) => {
      const iconUrl = markerData.type === 'estimate' 
        ? createEstimateMarkerIcon() 
        : createJobMarkerIcon();
      
      const googleMarker = new google.maps.Marker({
        position: { lat: markerData.lat, lng: markerData.lng },
        icon: {
          url: iconUrl,
          scaledSize: new google.maps.Size(36, 44),
          anchor: new google.maps.Point(18, 44)
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

  if (!hasApiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
        <MapPin className="h-16 w-16 text-amber-400 dark:text-amber-500 mb-4" />
        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">Map API Key Missing</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
          The Google Maps API key (VITE_GOOGLE_MAPS_API_KEY) is not configured. Please add it in the Secrets panel to enable the map view.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
        <AlertCircle className="h-16 w-16 text-red-400 dark:text-red-500 mb-4" />
        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">Failed to load Google Maps</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
          {loadError.message || 'The Google Maps API could not be loaded. Please check your API key and try again.'}
        </p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-slate-50 dark:bg-slate-900 rounded-lg">
        <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
        <p className="text-sm text-slate-500">Loading map...</p>
      </div>
    );
  }

  const center = markers.length > 0 
    ? { lat: markers[0].lat, lng: markers[0].lng }
    : defaultCenter;

  const hasScheduledItems = items.length > 0;
  const hasMappableLocations = markers.length > 0;
  const showNoAppointments = !hasScheduledItems && !isGeocoding;
  const showNoMappableLocations = hasScheduledItems && !hasMappableLocations && !isGeocoding;

  return (
    <div className="h-full w-full relative rounded-lg overflow-hidden">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={markers.length > 0 ? 12 : 11}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          styles: mapStyles,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControlOptions: {
            position: window.google?.maps?.ControlPosition?.RIGHT_CENTER
          }
        }}
      >
        {userLocation && userAccuracy && (
          <Circle
            center={userLocation}
            radius={userAccuracy}
            options={{
              fillColor: '#4285F4',
              fillOpacity: 0.1,
              strokeColor: '#4285F4',
              strokeOpacity: 0.3,
              strokeWeight: 1
            }}
          />
        )}
        
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

      {isGeocoding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 rounded-full shadow-lg px-4 py-2 flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
          <span className="text-sm text-slate-600 dark:text-slate-300">Finding locations...</span>
        </div>
      )}

      {showNoAppointments && !geoError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 rounded-full shadow-lg px-4 py-2 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-600 dark:text-slate-300">No scheduled appointments</span>
        </div>
      )}

      {showNoMappableLocations && !geoError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg shadow-lg px-4 py-2 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-amber-500" />
          <span className="text-sm text-amber-700 dark:text-amber-300">
            {items.length} appointment{items.length > 1 ? 's' : ''} scheduled, but no mappable addresses
          </span>
        </div>
      )}

      {geoStatus === 'iframe' && (
        <div className="absolute top-4 left-4 right-4 mx-auto max-w-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg shadow-lg px-4 py-3 flex items-start gap-3">
          <MapPin className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
              Location isn't available in embedded preview. Open EcoLogic in a new tab to enable GPS.
            </p>
            <button
              onClick={openInNewTab}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              <Navigation className="h-4 w-4" />
              Open in new tab
            </button>
          </div>
        </div>
      )}

      {geoStatus === 'prompt' && !userLocation && (
        <div className="absolute top-4 left-4 right-4 mx-auto max-w-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg shadow-lg px-4 py-3 flex items-start gap-3">
          <LocateFixed className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
              Enable location to show your position on the map.
            </p>
            <button
              onClick={requestLocationPermission}
              disabled={isLocating}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50"
            >
              {isLocating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enabling...
                </>
              ) : (
                <>
                  <LocateFixed className="h-4 w-4" />
                  Enable location
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {geoStatus === 'denied' && (
        <div className="absolute top-4 left-4 right-4 mx-auto max-w-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg shadow-lg px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Location blocked — click the lock icon in the address bar → Location → Allow.
            </p>
          </div>
          <button 
            onClick={() => setGeoStatus('unknown')}
            className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          >
            <span className="sr-only">Dismiss</span>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {geoError && geoError !== 'denied' && geoStatus !== 'iframe' && (
        <div className="absolute top-4 left-4 right-4 mx-auto max-w-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg shadow-lg px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-amber-800 dark:text-amber-200">{geoError}</p>
          </div>
          <button 
            onClick={() => setGeoError(null)}
            className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          >
            <span className="sr-only">Dismiss</span>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {markers.length > 0 && (
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
      )}

      <button
        onClick={handleLocateMe}
        disabled={isLocating}
        className="absolute bottom-4 right-4 w-10 h-10 bg-white dark:bg-slate-800 rounded-lg shadow-lg flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        title="My location"
      >
        {isLocating ? (
          <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
        ) : (
          <LocateFixed className={`h-5 w-5 ${userLocation ? 'text-blue-600' : 'text-slate-500'}`} />
        )}
      </button>
    </div>
  );
}

export function ScheduleMapView({ items, selectedDate }: ScheduleMapViewProps) {
  const [retryKey, setRetryKey] = useState(0);
  
  return (
    <MapErrorBoundary onRetry={() => setRetryKey(k => k + 1)}>
      <ScheduleMapViewInner key={retryKey} items={items} selectedDate={selectedDate} />
    </MapErrorBoundary>
  );
}
