// ---------------------------------------------------------------------------
// ScanResult — overlay displayed for ~2s after each scan
// ---------------------------------------------------------------------------
import React, { useEffect } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import type { ValidationResult } from "../types/scanner.types";

interface Props {
  result: ValidationResult | null;
  onDismiss: () => void;
  durationMs?: number;
}

export function ScanResult({ result, onDismiss, durationMs = 2000 }: Props) {
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!result) return;

    // Fade in
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();

    // Auto-dismiss after durationMs
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => onDismiss());
    }, durationMs);

    return () => clearTimeout(timer);
  }, [result]);

  if (!result) return null;

  const isSuccess = result.success;

  return (
    <Animated.View
      style={[styles.overlay, isSuccess ? styles.success : styles.failure, { opacity }]}
    >
      <Text style={styles.icon}>{isSuccess ? "✓" : "✗"}</Text>
      {isSuccess ? (
        <>
          <Text style={styles.holderName}>{result.holderName}</Text>
          <Text style={styles.seatInfo}>{result.seatInfo}</Text>
          <Text style={styles.ticketId}>{result.ticketId}</Text>
        </>
      ) : (
        <>
          <Text style={styles.errorText}>{result.error}</Text>
          {result.ticketId ? (
            <Text style={styles.ticketId}>{result.ticketId}</Text>
          ) : null}
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    bottom: 40,
    left: 24,
    right: 24,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  success: {
    backgroundColor: "#16a34a",
  },
  failure: {
    backgroundColor: "#dc2626",
  },
  icon: {
    fontSize: 48,
    color: "#ffffff",
    fontWeight: "bold",
    marginBottom: 8,
  },
  holderName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  seatInfo: {
    fontSize: 16,
    color: "#dcfce7",
    marginBottom: 4,
  },
  ticketId: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    fontFamily: "monospace",
  },
  errorText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 4,
  },
});
