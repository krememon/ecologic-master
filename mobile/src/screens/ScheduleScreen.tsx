import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, FlatList } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { api } from '../services/api';
import { COLORS, LOCATION_TRACKING } from '../constants/config';

interface LiveLocation {
  userId: string;
  name: string;
  initials: string;
  role: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  jobId: number | null;
  jobTitle: string | null;
  timeSessionId: number | null;
  updatedAt: string;
}

type ViewMode = 'map' | 'list';

export function ScheduleScreen() {
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const mapRef = useRef<MapView>(null);

  const fetchLocations = useCallback(async () => {
    try {
      const data = await api.get('/api/location/live');
      setLocations(data || []);
      setError(null);
    } catch (err: any) {
      console.error('[GEO] Failed to fetch live locations:', err);
      setError('Unable to load locations');
    }
  }, []);

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, LOCATION_TRACKING.POLLING_INTERVAL_MS);
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

  const renderListItem = ({ item }: { item: LiveLocation }) => (
    <View style={styles.listItem}>
      <View style={styles.listAvatar}>
        <Text style={styles.listAvatarText}>{item.initials}</Text>
      </View>
      <View style={styles.listInfo}>
        <Text style={styles.listName}>{item.name}</Text>
        <Text style={styles.listRole}>{item.role}</Text>
        {item.jobTitle && <Text style={styles.listJob}>{item.jobTitle}</Text>}
        <Text style={styles.listTime}>Updated {formatTime(item.updatedAt)}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[styles.toggleButton, viewMode === 'map' && styles.toggleActive]}
          onPress={() => setViewMode('map')}
        >
          <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>Map</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, viewMode === 'list' && styles.toggleActive]}
          onPress={() => setViewMode('list')}
        >
          <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>List</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'map' ? (
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
              key={loc.userId}
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
            >
              <View style={styles.markerContainer}>
                <View style={styles.markerBubble}>
                  <Text style={styles.markerInitials}>{loc.initials}</Text>
                </View>
                <Text style={styles.markerLabel}>{loc.name.split(' ')[0]}</Text>
              </View>
              <Callout>
                <View style={styles.callout}>
                  <Text style={styles.calloutName}>{loc.name}</Text>
                  <Text style={styles.calloutRole}>{loc.role}</Text>
                  {loc.jobTitle && <Text style={styles.calloutJob}>{loc.jobTitle}</Text>}
                  <Text style={styles.calloutTime}>Updated {formatTime(loc.updatedAt)}</Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>
      ) : (
        <FlatList
          data={locations}
          keyExtractor={(item) => item.userId}
          renderItem={renderListItem}
          style={styles.list}
          contentContainerStyle={locations.length === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={
            <Text style={styles.emptyText}>{error || 'No active locations to display'}</Text>
          }
        />
      )}

      {viewMode === 'map' && locations.length === 0 && (
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
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.border,
    borderRadius: 8,
    margin: 12,
    padding: 2,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  toggleActive: {
    backgroundColor: COLORS.primary,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  toggleTextActive: {
    color: '#fff',
  },
  map: { flex: 1 },
  list: { flex: 1 },
  emptyList: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 14, color: COLORS.textSecondary },
  listItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  listAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  listAvatarText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  listInfo: { flex: 1 },
  listName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  listRole: { fontSize: 12, color: COLORS.primary, fontWeight: '600', marginTop: 2 },
  listJob: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  listTime: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
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
  calloutJob: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, fontStyle: 'italic' },
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
    top: 60,
    right: 16,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  countText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
