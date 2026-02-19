import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { useActiveSession } from '../hooks/useActiveSession';
import { COLORS } from '../constants/config';

export function ActiveSessionBanner() {
  const { activeSession, locationDenied } = useActiveSession();
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!activeSession?.clockedInAt) {
      setElapsed('');
      return;
    }

    const update = () => {
      const start = new Date(activeSession.clockedInAt).getTime();
      const diff = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(diff / 3600).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
      const s = (diff % 60).toString().padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeSession?.clockedInAt]);

  const openSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  if (!activeSession) return null;

  return (
    <View>
      <View style={styles.banner}>
        <View style={styles.dot} />
        <Text style={styles.text}>
          Clocked in{activeSession.jobTitle ? ` - ${activeSession.jobTitle}` : ''} {'\u2022'} {elapsed}
        </Text>
      </View>
      {locationDenied && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            Location permission denied. Live tracking requires background location access.
          </Text>
          <TouchableOpacity onPress={openSettings} style={styles.settingsButton}>
            <Text style={styles.settingsButtonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ade80',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  warningBanner: {
    backgroundColor: '#fef3c7',
    paddingVertical: 6,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  warningText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  settingsButton: {
    backgroundColor: '#92400e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  settingsButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
