interface GeoPoint {
  lat: number;
  lng: number;
  accuracy: number;
  recordedAt: string;
  source: string;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const DISTANCE_THRESHOLD = 50;
const HEARTBEAT_MS = 60000;
const FLUSH_INTERVAL_MS = 30000;
const MAX_BUFFER_SIZE = 5;
const ACCURACY_LIMIT = 100;

let sessionId: number | null = null;
let watchId: number | null = null;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;
let buffer: GeoPoint[] = [];
let lastSentPoint: { lat: number; lng: number; time: number } | null = null;

function log(...args: any[]) {
  console.log('[geo]', ...args);
}

async function flushBuffer() {
  if (buffer.length === 0 || sessionId === null) return;
  const points = [...buffer];
  buffer = [];
  try {
    const res = await fetch('/api/location/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId, points }),
    });
    if (res.ok) {
      log('sent batch n=' + points.length);
    } else {
      log('batch failed status=' + res.status);
      buffer = points.concat(buffer);
    }
  } catch (e) {
    log('batch error', e);
    buffer = points.concat(buffer);
  }
}

function onPosition(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;

  if (accuracy > ACCURACY_LIMIT) {
    log('point skipped acc=' + accuracy.toFixed(0));
    return;
  }

  const now = Date.now();
  let shouldAdd = false;

  if (!lastSentPoint) {
    shouldAdd = true;
  } else {
    const dist = haversineDistance(lastSentPoint.lat, lastSentPoint.lng, lat, lng);
    const elapsed = now - lastSentPoint.time;
    if (dist >= DISTANCE_THRESHOLD || elapsed >= HEARTBEAT_MS) {
      shouldAdd = true;
    }
  }

  if (shouldAdd) {
    log('point lat=' + lat.toFixed(5) + ' lng=' + lng.toFixed(5) + ' acc=' + accuracy.toFixed(0));
    buffer.push({
      lat,
      lng,
      accuracy,
      recordedAt: new Date(now).toISOString(),
      source: 'watch',
    });
    lastSentPoint = { lat, lng, time: now };

    if (buffer.length >= MAX_BUFFER_SIZE) {
      flushBuffer();
    }
  }
}

function onPositionError(err: GeolocationPositionError) {
  log('watch error code=' + err.code + ' msg=' + err.message);
}

const geoTracking = {
  start(newSessionId: number) {
    if (watchId !== null) {
      this.stop();
    }
    sessionId = newSessionId;
    buffer = [];
    lastSentPoint = null;

    log('start sessionId=' + newSessionId);

    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
    });

    flushIntervalId = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
  },

  stop() {
    log('stop');
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (flushIntervalId !== null) {
      clearInterval(flushIntervalId);
      flushIntervalId = null;
    }
    flushBuffer();
    sessionId = null;
    buffer = [];
    lastSentPoint = null;
  },
};

export default geoTracking;
