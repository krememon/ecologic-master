import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { startLocationTracking, stopLocationTracking } from '../services/locationTracking';

interface ActiveSession {
  timeLogId: number;
  jobId: number | null;
  jobTitle: string | null;
  clockedInAt: string;
  category: string | null;
}

export function useActiveSession() {
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [isClockingIn, setIsClockingIn] = useState(false);
  const [isClockingOut, setIsClockingOut] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/api/time/today');
      if (data.activeLog) {
        const session: ActiveSession = {
          timeLogId: data.activeLog.id,
          jobId: data.activeLog.jobId,
          jobTitle: data.activeLog.jobTitle || data.activeLog.job?.title || null,
          clockedInAt: data.activeLog.clockInAt || data.clockedInAt,
          category: data.activeLog.category || null,
        };
        setActiveSession(session);
        const granted = await startLocationTracking(session.timeLogId, session.jobId);
        setLocationDenied(!granted);
      } else {
        setActiveSession(null);
        await stopLocationTracking();
        setLocationDenied(false);
      }
    } catch (err) {
      console.error('Failed to fetch active session:', err);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const clockIn = async (jobId: number, category?: string) => {
    setIsClockingIn(true);
    try {
      const data = await api.post('/api/time/clock-in', { jobId, category: category || 'job' });
      if (data.timeSessionId) {
        const granted = await startLocationTracking(data.timeSessionId, jobId);
        setLocationDenied(!granted);
      }
      await refresh();
      return data;
    } finally {
      setIsClockingIn(false);
    }
  };

  const clockOut = async () => {
    setIsClockingOut(true);
    try {
      await api.post('/api/time/clock-out');
      await stopLocationTracking();
      setActiveSession(null);
      setLocationDenied(false);
    } finally {
      setIsClockingOut(false);
    }
  };

  return { activeSession, isClockingIn, isClockingOut, locationDenied, clockIn, clockOut, refresh };
}
