import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../services/api';
import { COLORS } from '../constants/config';
import { useActiveSession } from '../hooks/useActiveSession';
import type { JobsStackParamList } from '../navigation/AppTabs';

type Props = NativeStackScreenProps<JobsStackParamList, 'JobDetail'>;

interface JobDetail {
  id: number;
  title: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  customerName?: string;
}

export function JobDetailScreen({ route }: Props) {
  const { jobId } = route.params;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { activeSession, clockIn, clockOut, isClockingIn, isClockingOut } = useActiveSession();

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get(`/api/jobs/${jobId}`);
        setJob(data);
      } catch (err) {
        console.error('Failed to fetch job:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  const handleClockIn = async () => {
    try {
      await clockIn(jobId);
      Alert.alert('Clocked In', `You are now clocked in to ${job?.title || 'this job'}.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to clock in');
    }
  };

  const handleClockOut = async () => {
    Alert.alert('Clock Out', 'Are you sure you want to clock out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clock Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await clockOut();
            Alert.alert('Clocked Out', 'You have been clocked out.');
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to clock out');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Job not found</Text>
      </View>
    );
  }

  const isClockedInToThis = activeSession?.jobId === jobId;
  const isClockedInToOther = activeSession && !isClockedInToThis;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>{job.title || `Job #${job.id}`}</Text>
        {job.customerName && (
          <Text style={styles.subtitle}>{job.customerName}</Text>
        )}

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Status</Text>
          <Text style={styles.detailValue}>{(job.status || '').replace(/_/g, ' ')}</Text>
        </View>

        {(job.address || job.city) && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue}>
              {[job.address, job.city, job.state].filter(Boolean).join(', ')}
            </Text>
          </View>
        )}

        {job.description && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Description</Text>
            <Text style={styles.detailValue}>{job.description}</Text>
          </View>
        )}
      </View>

      <View style={styles.clockSection}>
        {isClockedInToThis ? (
          <TouchableOpacity
            style={[styles.clockButton, styles.clockOutButton]}
            onPress={handleClockOut}
            disabled={isClockingOut}
          >
            {isClockingOut ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.clockButtonIcon}>⏹️</Text>
                <Text style={styles.clockButtonText}>Clock Out</Text>
              </>
            )}
          </TouchableOpacity>
        ) : isClockedInToOther ? (
          <View style={styles.alreadyClockedIn}>
            <Text style={styles.alreadyClockedText}>
              You are clocked in to another job. Clock out first.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.clockButton, styles.clockInButton]}
            onPress={handleClockIn}
            disabled={isClockingIn}
          >
            {isClockingIn ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.clockButtonIcon}>▶️</Text>
                <Text style={styles.clockButtonText}>Clock In</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: COLORS.error },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, marginBottom: 16 },
  detailRow: { marginTop: 12 },
  detailLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  detailValue: { fontSize: 15, color: COLORS.text, marginTop: 2 },
  clockSection: { marginTop: 24 },
  clockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 10,
  },
  clockInButton: { backgroundColor: COLORS.primary },
  clockOutButton: { backgroundColor: COLORS.error },
  clockButtonIcon: { fontSize: 20 },
  clockButtonText: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  alreadyClockedIn: {
    backgroundColor: COLORS.warning + '20',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  alreadyClockedText: { fontSize: 14, color: COLORS.warning, textAlign: 'center', fontWeight: '500' },
});
