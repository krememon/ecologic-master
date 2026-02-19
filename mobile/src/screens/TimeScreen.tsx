import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { api } from '../services/api';
import { COLORS } from '../constants/config';
import { useActiveSession } from '../hooks/useActiveSession';

export function TimeScreen() {
  const { activeSession, clockOut, isClockingOut, refresh } = useActiveSession();
  const [elapsed, setElapsed] = useState('00:00:00');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!activeSession?.clockedInAt) {
      setElapsed('00:00:00');
      return;
    }

    const update = () => {
      const start = new Date(activeSession.clockedInAt!).getTime();
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

  const handleClockOut = () => {
    Alert.alert('Clock Out', 'Are you sure you want to clock out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clock Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await clockOut();
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to clock out');
          }
        },
      },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
      }
    >
      {activeSession ? (
        <View style={styles.activeCard}>
          <Text style={styles.activeLabel}>CLOCKED IN</Text>
          <Text style={styles.timer}>{elapsed}</Text>
          {activeSession.jobTitle && (
            <Text style={styles.jobName}>{activeSession.jobTitle}</Text>
          )}
          {activeSession.category && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{activeSession.category.toUpperCase()}</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.clockOutButton}
            onPress={handleClockOut}
            disabled={isClockingOut}
          >
            {isClockingOut ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.clockOutText}>Clock Out</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.inactiveCard}>
          <Text style={styles.inactiveIcon}>⏱️</Text>
          <Text style={styles.inactiveTitle}>Not Clocked In</Text>
          <Text style={styles.inactiveSubtext}>
            Go to a job and tap "Clock In" to start tracking time.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, flex: 1, justifyContent: 'center' },
  activeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  activeLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    color: COLORS.primary,
    marginBottom: 12,
  },
  timer: {
    fontSize: 56,
    fontWeight: '800',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  jobName: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  categoryBadge: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  clockOutButton: {
    backgroundColor: COLORS.error,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    marginTop: 32,
    width: '100%',
    alignItems: 'center',
  },
  clockOutText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  inactiveCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inactiveIcon: { fontSize: 56, marginBottom: 16 },
  inactiveTitle: { fontSize: 22, fontWeight: '700', color: COLORS.text },
  inactiveSubtext: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
});
