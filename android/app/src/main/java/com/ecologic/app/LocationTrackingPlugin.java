package com.ecologic.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "LocationTracking",
    permissions = {
        @Permission(
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            },
            alias = "foregroundLocation"
        ),
        @Permission(
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION },
            alias = "backgroundLocation"
        )
    }
)
public class LocationTrackingPlugin extends Plugin {

    private static final String TAG = "EcoLogic.LocPlugin";
    private static final String GEO_TAG = "[ANDROID-GEO-NATIVE]";

    // ── Canary / bridge-test method ───────────────────────────────────────────
    // Call ping() from JS to confirm the native bridge is reachable.
    // If this is never entered, the plugin is not registered in this APK build.
    @PluginMethod
    public void ping(PluginCall call) {
        Log.i(TAG, GEO_TAG + " ping entered — native bridge IS reachable");
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("platform", "android");
        call.resolve(result);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Log.i(TAG, GEO_TAG + " checkPermissions entered");
        boolean fg = hasForegroundPermission();
        boolean bg = hasBackgroundPermission();
        Log.i(TAG, GEO_TAG + " checkPermissions — hasFg=" + fg + " hasBg=" + bg);
        JSObject status = buildPermissionStatus();
        Log.i(TAG, GEO_TAG + " checkPermissions result status=" + status.getString("status"));
        call.resolve(status);
    }

    @PluginMethod
    public void requestForegroundPermission(PluginCall call) {
        Log.i(TAG, GEO_TAG + " requestForegroundPermission entered");
        Log.i(TAG, GEO_TAG + " requestForegroundPermission — hasFg=" + hasForegroundPermission());
        if (hasForegroundPermission()) {
            Log.i(TAG, GEO_TAG + " requestForegroundPermission — already granted, resolving immediately");
            call.resolve(buildPermissionStatus());
            return;
        }
        Log.i(TAG, GEO_TAG + " requestForegroundPermission — requesting system dialog");
        requestPermissionForAlias("foregroundLocation", call, "onForegroundPermissionResult");
    }

    @PermissionCallback
    private void onForegroundPermissionResult(PluginCall call) {
        boolean granted = hasForegroundPermission();
        Log.i(TAG, GEO_TAG + " requestForegroundPermission callback — granted=" + granted);
        call.resolve(buildPermissionStatus());
    }

    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        Log.i(TAG, GEO_TAG + " requestBackgroundPermission entered");
        Log.i(TAG, GEO_TAG + " requestBackgroundPermission — SDK=" + Build.VERSION.SDK_INT);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Log.i(TAG, GEO_TAG + " requestBackgroundPermission — SDK < Q, not required");
            call.resolve(buildPermissionStatus());
            return;
        }
        if (hasBackgroundPermission()) {
            Log.i(TAG, GEO_TAG + " requestBackgroundPermission — already granted");
            call.resolve(buildPermissionStatus());
            return;
        }
        Log.i(TAG, GEO_TAG + " requestBackgroundPermission — requesting system dialog");
        requestPermissionForAlias("backgroundLocation", call, "onBackgroundPermissionResult");
    }

    @PermissionCallback
    private void onBackgroundPermissionResult(PluginCall call) {
        boolean granted = hasBackgroundPermission();
        Log.i(TAG, GEO_TAG + " requestBackgroundPermission callback — granted=" + granted);
        call.resolve(buildPermissionStatus());
    }

    @PluginMethod
    public void start(PluginCall call) {
        Log.i(TAG, GEO_TAG + " start entered");
        long sessionId = call.getLong("sessionId", -1L);
        String apiBaseUrl = call.getString("apiBaseUrl", "");
        String authToken = call.getString("authToken", "");
        boolean tokenPresent = authToken != null && !authToken.isEmpty();

        Log.i(TAG, GEO_TAG + " start called — sessionId=" + sessionId
                + " apiBaseUrl=" + apiBaseUrl
                + " tokenPresent=" + tokenPresent);

        if (sessionId < 0) {
            Log.e(TAG, GEO_TAG + " start failed: sessionId is required and must be >= 0 (got " + sessionId + ")");
            call.reject("sessionId is required and must be >= 0");
            return;
        }

        if (!hasForegroundPermission()) {
            Log.e(TAG, GEO_TAG + " start failed: foreground location permission not granted");
            call.reject("Foreground location permission not granted");
            return;
        }

        Context ctx = getContext();
        Intent intent = new Intent(ctx, LocationService.class);
        intent.setAction(LocationService.ACTION_START);
        intent.putExtra(LocationService.EXTRA_SESSION_ID, sessionId);
        intent.putExtra(LocationService.EXTRA_API_BASE_URL, apiBaseUrl);
        intent.putExtra(LocationService.EXTRA_AUTH_TOKEN, authToken != null ? authToken : "");

        try {
            ContextCompat.startForegroundService(ctx, intent);
            Log.i(TAG, GEO_TAG + " service intent dispatched — sessionId=" + sessionId);
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, GEO_TAG + " start failed: " + e.getMessage(), e);
            call.reject("Failed to start location service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Log.i(TAG, GEO_TAG + " stop entered");
        Context ctx = getContext();
        Intent intent = new Intent(ctx, LocationService.class);
        intent.setAction(LocationService.ACTION_STOP);
        ctx.stopService(intent);
        Log.i(TAG, GEO_TAG + " stop intent dispatched");
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    private boolean hasForegroundPermission() {
        Context ctx = getContext();
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return hasForegroundPermission();
        }
        return ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject buildPermissionStatus() {
        boolean fgGranted = hasForegroundPermission();
        boolean bgGranted = hasBackgroundPermission();

        LocationManager lm = (LocationManager) getContext()
                .getSystemService(Context.LOCATION_SERVICE);
        boolean locationOn = lm != null &&
                (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                 lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));

        String status;
        if (!locationOn) {
            status = "location_services_off";
        } else if (!fgGranted) {
            status = "needs_foreground_permission";
        } else if (!bgGranted) {
            status = "needs_background_permission";
        } else {
            status = "ready";
        }

        JSObject obj = new JSObject();
        obj.put("status", status);
        obj.put("hasForegroundPermission", fgGranted);
        obj.put("hasBackgroundPermission", bgGranted);
        obj.put("locationServicesEnabled", locationOn);
        return obj;
    }
}
