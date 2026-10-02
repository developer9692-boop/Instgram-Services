/**
 * ASTROPULSE SMM PANEL - FIREBASE & EMAILJS CONFIGURATION
 * Firebase Spark (free) + EmailJS free plan. Works on Firebase Hosting, GitHub Pages, Vercel, Netlify.
 *
 * Load order in every HTML page (already the case):
 *   firebase-app-compat.js -> firebase-auth-compat.js -> firebase-firestore-compat.js -> firebase-config.js
 */

// ── 1. FIREBASE CONFIGURATION (public by design; protected by firestore.rules) ──
const firebaseConfig = {
  apiKey: "AIzaSyAmvcyfpgFsFY_JLtC2T3t36KnUKyLQL0o",
  authDomain: "astropulsesmm.firebaseapp.com",
  projectId: "astropulsesmm",
  storageBucket: "astropulsesmm.firebasestorage.app",
  messagingSenderId: "24067828012",
  appId: "1:24067828012:web:ede9ad262bae059006a489",
  measurementId: "G-YCEKPEDNR6"
};

// ── 2. ADMIN ACCOUNTS ─────────────────────────────────────────────────────────
// Must match the emails in firestore.rules (that file is what actually enforces security).
const ADMIN_EMAILS = [
  'astropulsesmmpanel@gmail.com',
  'admin@astropulse.com',
  'developer9692@gmail.com'
];

// ── 3. EMAILJS (order status emails sent from admin panel) ────────────────────
const EMAILJS_CONFIG = {
  publicKey: 'h2FoVFBLSzD-sxr_4',
  serviceId: 'service_ow6t97n',
  statusTemplateId: 'template_axj0qsl'
};

// ── 3.5. GEMINI (optional). Leave "" to use the built-in local bot. ───────────
// WARNING: anything in this file is public. Restrict the key to your site's domain
// (Google AI Studio / Cloud Console -> API key -> HTTP referrers) and rotate the old one.
const GEMINI_API_KEY = "AQ.Ab8RN6KSjLpUS1niHGOQXT9G80QEHQdXNj5QlANiLy6sD19DeA";
const GEMINI_MODEL = "gemini-2.5-flash";

// ── 4. FIREBASE INITIALIZATION ────────────────────────────────────────────────
let app = null, auth = null, db = null;

try {
  if (typeof firebase !== 'undefined') {
    app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
  } else {
    console.error('Firebase SDK scripts did not load before firebase-config.js');
  }
} catch (e) {
  console.error('Firebase initialization failed:', e);
}

// ── 5. HELPERS ────────────────────────────────────────────────────────────────
function isUserAdmin(user) {
  if (!user || !user.email) return false;
  return ADMIN_EMAILS.map(e => e.toLowerCase()).includes(String(user.email).toLowerCase());
}

function normalizeOrderId(value) {
  const m = String(value || '').toUpperCase().match(/\bASTR\s*[-#:]?\s*(\d{6,12})\b/);
  return m ? 'ASTR' + m[1] : null;
}
function extractOrderId(text) { return normalizeOrderId(text); }

function isRefillIntent(text) {
  return /\b(refill|refil|re-fill|top\s*up|dropped|drop|replacement)\b/i.test(String(text || ''));
}

// ── 6. STORE SETTINGS & SERVICES ──────────────────────────────────────────────
async function getStoreSettings() {
  if (!db) return {};
  try {
    const snap = await db.collection('settings').doc('store').get();
    return snap.exists ? snap.data() : {};
  } catch (e) {
    console.warn('getStoreSettings:', e.message);
    return {};
  }
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
  try {
    const snap = await db.collection('services').where('active', '==', true).get();
    return snap.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() }));
  } catch (e) {
    console.warn('getStoreServices:', e.message);
    return [];
  }
}

async function saveStoreService(service) {
  if (!db) return { success: false, error: 'Database not connected' };
  try {
    const payload = { ...service, active: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const firestoreId = payload.firestoreId;
    delete payload.firestoreId;
    if (firestoreId) {
      await db.collection('services').doc(firestoreId).set(payload, { merge: true });
      return { success: true, id: firestoreId };
    }
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
    await db.collection('services').doc(serviceId).update({
      active: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
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
    const removed = Array.isArray(settings.removedServiceIds) ? settings.removedServiceIds : [];
    const numericId = Number(serviceId);
    if (!removed.includes(numericId)) removed.push(numericId);
    await saveStoreSettings({ removedServiceIds: removed });
    const snap = await db.collection('services').where('id', '==', numericId).get();
    await Promise.all(snap.docs.map(doc => doc.ref.update({ active: false })));
    return { success: true };
  } catch (error) {
    console.error('Error removing service by ID:', error);
    return { success: false, error: error.message };
  }
}

// ── 7. AUTH ───────────────────────────────────────────────────────────────────
function getAuthUser() {
  return new Promise(resolve => {
    if (!auth) return resolve(null);
    const unsub = auth.onAuthStateChanged(user => { unsub(); resolve(user); });
  });
}

// ── 8. ORDERS ─────────────────────────────────────────────────────────────────
async function saveOrderToFirestore(orderData) {
  if (!db) return { success: false, error: 'Database offline' };
  try {
    const user = auth && auth.currentUser;
    const docRef = await db.collection('orders').add({
      ...orderData,
      // userId must equal the signed-in uid or firestore.rules will reject the write
      userId: (user && user.uid) || orderData.userId,
      status: orderData.status || 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error saving order to Firestore:', error);
    return { success: false, error: error.message };
  }
}

async function getOrderByPublicId(orderId) {
  if (!db) return null;
  try {
    const id = normalizeOrderId(orderId) || String(orderId || '').trim().toUpperCase();
    let query = db.collection('orders').where('orderId', '==', id);
    const user = auth && auth.currentUser;
    if (user && !isUserAdmin(user)) query = query.where('userId', '==', user.uid);
    const snap = await query.limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error fetching order:', error);
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
        const at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at;
      });
      onData(orders);
    }, onError);
}

async function updateOrderStatusInFirestore(docId, newStatus, adminEmail) {
  if (!db) return { success: false, error: 'Database not connected' };
  try {
    await db.collection('orders').doc(docId).update({
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: adminEmail || 'admin'
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating order status:', error);
    return { success: false, error: error.message };
  }
}

// ── 9. EMAIL NOTIFICATION ─────────────────────────────────────────────────────
async function sendOrderStatusEmail(order, newStatus) {
  if (!order || !order.userEmail) return { success: false, error: 'No customer email found for this order' };
  if (typeof emailjs === 'undefined') return { success: false, error: 'EmailJS library not loaded' };

  const isCompleted = String(newStatus).toLowerCase() === 'completed';
  const service = order.service || 'Social Service';
  const templateParams = {
    to_email: order.userEmail,
    customer_name: order.userName || order.userEmail.split('@')[0],
    order_id: order.orderId,
    service_name: order.service || 'Service',
    quantity: order.quantity || '—',
    amount: order.amountPaid || '—',
    target_link: order.link || '—',
    order_status: isCompleted ? 'ORDER COMPLETED' : 'ORDER DECLINED',
    status_message: isCompleted
      ? `Great news! Your order ${order.orderId} for "${service}" has been successfully completed and delivered.`
      : `Notice: Your order ${order.orderId} for "${service}" could not be completed and has been marked as declined. If payment was deducted, please contact support with your UTR.`,
    date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  };

  try {
    emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    const response = await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.statusTemplateId, templateParams);
    return { success: true, response };
  } catch (err) {
    console.warn('EmailJS notification error:', err);
    return { success: false, error: err.text || err.message || 'Failed to dispatch email' };
  }
}

// ── 10. REFILL ────────────────────────────────────────────────────────────────
/**
 * Decide refill eligibility. Priority: explicit `refill` field saved on the order,
 * then keywords in the service name. Unknown => NOT eligible (safe default).
 */
function serviceAllowsRefill(order) {
  if (!order) return false;
  const field = String(order.refill || '').trim().toLowerCase();
  if (field) {
    if (/no\s*refill|non[-\s]?refill|without\s*refill|^none$|^no$|^false$|^0$/.test(field)) return false;
    return true; // e.g. "Lifetime", "30 Days", "Yes"
  }
  const name = String(order.service || order.serviceName || '').toLowerCase();
  if (/no\s*refill|non[-\s]?refill|without\s*refill/.test(name)) return false;
  return /refill|lifetime|guarantee|\b\d+\s*days?\b/.test(name);
}

async function processOrderRefill(orderId) {
  if (!db) return { success: false, error: 'Database offline. Please check connection.' };

  const rawId = normalizeOrderId(orderId) || String(orderId || '').trim().toUpperCase();
  if (!rawId) return { success: false, error: 'Please enter a valid Order ID (e.g. ASTR38572197).' };

  // auth.currentUser can be null for a moment after page load; wait for it
  const user = (auth && auth.currentUser) || await getAuthUser();
  if (!user) return { success: false, error: 'Please sign in before requesting a refill.' };

  try {
    const order = await getOrderByPublicId(rawId);
    if (!order) {
      return { success: false, error: `Could not find an order with ID "${rawId}" on your account. Please double-check your Order ID.` };
    }

    const status = String(order.status || 'pending').toLowerCase();
    if (status === 'pending') {
      return { success: false, error: `Order ${rawId} is still In Progress. Refills can only be requested after the order is Completed.` };
    }
    if (status === 'declined') {
      return { success: false, error: `Order ${rawId} was Declined, so a refill cannot be processed. Please contact support if you need help.` };
    }

    if (!serviceAllowsRefill(order)) {
      return { success: false, error: `Order ${rawId} ("${order.service || 'service'}") has no refill guarantee, so refills are not available for it.` };
    }

    // Duplicate check: filter on userId (matches security rules), compare the rest locally
    const existing = await db.collection('refillRequests').where('userId', '==', user.uid).get();
    const hasPending = existing.docs.some(d => {
      const r = d.data();
      return r.orderId === rawId && r.status === 'pending';
    });
    if (hasPending) return { success: false, error: `A refill request for ${rawId} is already pending.` };

    await db.collection('refillRequests').add({
      orderId: rawId,
      orderDocId: order.id,
      userId: user.uid,
      userEmail: user.email || order.userEmail || '',
      service: order.service || 'Service',
      serviceId: order.serviceId || '',
      quantity: order.quantity || 0,
      link: order.link || '',
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, order, message: `Refill request for Order ${rawId} has been sent to admin for review.` };
  } catch (err) {
    console.error('Refill processing error:', err);
    const denied = err && (err.code === 'permission-denied' || /permission/i.test(err.message || ''));
    return {
      success: false,
      error: denied
        ? 'Permission denied by Firestore rules. Deploy firestore.rules (firebase deploy --only firestore:rules).'
        : (err.message || 'Failed to process refill')
    };
  }
}

// ── 11. CHATBOT ───────────────────────────────────────────────────────────────
async function askGeminiAI(userMessage, chatHistory = []) {
  const key = typeof GEMINI_API_KEY === 'string' ? GEMINI_API_KEY.trim() : '';
  if (key && !key.includes('YOUR_GEMINI')) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
      const systemInstruction = `You are AstroPulse AI, the 24/7 assistant for AstroPulse SMM Panel (India).
Help with: SMM services (Instagram, YouTube, Telegram, Facebook, Twitter), orders start in 0-10 minutes, UPI payments verified by 12-digit UTR, refills only for services marked Refill/Lifetime Refill (ask users to send "Refill ASTR12345678"), support on Telegram @astropulsesmmsupport or astropulsesmmpanel@gmail.com.
Never claim you submitted a refill yourself. Be concise (2-3 sentences), polite, use bold for key terms.`;

      // Gemini requires alternating roles starting with "user"
      const history = chatHistory.slice(-6)
        .map(m => ({ role: m.sender === 'user' ? 'user' : 'model', parts: [{ text: String(m.text || '') }] }))
        .filter(m => m.parts[0].text);
      while (history.length && history[0].role !== 'user') history.shift();
      const contents = [];
      for (const m of history) {
        if (contents.length && contents[contents.length - 1].role === m.role) contents[contents.length - 1] = m;
        else contents.push(m);
      }
      if (contents.length && contents[contents.length - 1].role === 'user') contents.pop();
      contents.push({ role: 'user', parts: [{ text: userMessage }] });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_instruction: { parts: [{ text: systemInstruction }] }, contents })
      });
      if (res.ok) {
        const json = await res.json();
        const reply = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) return reply;
      } else {
        console.warn('Gemini HTTP', res.status, '- using local bot');
      }
    } catch (e) {
      console.warn('Gemini call failed, using local bot:', e);
    }
  }
  return getLocalBotResponse(userMessage);
}

function getLocalBotResponse(msg) {
  const text = (msg || '').toLowerCase();
  if (/refill|dropped|drop|refil/.test(text)) {
    return "🔄 **Order Refill Support**: Type `Refill ASTR12345678` (with your Order ID). The system checks that the order is Completed and refill-eligible, then sends your request to admin.";
  }
  if (/track|status|where is my order|check order/.test(text)) {
    return "📦 **Order History**: Open Order History from the menu to see your Order IDs, services, quantities, and live statuses.";
  }
  if (/pay|payment|upi|gpay|phonepe|paytm|utr|scanner|qr/.test(text)) {
    return "💳 **UPI Payment**: Choose a service, enter your link and quantity, then pay via app or QR. Paste the 12-digit UTR/Transaction ID to confirm your order.";
  }
  if (/speed|how fast|start time|how long|delivery/.test(text)) {
    return "⚡ **Fast Start**: Most orders start within **0–10 minutes**. Delivery speed depends on the service selected.";
  }
  if (/safe|ban|password|login/.test(text)) {
    return "🛡️ **Safe & Secure**: AstroPulse **never asks for your account password**. Services are delivered to your public links.";
  }
  if (/contact|human|admin|whatsapp|telegram|email|support/.test(text)) {
    return "🤝 **Support**: Telegram **@astropulsesmmsupport** or email **astropulsesmmpanel@gmail.com**.";
  }
  if (/instagram|follower|like|reel|view/.test(text)) {
    return "📸 **Instagram Growth**: Reel Views from ₹0.30/1K, High Quality Likes from ₹10/1K, with fast start.";
  }
  return "👋 Hi! I am **AstroPulse AI**. Ask me about **services, delivery speed, payments, order tracking**, or request a **refill** for a completed order!";
}
