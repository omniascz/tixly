import { Link, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { colors } from '@/lib/theme';
import { STRIPE_PUBLISHABLE_KEY } from '@/lib/config';

export default function RootLayout() {
  const inner = (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.brand },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen
          name="tickets/index"
          options={{
            title: 'Moje vstupenky',
            headerRight: () => (
              <Link href="/events" style={{ color: '#fff', fontWeight: '700' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Akce</Text>
              </Link>
            ),
          }}
        />
        <Stack.Screen
          name="tickets/[id]"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
        <Stack.Screen name="events/index" options={{ title: 'Akce' }} />
        <Stack.Screen name="events/[id]" options={{ title: 'Akce' }} />
        <Stack.Screen name="orders/index" options={{ title: 'Historie objednávek' }} />
        <Stack.Screen
          name="profile"
          options={{
            title: 'Profil',
            headerRight: () => null,
          }}
        />
        <Stack.Screen
          name="checkout"
          options={{ title: 'Pokladna', presentation: 'modal' }}
        />
      </Stack>
    </>
  );

  if (STRIPE_PUBLISHABLE_KEY) {
    return (
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} merchantIdentifier="merchant.cz.tixly">
        {inner}
      </StripeProvider>
    );
  }
  return inner;
}
