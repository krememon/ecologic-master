import { Capacitor } from '@capacitor/core';
import { LocationTracking } from '@/lib/androidLocationTracking';

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

// Android-specific state
let androidServiceActive = false;

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

// ─── Android native foreground-service path ────────────────────────────────

async function startAndroid(sessionId: number): Promise<'ok' | 'needs_foreground' | 'needs_background' | 'services_off' | 'error'> {
  console.log('[ANDROID-GEO] clock-in detected — sessionId=' + sessionId);

  let status = await LocationTracking.checkPermissions();
  console.log('[ANDROID-GEO] permission status before request: ' + status.status +
    ' hasFg=' + status.hasForegroundPermission +
    ' hasBg=' + status.hasBackgroundPermission +
    ' locationOn=' + status.locationServicesEnabled);

  if (status.status === 'location_services_off') {
    console.log('[ANDROID-GEO] location services off — cannot track');
    return 'services_off';
  }

  if (status.status === 'needs_foreground_permission') {
    console.log('[ANDROID-GEO] requesting foreground permission');
    status = await LocationTracking.requestForegroundPermission();
    console.log('[ANDROID-GEO] foreground permission result: ' + status.status +
      ' hasFg=' + status.hasForegroundPermission);
    if (!status.hasForegroundPermission) {
      console.log('[ANDROID-GEO] foreground permission DENIED — tracking unavailable');
      return 'needs_foreground';
    }
  }

  // Background permission — optional but request for OEM completeness.
  // The foreground service works without it; we continue even if denied.
  if (status.status === 'needs_background_permission') {
    console.log('[ANDROID-GEO] requesting background permission');
    const bgStatus = await LocationTracking.requestBackgroundPermission();
    console.log('[ANDROID-GEO] background permission result: ' + bgStatus.status);
    // Non-blocking — foreground service works without background permission
  }

  const apiBaseUrl = window.location.origin;
  const authToken = typeof localStorage !== 'undefined'
    ? (localStorage.getItem('nativeSessionId') || '')
    : '';

  console.log('[ANDROID-GEO] starting native tracking — sessionId=' + sessionId + ' apiBase=' + apiBaseUrl);

  try {
    await LocationTracking.start({ sessionId, apiBaseUrl, authToken });
    androidServiceActive = true;
    console.log('[ANDROID-GEO] native tracking started — sessionId=' + sessionId);

    // Grab a one-time position for the JS-side lastKnownCoords (map fallback)
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      lastKnownCoords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      log('android: initial coords lat=' + pos.coords.latitude.toFixed(6) + ' lng=' + pos.coords.longitude.toFixed(6));
    } catch (e) {
      log('android: initial position fix failed (non-fatal)', e);
    }

    return 'ok';
  } catch (e: any) {
    console.log('[ANDROID-GEO] native tracking failed: ' + (e?.message || String(e)));
    return 'error';
  }
}

async function stopAndroid() {
  if (!androidServiceActive) return;
  try {
    await LocationTracking.stop();
    androidServiceActive = false;
    log('android: LocationService stopped');
  } catch (e) {
    log('android: stop failed (non-fatal)', e);
  }
}

// ─── iOS / Capacitor Geolocation path (unchanged) ──────────────────────────

async function startNative(sessionId: number) {
  const { Geolocation } = await import('@capacitor/geolocation');

  log('native: checking permissions...');
  let currentStatus = 'prompt';
  try {
    const permStatus = await Geolocation.checkPermissions();
    currentStatus = permStatus.location;
    log('native: perm status location=' + permStatus.location + ' coarseLocation=' + permStatus.coarseLocation);
  } catch (e) {
    log('native: checkPermissions error', e);
  }

  if (currentStatus !== 'granted') {
    log('native: requesting permissions (currentStatus=' + currentStatus + ')...');
    try {
      const reqResult = await Geolocation.requestPermissions({ permissions: ['location'] });
      currentStatus = reqResult.location;
      log('native: requestPermissions result location=' + reqResult.location + ' coarseLocation=' + reqResult.coarseLocation);
    } catch (e) {
      log('native: requestPermissions error', e);
      currentStatus = 'denied';
    }
  } else {
    log('native: permission already granted — skipping request dialog');
  }

  if (currentStatus === 'denied') {
    log('native: location permission DENIED — tracking unavailable. Ask user to enable Location in iOS Settings > EcoLogic.');
    return;
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

// ─── Public API ─────────────────────────────────────────────────────────────

export type AndroidTrackingResult = 'ok' | 'needs_foreground' | 'needs_background' | 'services_off' | 'error' | 'not_android';

const geoTracking = {
  // Returns a Promise<AndroidTrackingResult> on Android so callers can react to
  // the permission outcome and show appropriate UI.  On iOS/web the async work
  // is still fire-and-forget but the function still returns a resolved promise
  // with 'not_android' so call sites can await safely on all platforms.
  async start(newSessionId: number): Promise<AndroidTrackingResult> {
    const platform = Capacitor.getPlatform();
    const native = Capacitor.isNativePlatform();
    log('start sessionId=' + newSessionId, 'platform=' + platform, 'isNative=' + native);
    log('userAgent=' + navigator.userAgent.substring(0, 120));

    if (watchId !== null || webWatchId !== null || androidServiceActive) {
      log('stopping previous tracker before starting new one');
      await this.stop();
    }

    currentSessionId = newSessionId;
    lastSentPoint = null;
    pointCount = 0;

    if (platform === 'android') {
      log('android: delegating to native foreground service');
      try {
        const result = await startAndroid(newSessionId);
        log('android: startAndroid result=' + result);
        return result;
      } catch (e: any) {
        console.log('[ANDROID-GEO] native tracking failed: ' + (e?.message || String(e)));
        return 'error';
      }
    } else if (native) {
      log('iOS: using Capacitor Geolocation watchPosition');
      startNative(newSessionId);
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
      return 'not_android';
    } else {
      log('web: using navigator.geolocation');
      startWeb();
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
      return 'not_android';
    }
  },

  async stop() {
    const platform = Capacitor.getPlatform();
    log('stop sessionId=' + currentSessionId + ' totalPoints=' + pointCount + ' platform=' + platform);

    if (platform === 'android') {
      await stopAndroid();
    }

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

  isAndroidServiceActive() {
    return androidServiceActive;
  },

  async checkAndroidPermissions() {
    if (Capacitor.getPlatform() !== 'android') return null;
    try {
      return await LocationTracking.checkPermissions();
    } catch (e) {
      log('checkAndroidPermissions error', e);
      return null;
    }
  },
};

export default geoTracking;
