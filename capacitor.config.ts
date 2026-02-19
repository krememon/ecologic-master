import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ecologic.app',
  appName: 'EcoLogic',
  webDir: 'dist/public',
  server: {
    // DEV MODE: Uncomment the line below and set your LAN IP for live reload testing.
    // url: 'http://192.168.1.XXX:5000',
    // allowNavigation: ['*'],
    androidScheme: 'https',
  },
};

export default config;
