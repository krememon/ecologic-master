import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/hooks/useAuth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { resumeTrackingIfNeeded } from './src/services/locationTracking';

export default function App() {
  useEffect(() => {
    resumeTrackingIfNeeded();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
