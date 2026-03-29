package com.ecologic.app;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // WRAPPER BADGE: Set to false to hide the debug overlay
    private static final boolean SHOW_WRAPPER_BADGE = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationTrackingPlugin.class);
        super.onCreate(savedInstanceState);

        if (SHOW_WRAPPER_BADGE) {
            addWrapperBadge();
        }
    }

    private void addWrapperBadge() {
        TextView badge = new TextView(this);
        badge.setText("WRAPPER");
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        badge.setTextColor(Color.WHITE);
        badge.setTypeface(null, android.graphics.Typeface.BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dpToPx(12), dpToPx(3), dpToPx(12), dpToPx(3));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(217, 26, 127, 100));
        bg.setCornerRadius(dpToPx(10));
        badge.setBackground(bg);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.topMargin = dpToPx(48);

        ViewGroup rootView = findViewById(android.R.id.content);
        rootView.addView(badge, params);
    }

    private int dpToPx(int dp) {
        return (int) TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, dp,
            getResources().getDisplayMetrics()
        );
    }
}
