import React from 'react';
// TODO: import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
// TODO: import { formatDate } from '../lib/format';
import type { Ticket } from '../types/api.types';

interface TicketCardProps {
  ticket: Ticket;
  onPress?: (ticket: Ticket) => void;
}

/**
 * TicketCard — kompaktní karta vstupenky pro TicketWalletScreen
 * Zobrazuje: název akce, datum, místo, sedadlo, status badge
 */
export function TicketCard({ ticket, onPress }: TicketCardProps): React.ReactElement {
  // TODO: status color map: active=green, used=gray, revoked=red, cancelled=orange
  // TODO: render event title, formatDate(ticket.eventDate), venueName, seatInfo, status badge
  // TODO: TouchableOpacity → onPress(ticket)
  void ticket;
  void onPress;
  return <></>;
}
