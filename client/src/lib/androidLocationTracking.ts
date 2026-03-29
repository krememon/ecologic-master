import { registerPlugin } from '@capacitor/core';

export interface AndroidLocationPermissionStatus {
  status: 'ready' | 'needs_foreground_permission' | 'needs_background_permission' | 'location_services_off';
  hasForegroundPermission: boolean;
  hasBackgroundPermission: boolean;
  locationServicesEnabled: boolean;
}

interface LocationTrackingPlugin {
  checkPermissions(): Promise<AndroidLocationPermissionStatus>;
  requestForegroundPermission(): Promise<AndroidLocationPermissionStatus>;
  requestBackgroundPermission(): Promise<AndroidLocationPermissionStatus>;
  start(opts: { sessionId: number; apiBaseUrl: string; authToken: string }): Promise<{ started: boolean }>;
  stop(): Promise<{ stopped: boolean }>;
}

const readyStatus: AndroidLocationPermissionStatus = {
  status: 'ready',
  hasForegroundPermission: true,
  hasBackgroundPermission: true,
  locationServicesEnabled: true,
};

const LocationTracking = registerPlugin<LocationTrackingPlugin>('LocationTracking', {
  web: {
    checkPermissions: async () => readyStatus,
    requestForegroundPermission: async () => readyStatus,
    requestBackgroundPermission: async () => readyStatus,
    start: async () => ({ started: true }),
    stop: async () => ({ stopped: true }),
  },
});

export { LocationTracking };
