import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

export interface AndroidLocationPermissionStatus {
  status: 'ready' | 'needs_foreground_permission' | 'needs_background_permission' | 'location_services_off';
  hasForegroundPermission: boolean;
  hasBackgroundPermission: boolean;
  locationServicesEnabled: boolean;
}

interface LocationTrackingPlugin {
  ping(): Promise<{ ok: boolean; platform: string }>;
  checkPermissions(): Promise<AndroidLocationPermissionStatus>;
  requestForegroundPermission(): Promise<AndroidLocationPermissionStatus>;
  requestBackgroundPermission(): Promise<AndroidLocationPermissionStatus>;
  start(opts: { sessionId: number; apiBaseUrl: string; authToken: string }): Promise<{ started: boolean }>;
  stop(): Promise<{ stopped: boolean }>;
}

// Web stub — only used in browser. On Android/iOS native the bridge routes to Java/Swift.
// ping() returns platform='web_stub' so we can detect if the native bridge is unreachable.
const readyStatus: AndroidLocationPermissionStatus = {
  status: 'ready',
  hasForegroundPermission: true,
  hasBackgroundPermission: true,
  locationServicesEnabled: true,
};

const LocationTracking = registerPlugin<LocationTrackingPlugin>('LocationTracking', {
  web: {
    ping: async () => ({ ok: false, platform: 'web_stub' }),
    checkPermissions: async () => readyStatus,
    requestForegroundPermission: async () => readyStatus,
    requestBackgroundPermission: async () => readyStatus,
    start: async () => ({ started: true }),
    stop: async () => ({ stopped: true }),
  },
});

// ── Startup probe ─────────────────────────────────────────────────────────────
// Called once at module load. Logs key diagnostics so we know immediately whether
// the native bridge is reachable, before any clock-in attempt.
const _platform = Capacitor.getPlatform();
const _isNative = Capacitor.isNativePlatform();
console.log('[ANDROID-GEO] androidLocationTracking loaded — platform=' + _platform + ' isNative=' + _isNative);

if (_platform === 'android') {
  // Verify the plugin object actually has the expected methods.
  // If any method is missing this module itself is broken.
  const methods = ['ping', 'checkPermissions', 'requestForegroundPermission', 'start', 'stop'];
  const missing = methods.filter((m) => typeof (LocationTracking as any)[m] !== 'function');
  if (missing.length > 0) {
    console.log('[ANDROID-GEO] PLUGIN METHODS MISSING: ' + missing.join(', ') + ' — native tracking will fail');
  } else {
    console.log('[ANDROID-GEO] plugin object has all required methods');
  }

  // Fire ping() to prove whether the bridge reaches native Java.
  // Result logged immediately so it appears in the very first Logcat dump.
  LocationTracking.ping().then((res) => {
    console.log('[ANDROID-GEO] ping result ok=' + res.ok + ' platform=' + res.platform);
    if (res.platform === 'web_stub') {
      console.log('[ANDROID-GEO] WARNING: ping returned web_stub — native bridge NOT reached. APK may be stale.');
    } else {
      console.log('[ANDROID-GEO] ping SUCCESS — native bridge is reachable');
    }
  }).catch((e: any) => {
    console.log('[ANDROID-GEO] ping FAILED — native bridge threw: ' + (e?.message || String(e)));
    console.log('[ANDROID-GEO] this means the native plugin is NOT registered in the current APK build');
  });
}

export { LocationTracking };
