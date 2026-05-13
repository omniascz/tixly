// Push Notification Service
// Handles Expo push token registration and incoming notification routing.
// NOTE: expo-notifications is loaded lazily — this file imports it via require
//       so it can be tested without a native RN environment.

import { authApi } from '../api/auth.api';

export type NavigateFunction = (screen: string, params?: Record<string, unknown>) => void;
export type ToastFunction = (message: string) => void;

let _navigate: NavigateFunction | null = null;
let _toast: ToastFunction | null = null;

export function configurePushHandlers(options: {
  navigate: NavigateFunction;
  toast: ToastFunction;
}): void {
  _navigate = options.navigate;
  _toast = options.toast;
}

export interface NotificationPayload {
  type: 'order.confirmed' | 'event.reminder' | 'ticket.transferred';
  orderId?: string;
  eventId?: string;
  ticketId?: string;
  message?: string;
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[PushNotifications] Permission not granted');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const expoPushToken: string = tokenData.data;

    // Send token to backend
    await authApi.registerPushToken(expoPushToken);

    return expoPushToken;
  } catch (err) {
    console.error('[PushNotifications] Registration failed', err);
    return null;
  }
}

export function handleNotification(payload: NotificationPayload): void {
  switch (payload.type) {
    case 'order.confirmed':
      _navigate?.('TicketWallet');
      break;

    case 'event.reminder':
      if (payload.eventId) {
        _navigate?.('EventDetail', { eventId: payload.eventId });
      }
      break;

    case 'ticket.transferred': {
      const message = payload.message ?? 'Vstupenka byla přenesena';
      _toast?.(message);
      // Trigger wallet refresh by navigating to it
      _navigate?.('TicketWallet');
      break;
    }

    default:
      console.warn('[PushNotifications] Unknown notification type', payload);
  }
}

export function setupNotificationListeners(): () => void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');

    // Configure how notifications appear when app is foregrounded
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response: { notification: { request: { content: { data: NotificationPayload } } } }) => {
        const data = response.notification.request.content.data;
        handleNotification(data);
      },
    );

    return () => subscription.remove();
  } catch {
    // Not in a native environment
    return () => {};
  }
}
