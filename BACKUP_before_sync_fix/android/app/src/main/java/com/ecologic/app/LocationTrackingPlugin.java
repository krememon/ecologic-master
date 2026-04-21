package com.ecologic.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
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
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "foregroundLocation"),
        @Permission(strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, alias = "backgroundLocation")
    }
)
public class LocationTrackingPlugin extends Plugin {
    private static final String TAG = "EcoLogic.LocPlugin";

    static {
        Log.e("EcoLogic.PROOF", "LOCATIONTRACKINGPLUGIN CLASS LOADED FROM CURRENT SOURCE");
        Log.i("EcoLogic.LocPlugin", "[ANDROID-GEO-NATIVE] LocationTrackingPlugin class loaded");
    }

    @PluginMethod
    public void ping(PluginCall call) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] ping entered — bridge reachable");
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("platform", "android");
        call.resolve(r);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] checkPermissions entered");
        call.resolve(buildPermissionStatus());
    }

    @PluginMethod
    public void requestForegroundPermission(PluginCall call) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] requestForegroundPermission entered");
        if (hasForegroundPermission()) { call.resolve(buildPermissionStatus()); return; }
        requestPermissionForAlias("foregroundLocation", call, "onFgResult");
    }

    @PermissionCallback
    private void onFgResult(PluginCall call) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] requestForegroundPermission callback granted=" + hasForegroundPermission());
        call.resolve(buildPermissionStatus());
    }

    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] requestBackgroundPermission entered");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasBackgroundPermission()) {
            call.resolve(buildPermissionStatus()); return;
        }
        requestPermissionForAlias("backgroundLocation", call, "onBgResult");
    }

    @PermissionCallback
    private void onBgResult(PluginCall call) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] requestBackgroundPermission callback granted=" + hasBackgroundPermission());
        call.resolve(buildPermissionStatus());
    }

    @PluginMethod
    public void start(PluginCall call) {
        // ── Robust sessionId parsing ──────────────────────────────────────────────
        // Capacitor deserializes JSON numbers as Integer (not Long) when the value
        // fits in 32 bits. call.getLong() does a direct (Long) cast which silently
        // returns the default -1 for Integer values. We must read the raw JSON token
        // and handle Integer, Long, and String forms ourselves.
        long sessionId = -1L;
        Object rawSessionId = null;
        try { rawSessionId = call.getData().opt("sessionId"); } catch (Exception ignored) {}

        Log.i(TAG, "[ANDROID-GEO-NATIVE] raw sessionId from call as Long=" + call.getLong("sessionId", -999L));
        Log.i(TAG, "[ANDROID-GEO-NATIVE] raw sessionId from call as String=" + call.getString("sessionId", "(null)"));
        Log.i(TAG, "[ANDROID-GEO-NATIVE] raw sessionId JSON type=" + (rawSessionId == null ? "null" : rawSessionId.getClass().getSimpleName()) + " value=" + rawSessionId);

        if (rawSessionId instanceof Long) {
            sessionId = (Long) rawSessionId;
        } else if (rawSessionId instanceof Integer) {
            sessionId = ((Integer) rawSessionId).longValue();
        } else if (rawSessionId instanceof Double) {
            sessionId = ((Double) rawSessionId).longValue();
        } else if (rawSessionId instanceof String) {
            try { sessionId = Long.parseLong((String) rawSessionId); } catch (NumberFormatException ignored) {}
        }

        Log.i(TAG, "[ANDROID-GEO-NATIVE] final parsed sessionId=" + sessionId);

        String apiBaseUrl = call.getString("apiBaseUrl", "");
        String authToken = call.getString("authToken", "");
        Log.i(TAG, "[ANDROID-GEO-NATIVE] start entered sessionId=" + sessionId + " tokenPresent=" + (authToken != null && !authToken.isEmpty()));
        if (sessionId < 0) { call.reject("sessionId required — parsed value was " + sessionId + " raw type=" + (rawSessionId == null ? "null" : rawSessionId.getClass().getSimpleName())); return; }
        if (!hasForegroundPermission()) { call.reject("Foreground location permission not granted"); return; }
        Context ctx = getContext();
        Intent intent = new Intent(ctx, LocationService.class);
        intent.setAction(LocationService.ACTION_START);
        intent.putExtra(LocationService.EXTRA_SESSION_ID, sessionId);
        intent.putExtra(LocationService.EXTRA_API_BASE_URL, apiBaseUrl);
        intent.putExtra(LocationService.EXTRA_AUTH_TOKEN, authToken != null ? authToken : "");
        try {
            ContextCompat.startForegroundService(ctx, intent);
            Log.i(TAG, "[ANDROID-GEO-NATIVE] service started sessionId=" + sessionId);
            JSObject r = new JSObject(); r.put("started", true); call.resolve(r);
        } catch (Exception e) {
            Log.e(TAG, "[ANDROID-GEO-NATIVE] start failed: " + e.getMessage(), e);
            call.reject("Failed to start location service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] stop entered");
        Context ctx = getContext();
        Intent intent = new Intent(ctx, LocationService.class);
        intent.setAction(LocationService.ACTION_STOP);
        try {
            ctx.startService(intent);
            Log.i(TAG, "[ANDROID-GEO-NATIVE] stop dispatched");
            JSObject r = new JSObject(); r.put("stopped", true); call.resolve(r);
        } catch (Exception e) {
            Log.e(TAG, "[ANDROID-GEO-NATIVE] stop failed: " + e.getMessage(), e);
            call.reject("Failed to stop location service: " + e.getMessage());
        }
    }

    private boolean hasForegroundPermission() {
        return getPermissionState("foregroundLocation") == com.getcapacitor.PermissionState.GRANTED;
    }

    private boolean hasBackgroundPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return getPermissionState("backgroundLocation") == com.getcapacitor.PermissionState.GRANTED;
    }

    private JSObject buildPermissionStatus() {
        boolean fg = hasForegroundPermission();
        boolean bg = hasBackgroundPermission();
        String status = bg ? "granted" : fg ? "foreground-only" : "denied";
        JSObject r = new JSObject();
        r.put("status", status);
        r.put("foreground", fg);
        r.put("background", bg);
        return r;
    }
}
