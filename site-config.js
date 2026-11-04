/* ═══════════════════════════════════════════════════════════════
   ASTROPULSE — SITE CONFIG
   Edit THIS file to change text, contact details, FAQ, banner,
   testimonials and which sections are shown. No other code needs
   to be touched. Upload it next to index.html.
   ═══════════════════════════════════════════════════════════════ */
window.SITE_CONFIG = {
  // Turn on to show a "we'll be back soon" screen to every visitor.
  maintenance: { enabled: false, message: "We're upgrading Astropulse. Please check back in a few minutes." },

  // Top announcement bar (offers, notices).
  banner: { enabled: false, text: "🎉 Special offer: add your text here", link: "" },

  hero: {
    title: "Astropulse",
    tagline: "The Way of Famous",
    subtitle: "India's Premium SMM Panel",
    // value "auto" = calculated from the live price list (never hard-code a price).
    // Keep "Orders" and "Support" values TRUE — do not show numbers you cannot prove.
    stats: [
      { value: "10K+", label: "Orders" },
      { value: "auto", label: "From / 1K" },
      { value: "24/7", label: "Support" }
    ]
  },

  contact: {
    email: "astropulsesmmpanel@gmail.com",
    telegram: "astropulsesmmsupport"   // confirmed handle, without @
  },

  // Show / hide whole sections.
  sections: { about: true, trust: true, testimonials: true, howItWorks: true, contact: true, rules: true, faq: true },

  // ONLY genuine reviews, with the customer's permission. Empty = section hidden.
  // Example: { name: "First L.", loc: "City", rating: 5, text: "Their real words." }
  testimonials: [],


  // Refund & refill policy shown on the site. Edit wording here.
  policy: {
    refillTitle: "Refill Policy",
    refill: [
      "Refill is available only on services that show Lifetime or a refill period in the Refill column. Services marked No Refill are not eligible.",
      "The order must be Completed. Open Menu → Get Refill (or ask the AI assistant) and send your Order ID.",
      "Your profile or post must stay public and the link/username must not be changed after ordering.",
      "Only one refill request can be active per order. Our team reviews it and processes it as soon as possible.",
      "Refill covers a drop in the delivered quantity. It does not cover content you deleted, made private or removed yourself."
    ],
    refundTitle: "Refund Policy",
    refund: [
      "Canceled orders are refunded in full to your Astropulse account balance.",
      "Partial orders: the undelivered portion is refunded automatically to your account balance.",
      "Fully completed orders are not refundable. If the count drops, use Refill (where the service offers it).",
      "No refund when the link is wrong, private or deleted, when the username/link is changed after ordering, or when a duplicate order is placed on the same link.",
      "Payment problem (wrong amount, missing order)? Contact support with your Order ID and UTR number and we will review it."
    ]
  },

  faqs: [
    { q:'Is my Instagram/social account password required?', a:'No. Astropulse never asks for your account password. We only need your public profile link, post link or video link to deliver the service.' },
    { q:'How fast will my order start?', a:'Most orders begin processing within 0–10 minutes of payment confirmation. Exact start time is shown next to each service before you order.' },
    { q:'What payment methods are supported?', a:'You can pay using any UPI app such as Google Pay, PhonePe or Paytm — either by scanning the QR code or opening your preferred UPI app directly at checkout.' },
    { q:'What happens if my order is only partially delivered?', a:'If a service can only be partially completed, the undelivered portion is automatically refunded to your account balance. See the "Important Usage Rules" section for details.' },
    { q:'Can I track my order status?', a:'Yes — open Order History from the menu to see every order, its Order ID, service, quantity, and current status.' },
    { q:'Is it safe to use an SMM panel for my account?', a:'Yes, when used responsibly. Keep your profile public, avoid placing duplicate orders on the same link at the same time, and follow the usage rules listed above.' },
    { q:'How does a refill work?', a:'Refill is available on services marked Lifetime or with a refill period. Once your order is Completed, open Menu → Get Refill and enter your Order ID. Services marked No Refill are not eligible. See the Refill Policy section for full details.' },
    { q:'When do I get a refund?', a:'Canceled orders are refunded in full and partial orders are refunded for the undelivered portion, both to your account balance. Completed orders, wrong or private links, and changed usernames are not refundable. See the Refund Policy section.' }
  ]
};
