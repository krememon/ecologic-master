import type { CapacitorConfig } from '@capacitor/cli';

const HOSTED_APP_URL = process.env.VITE_CAP_HOSTED_URL || 'https://app.ecologicc.com';

const config: CapacitorConfig = {
  appId: 'com.ecologic.app',
  appName: 'EcoLogic',
  webDir: 'dist/public',
  server: {
    url: HOSTED_APP_URL,
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      'app.ecologicc.com',
      'ecologicc.com',
      'accounts.google.com',
      'appleid.apple.com',
    ],
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
