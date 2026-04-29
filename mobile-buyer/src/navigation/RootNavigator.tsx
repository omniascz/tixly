import React, { useEffect } from 'react';
// TODO: import { NavigationContainer } from '@react-navigation/native';
// TODO: import { createStackNavigator } from '@react-navigation/stack';
// TODO: import { AppTabs } from './AppTabs';
// TODO: import { useAuthStore } from '../stores/auth.store';
// TODO: import { LoginScreen } from '../screens/LoginScreen';
// TODO: import { EventDetailScreen } from '../screens/EventDetailScreen';
// TODO: import { CheckoutScreen } from '../screens/CheckoutScreen';
// TODO: import { TicketDetailScreen } from '../screens/TicketDetailScreen';
// TODO: import { configureClient } from '../api/client';
// TODO: import { authApi } from '../api/auth.api';

/**
 * RootNavigator
 * - Checks auth state on mount (loadFromStorage)
 * - Conditionally renders Auth stack vs App stack
 * - Configures apiClient with token getter + refresh handler
 */
// const Stack = createStackNavigator();

export function RootNavigator(): React.ReactElement {
  // TODO: const { tokens, loadFromStorage, getAccessToken, setTokens, logout } = useAuthStore();

  // TODO: useEffect → loadFromStorage + configureClient({
  //   getAccessToken,
  //   onTokenExpired: async () => {
  //     if (!tokens?.refreshToken) { logout(); return null; }
  //     try {
  //       const { tokens: newTokens } = await authApi.refresh(tokens.refreshToken);
  //       await setTokens(newTokens);
  //       return newTokens.accessToken;
  //     } catch {
  //       await logout();
  //       return null;
  //     }
  //   }
  // })

  // TODO:
  // return (
  //   <NavigationContainer>
  //     <Stack.Navigator>
  //       {tokens ? (
  //         <>
  //           <Stack.Screen name="AppTabs" component={AppTabs} options={{ headerShown: false }} />
  //           <Stack.Screen name="EventDetail" component={EventDetailScreen} />
  //           <Stack.Screen name="Checkout" component={CheckoutScreen} />
  //           <Stack.Screen name="TicketDetail" component={TicketDetailScreen} />
  //         </>
  //       ) : (
  //         <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
  //       )}
  //     </Stack.Navigator>
  //   </NavigationContainer>
  // );
  return <></>;
}
