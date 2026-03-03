import { Capacitor } from '@capacitor/core';

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

let currentSessionId: number | null = null;
let watchId: string | null = null;
let webWatchId: number | null = null;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;
let lastSentPoint: { lat: number; lng: number; time: number } | null = null;
let lastKnownCoords: { lat: number; lng: number; accuracy: number } | null = null;
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

function handleCoords(lat: number, lng: number, accuracy: number, speed: number | null, heading: number | null, altitude: number | null, timestamp: number, source: string) {
  pointCount++;
  log(
    'point #' + pointCount,
    'lat=' + lat.toFixed(6),
    'lng=' + lng.toFixed(6),
    'acc=' + accuracy.toFixed(0),
    'source=' + source
  );

  lastKnownCoords = { lat, lng, accuracy };

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
    if (dist >= DISTANCE_THRESHOLD || elapsed >= HEARTBEAT_MS) {
      shouldSend = true;
    }
  }

  if (shouldSend) {
    lastSentPoint = { lat, lng, time: now };
    sendOnePoint(lat, lng, accuracy, source);
  }
}

async function startNative(sessionId: number) {
  const { Geolocation } = await import('@capacitor/geolocation');

  log('native: checking permissions...');
  try {
    const permStatus = await Geolocation.checkPermissions();
    log('native: perm status location=' + permStatus.location + ' coarseLocation=' + permStatus.coarseLocation);
  } catch (e) {
    log('native: checkPermissions error', e);
  }

  log('native: requesting permissions...');
  try {
    const reqResult = await Geolocation.requestPermissions({ permissions: ['location'] });
    log('native: requestPermissions result location=' + reqResult.location + ' coarseLocation=' + reqResult.coarseLocation);
  } catch (e) {
    log('native: requestPermissions error', e);
  }

  log('native: starting watchPosition...');
  try {
    watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      },
      (position, err) => {
        if (err) {
          log('native: watch ERROR', err);
          return;
        }
        if (position) {
          handleCoords(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.accuracy,
            position.coords.speed ?? null,
            position.coords.heading ?? null,
            position.coords.altitude ?? null,
            position.timestamp,
            'watch'
          );
        }
      }
    );
    log('native: watchPosition started id=' + watchId);
  } catch (e) {
    log('native: watchPosition THREW', e);
  }

  log('native: getCurrentPosition fallback...');
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
    });
    log('native: firstFix lat=' + pos.coords.latitude.toFixed(6) + ' lng=' + pos.coords.longitude.toFixed(6) + ' acc=' + pos.coords.accuracy.toFixed(0));
    handleCoords(
      pos.coords.latitude,
      pos.coords.longitude,
      pos.coords.accuracy,
      pos.coords.speed ?? null,
      pos.coords.heading ?? null,
      pos.coords.altitude ?? null,
      pos.timestamp,
      'firstFix'
    );
  } catch (e: any) {
    log('native: firstFix ERROR', e?.message || e);
  }
}

function startWeb() {
  if (!navigator.geolocation) {
    log('web: navigator.geolocation NOT available');
    return;
  }

  try {
    navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then(
      (result) => {
        log('web: perm=' + result.state);
        result.addEventListener('change', () => {
          log('web: perm changed to=' + result.state);
        });
      },
      (err) => log('web: perm query failed:', err)
    );
  } catch (e) {
    log('web: perm query not supported');
  }

  const watchOpts: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0,
  };
  log('web: watchPosition starting options=', JSON.stringify(watchOpts));

  try {
    webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        handleCoords(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          pos.coords.speed ?? null,
          pos.coords.heading ?? null,
          pos.coords.altitude ?? null,
          pos.timestamp,
          'watch'
        );
      },
      (err) => {
        log('web: watch ERROR code=' + err.code + ' message="' + err.message + '"');
      },
      watchOpts
    );
    log('web: watchPosition started id=' + webWatchId);
  } catch (e) {
    log('web: watchPosition THREW', e);
  }

  log('web: getCurrentPosition fallback...');
  try {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        log('web: firstFix lat=' + pos.coords.latitude.toFixed(6) + ' lng=' + pos.coords.longitude.toFixed(6) + ' acc=' + pos.coords.accuracy.toFixed(0));
        handleCoords(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          pos.coords.speed ?? null,
          pos.coords.heading ?? null,
          pos.coords.altitude ?? null,
          pos.timestamp,
          'firstFix'
        );
      },
      (err) => {
        log('web: firstFix ERROR code=' + err.code + ' message="' + err.message + '"');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  } catch (e) {
    log('web: getCurrentPosition THREW', e);
  }
}

const geoTracking = {
  start(newSessionId: number) {
    const platform = Capacitor.getPlatform();
    const native = Capacitor.isNativePlatform();
    log('start sessionId=' + newSessionId, 'platform=' + platform, 'isNative=' + native);
    log('userAgent=' + navigator.userAgent.substring(0, 120));

    if (watchId !== null || webWatchId !== null) {
      log('stopping previous watch before starting new one');
      this.stop();
    }

    currentSessionId = newSessionId;
    lastSentPoint = null;
    pointCount = 0;

    if (native) {
      log('using NATIVE Capacitor Geolocation plugin');
      startNative(newSessionId);
    } else {
      log('using WEB navigator.geolocation');
      startWeb();
    }

    flushIntervalId = setInterval(() => {
      log('heartbeat tick — pointCount=' + pointCount + ' sessionId=' + currentSessionId);
      if (lastKnownCoords && currentSessionId !== null) {
        const elapsed = lastSentPoint ? Date.now() - lastSentPoint.time : Infinity;
        if (elapsed >= HEARTBEAT_MS) {
          log('heartbeat keepalive — sending last known coords');
          lastSentPoint = { lat: lastKnownCoords.lat, lng: lastKnownCoords.lng, time: Date.now() };
          sendOnePoint(lastKnownCoords.lat, lastKnownCoords.lng, lastKnownCoords.accuracy, 'heartbeat');
        }
      }
    }, 30000);

    log('start() complete');
  },

  async stop() {
    log('stop sessionId=' + currentSessionId + ' totalPoints=' + pointCount);

    if (watchId !== null) {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        await Geolocation.clearWatch({ id: watchId });
        log('native: watch cleared id=' + watchId);
      } catch (e) {
        log('native: clearWatch error', e);
      }
      watchId = null;
    }

    if (webWatchId !== null) {
      navigator.geolocation.clearWatch(webWatchId);
      log('web: watch cleared id=' + webWatchId);
      webWatchId = null;
    }

    if (flushIntervalId !== null) {
      clearInterval(flushIntervalId);
      flushIntervalId = null;
    }

    currentSessionId = null;
    lastSentPoint = null;
    lastKnownCoords = null;
    pointCount = 0;
  },

  getLastKnownCoords() {
    return lastKnownCoords;
  },

  isActive() {
    return currentSessionId !== null;
  },
};

export default geoTracking;
