import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TRACKING } from '../constants/config';
import { api } from './api';

let currentTimeLogId: number | null = null;
let currentJobId: number | null = null;

TaskManager.defineTask(LOCATION_TRACKING.TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.error('[Location] Background task error:', error);
    return;
  }

  if (!data || !currentTimeLogId) return;

  const { locations } = data;
  if (!locations || locations.length === 0) return;

  const location = locations[locations.length - 1];
  const { latitude, longitude } = location.coords;
  const accuracy = location.coords.accuracy;
  const heading = location.coords.heading;
  const speed = location.coords.speed;

  try {
    await api.post('/api/location/ping', {
      timeSessionId: currentTimeLogId,
      jobId: currentJobId,
      lat: latitude,
      lng: longitude,
      accuracy,
      heading: heading >= 0 ? heading : null,
      speed: speed >= 0 ? speed : null,
      capturedAt: new Date(location.timestamp).toISOString(),
    });
    console.log('[Location] Ping sent:', { lat: latitude.toFixed(4), lng: longitude.toFixed(4) });
  } catch (err) {
    console.error('[Location] Failed to send ping:', err);
  }
});

export async function startLocationTracking(timeLogId: number, jobId: number | null) {
  currentTimeLogId = timeLogId;
  currentJobId = jobId;

  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME).catch(() => false);
  if (isTracking) {
    console.log('[Location] Already tracking');
    return;
  }

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    console.warn('[Location] Foreground permission denied');
    return;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    console.warn('[Location] Background permission denied');
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME, {
    accuracy: Location.Accuracy.High,
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

  console.log('[Location] Background tracking started for timeLogId:', timeLogId);
}

export async function stopLocationTracking() {
  currentTimeLogId = null;
  currentJobId = null;

  const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME).catch(() => false);
  if (isTracking) {
    await Location.stopLocationUpdatesAsync(LOCATION_TRACKING.TASK_NAME);
    console.log('[Location] Background tracking stopped');
  }
}

export function isTracking(): boolean {
  return currentTimeLogId !== null;
}
