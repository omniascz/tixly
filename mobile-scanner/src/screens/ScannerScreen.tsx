// ---------------------------------------------------------------------------
// ScannerScreen — live QR scanning with expo-camera
// ---------------------------------------------------------------------------
import React, { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { validateOffline } from "../services/validator.service";
import { useScannerStore } from "../stores/scanner.store";
import { ScanResult } from "../components/ScanResult";
import { SyncIndicator } from "../components/SyncIndicator";
import type { ScanRecord, ValidationResult } from "../types/scanner.types";
import { SCAN_COOLDOWN_MS } from "../lib/constants";

type Props = NativeStackScreenProps<RootStackParamList, "Scanner">;

export function ScannerScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanResult, setScanResult] = useState<ValidationResult | null>(null);
  const [torchOn, setTorchOn] = useState(false);

  const { selectedEventId, addScanRecord } = useScannerStore();

  // Anti-flicker: track last scanned ticketId + timestamp
  const lastScan = useRef<{ ticketId: string; at: number } | null>(null);
  const processing = useRef(false);

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (processing.current) return;
      processing.current = true;

      try {
        if (!selectedEventId) {
          navigation.navigate("EventSelect");
          return;
        }

        const result = await validateOffline(data, selectedEventId);

        // Anti-flicker: skip same ticket within cooldown window
        const now = Date.now();
        if (
          lastScan.current &&
          lastScan.current.ticketId === result.ticketId &&
          now - lastScan.current.at < SCAN_COOLDOWN_MS
        ) {
          return;
        }
        lastScan.current = { ticketId: result.ticketId, at: now };

        // Haptic feedback
        if (result.success) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }

        // Record in history store
        const record: ScanRecord = {
          id: `${result.ticketId}-${now}`,
          ticketId: result.ticketId,
          holderName: result.holderName,
          seatInfo: result.seatInfo,
          success: result.success,
          error: result.error,
          scannedAt: new Date(now).toISOString(),
        };
        addScanRecord(record);

        setScanResult(result);
      } finally {
        // Release processing lock after a brief delay (anti-flicker)
        setTimeout(() => {
          processing.current = false;
        }, SCAN_COOLDOWN_MS);
      }
    },
    [selectedEventId, addScanRecord, navigation]
  );

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.permissionText}>
          Camera permission is required to scan tickets.
        </Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={torchOn}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarCodeScanned}
      />

      {/* HUD overlay */}
      <SafeAreaView style={styles.hud} pointerEvents="box-none">
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => navigation.navigate("EventSelect")}
          >
            <Text style={styles.iconBtnText}>← Event</Text>
          </TouchableOpacity>

          <SyncIndicator onPress={() => navigation.navigate("SyncStatus")} />

          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setTorchOn((t) => !t)}
          >
            <Text style={styles.iconBtnText}>{torchOn ? "Flash Off" : "Flash"}</Text>
          </TouchableOpacity>
        </View>

        {/* Viewfinder hint */}
        <View style={styles.viewfinderWrapper} pointerEvents="none">
          <View style={styles.viewfinder} />
          <Text style={styles.hint}>Point camera at ticket QR code</Text>
        </View>

        {/* Bottom nav */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => navigation.navigate("ScanHistory")}
          >
            <Text style={styles.navBtnText}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => navigation.navigate("Settings")}
          >
            <Text style={styles.navBtnText}>Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Scan result overlay */}
      <ScanResult result={scanResult} onDismiss={() => setScanResult(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  hud: {
    flex: 1,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  iconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
  },
  iconBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  viewfinderWrapper: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  viewfinder: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderColor: "#6366f1",
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  hint: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    marginTop: 16,
  },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  navBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "rgba(99,102,241,0.8)",
    borderRadius: 20,
  },
  navBtnText: { color: "#fff", fontWeight: "600" },
  permissionText: {
    color: "#f9fafb",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
    padding: 24,
  },
  button: {
    backgroundColor: "#6366f1",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignSelf: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
