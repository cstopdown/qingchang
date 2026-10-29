import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.qingchang.app',
  appName: '轻唱',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost' },
  android: { allowMixedContent: false },
};

export default config;
