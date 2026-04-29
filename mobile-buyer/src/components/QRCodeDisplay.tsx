import React, { useEffect, useState, useRef } from 'react';
// TODO: import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
// TODO: import QRCode from 'react-native-qrcode-svg'; (or expo-barcode-scanner alternative)
import { QrDisplayService } from '../services/qr-display.service';
import type { QrState } from '../services/qr-display.service';

interface QRCodeDisplayProps {
  ticketId: string;
}

/**
 * QRCodeDisplay — živý QR kód s countdown timerem
 * - Subscribuje na QrDisplayService pro daný ticketId
 * - Zobrazuje countdown do další změny QR
 * - Při isOffline zobrazí "offline" badge
 * - Velký QR kód (fullscreen vhodný)
 */
export function QRCodeDisplay({ ticketId }: QRCodeDisplayProps): React.ReactElement {
  const [qrState, setQrState] = useState<QrState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    QrDisplayService.subscribe(ticketId, (state) => {
      setQrState(state);
      // Calculate seconds until expiry
      const expiresAt = new Date(state.expiresAt).getTime();
      const seconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(seconds);
    });

    // Countdown timer
    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      QrDisplayService.unsubscribe(ticketId);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [ticketId]);

  if (!qrState) {
    // TODO: return <ActivityIndicator />;
    return <></>;
  }

  // TODO:
  // return (
  //   <View style={styles.container}>
  //     {qrState.isOffline && <Text style={styles.offlineBadge}>Offline</Text>}
  //     <QRCode value={qrState.qrData} size={280} />
  //     <Text style={styles.countdown}>Obnoví se za {secondsLeft}s</Text>
  //   </View>
  // );
  return <></>;
}
