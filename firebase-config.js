/**
 * ASTROPULSE SMM PANEL - FIREBASE & EMAILJS CONFIGURATION
 * 
 * 100% FREE TIER (Firebase Spark Plan + EmailJS Free Plan)
 * Zero paid hosting required. Works with Firebase Hosting, GitHub Pages, Vercel, Netlify.
 */

// ── 1. FIREBASE CONFIGURATION ───────────────────────────────────────────────
// Replace the values below with your Firebase Project Configuration from:
// Firebase Console (https://console.firebase.google.com/) -> Project Settings -> General -> Your apps -> Web app
const firebaseConfig = {
  apiKey: "AIzaSyAmvcyfpgFsFY_JLtC2T3t36KnUKyLQL0o",
  authDomain: "astropulsesmm.firebaseapp.com",
  projectId: "astropulsesmm",
  storageBucket: "astropulsesmm.firebasestorage.app",
  messagingSenderId: "24067828012",
  appId: "1:24067828012:web:ede9ad262bae059006a489",
  measurementId: "G-YCEKPEDNR6"
};

// ── 2. ADMIN ACCOUNTS LIST ──────────────────────────────────────────────────
// Add your admin email address(es) here. Any user logging in with these emails
// will automatically get access to the Admin Panel (admin.html).
const ADMIN_EMAILS = [
  'astropulsesmmpanel@gmail.com',
  'admin@astropulse.com',
  'developer9692@gmail.com'
];

// ── 3. EMAILJS CONFIGURATION FOR STATUS NOTIFICATIONS ──────────────────────
// Used to send "Order Completed" & "Order Declined" emails to customers for free.
// In your EmailJS dashboard (https://dashboard.emailjs.com/):
// - Create an email service (or use the one already in index.html: service_rpk6219)
// - Create a template with "To Email" set to: {{to_email}}
const EMAILJS_CONFIG = {
  publicKey: 'h2FoVFBLSzD-sxr_4',     // Your EmailJS Public Key
  serviceId: 'service_ow6t97n',       // Your EmailJS Service ID
  statusTemplateId: 'template_axj0qsl' // Your EmailJS Template ID for customer status updates
};

// ── 3.5. GOOGLE GEMINI API CONFIGURATION (FREE TIER) ────────────────────────
// Add your Google Gemini API key from https://aistudio.google.com/
// The AI Chatbot has built-in smart fallback so it works even if this key is blank!
const GEMINI_API_KEY = "AQ.Ab8RN6KSjLpUS1niHGOQXT9G80QEHQdXNj5QlANiLy6sD19DeA";

// ── 4. FIREBASE INITIALIZATION ──────────────────────────────────────────────
let app, auth, db;

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      app = firebase.initializeApp(firebaseConfig);
    } else {
      app = firebase.app();
    }
    auth = firebase.auth();
    db = firebase.firestore();
  }
} catch (e) {
  console.warn("Firebase initialization notice:", e.message);
}

// ── 5. HELPER FUNCTIONS ─────────────────────────────────────────────────────

/**
 * Check if a given user (or current user) is an admin.
 */
function isUserAdmin(user) {
  if (!user || !user.email) return false;
  return ADMIN_EMAILS.map(e => e.toLowerCase()).includes(user.email.toLowerCase());
}

async function getStoreSettings() {
  if (!db) return {};
  const snapshot = await db.collection('settings').doc('store').get();
  return snapshot.exists ? snapshot.data() : {};
}

async function saveStoreSettings(settings) {
  if (!db) return { success: false, error: 'Database not connected' };
  try {
    await db.collection('settings').doc('store').set(settings, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving store settings:', error);
    return { success: false, error: error.message };
  }
}

async function getStoreServices() {
  if (!db) return [];
  const snapshot = await db.collection('services').where('active', '==', true).get();
  return snapshot.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() }));
}

async function saveStoreService(service) {
  if (!db) return { success: false, error: 'Database not connected' };
  try {
    const payload = { ...service, active: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (service.firestoreId) {
      const firestoreId = service.firestoreId;
      delete payload.firestoreId;
      await db.collection('services').doc(firestoreId).set(payload, { merge: true });
      return { success: true, id: firestoreId };
    }
    delete payload.firestoreId;
    const docRef = await db.collection('services').add(payload);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error saving service:', error);
    return { success: false, error: error.message };
  }
}

async function removeStoreService(serviceId) {
  if (!db) return { success: false, error: 'Database not connected' };
  try {
    await db.collection('services').doc(serviceId).update({ active: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return { success: true };
  } catch (error) {
    console.error('Error removing service:', error);
    return { success: false, error: error.message };
  }
}

async function removeServiceByPublicId(serviceId) {
  if (!db) return { success: false, error: 'Database not connected' };
  try {
    const settings = await getStoreSettings();
    const removedServiceIds = Array.isArray(settings.removedServiceIds) ? settings.removedServiceIds : [];
    const numericId = Number(serviceId);
    if (!removedServiceIds.includes(numericId)) removedServiceIds.push(numericId);
    await saveStoreSettings({ removedServiceIds });
    const snapshot = await db.collection('services').where('id', '==', numericId).get();
    await Promise.all(snapshot.docs.map(doc => doc.ref.update({ active: false })));
    return { success: true };
  } catch (error) {
    console.error('Error removing service by ID:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get the currently authenticated user (promise-based).
 */
function getAuthUser() {
  return new Promise((resolve) => {
    if (!auth) return resolve(null);
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/**
 * Save an order to Firestore `orders` collection.
 */
async function saveOrderToFirestore(orderData) {
  if (!db) {
    console.error("Firestore is not initialized.");
    return { success: false, error: "Database offline" };
  }

  try {
    const docRef = await db.collection("orders").add({
      ...orderData,
      status: orderData.status || 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("Error saving order to Firestore:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Look up an order by its public order ID (e.g. ASTR12345678).
 */
async function getOrderByPublicId(orderId) {
  if (!db) return null;
  try {
    let query = db.collection("orders").where("orderId", "==", orderId.trim().toUpperCase());
    if (auth && auth.currentUser && !isUserAdmin(auth.currentUser)) {
      query = query.where("userId", "==", auth.currentUser.uid);
    }
    const snapshot = await query.limit(1).get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error("Error fetching order:", error);
    return null;
  }
}

function listenToUserOrders(userId, onData, onError) {
  if (!db || !userId) return () => {};
  return db.collection('orders')
    .where('userId', '==', userId)
    .onSnapshot(snapshot => {
      const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      orders.sort((a, b) => {
        const aTime = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const bTime = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return bTime - aTime;
      });
      onData(orders);
    }, onError);
}

/**
 * Update an order's status in Firestore (Admin only).
 * @param {string} docId - Firestore document ID
 * @param {'completed'|'declined'|'pending'} newStatus
 * @param {string} adminEmail
 */
async function updateOrderStatusInFirestore(docId, newStatus, adminEmail) {
  if (!db) return { success: false, error: "Database not connected" };
  try {
    await db.collection("orders").doc(docId).update({
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: adminEmail || 'admin'
    });
    return { success: true };
  } catch (error) {
    console.error("Error updating order status:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Send an automated notification email to the user when their order is Completed or Declined.
 * Uses EmailJS free tier directly from client-side.
 */
async function sendOrderStatusEmail(order, newStatus) {
  if (!order || !order.userEmail) {
    return { success: false, error: "No customer email found for this order" };
  }

  if (typeof emailjs === 'undefined') {
    return { success: false, error: "EmailJS library not loaded" };
  }

  const isCompleted = newStatus.toLowerCase() === 'completed';
  const statusHeadline = isCompleted ? 'ORDER COMPLETED' : 'ORDER DECLINED';
  const messageBody = isCompleted
    ? `Great news! Your order ${order.orderId} for "${order.service || 'Social Service'}" has been successfully completed and delivered.`
    : `Notice: Your order ${order.orderId} for "${order.service || 'Social Service'}" could not be completed and has been marked as declined. If payment was deducted, please reply to this email or contact support with your UTR.`;

  const templateParams = {
    to_email: order.userEmail,
    customer_name: order.userName || order.userEmail.split('@')[0],
    order_id: order.orderId,
    service_name: order.service || 'Service',
    quantity: order.quantity || '—',
    amount: order.amountPaid || '—',
    target_link: order.link || '—',
    order_status: statusHeadline,
    status_message: messageBody,
    date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  };

  try {
    // Initialize EmailJS with key if not already initialized
    emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });

    const response = await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.statusTemplateId,
      templateParams
    );
    return { success: true, response };
  } catch (err) {
    console.warn("EmailJS notification error:", err);
    // Provide a graceful fallback so admin knows what happened
    return { success: false, error: err.text || err.message || "Failed to dispatch email" };
  }
}

/**
 * Check refill eligibility and process automated refill request for an order.
 */
async function processOrderRefill(orderId) {
  if (!db) return { success: false, error: "Database offline. Please check connection." };
  const rawId = (orderId || '').trim().toUpperCase();
  if (!rawId) return { success: false, error: "Please enter a valid Order ID (e.g. ASTR38572197)." };

  try {
    const order = await getOrderByPublicId(rawId);
    if (!order) {
      return {
        success: false,
        error: `Could not find any order with ID "${rawId}". Please double-check your Order ID.`
      };
    }

    const status = (order.status || 'pending').toLowerCase();
    if (status === 'pending') {
      return {
        success: false,
        error: `Order ${rawId} is currently In Progress / Pending. Refills can only be requested after the order has been Completed.`
      };
    }
    if (status === 'declined') {
      return {
        success: false,
        error: `Order ${rawId} was Declined. Refills cannot be processed for declined orders. Please contact support if you need assistance.`
      };
    }

    // Check refill eligibility based on service metadata
    const serviceName = order.service || '';
    const isNoRefill = /no\s*refill/i.test(serviceName);
    const isLifetime = /lifetime/i.test(serviceName);
    const isRefillWord = /refill/i.test(serviceName) && !isNoRefill;

    if (isNoRefill || (!isLifetime && !isRefillWord)) {
      return {
        success: false,
        error: `Order ${rawId} ("${serviceName}") was ordered with a No-Refill guarantee. Refills are not supported for this service.`
      };
    }

    if (!auth || !auth.currentUser) {
      return { success: false, error: 'Please sign in before requesting a refill.' };
    }

    const existing = await db.collection('refillRequests')
      .where('orderId', '==', rawId)
      .get();
    const hasPendingRequest = existing.docs.some(doc => {
      const request = doc.data();
      return request.userId === auth.currentUser.uid && request.status === 'pending';
    });
    if (hasPendingRequest) {
      return { success: false, error: `A refill request for ${rawId} is already pending.` };
    }

    await db.collection('refillRequests').add({
      orderId: rawId,
      orderDocId: order.id,
      userId: auth.currentUser.uid,
      userEmail: auth.currentUser.email || order.userEmail || '',
      service: order.service || 'Service',
      serviceId: order.serviceId || '',
      quantity: order.quantity || 0,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return {
      success: true,
      order: order,
      message: `Refill request for Order ${rawId} has been sent to admin for review.`
    };
  } catch (err) {
    console.error("Refill processing error:", err);
    return { success: false, error: err.message || "Failed to process refill" };
  }
}

/**
 * Intelligent domain chatbot engine with Google Gemini 1.5 Flash integration.
 */
async function askGeminiAI(userMessage, chatHistory = []) {
  // If Gemini API Key is provided, call Google Gemini 1.5 Flash endpoint
  if (typeof GEMINI_API_KEY === 'string' && GEMINI_API_KEY.trim() && !GEMINI_API_KEY.includes('YOUR_GEMINI')) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY.trim()}`;
      const systemInstruction = `You are AstroPulse AI, the 24/7 smart assistant for AstroPulse SMM Panel (India's premier social media growth provider).
You assist users with:
1. SMM services: Instagram (Reel Views, Likes, Followers, Comments), YouTube (Views, Subscribers, Likes), Telegram (Members, Views, Reactions), Facebook (Views, Page Likes, Followers), Twitter.
2. Orders & Start time: Orders start automatically within 0–10 minutes.
3. Payments: Done via UPI (PhonePe, GPay, Paytm) and verified instantly with the 12-digit UTR/Txn ID.
4. Refills: Services with "Lifetime Refill" or "Refill" are guaranteed. If a user asks for a refill with an order ID, encourage them to submit the order ID in the chat so the automated system can process it.
5. Telegram Support: @astropulsesmmsupport | Email: astropulsesmmpanel@gmail.com.
Tone: Fast, polite, helpful, and concise (maximum 2-3 sentences). Format with bolding for clarity.`;

      const contents = [
        { role: "user", parts: [{ text: systemInstruction }] },
        { role: "model", parts: [{ text: "Understood! I am AstroPulse AI, ready to assist users with fast social growth, orders, payments, and refills." }] },
        ...chatHistory.slice(-4).map(m => ({
          role: m.sender === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }]
        })),
        { role: "user", parts: [{ text: userMessage }] }
      ];

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents })
      });

      if (res.ok) {
        const json = await res.json();
        const botReply = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (botReply) return botReply;
      }
    } catch (e) {
      console.warn("Gemini API call failed, falling back to local smart engine:", e);
    }
  }

  // Built-in intelligent domain responses (works 100% offline & without API key!)
  return getLocalBotResponse(userMessage);
}

function getLocalBotResponse(msg) {
  const text = (msg || '').toLowerCase();

  if (/refill|dropped|drop|refil/.test(text)) {
    return "🔄 **Order Refill Support**: To request a refill, simply type: `Refill ASTR12345678` (with your Order ID). Our system will automatically verify your order eligibility and process your refill!";
  }
  if (/track|status|where is my order|check order/.test(text)) {
    return "📦 **Order History**: Open Order History from the menu to see your Order IDs, services, quantities, and live statuses.";
  }
  if (/pay|payment|upi|gpay|phonepe|paytm|utr|scanner|qr/.test(text)) {
    return "💳 **UPI Payment & Verification**: Select your desired service, enter your link and quantity, then choose **Pay via App** or **Scan QR**. After payment, paste your 12-digit UTR/Transaction ID to immediately confirm your order!";
  }
  if (/speed|how fast|start time|how long|delivery/.test(text)) {
    return "⚡ **Instant Start**: Over 95% of our orders start processing within **0–10 minutes** automatically! High-speed delivery continues at up to 10M views/day depending on the service selected.";
  }
  if (/safe|ban|password|login/.test(text)) {
    return "🛡️ **100% Safe & Secure**: Astropulse **NEVER asks for your account password**. All services are delivered externally to your public links with zero risk to your account.";
  }
  if (/contact|human|admin|whatsapp|telegram|email|support/.test(text)) {
    return "🤝 **Customer Support**: You can reach our dedicated team on **Telegram: @astropulsesmmsupport** or by email at **astropulsesmmpanel@gmail.com** for 24/7 assistance!";
  }
  if (/instagram|follower|like|reel|view/.test(text)) {
    return "📸 **Instagram Growth**: We provide non-drop Reel Views from ₹0.30/1K, High Quality Likes from ₹10/1K, and targeted Indian engagement with instant start!";
  }

  return "👋 Hi! I am **AstroPulse AI**. How can I help you today? You can ask me about **services, delivery speed, payments, order tracking**, or request an **automated refill** for any completed order!";
}
