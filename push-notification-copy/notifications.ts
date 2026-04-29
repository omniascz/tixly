export type PushNotification = {
  title: string
  body: string
  url?: string
}

export type NotificationVariants = {
  cs: PushNotification[]
  en: PushNotification[]
}

export const pushNotifications = {
  reminder: {
    h24: {
      cs: [
        {
          title: "{{eventName}} za 24 hodin",
          body: "Začíná v {{eventTime}}, {{venueName}}. Vstupenka je připravena!",
          url: "/tickets/{{ticketId}}"
        },
        {
          title: "Nezapomeň na {{eventName}}",
          body: "Zítra v {{eventTime}} už tu bude! Vstupenka čeká.",
          url: "/tickets/{{ticketId}}"
        }
      ],
      en: [
        {
          title: "{{eventName}} in 24 hours",
          body: "Starts at {{eventTime}}, {{venueName}}. Your ticket is ready!",
          url: "/tickets/{{ticketId}}"
        },
        {
          title: "Don't miss {{eventName}}",
          body: "Tomorrow at {{eventTime}}! Ticket is prepared.",
          url: "/tickets/{{ticketId}}"
        }
      ]
    },
    h2: {
      cs: [
        {
          title: "Už za 2 hodiny!",
          body: "{{venueName}}, {{venueAddress}}. Pojď včas! 🎟️",
          url: "/tickets/{{ticketId}}"
        },
        {
          title: "{{eventName}} začíná",
          body: "Doporučujeme přijít o 15 minut dříve. Parkování blízko!",
          url: "/tickets/{{ticketId}}"
        }
      ],
      en: [
        {
          title: "Just 2 hours left!",
          body: "{{venueName}}, {{venueAddress}}. Come early! 🎟️",
          url: "/tickets/{{ticketId}}"
        },
        {
          title: "{{eventName}} is starting",
          body: "Plan to arrive 15 min early. Parking available nearby!",
          url: "/tickets/{{ticketId}}"
        }
      ]
    }
  },
  resale: {
    watchlistMatch: {
      cs: [
        {
          title: "{{eventName}} na prodej!",
          body: "Vstupenka za {{price}} Kč. Zájemců víc, pospěš si!",
          url: "/events/{{eventId}}/resale"
        },
        {
          title: "Volná vstupenka: {{eventName}}",
          body: "Právě se objevila! Cena: {{price}} Kč. Limit omezený.",
          url: "/events/{{eventId}}/resale"
        }
      ],
      en: [
        {
          title: "{{eventName}} resale available!",
          body: "Ticket for {{price}} Kč. Limited stock, act fast!",
          url: "/events/{{eventId}}/resale"
        },
        {
          title: "Ticket just listed: {{eventName}}",
          body: "Price: {{price}} Kč. High demand—grab yours!",
          url: "/events/{{eventId}}/resale"
        }
      ]
    },
    ticketSold: {
      cs: [
        {
          title: "Vstupenka prodána! 🎉",
          body: "Výtěžek {{price}} Kč přijde {{payoutDate}}.",
          url: "/account/payouts"
        },
        {
          title: "Prodej potvrzen",
          body: "Dostaneš {{price}} Kč. Výplata přijde brzy.",
          url: "/account/payouts"
        }
      ],
      en: [
        {
          title: "Ticket sold! 🎉",
          body: "You'll receive {{price}} Kč on {{payoutDate}}.",
          url: "/account/payouts"
        },
        {
          title: "Sale confirmed",
          body: "Payment of {{price}} Kč coming soon.",
          url: "/account/payouts"
        }
      ]
    },
    ticketReserved: {
      cs: [
        {
          title: "Zájem o tvoji vstupenku",
          body: "Rezervována na 10 minut. Čeká se na platbu.",
          url: "/account/listings"
        }
      ],
      en: [
        {
          title: "Someone wants your ticket",
          body: "Reserved for 10 minutes. Awaiting payment.",
          url: "/account/listings"
        }
      ]
    }
  },
  earlyBird: {
    h24: {
      cs: [
        {
          title: "Early bird vypršije za 24h",
          body: "Ušetři {{savings}} Kč! {{eventName}} za {{earlyBirdPrice}} Kč.",
          url: "/events/{{eventId}}"
        },
        {
          title: "Poslední den: {{eventName}}",
          body: "Early bird cena: {{earlyBirdPrice}} Kč (normálně {{originalPrice}} Kč).",
          url: "/events/{{eventId}}"
        }
      ],
      en: [
        {
          title: "Early bird ends in 24 hours",
          body: "Save {{savings}} Kč! {{eventName}} for {{earlyBirdPrice}} Kč.",
          url: "/events/{{eventId}}"
        },
        {
          title: "Last day: {{eventName}}",
          body: "Early bird: {{earlyBirdPrice}} Kč (normally {{originalPrice}} Kč).",
          url: "/events/{{eventId}}"
        }
      ]
    },
    h1: {
      cs: [
        {
          title: "Cena se zvýší za hodinu!",
          body: "{{eventName}}: {{earlyBirdPrice}} → {{originalPrice}} Kč.",
          url: "/events/{{eventId}}"
        },
        {
          title: "Poslední šance na early bird",
          body: "Za {{deadline}} se cena zvyšuje. Kup teď!",
          url: "/events/{{eventId}}"
        }
      ],
      en: [
        {
          title: "Price increases in 1 hour!",
          body: "{{eventName}}: {{earlyBirdPrice}} → {{originalPrice}} Kč.",
          url: "/events/{{eventId}}"
        },
        {
          title: "Last chance for early bird",
          body: "Price goes up at {{deadline}}. Buy now!",
          url: "/events/{{eventId}}"
        }
      ]
    }
  },
  seasonPass: {
    expiringReminder: {
      cs: [
        {
          title: "Tvoje permanentka brzy vyprší",
          body: "Platí do {{passExpiry}}. Prodluž a ještě ušetři! 📅",
          url: "/passes/{{passId}}/renew"
        },
        {
          title: "Permanentka vypršení: {{passExpiry}}",
          body: "Prodloužení ti zajistí přístup na všechny akce. Renew teď!",
          url: "/passes/{{passId}}/renew"
        }
      ],
      en: [
        {
          title: "Your season pass expires soon",
          body: "Expires {{passExpiry}}. Renew & save more! 📅",
          url: "/passes/{{passId}}/renew"
        },
        {
          title: "Pass expiring: {{passExpiry}}",
          body: "Renew to keep unlimited access to events.",
          url: "/passes/{{passId}}/renew"
        }
      ]
    },
    churnDiscount: {
      cs: [
        {
          title: "Sleva {{discountPct}}% na prodloužení",
          body: "Zotrvej s námi. Prodloužení jen do {{deadline}}.",
          url: "/passes/{{passId}}/renew"
        },
        {
          title: "Speciální nabídka: {{discountPct}}% sleva",
          body: "Bez permanentky už nepřijdeš na žádnou akci. Vrať se!",
          url: "/passes/{{passId}}/renew"
        }
      ],
      en: [
        {
          title: "{{discountPct}}% off renewal offer",
          body: "Come back to us. Offer valid until {{deadline}}.",
          url: "/passes/{{passId}}/renew"
        },
        {
          title: "Special renewal discount: {{discountPct}}%",
          body: "Don't miss out on all upcoming events. Renew now!",
          url: "/passes/{{passId}}/renew"
        }
      ]
    }
  },
  order: {
    confirmed: {
      cs: [
        {
          title: "Vstupenka je tvoje! 🎉",
          body: "{{eventName}}, {{eventDate}}. Detaily v objednávce.",
          url: "/orders/{{orderId}}"
        }
      ],
      en: [
        {
          title: "Ticket secured! 🎉",
          body: "{{eventName}}, {{eventDate}}. Check your order.",
          url: "/orders/{{orderId}}"
        }
      ]
    },
    paymentFailed: {
      cs: [
        {
          title: "Platba se nepovedla",
          body: "Zkus znovu nebo použij jinou kartu. Vstupenka čeká!",
          url: "/orders/{{orderId}}/retry"
        }
      ],
      en: [
        {
          title: "Payment unsuccessful",
          body: "Try again or use a different card. Retry now!",
          url: "/orders/{{orderId}}/retry"
        }
      ]
    }
  },
  referral: {
    creditEarned: {
      cs: [
        {
          title: "Kredit: +{{creditAmount}} Kč",
          body: "Tvůj kamarád koupil vstupenku! Celkem: {{totalCredit}} Kč.",
          url: "/account/credit"
        }
      ],
      en: [
        {
          title: "Credit earned: +{{creditAmount}} Kč",
          body: "Friend purchased a ticket! Total: {{totalCredit}} Kč.",
          url: "/account/credit"
        }
      ]
    }
  }
} as const
