import React, { useEffect, useCallback } from 'react';
// TODO: import { View, Text, TouchableOpacity, StyleSheet, Share, Linking } from 'react-native';
// TODO: import { QRCodeDisplay } from '../components/QRCodeDisplay';
// TODO: import { useTicketsStore } from '../stores/tickets.store';
// TODO: import { formatDate } from '../lib/format';
// TODO: import { ticketsApi } from '../api/tickets.api';

/**
 * TicketDetailScreen
 * - Zobrazuje detail vstupenky: akce, datum, místo, sedadlo, jméno držitele
 * - Živý QR kód (QRCodeDisplay komponenta) — fullscreen mód
 * - Tlačítko "Přidat do Apple Wallet" → ticketsApi.getWalletPass(id, 'apple') → Linking.openURL
 * - Tlačítko "Google Pay" → ticketsApi.getWalletPass(id, 'google') → Linking.openURL
 * - Tlačítko "Sdílet" → Share.share (PDF URL z backendu)
 */
export function TicketDetailScreen(): React.ReactElement {
  // TODO: route.params.ticketId
  // TODO: const ticket = useTicketsStore(state => state.tickets.find(t => t.id === ticketId));
  // TODO: handleAddToAppleWallet, handleAddToGooglePay, handleShare
  return <></>;
}
