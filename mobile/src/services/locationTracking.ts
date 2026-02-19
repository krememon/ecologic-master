import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { LOCATION_TRACKING } from '../constants/config';
import { api } from './api';

const SESSION_KEY = 'ecologic_active_tracking';

interface TrackingSession {
  timeLogId: number;
  jobId: number | null;
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

TaskManager.defineTask(LOCATION_TRACKING.TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.error('[Location] Background task error:', error);
    return;
  }

  const session = await getPersistedSession();
  if (!session || !data) return;

  const { locations } = data;
  if (!locations || locations.length === 0) return;

  const location = locations[locations.length - 1];
  const { latitude, longitude, accuracy, heading, speed, altitude } = location.coords;

  try {
    await api.post('/api/location/ping', {
      timeSessionId: session.timeLogId,
      jobId: session.jobId,
      lat: latitude,
      lng: longitude,
      accuracy_m: accuracy,
      altitude: altitude != null ? altitude : null,
      heading: heading >= 0 ? heading : null,
      speed: speed >= 0 ? speed : null,
      captured_at: new Date(location.timestamp).toISOString(),
    });
  } catch (err) {
    console.error('[Location] Failed to send ping:', err);
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
  if (isTracking) return true;

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    _permissionDenied = true;
    return false;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    _permissionDenied = true;
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

  return true;
}

export async function stopLocationTracking() {
  await persistSession(null);

  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME).catch(() => false);
  if (isTracking) {
    await Location.stopLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME);
  }
}

export async function resumeTrackingIfNeeded(): Promise<void> {
  const session = await getPersistedSession();
  if (session) {
    await startLocationTracking(session.timeLogId, session.jobId);
  }
}
