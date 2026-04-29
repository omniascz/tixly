#!/bin/bash
# Vytvoří všechna Kafka témata potřebná pro Tixly.
# Spouští se jednou po startu Kafka (kafka-init service).

set -e
BOOTSTRAP="kafka:9092"

create_topic() {
  local topic=$1
  local partitions=${2:-3}
  local retention_ms=${3:-604800000}  # 7 dní default

  echo "  → Vytvářím téma: $topic (partitions=$partitions, retention=${retention_ms}ms)"
  kafka-topics.sh \
    --bootstrap-server "$BOOTSTRAP" \
    --create \
    --if-not-exists \
    --topic "$topic" \
    --partitions "$partitions" \
    --replication-factor 1 \
    --config retention.ms="$retention_ms"
}

echo "==> Čekám na Kafka..."
sleep 5

echo "==> Vytvářím Kafka témata..."

# --- Platby & objednávky ---
create_topic "tixly.orders.created"
create_topic "tixly.orders.cancelled"
create_topic "tixly.payments.completed"
create_topic "tixly.payments.failed"
create_topic "tixly.payments.refunded"

# --- Vstupenky ---
create_topic "tixly.tickets.issued"
create_topic "tixly.tickets.checked-in"
create_topic "tixly.tickets.invalidated"

# --- Resale ---
create_topic "tixly.resale.listed"
create_topic "tixly.resale.sold"
create_topic "tixly.resale.cancelled"
create_topic "tixly.resale.payout-initiated"

# --- Sezónní karty & permanentky ---
create_topic "tixly.passes.activated"
create_topic "tixly.passes.renewed"
create_topic "tixly.passes.cancelled"

# --- AI / ML ---
create_topic "tixly.ai.feature-sync"          3 2592000000   # 30 dní
create_topic "tixly.ai.churn-scored"           3 604800000
create_topic "tixly.ai.recommendation-served"  3 604800000
create_topic "tixly.ai.send-time-updated"      3 604800000

# --- Marketing & tracking ---
create_topic "tixly.tracking.page-view"        6 259200000   # 3 dny
create_topic "tixly.tracking.conversion"       3 2592000000  # 30 dní
create_topic "tixly.tracking.cart-event"       3 604800000
create_topic "tixly.marketing.email-sent"      3 604800000
create_topic "tixly.marketing.email-opened"    3 604800000
create_topic "tixly.marketing.email-clicked"   3 604800000
create_topic "tixly.marketing.push-sent"       3 259200000

# --- Ceny ---
create_topic "tixly.pricing.phase-changed"
create_topic "tixly.pricing.price-adjusted"

# --- Promotéři & platforma ---
create_topic "tixly.promoters.approved"
create_topic "tixly.promoters.suspended"
create_topic "tixly.payouts.initiated"
create_topic "tixly.payouts.completed"

# --- GDPR ---
create_topic "tixly.gdpr.deletion-requested" 1 2592000000   # 30 dní, 1 partition pro ordering

# --- Dead Letter Queue ---
create_topic "tixly.dlq" 1 2592000000

echo "==> Kafka témata vytvořena."
kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list
