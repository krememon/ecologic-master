import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { LOCATION_TRACKING } from '../constants/config';
import { api } from './api';

const SESSION_KEY = 'ecologic_active_tracking';
const DEBUG_KEY = 'ecologic_last_ping_debug';

interface TrackingSession {
  timeLogId: number;
  jobId: number | null;
}

interface DebugInfo {
  trackingActive: boolean;
  lastPingAt: string | null;
  lastPingStatus: 'success' | 'error' | null;
  lastPingError: string | null;
  sessionId: number | null;
  jobId: number | null;
  lastLat: number | null;
  lastLng: number | null;
}

async function getPersistedSession(): Promise<TrackingSession | null> {
  try {
    const data = await SecureStore.getItemAsync(SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function persistSession(session: TrackingSession | null): Promise<void> {
  try {
    if (session) {
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    } else {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    }
  } catch {}
}

async function persistDebugInfo(info: Partial<DebugInfo>): Promise<void> {
  if (!__DEV__) return;
  try {
    const existing = await SecureStore.getItemAsync(DEBUG_KEY);
    const current: DebugInfo = existing ? JSON.parse(existing) : {
      trackingActive: false,
      lastPingAt: null,
      lastPingStatus: null,
      lastPingError: null,
      sessionId: null,
      jobId: null,
      lastLat: null,
      lastLng: null,
    };
    const updated = { ...current, ...info };
    await SecureStore.setItemAsync(DEBUG_KEY, JSON.stringify(updated));
  } catch {}
}

export async function getDebugInfo(): Promise<DebugInfo | null> {
  if (!__DEV__) return null;
  try {
    const data = await SecureStore.getItemAsync(DEBUG_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

TaskManager.defineTask(LOCATION_TRACKING.TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.error('[GEO] Background task error:', error);
    return;
  }

  const session = await getPersistedSession();
  if (!session || !data) return;

  const { locations } = data;
  if (!locations || locations.length === 0) return;

  const location = locations[locations.length - 1];
  const { latitude, longitude, accuracy, heading, speed, altitude } = location.coords;

  const payload = {
    timeSessionId: session.timeLogId,
    jobId: session.jobId,
    lat: latitude,
    lng: longitude,
    accuracy_m: accuracy,
    altitude: altitude != null ? altitude : null,
    heading: heading >= 0 ? heading : null,
    speed: speed >= 0 ? speed : null,
    captured_at: new Date(location.timestamp).toISOString(),
  };

  try {
    const result = await api.post('/api/location/ping', payload);
    if (__DEV__) {
      console.log('[GEO] ping sent OK', { pingId: result?.pingId, lat: latitude.toFixed(4), lng: longitude.toFixed(4) });
      await persistDebugInfo({
        lastPingAt: new Date().toISOString(),
        lastPingStatus: 'success',
        lastPingError: null,
        lastLat: latitude,
        lastLng: longitude,
        sessionId: session.timeLogId,
        jobId: session.jobId,
      });
    }
  } catch (err: any) {
    console.error('[GEO] Failed to send ping:', err?.message || err);
    if (__DEV__) {
      await persistDebugInfo({
        lastPingAt: new Date().toISOString(),
        lastPingStatus: 'error',
        lastPingError: err?.message || 'Unknown error',
      });
    }
  }
});

let _permissionDenied = false;

export function wasPermissionDenied(): boolean {
  return _permissionDenied;
}

export async function startLocationTracking(timeLogId: number, jobId: number | null): Promise<boolean> {
  _permissionDenied = false;

  await persistSession({ timeLogId, jobId });

  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME).catch(() => false);
  if (isTracking) {
    if (__DEV__) console.log('[GEO] Already tracking, skipping start');
    await persistDebugInfo({ trackingActive: true, sessionId: timeLogId, jobId });
    return true;
  }

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    if (__DEV__) console.warn('[GEO] Foreground location permission denied');
    _permissionDenied = true;
    await persistDebugInfo({ trackingActive: false });
    return false;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    if (__DEV__) console.warn('[GEO] Background location permission denied (user selected "While Using" instead of "Always")');
    _permissionDenied = true;
    await persistDebugInfo({ trackingActive: false });
    return false;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME, {
    accuracy: Location.Accuracy.Highest,
    timeInterval: LOCATION_TRACKING.INTERVAL_MS,
    distanceInterval: LOCATION_TRACKING.DISTANCE_FILTER_METERS,
    deferredUpdatesInterval: LOCATION_TRACKING.INTERVAL_MS,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'EcoLogic - Tracking Location',
      notificationBody: 'Your location is being tracked while clocked in.',
      notificationColor: '#1a7f64',
    },
  });

  if (__DEV__) console.log('[GEO] Tracking started', { timeLogId, jobId });
  await persistDebugInfo({ trackingActive: true, sessionId: timeLogId, jobId });
  return true;
}

export async function stopLocationTracking() {
  await persistSession(null);

  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME).catch(() => false);
  if (isTracking) {
    await Location.stopLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME);
  }
  if (__DEV__) console.log('[GEO] Tracking stopped');
  await persistDebugInfo({ trackingActive: false, sessionId: null, jobId: null });
}

export async function resumeTrackingIfNeeded(): Promise<void> {
  const session = await getPersistedSession();
  if (session) {
    if (__DEV__) console.log('[GEO] Resuming tracking from persisted session', session);
    await startLocationTracking(session.timeLogId, session.jobId);
  }
}
