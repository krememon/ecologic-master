import { useCallback, useState, useRef, useEffect, Component, ReactNode } from "react";
import { GoogleMap, useJsApiLoader, InfoWindow, OverlayViewF, OVERLAY_MOUSE_TARGET } from "@react-google-maps/api";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { MapPin, Clock, User, ChevronRight, Loader2, RefreshCw, AlertCircle, Calendar, X, ChevronUp, Navigation } from "lucide-react";
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
        <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
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

function createJobMarkerIcon(selected = false): string {
  const size = selected ? 44 : 36;
  const h = selected ? 54 : 44;
  const cx = size / 2;
  const color = selected ? '#059669' : '#16a34a';
  const stroke = selected ? `<circle cx="${cx}" cy="${cx}" r="${cx - 1}" fill="none" stroke="#ffffff" stroke-width="3"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 ${size} ${h}">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="${selected ? 3 : 2}" flood-opacity="${selected ? 0.5 : 0.3}"/></filter></defs>
    <path d="M${cx} 0C${cx * 0.447} 0 0 ${cx * 0.447} 0 ${cx}c0 ${cx * 0.75} ${cx} ${h - cx} ${cx} ${h - cx}s${cx}-${(h - cx) * 0.48} ${cx}-${h - cx}C${size} ${cx * 0.447} ${size - cx * 0.447} 0 ${cx} 0z" fill="${color}" filter="url(#s)"/>
    ${stroke}
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function createEstimateMarkerIcon(selected = false): string {
  const size = selected ? 44 : 36;
  const h = selected ? 54 : 44;
  const cx = size / 2;
  const color = selected ? '#7e22ce' : '#9333ea';
  const stroke = selected ? `<circle cx="${cx}" cy="${cx}" r="${cx - 1}" fill="none" stroke="#ffffff" stroke-width="3"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 ${size} ${h}">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="${selected ? 3 : 2}" flood-opacity="${selected ? 0.5 : 0.3}"/></filter></defs>
    <path d="M${cx} 0C${cx * 0.447} 0 0 ${cx * 0.447} 0 ${cx}c0 ${cx * 0.75} ${cx} ${h - cx} ${cx} ${h - cx}s${cx}-${(h - cx) * 0.48} ${cx}-${h - cx}C${size} ${cx * 0.447} ${size - cx * 0.447} 0 ${cx} 0z" fill="${color}" filter="url(#s)"/>
    ${stroke}
    <text x="${cx}" y="${cx + 4}" text-anchor="middle" fill="#ffffff" font-size="${selected ? 16 : 14}" font-weight="bold" font-family="Arial, sans-serif">$</text>
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

  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [trayExpanded, setTrayExpanded] = useState(false);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const hasApiKey = Boolean(apiKey);
  
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
    libraries: LIBRARIES
  });

  const role = (userRole || '').toUpperCase();
  const isSelf = (locUserId: string) => userId && locUserId === userId;

  const selectJob = useCallback((id: number, source: 'card' | 'marker') => {
    setSelectedJobId(id);
    setSelectedMarker(null);
    setSelectedCrewMarker(null);

    const marker = markers.find(m => m.id === id);
    if (!marker) return;

    if (source === 'card' && mapRef.current) {
      mapRef.current.panTo({ lat: marker.lat, lng: marker.lng });
      const zoom = mapRef.current.getZoom();
      if (zoom && zoom < 14) mapRef.current.setZoom(14);
    }

    if (source === 'marker') {
      const el = cardRefs.current.get(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
      if (!trayExpanded) setTrayExpanded(true);
    }
  }, [markers, trayExpanded]);

  useEffect(() => {
    if (selectedJobId === null) return;
    googleMarkersRef.current.forEach((gm, idx) => {
      const md = markers[idx];
      if (!md) return;
      const isSelected = md.id === selectedJobId;
      const iconUrl = md.type === 'estimate'
        ? createEstimateMarkerIcon(isSelected)
        : createJobMarkerIcon(isSelected);
      const size = isSelected ? 44 : 36;
      const h = isSelected ? 54 : 44;
      gm.setIcon({
        url: iconUrl,
        scaledSize: new google.maps.Size(size, h),
        anchor: new google.maps.Point(size / 2, h)
      });
      gm.setZIndex(isSelected ? 999 : 1);
    });
  }, [selectedJobId, markers]);

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
      const isSelected = markerData.id === selectedJobId;
      const iconUrl = markerData.type === 'estimate' 
        ? createEstimateMarkerIcon(isSelected) 
        : createJobMarkerIcon(isSelected);
      const size = isSelected ? 44 : 36;
      const h = isSelected ? 54 : 44;
      
      const googleMarker = new google.maps.Marker({
        position: { lat: markerData.lat, lng: markerData.lng },
        icon: {
          url: iconUrl,
          scaledSize: new google.maps.Size(size, h),
          anchor: new google.maps.Point(size / 2, h)
        },
        zIndex: isSelected ? 999 : 1
      });

      googleMarker.addListener('click', () => {
        selectJob(markerData.id, 'marker');
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
    mapRef.current.fitBounds(bounds, { top: 50, right: 50, bottom: 80, left: 50 });

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
          setSelectedJobId(null);
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
    map.addListener('click', () => {
      setSelectedCrewMarker(null);
      setSelectedJobId(null);
    });
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

  const getTimeRange = (item: MarkerData | ScheduleItem) => {
    const start = formatTimeDisplay(item.scheduledTime);
    const end = formatTimeDisplay(item.scheduledEndTime);
    if (start && end) return `${start} – ${end}`;
    if (start) return start;
    return 'Scheduled';
  };

  const handleCardScroll = useCallback(() => {
    if (!carouselRef.current || markers.length === 0) return;
    const container = carouselRef.current;
    const centerX = container.scrollLeft + container.clientWidth / 2;
    
    let closestId: number | null = null;
    let closestDist = Infinity;
    
    cardRefs.current.forEach((el, id) => {
      const cardCenter = el.offsetLeft + el.clientWidth / 2;
      const dist = Math.abs(cardCenter - centerX);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    });

    if (closestId !== null && closestId !== selectedJobId) {
      selectJob(closestId, 'card');
    }
  }, [markers, selectedJobId, selectJob]);

  if (!hasApiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
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
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-900 rounded-lg p-8">
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
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-900 rounded-lg">
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
    <div className="h-full w-full relative overflow-hidden">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={markers.length > 0 || crewLocations.length > 0 ? 12 : 11}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          styles: mapStyles,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControlOptions: {
            position: window.google?.maps?.ControlPosition?.RIGHT_CENTER
          }
        }}
      >
        {selectedCrewMarker && (
          <OverlayViewF
            position={{ lat: selectedCrewMarker.lat, lng: selectedCrewMarker.lng }}
            mapPaneName={OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={(w, h) => ({ x: -(w / 2), y: -(h + 48) })}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-[260px] rounded-2xl bg-white shadow-lg ring-1 ring-black/5 overflow-hidden"
              style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
            >
              <div className="px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 pr-7">
                  {isSelf(selectedCrewMarker.userId) ? (
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                      <div className="w-3 h-3 rounded-full bg-white" />
                    </div>
                  ) : selectedCrewMarker.avatarUrl ? (
                    <img src={selectedCrewMarker.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      {selectedCrewMarker.initials}
                    </div>
                  )}
                  <span className="text-[15px] font-semibold text-slate-900 leading-tight truncate">
                    {isSelf(selectedCrewMarker.userId) ? 'You' : selectedCrewMarker.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 ml-[42px]">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="text-[13px] text-slate-500 leading-tight">
                    {formatTimeAgo(selectedCrewMarker.lastUpdatedAt)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedCrewMarker(null)}
                className="absolute top-2 right-2 h-6 w-6 rounded-full hover:bg-black/5 flex items-center justify-center transition-colors"
              >
                <X className="h-3.5 w-3.5 text-slate-400" />
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-[6px] w-3 h-3 rotate-45 bg-white ring-1 ring-black/5 shadow-sm" style={{ clipPath: 'polygon(0% 0%, 100% 100%, 0% 100%)' }} />
            </div>
          </OverlayViewF>
        )}
      </GoogleMap>

      {isGeocoding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 rounded-full shadow-lg px-4 py-2 flex items-center gap-2 z-10">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
          <span className="text-sm text-slate-600 dark:text-slate-300">Finding locations...</span>
        </div>
      )}

      {showNoAppointments && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 rounded-full shadow-lg px-4 py-2 flex items-center gap-2 z-10">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-600 dark:text-slate-300">No scheduled appointments</span>
        </div>
      )}

      {showNoMappableLocations && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 z-10">
          <MapPin className="h-4 w-4 text-amber-500" />
          <span className="text-sm text-amber-700 dark:text-amber-300">
            {items.length} appointment{items.length > 1 ? 's' : ''} scheduled, but no mappable addresses
          </span>
        </div>
      )}

      {markers.length > 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div
            className="transition-transform duration-300 ease-out"
            style={{ transform: trayExpanded ? 'translateY(0)' : 'translateY(calc(100% - 44px))' }}
          >
            <div className="flex justify-center pb-1">
              <button
                onClick={() => setTrayExpanded(!trayExpanded)}
                className="flex items-center gap-1.5 bg-white dark:bg-slate-800 rounded-full shadow-lg px-4 py-2 border border-slate-200 dark:border-slate-700 active:scale-95 transition-all"
              >
                <ChevronUp
                  className={`h-4 w-4 text-slate-500 transition-transform duration-200 ${trayExpanded ? 'rotate-180' : ''}`}
                />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {markers.length} {markers.length === 1 ? 'location' : 'locations'}
                </span>
              </button>
            </div>

            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.1)] border-t border-slate-200/80 dark:border-slate-700/80">
              <div
                ref={carouselRef}
                onScroll={handleCardScroll}
                className="flex gap-3 overflow-x-auto px-4 py-3 snap-x snap-mandatory scrollbar-hide"
                style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
              >
                {markers.map((m) => {
                  const isActive = m.id === selectedJobId;
                  return (
                    <div
                      key={`${m.type}-${m.id}`}
                      ref={(el) => { if (el) cardRefs.current.set(m.id, el); }}
                      onClick={() => selectJob(m.id, 'card')}
                      className={`flex-shrink-0 w-[240px] snap-center rounded-xl border p-3 cursor-pointer transition-all duration-200 ${
                        isActive
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-md ring-1 ring-blue-500/30'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className={`text-[13px] font-bold leading-tight ${
                          isActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-100'
                        }`}>
                          {getTimeRange(m)}
                        </span>
                        <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${
                          m.type === 'estimate'
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200'
                            : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                        }`}>
                          {m.type === 'estimate' ? 'EST' : 'JOB'}
                        </span>
                      </div>
                      <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200 truncate leading-tight">
                        {m.customerName || m.title}
                      </p>
                      {m.address && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 leading-tight">
                          {m.address}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInfoCardClick(m);
                          }}
                          className="text-[11px] font-medium text-blue-600 dark:text-blue-400 flex items-center gap-0.5"
                        >
                          View details
                          <ChevronRight className="h-3 w-3" />
                        </button>
                        {m.address && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const addr = encodeURIComponent(m.address!);
                              window.open(`https://maps.apple.com/?daddr=${addr}`, '_blank');
                            }}
                            className="h-7 w-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center"
                          >
                            <Navigation className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {(crewLocations.length > 0 && markers.length === 0) && (
        <div className="absolute bottom-4 left-4 bg-white dark:bg-slate-800 rounded-lg shadow-lg px-3 py-2 z-10">
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-slate-600 dark:text-slate-300">
              {role === 'TECHNICIAN' ? 'You' : `Crew (${crewLocations.length})`}
            </span>
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
