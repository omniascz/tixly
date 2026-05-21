import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#6C47FF' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Tixly' }} />
        <Stack.Screen name="tickets/index" options={{ title: 'Moje vstupenky' }} />
        <Stack.Screen name="tickets/[id]" options={{ presentation: 'fullScreenModal', headerShown: false }} />
      </Stack>
    </>
  );
}
