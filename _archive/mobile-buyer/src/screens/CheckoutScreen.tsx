import React, { useState } from 'react';
// TODO: import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
// TODO: import { ordersApi } from '../api/orders.api';
// TODO: import { formatPrice } from '../lib/format';
// TODO: import type { Order } from '../types/api.types';

/**
 * CheckoutScreen
 * - Zobrazí souhrn objednávky: akce, ticket types, ceny v Kč (formatPrice)
 * - Výběr platební metody: Stripe Card | GoPay
 * - Stripe flow:
 *     1. POST /api/payments/stripe/checkout → { clientSecret }
 *     2. Zobrazí Stripe Payment Sheet (@stripe/stripe-react-native)
 *     3. Po úspěchu → navigate('TicketWallet', { success: true })
 * - GoPay flow:
 *     1. POST /api/payments/gopay/checkout → { gatewayUrl }
 *     2. Otevře WebView nebo Linking.openURL
 * - Po platbě: trigger tickets.store.fetchTickets()
 */
export function CheckoutScreen(): React.ReactElement {
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'gopay'>('stripe');
  const [isProcessing, setIsProcessing] = useState(false);

  // TODO: route.params.order (Order object)
  // TODO: handlePay() implementation
  // TODO: render order summary + payment method picker + Pay button

  return <></>;
}
