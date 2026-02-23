# EcoLogic iOS Push Notifications Setup

## Prerequisites
- Apple Developer Account with Push Notifications enabled
- Xcode 15+ with real device connected via cable
- APNs Auth Key (.p8 file) from Apple Developer portal

## Step 1: Apple Developer Portal

1. Go to **Certificates, Identifiers & Profiles** > **Keys**
2. Create a new key with **Apple Push Notifications service (APNs)** enabled
3. Download the `.p8` file (e.g., `AuthKey_ABC123.p8`)
4. Note the **Key ID** shown on the portal
5. Note your **Team ID** from the top-right of the developer portal

## Step 2: Set Environment Secrets

Add these secrets to your Replit project (or server environment):

| Secret | Value |
|--------|-------|
| `APNS_TEAM_ID` | Your Apple Developer Team ID (e.g., `ABCDE12345`) |
| `APNS_KEY_ID` | The Key ID from step 1 (e.g., `ABC123DEFG`) |
| `APNS_BUNDLE_ID` | Your app bundle identifier (e.g., `com.ecologic.app`) |
| `APNS_AUTH_KEY_P8` | Full contents of the `.p8` file (paste the entire file including `-----BEGIN PRIVATE KEY-----` header/footer) |
| `APNS_USE_SANDBOX` | Set to `true` for development builds, remove or set `false` for production |

## Step 3: Xcode Project Configuration

1. Open the Xcode project (e.g., `ios/App/App.xcworkspace`)
2. Select your app target > **Signing & Capabilities**
3. Select your Development Team
4. Verify **Bundle Identifier** matches `APNS_BUNDLE_ID`
5. Click **+ Capability** and add:
   - **Push Notifications**
   - **Background Modes** > check **Remote notifications**

## Step 4: Build & Run on Real Device

1. Connect your iPhone via USB cable
2. Select the device as the build target in Xcode
3. Build and run (Cmd+R)
4. The app will install on your device

## Step 5: Enable Notifications in the App

1. Open EcoLogic on your iPhone
2. Go to **Settings** page
3. Tap **Enable Notifications**
4. When the iOS permission popup appears, tap **Allow**

## Step 6: Test Notifications

### Local Test (no server needed)
- In Settings, tap **Test Local**
- A notification banner should appear after ~2 seconds with "Notifications are working."

### Remote Test (requires APNs secrets)
- In Settings, tap **Test Remote** (Owner/Supervisor only)
- The server will send a real push notification via APNs
- You should see "EcoLogic Test" notification appear

### API Test
```bash
curl -X POST https://your-server.com/api/push/test \
  -H "Cookie: your-session-cookie" \
  -H "Content-Type: application/json"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No iOS permission popup | Check Push Notifications capability is added in Xcode |
| Permission popup denied | Go to iPhone Settings > EcoLogic > Notifications > Allow |
| Local test works but remote doesn't | Verify APNs secrets are set correctly |
| "APNs not configured" in server logs | Check all 4 APNS_* secrets are present |
| Token shows as "Unregistered" | You may need to use sandbox mode (`APNS_USE_SANDBOX=true`) for dev builds |
| Push works in foreground but no banner | iOS suppresses banners when app is in foreground; we mirror as local notification to work around this |

## Architecture

- **Frontend**: `@capacitor/push-notifications` requests iOS permission and registers the APNs device token
- **Backend**: Token stored in `push_tokens` table, sent via direct APNs HTTP/2 using `.p8` token-based auth
- **Foreground**: When a push arrives while app is open, a local notification is scheduled to show the banner
- **Triggers**: All in-app notifications (job assignments, messages, etc.) automatically send push via `notificationService.ts`
