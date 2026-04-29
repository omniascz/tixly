import React from 'react';
// TODO: import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
// TODO: import { formatPrice, formatDate } from '../lib/format';
import type { Event } from '../types/api.types';

interface EventCardProps {
  event: Event;
  onPress?: (event: Event) => void;
}

/**
 * EventCard — kompaktní karta akce pro FlatList
 * Zobrazuje: cover image, název, datum, město, nejnižší cenu
 */
export function EventCard({ event, onPress }: EventCardProps): React.ReactElement {
  // TODO: render cover image, title, formatDate(event.dateStart), event.city
  // TODO: minPrice = Math.min(...event.ticketTypes.map(t => t.priceCzk * 100)) → formatPrice
  // TODO: TouchableOpacity → onPress(event)
  void event;
  void onPress;
  return <></>;
}
