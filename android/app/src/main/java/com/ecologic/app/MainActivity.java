package com.ecologic.app;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "EcoLogic.Main";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Log.i(TAG, "[ANDROID-GEO-NATIVE] registering LocationTracking plugin class=com.ecologic.app.LocationTrackingPlugin");
        registerPlugin(LocationTrackingPlugin.class);
        Log.i(TAG, "[ANDROID-GEO-NATIVE] registerPlugin(LocationTrackingPlugin.class) call completed");
        super.onCreate(savedInstanceState);
    }
}
