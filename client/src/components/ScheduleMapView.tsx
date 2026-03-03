import { useCallback, useState, useRef, useEffect, Component, ReactNode } from "react";
import { GoogleMap, useJsApiLoader, InfoWindow } from "@react-google-maps/api";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { MapPin, Clock, User, ChevronRight, Loader2, RefreshCw, AlertCircle, Calendar } from "lucide-react";
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

interface CrewLocation {
  userId: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  lat: number;
  lng: number;
  lastUpdatedAt: string;
}

interface ScheduleMapViewProps {
  items: ScheduleItem[];
  selectedDate: Date;
  userRole?: string;
  userId?: string;
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

const defaultCenter = { lat: 40.73, lng: -73.13 };

const LIBRARIES: ("places")[] = ['places'];

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

function createCrewInitialsIcon(initials: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="18" fill="#3b82f6" stroke="#ffffff" stroke-width="2"/>
    <text x="20" y="26" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="bold" font-family="Arial, sans-serif">${initials}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function createYouMarkerIcon(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="18" fill="#4285F4" stroke="#ffffff" stroke-width="2"/>
    <circle cx="20" cy="20" r="6" fill="#ffffff"/>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function createCrewAvatarIcon(avatarUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 40;
      const ctx = canvas.getContext('2d')!;
      ctx.beginPath();
      ctx.arc(20, 20, 18, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 2, 2, 36, 36);
      ctx.beginPath();
      ctx.arc(20, 20, 18, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      resolve('');
    };
    img.src = avatarUrl;
  });
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function ScheduleMapViewInner({ items, selectedDate, userRole, userId }: ScheduleMapViewProps) {
  const [, setLocation] = useLocation();
  const [selectedMarker, setSelectedMarker] = useState<MarkerData | null>(null);
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const googleMarkersRef = useRef<google.maps.Marker[]>([]);

  const [crewLocations, setCrewLocations] = useState<CrewLocation[]>([]);
  const [selectedCrewMarker, setSelectedCrewMarker] = useState<CrewLocation | null>(null);
  const crewMarkersRef = useRef<google.maps.Marker[]>([]);
  const crewClustererRef = useRef<MarkerClusterer | null>(null);
  const hasFittedCrewRef = useRef(false);
  
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const hasApiKey = Boolean(apiKey);
  
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
    libraries: LIBRARIES
  });

  const role = (userRole || '').toUpperCase();
  const isSelf = (locUserId: string) => userId && locUserId === userId;

  useEffect(() => {
    if (!isLoaded) return;
    const fetchCrew = async () => {
      try {
        const res = await fetch('/api/location/live', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const mapped: CrewLocation[] = (data || []).map((d: any) => ({
            userId: String(d.userId),
            name: d.name || 'Unknown',
            initials: d.initials || '??',
            avatarUrl: d.avatarUrl || null,
            lat: parseFloat(d.lat) || 0,
            lng: parseFloat(d.lng) || 0,
            lastUpdatedAt: d.updatedAt || new Date().toISOString(),
          }));
          const selfFound = userId ? mapped.some(l => l.userId === userId) : false;
          console.log(`[MapLive] role=${role} count=${mapped.length} selfFound=${selfFound ? 'YES' : 'NO'}`);
          setCrewLocations(mapped);
        }
      } catch {}
    };
    fetchCrew();
    const interval = setInterval(fetchCrew, 5000);
    return () => clearInterval(interval);
  }, [isLoaded]);

  const geocodeAddresses = useCallback(async () => {
    if (!items.length) {
      setMarkers([]);
      return;
    }

    setIsGeocoding(true);
    const geocoded: MarkerData[] = [];

    for (const item of items) {
      if (!item.address && !item.latitude) continue;

      if (item.latitude && item.longitude) {
        geocoded.push({ ...item, lat: item.latitude, lng: item.longitude });
        continue;
      }

      if (!item.address) continue;

      try {
        const response = await apiRequest('POST', '/api/geocode', {
          address: item.address,
          customerId: item.customerId
        });
        if (response.ok) {
          const data = await response.json();
          geocoded.push({ ...item, lat: data.latitude, lng: data.longitude });
        }
      } catch {}
    }

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

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    crewMarkersRef.current.forEach(m => m.setMap(null));
    crewMarkersRef.current = [];
    if (crewClustererRef.current) {
      crewClustererRef.current.clearMarkers();
      crewClustererRef.current = null;
    }

    if (crewLocations.length === 0) return;

    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const freshLocations = crewLocations.filter(loc => new Date(loc.lastUpdatedAt).getTime() > tenMinAgo);

    if (freshLocations.length === 0) return;

    const createMarkers = async () => {
      const newCrewMarkers: google.maps.Marker[] = [];

      for (const loc of freshLocations) {
        const isMe = isSelf(loc.userId);
        let iconUrl: string;
        
        if (isMe) {
          iconUrl = createYouMarkerIcon();
        } else if (loc.avatarUrl) {
          const avatarIcon = await createCrewAvatarIcon(loc.avatarUrl);
          iconUrl = avatarIcon || createCrewInitialsIcon(loc.initials);
        } else {
          iconUrl = createCrewInitialsIcon(loc.initials);
        }

        const marker = new google.maps.Marker({
          position: { lat: loc.lat, lng: loc.lng },
          icon: {
            url: iconUrl,
            scaledSize: new google.maps.Size(40, 40),
            anchor: new google.maps.Point(20, 20),
          },
          title: isMe ? 'You' : loc.name,
          zIndex: isMe ? 999 : 500,
        });

        marker.addListener('click', () => {
          setSelectedCrewMarker(loc);
          setSelectedMarker(null);
        });

        newCrewMarkers.push(marker);
      }

      crewMarkersRef.current = newCrewMarkers;

      if (newCrewMarkers.length > 1) {
        crewClustererRef.current = new MarkerClusterer({
          map: mapRef.current!,
          markers: newCrewMarkers,
          renderer: {
            render: ({ count, position }) => {
              return new google.maps.Marker({
                position,
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 18,
                  fillColor: '#10b981',
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 3,
                },
                label: {
                  text: String(count),
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 'bold',
                },
                zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
              });
            },
          },
        });
      } else {
        newCrewMarkers.forEach(m => m.setMap(mapRef.current));
      }

      if (!hasFittedCrewRef.current && markers.length === 0 && freshLocations.length > 0 && mapRef.current) {
        hasFittedCrewRef.current = true;
        if (freshLocations.length === 1) {
          mapRef.current.panTo({ lat: freshLocations[0].lat, lng: freshLocations[0].lng });
          mapRef.current.setZoom(15);
        } else {
          const bounds = new google.maps.LatLngBounds();
          freshLocations.forEach(l => bounds.extend({ lat: l.lat, lng: l.lng }));
          mapRef.current.fitBounds(bounds, 50);
        }
      }
    };

    createMarkers();

    return () => {
      crewMarkersRef.current.forEach(m => m.setMap(null));
      if (crewClustererRef.current) {
        crewClustererRef.current.clearMarkers();
      }
    };
  }, [crewLocations, isLoaded, markers.length]);

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = useCallback(() => {
    googleMarkersRef.current.forEach(m => m.setMap(null));
    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }
    crewMarkersRef.current.forEach(m => m.setMap(null));
    if (crewClustererRef.current) {
      crewClustererRef.current.clearMarkers();
      crewClustererRef.current = null;
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
    : crewLocations.length > 0
      ? { lat: crewLocations[0].lat, lng: crewLocations[0].lng }
      : defaultCenter;

  const hasScheduledItems = items.length > 0;
  const hasMappableLocations = markers.length > 0;
  const showNoAppointments = !hasScheduledItems && !isGeocoding && crewLocations.length === 0;
  const showNoMappableLocations = hasScheduledItems && !hasMappableLocations && !isGeocoding;

  return (
    <div className="h-full w-full relative rounded-lg overflow-hidden">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={markers.length > 0 || crewLocations.length > 0 ? 12 : 11}
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

        {selectedCrewMarker && (
          <InfoWindow
            position={{ lat: selectedCrewMarker.lat, lng: selectedCrewMarker.lng }}
            onCloseClick={() => setSelectedCrewMarker(null)}
            options={{ maxWidth: 240 }}
          >
            <div className="p-1">
              <div className="flex items-center gap-2 mb-1">
                {isSelf(selectedCrewMarker.userId) ? (
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-white" />
                  </div>
                ) : selectedCrewMarker.avatarUrl ? (
                  <img src={selectedCrewMarker.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                    {selectedCrewMarker.initials}
                  </div>
                )}
                <h3 className="font-semibold text-slate-900 text-sm">
                  {isSelf(selectedCrewMarker.userId) ? 'You' : selectedCrewMarker.name}
                </h3>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span>Last updated {formatTimeAgo(selectedCrewMarker.lastUpdatedAt)}</span>
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

      {showNoAppointments && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 rounded-full shadow-lg px-4 py-2 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-600 dark:text-slate-300">No scheduled appointments</span>
        </div>
      )}

      {showNoMappableLocations && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg shadow-lg px-4 py-2 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-amber-500" />
          <span className="text-sm text-amber-700 dark:text-amber-300">
            {items.length} appointment{items.length > 1 ? 's' : ''} scheduled, but no mappable addresses
          </span>
        </div>
      )}

      {(markers.length > 0 || crewLocations.length > 0) && (
        <div className="absolute bottom-4 left-4 bg-white dark:bg-slate-800 rounded-lg shadow-lg px-3 py-2">
          <div className="flex items-center gap-3 text-xs">
            {markers.filter(m => m.type === 'job').length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-slate-600 dark:text-slate-300">Jobs ({markers.filter(m => m.type === 'job').length})</span>
              </div>
            )}
            {markers.filter(m => m.type === 'estimate').length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-purple-500" />
                <span className="text-slate-600 dark:text-slate-300">Estimates ({markers.filter(m => m.type === 'estimate').length})</span>
              </div>
            )}
            {crewLocations.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-slate-600 dark:text-slate-300">
                  {role === 'TECHNICIAN' ? 'You' : `Crew (${crewLocations.length})`}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ScheduleMapView({ items, selectedDate, userRole, userId }: ScheduleMapViewProps) {
  const [retryKey, setRetryKey] = useState(0);
  
  return (
    <MapErrorBoundary onRetry={() => setRetryKey(k => k + 1)}>
      <ScheduleMapViewInner key={retryKey} items={items} selectedDate={selectedDate} userRole={userRole} userId={userId} />
    </MapErrorBoundary>
  );
}
