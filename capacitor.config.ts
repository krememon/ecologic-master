import type { CapacitorConfig } from '@capacitor/cli';

const HOSTED_APP_URL = process.env.VITE_CAP_HOSTED_URL || 'https://8ba406dd-3601-4e6d-b203-72607ec69813-00-23v869p3ury5l.picard.replit.dev/wrapper';

const config: CapacitorConfig = {
  appId: 'com.ecologic.app',
  appName: 'EcoLogic',
  webDir: 'dist/public',
  server: {
    url: HOSTED_APP_URL,
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      '8ba406dd-3601-4e6d-b203-72607ec69813-00-23v869p3ury5l.picard.replit.dev',
      'accounts.google.com',
      'appleid.apple.com',
    ],
  },
};

export default config;
