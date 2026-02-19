import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { JobsScreen } from '../screens/JobsScreen';
import { JobDetailScreen } from '../screens/JobDetailScreen';
import { TimeScreen } from '../screens/TimeScreen';
import { COLORS } from '../constants/config';
import { ActiveSessionBanner } from '../components/ActiveSessionBanner';
import { View } from 'react-native';

export type JobsStackParamList = {
  JobsList: undefined;
  JobDetail: { jobId: number; jobTitle: string };
};

const JobsStack = createNativeStackNavigator<JobsStackParamList>();

function JobsStackNavigator() {
  return (
    <JobsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <JobsStack.Screen
        name="JobsList"
        component={JobsScreen}
        options={{ title: 'Jobs' }}
      />
      <JobsStack.Screen
        name="JobDetail"
        component={JobDetailScreen}
        options={({ route }) => ({ title: route.params.jobTitle || 'Job Details' })}
      />
    </JobsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Schedule: '📅',
    Jobs: '🔧',
    Clock: '⏱️',
  };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 20 }}>{icons[label] || '•'}</Text>
      <Text
        style={{
          fontSize: 10,
          color: focused ? COLORS.primary : COLORS.textSecondary,
          fontWeight: focused ? '700' : '400',
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function AppTabs() {
  return (
    <View style={{ flex: 1 }}>
      <ActiveSessionBanner />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: COLORS.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700', letterSpacing: 2 },
          tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: '#fff',
            borderTopColor: COLORS.border,
            height: 80,
            paddingBottom: 20,
          },
          tabBarActiveTintColor: COLORS.primary,
        })}
      >
        <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'ECOLOGIC' }} />
        <Tab.Screen
          name="Jobs"
          component={JobsStackNavigator}
          options={{ headerShown: false }}
        />
        <Tab.Screen name="Clock" component={TimeScreen} options={{ title: 'Time' }} />
      </Tab.Navigator>
    </View>
  );
}
