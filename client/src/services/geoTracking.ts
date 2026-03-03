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

function getPlatform(): string {
  try {
    const w = window as any;
    if (w.Capacitor && typeof w.Capacitor.getPlatform === 'function') {
      return w.Capacitor.getPlatform();
    }
  } catch {}
  return 'web';
}

function isNative(): boolean {
  try {
    const w = window as any;
    return w.Capacitor?.isNativePlatform?.() === true;
  } catch {}
  return false;
}

const DISTANCE_THRESHOLD = 50;
const HEARTBEAT_MS = 60000;
const ACCURACY_LIMIT = 100;

let currentSessionId: number | null = null;
let watchId: number | null = null;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;
let lastSentPoint: { lat: number; lng: number; time: number } | null = null;
let pointCount = 0;

function log(...args: any[]) {
  console.log('[geo]', ...args);
}

async function sendOnePoint(lat: number, lng: number, accuracy: number, source: string) {
  if (currentSessionId === null) {
    log('sendOnePoint skipped — no active session');
    return;
  }
  const point: GeoPoint = {
    lat,
    lng,
    accuracy,
    recordedAt: new Date().toISOString(),
    source,
  };
  log('sending 1-point batch sessionId=' + currentSessionId, 'source=' + source);
  try {
    const res = await fetch('/api/location/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId: currentSessionId, points: [point] }),
    });
    if (res.ok) {
      const data = await res.json();
      log('batch OK accepted=' + data.accepted + ' rejected=' + data.rejected);
    } else {
      const text = await res.text();
      log('batch FAILED status=' + res.status, text);
    }
  } catch (e) {
    log('batch NETWORK ERROR', e);
  }
}

function handlePosition(pos: GeolocationPosition, source: string) {
  const { latitude: lat, longitude: lng, accuracy, speed, heading, altitude } = pos.coords;
  pointCount++;
  log(
    'point #' + pointCount,
    'lat=' + lat.toFixed(6),
    'lng=' + lng.toFixed(6),
    'acc=' + accuracy.toFixed(0),
    'speed=' + (speed ?? 'null'),
    'heading=' + (heading ?? 'null'),
    'alt=' + (altitude ?? 'null'),
    'ts=' + pos.timestamp,
    'source=' + source
  );

  if (accuracy > ACCURACY_LIMIT) {
    log('point SKIPPED — acc=' + accuracy.toFixed(0) + ' > limit=' + ACCURACY_LIMIT);
    return;
  }

  const now = Date.now();
  let shouldSend = false;

  if (!lastSentPoint) {
    shouldSend = true;
    log('first qualifying point — sending immediately');
  } else {
    const dist = haversineDistance(lastSentPoint.lat, lastSentPoint.lng, lat, lng);
    const elapsed = now - lastSentPoint.time;
    log('filter check dist=' + dist.toFixed(0) + 'm elapsed=' + (elapsed / 1000).toFixed(0) + 's');
    if (dist >= DISTANCE_THRESHOLD || elapsed >= HEARTBEAT_MS) {
      shouldSend = true;
    } else {
      log('point filtered out (dist < 50m and elapsed < 60s)');
    }
  }

  if (shouldSend) {
    lastSentPoint = { lat, lng, time: now };
    sendOnePoint(lat, lng, accuracy, source);
  }
}

function onWatchPosition(pos: GeolocationPosition) {
  handlePosition(pos, 'watch');
}

function onWatchError(err: GeolocationPositionError) {
  log('watch ERROR code=' + err.code + ' message="' + err.message + '"');
  if (err.code === 1) log('  → PERMISSION_DENIED');
  if (err.code === 2) log('  → POSITION_UNAVAILABLE');
  if (err.code === 3) log('  → TIMEOUT');
}

const geoTracking = {
  start(newSessionId: number) {
    const platform = getPlatform();
    const native = isNative();
    log('start sessionId=' + newSessionId, 'platform=' + platform, 'isNative=' + native);
    log('navigator.geolocation exists=' + !!navigator.geolocation);
    log('userAgent=' + navigator.userAgent.substring(0, 120));

    if (watchId !== null) {
      log('stopping previous watch before starting new one');
      this.stop();
    }

    currentSessionId = newSessionId;
    lastSentPoint = null;
    pointCount = 0;

    if (!navigator.geolocation) {
      log('ERROR: navigator.geolocation is NOT available — cannot track');
      return;
    }

    try {
      navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then(
        (result) => {
          log('perm=' + result.state);
          result.addEventListener('change', () => {
            log('perm changed to=' + result.state);
          });
        },
        (err) => log('perm query failed:', err)
      );
    } catch (e) {
      log('perm query not supported:', e);
    }

    const watchOpts: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    };
    log('watchPosition starting with options=', JSON.stringify(watchOpts));

    try {
      watchId = navigator.geolocation.watchPosition(onWatchPosition, onWatchError, watchOpts);
      log('watchPosition started id=' + watchId);
    } catch (e) {
      log('watchPosition THREW', e);
    }

    log('getCurrentPosition fallback firing (enableHighAccuracy, timeout=15s)...');
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          log('firstFix lat=' + latitude.toFixed(6) + ' lng=' + longitude.toFixed(6) + ' acc=' + accuracy.toFixed(0));
          handlePosition(pos, 'firstFix');
        },
        (err) => {
          log('firstFix ERROR code=' + err.code + ' message="' + err.message + '"');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    } catch (e) {
      log('getCurrentPosition THREW', e);
    }

    flushIntervalId = setInterval(() => {
      log('heartbeat tick — pointCount=' + pointCount + ' sessionId=' + currentSessionId);
    }, 30000);

    log('start() complete — watch and fallback initiated');
  },

  stop() {
    log('stop sessionId=' + currentSessionId + ' totalPoints=' + pointCount);
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      log('watch cleared id=' + watchId);
      watchId = null;
    }
    if (flushIntervalId !== null) {
      clearInterval(flushIntervalId);
      flushIntervalId = null;
    }
    currentSessionId = null;
    lastSentPoint = null;
    pointCount = 0;
  },
};

export default geoTracking;
