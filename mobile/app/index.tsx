import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tixly</Text>
      <Text style={styles.subtitle}>Tvoje vstupenky na dosah ruky.</Text>
      <Pressable style={styles.button} onPress={() => router.push('/tickets')}>
        <Text style={styles.buttonText}>Moje vstupenky</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 48, fontWeight: '900', color: '#6C47FF' },
  subtitle: { fontSize: 16, color: '#666', marginTop: 8 },
  button: { backgroundColor: '#6C47FF', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, marginTop: 32 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
