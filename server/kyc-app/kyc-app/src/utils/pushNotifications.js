// Push Notifications - Keep-alive system
import { auth, db } from '../supabase';
import { doc, setDoc, serverTimestamp } from 'supabase/database';

// Request notification permission and register
export async function initializePushNotifications() {
  // Check if notifications are supported
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.warn('Push notifications not supported');
    return null;
  }

  try {
    // Request permission
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      console.log('Notification permission denied');
      return null;
    }

    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Get FCM token (Supabase Cloud Messaging)
    // Note: You need to add Supabase Messaging SDK
    // For now, we'll use a placeholder
    const token = await getDeviceToken(registration);

    if (!token) {
      console.error('Failed to get device token');
      return null;
    }

    // Save token to Database
    const user = auth.currentUser;
    if (user) {
      await saveTokenToDatabase(user.uid, token);
    }

    console.log('✅ Push notifications initialized');
    return token;
  } catch (error) {
    console.error('Push notification init failed:', error);
    return null;
  }
}

// Get device token (placeholder - needs Supabase Messaging)
async function getDeviceToken(registration) {
  // TODO: Implement Supabase Messaging
  // import { getMessaging, getToken } from 'supabase/messaging';
  // const messaging = getMessaging();
  // return await getToken(messaging, { serviceWorkerRegistration: registration });

  // For now, generate a unique ID
  return `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Save token to Database
async function saveTokenToDatabase(userId, token) {
  try {
    await setDoc(
      doc(db, 'users', userId),
      {
        fcmToken: token,
        fcmTokenUpdatedAt: serverTimestamp(),
        platform: getPlatform(),
        notificationsEnabled: true,
      },
      { merge: true }
    );

    console.log('Token saved to Database');
  } catch (error) {
    console.error('Failed to save token:', error);
  }
}

// Detect platform
function getPlatform() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  return 'web';
}

// Unregister push notifications
export async function disablePushNotifications() {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.unregister();
    }

    const user = auth.currentUser;
    if (user) {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          fcmToken: null,
          notificationsEnabled: false,
        },
        { merge: true }
      );
    }

    console.log('✅ Push notifications disabled');
  } catch (error) {
    console.error('Failed to disable notifications:', error);
  }
}

// Check if notifications are enabled
export function areNotificationsEnabled() {
  return Notification.permission === 'granted';
}
