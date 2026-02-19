import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { api } from '../services/api';
import { COLORS } from '../constants/config';

interface LiveLocation {
  id: number;
  userId: string;
  name: string;
  userInitials: string;
  role: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  captured_at: string;
  jobId: number | null;
  timeSessionId: number | null;
}

const POLL_INTERVAL = 12000;

export function ScheduleScreen() {
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);

  const fetchLocations = useCallback(async () => {
    try {
      const data = await api.get('/api/schedule/live-locations?since=30');
      setLocations(data || []);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch live locations:', err);
      setError('Unable to load locations');
    }
  }, []);

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLocations]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = Date.now();
    const diffSec = Math.floor((now - date.getTime()) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return `${Math.floor(diffSec / 3600)}h ago`;
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: 37.78,
          longitude: -122.42,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
        showsUserLocation
        showsMyLocationButton
      >
        {locations.map((loc) => (
          <Marker
            key={loc.id}
            coordinate={{ latitude: loc.lat, longitude: loc.lng }}
          >
            <View style={styles.markerContainer}>
              <View style={styles.markerBubble}>
                <Text style={styles.markerInitials}>{loc.userInitials}</Text>
              </View>
              <Text style={styles.markerLabel}>{loc.name.split(' ')[0]}</Text>
            </View>
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.calloutName}>{loc.name}</Text>
                <Text style={styles.calloutRole}>{loc.role}</Text>
                <Text style={styles.calloutTime}>Updated {formatTime(loc.captured_at)}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {locations.length === 0 && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            {error || 'No active locations to display'}
          </Text>
        </View>
      )}

      <View style={styles.countBadge}>
        <Text style={styles.countText}>{locations.length} active</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  markerContainer: { alignItems: 'center' },
  markerBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  markerInitials: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  markerLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    backgroundColor: '#ffffffcc',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
    overflow: 'hidden',
  },
  callout: { padding: 8, minWidth: 150 },
  calloutName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  calloutRole: { fontSize: 12, color: COLORS.primary, marginTop: 2, fontWeight: '600' },
  calloutTime: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  overlay: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    backgroundColor: COLORS.surface + 'ee',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  overlayText: { fontSize: 14, color: COLORS.textSecondary },
  countBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  countText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
