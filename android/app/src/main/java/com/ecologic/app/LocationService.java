package com.ecologic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationService extends Service {

    public static final String ACTION_START = "com.ecologic.app.LOCATION_START";
    public static final String ACTION_STOP = "com.ecologic.app.LOCATION_STOP";
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_API_BASE_URL = "apiBaseUrl";
    public static final String EXTRA_AUTH_TOKEN = "authToken";

    private static final String TAG = "EcoLogic.LocService";
    private static final String GEO_TAG = "[ANDROID-GEO-SERVICE]";
    private static final String CHANNEL_ID = "ecologic_location_tracking";
    private static final int NOTIFICATION_ID = 1001;

    private static final long INTERVAL_MS = 60_000L;
    private static final long FASTEST_INTERVAL_MS = 15_000L;
    private static final float DISTANCE_THRESHOLD_M = 50f;
    private static final float ACCURACY_LIMIT_M = 100f;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ExecutorService networkExecutor;

    private long sessionId = -1;
    private String apiBaseUrl = "";
    private String authToken = "";

    private Location lastSentLocation = null;
    private long lastSentTime = 0;
    private int locationCount = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        networkExecutor = Executors.newSingleThreadExecutor();
        Log.i(TAG, GEO_TAG + " onCreate — service created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            Log.i(TAG, GEO_TAG + " onStartCommand — STOP received");
            stopTracking();
            stopSelf();
            Log.i(TAG, GEO_TAG + " stopSelf called");
            return START_NOT_STICKY;
        }

        sessionId = intent.getLongExtra(EXTRA_SESSION_ID, -1);
        apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL);
        authToken = intent.getStringExtra(EXTRA_AUTH_TOKEN);

        if (apiBaseUrl == null) apiBaseUrl = "";
        if (authToken == null) authToken = "";

        Log.i(TAG, GEO_TAG + " onStartCommand — START sessionId=" + sessionId
                + " apiBase=" + apiBaseUrl
                + " tokenPresent=" + (!authToken.isEmpty()));

        createNotificationChannel();
        Notification notification = buildNotification();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            Log.i(TAG, GEO_TAG + " startForeground success — notification posted");
        } catch (Exception e) {
            Log.e(TAG, GEO_TAG + " startForeground FAILED: " + e.getMessage(), e);
        }

        startLocationUpdates();
        return START_STICKY;
    }

    private void startLocationUpdates() {
        Log.i(TAG, GEO_TAG + " fused location request start — interval=" + INTERVAL_MS
                + "ms fastest=" + FASTEST_INTERVAL_MS + "ms dist=" + DISTANCE_THRESHOLD_M + "m");

        LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
                .setMinUpdateIntervalMillis(FASTEST_INTERVAL_MS)
                .setMinUpdateDistanceMeters(DISTANCE_THRESHOLD_M)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null) return;
                for (Location location : result.getLocations()) {
                    onNewLocation(location);
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(
                    locationRequest, locationCallback, Looper.getMainLooper());
            Log.i(TAG, GEO_TAG + " fused location updates registered successfully");
        } catch (SecurityException e) {
            Log.e(TAG, GEO_TAG + " fused location SECURITY EXCEPTION — missing permission: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, GEO_TAG + " fused location unexpected error: " + e.getMessage(), e);
        }
    }

    private void onNewLocation(Location location) {
        locationCount++;
        float accuracy = location.getAccuracy();
        Log.d(TAG, GEO_TAG + " location #" + locationCount
                + " lat=" + location.getLatitude()
                + " lng=" + location.getLongitude()
                + " acc=" + accuracy);

        if (locationCount == 1) {
            Log.i(TAG, GEO_TAG + " first location received — sessionId=" + sessionId
                    + " lat=" + location.getLatitude() + " lng=" + location.getLongitude());
        }

        if (accuracy > ACCURACY_LIMIT_M) {
            Log.d(TAG, GEO_TAG + " skipping point — accuracy " + accuracy + " > limit " + ACCURACY_LIMIT_M);
            return;
        }

        long now = System.currentTimeMillis();
        boolean shouldSend = false;

        if (lastSentLocation == null) {
            shouldSend = true;
            Log.d(TAG, GEO_TAG + " first qualifying point — sending");
        } else {
            float moved = lastSentLocation.distanceTo(location);
            long elapsed = now - lastSentTime;
            if (moved >= DISTANCE_THRESHOLD_M || elapsed >= INTERVAL_MS) {
                shouldSend = true;
                Log.d(TAG, GEO_TAG + " sending — moved=" + moved + "m elapsed=" + elapsed + "ms");
            }
        }

        if (shouldSend) {
            lastSentLocation = location;
            lastSentTime = now;
            sendToBackend(location);
        }
    }

    private void sendToBackend(final Location location) {
        networkExecutor.submit(() -> {
            try {
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                String recordedAt = sdf.format(new Date(location.getTime()));

                JSONObject point = new JSONObject();
                point.put("lat", location.getLatitude());
                point.put("lng", location.getLongitude());
                point.put("accuracy", location.getAccuracy());
                point.put("recordedAt", recordedAt);
                point.put("source", "android_fg_service");
                if (location.hasSpeed()) point.put("speed", location.getSpeed());
                if (location.hasBearing()) point.put("heading", location.getBearing());
                if (location.hasAltitude()) point.put("altitude", location.getAltitude());

                JSONArray points = new JSONArray();
                points.put(point);

                JSONObject body = new JSONObject();
                body.put("sessionId", sessionId);
                body.put("points", points);

                String targetUrl = apiBaseUrl + "/api/location/batch";
                Log.i(TAG, GEO_TAG + " upload attempt — url=" + targetUrl + " sessionId=" + sessionId);

                URL url = new URL(targetUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                if (!authToken.isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + authToken);
                }
                conn.setDoOutput(true);
                conn.setConnectTimeout(15_000);
                conn.setReadTimeout(15_000);

                byte[] bodyBytes = body.toString().getBytes("UTF-8");
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bodyBytes);
                }

                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    Log.i(TAG, GEO_TAG + " batch upload success — HTTP " + code + " sessionId=" + sessionId);
                } else {
                    Log.w(TAG, GEO_TAG + " batch upload failed — HTTP " + code + " sessionId=" + sessionId);
                }
                conn.disconnect();
            } catch (Exception e) {
                Log.e(TAG, GEO_TAG + " batch upload failed — " + e.getMessage(), e);
            }
        });
    }

    private void stopTracking() {
        if (locationCallback != null && fusedLocationClient != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
            Log.i(TAG, GEO_TAG + " fused location updates removed");
        }
    }

    @Override
    public void onDestroy() {
        stopTracking();
        if (networkExecutor != null) {
            networkExecutor.shutdown();
        }
        Log.i(TAG, GEO_TAG + " onDestroy — service destroyed");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "EcoLogic Location Tracking",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Active while you are clocked in");
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("EcoLogic")
                .setContentText("Tracking your work location while clocked in.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setSilent(true)
                .build();
    }
}
