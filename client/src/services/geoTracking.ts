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
const ACCURACY_LIMIT = 100;

let sessionId: number | null = null;
let watchId: number | null = null;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;
let buffer: GeoPoint[] = [];
let lastSentPoint: { lat: number; lng: number; time: number } | null = null;

function log(...args: any[]) {
  console.log('[geo]', ...args);
}

async function sendBatch(points: GeoPoint[]) {
  if (points.length === 0 || sessionId === null) return;
  try {
    const res = await fetch('/api/location/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId, points }),
    });
    if (res.ok) {
      const data = await res.json();
      log('sent batch n=' + points.length, 'accepted=' + data.accepted, 'rejected=' + data.rejected);
    } else {
      const text = await res.text();
      log('batch failed status=' + res.status, text);
      buffer = points.concat(buffer);
    }
  } catch (e) {
    log('batch error', e);
    buffer = points.concat(buffer);
  }
}

async function flushBuffer() {
  if (buffer.length === 0 || sessionId === null) return;
  const points = [...buffer];
  buffer = [];
  await sendBatch(points);
}

function addPointAndMaybeSend(lat: number, lng: number, accuracy: number, source: string) {
  const now = Date.now();
  const point: GeoPoint = {
    lat,
    lng,
    accuracy,
    recordedAt: new Date(now).toISOString(),
    source,
  };

  let shouldAdd = false;
  if (!lastSentPoint) {
    shouldAdd = true;
    log('first fix — will send immediately');
  } else {
    const dist = haversineDistance(lastSentPoint.lat, lastSentPoint.lng, lat, lng);
    const elapsed = now - lastSentPoint.time;
    if (dist >= DISTANCE_THRESHOLD || elapsed >= HEARTBEAT_MS) {
      shouldAdd = true;
      log('filter pass dist=' + dist.toFixed(0) + 'm elapsed=' + (elapsed / 1000).toFixed(0) + 's');
    }
  }

  if (shouldAdd) {
    lastSentPoint = { lat, lng, time: now };
    sendBatch([point]);
  }
}

function onPosition(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;
  log('point lat=' + lat.toFixed(6) + ' lng=' + lng.toFixed(6) + ' acc=' + accuracy.toFixed(0) + ' speed=' + (speed ?? 'null') + ' ts=' + pos.timestamp);

  if (accuracy > ACCURACY_LIMIT) {
    log('point skipped — acc=' + accuracy.toFixed(0) + ' > ' + ACCURACY_LIMIT);
    return;
  }

  addPointAndMaybeSend(lat, lng, accuracy, 'watch');
}

function onPositionError(err: GeolocationPositionError) {
  log('watch error code=' + err.code + ' message=' + err.message);
}

const watchOptions: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 0,
};

const geoTracking = {
  start(newSessionId: number) {
    if (watchId !== null) {
      this.stop();
    }
    sessionId = newSessionId;
    buffer = [];
    lastSentPoint = null;

    log('start sessionId=' + newSessionId);

    if (!navigator.geolocation) {
      log('ERROR: navigator.geolocation not available');
      return;
    }

    navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then(
      (result) => log('perm=' + result.state),
      () => log('perm=query-not-supported')
    );

    log('watch starting options=', JSON.stringify(watchOptions));
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, watchOptions);
    log('watch started id=' + watchId);

    log('getCurrentPosition fallback firing...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;
        log('getCurrentPosition OK lat=' + lat.toFixed(6) + ' lng=' + lng.toFixed(6) + ' acc=' + accuracy.toFixed(0) + ' speed=' + (speed ?? 'null'));
        if (accuracy <= ACCURACY_LIMIT) {
          addPointAndMaybeSend(lat, lng, accuracy, 'getCurrentPosition');
        } else {
          log('getCurrentPosition skipped — acc=' + accuracy.toFixed(0) + ' > ' + ACCURACY_LIMIT);
        }
      },
      (err) => {
        log('getCurrentPosition FAILED code=' + err.code + ' message=' + err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    flushIntervalId = setInterval(flushBuffer, 30000);
  },

  stop() {
    log('stop sessionId=' + sessionId);
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      log('watch cleared id=' + watchId);
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
