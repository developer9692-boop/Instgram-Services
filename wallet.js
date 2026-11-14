/**
 * ASTROPULSE — WALLET LOGIC (shared by index.html, payment.html, admin.html)
 * Load AFTER firebase-config.js.
 *
 * Money is ALWAYS handled as whole PAISE (integers). 1 rupee = 100 paise.
 * This removes floating-point errors (0.1 + 0.2 problems) from every balance calculation.
 *
 * Firestore collections used (see firestore.rules):
 *   users/{uid}            { balance (paise), lastTx, updatedAt }
 *   walletTx/{id}          immutable ledger: debit / credit / refund
 *   fundRequests/{id}      Add-Funds requests waiting for admin approval
 *   usedUtrs/{utr}         guards against crediting the same UTR twice
 *   orders/{id}            wallet orders (paymentMethod: 'wallet')
 */
(function (root) {
  'use strict';

  const MIN_TOPUP_PAISE = 1000;      // ₹10
  const MAX_TOPUP_PAISE = 5000000;   // ₹50,000
  const MAX_BALANCE_PAISE = 100000000; // ₹10,00,000 sanity cap

  let testEnv = null;
  function env() {
    if (testEnv) return testEnv;
    const database = (typeof db !== 'undefined') ? db : null;
    if (!database) throw new Error('Database not connected');
    return { db: database, now: () => firebase.firestore.FieldValue.serverTimestamp() };
  }

  // ── Pure money helpers ─────────────────────────────────────────────────────
  /** "100", "99.5", "₹1,250.75" → integer paise. NaN when invalid. */
  function toPaise(value) {
    const s = String(value == null ? '' : value).trim().replace(/[₹,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    const parts = s.split('.');
    const rupees = parseInt(parts[0], 10);
    const paise = parseInt(((parts[1] || '') + '00').slice(0, 2), 10);
    const total = rupees * 100 + paise;
    return Number.isSafeInteger(total) ? total : NaN;
  }

  /** integer paise → "₹1,250.75" */
  function formatINR(paise) {
    const n = Math.round(Number(paise) || 0);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const rupees = Math.floor(abs / 100);
    const p = abs % 100;
    return sign + '₹' + rupees.toLocaleString('en-IN') + '.' + String(p).padStart(2, '0');
  }

  /** Price of an order in paise. rate = ₹ per 1000. Rounds to the nearest paisa. */
  function priceInPaise(quantity, ratePer1k) {
    const qty = Number(quantity);
    const ratePaise = Math.round(Number(ratePer1k) * 100);   // paise per 1000 units
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(ratePaise) || ratePaise <= 0) return NaN;
    return Math.max(1, Math.round((qty * ratePaise) / 1000));
  }

  /** Can the wallet pay for this? Returns the full breakdown the UI needs. */
  function checkFunds(balancePaise, costPaise) {
    const balance = Math.max(0, Math.round(Number(balancePaise) || 0));
    const cost = Math.round(Number(costPaise) || 0);
    const ok = cost > 0 && balance >= cost;
    return { ok, balance, cost, after: ok ? balance - cost : balance, shortfall: ok ? 0 : Math.max(0, cost - balance) };
  }

  function normalizeUtr(value) {
    return String(value || '').toUpperCase().replace(/[\s-]/g, '');
  }
  function isValidUtr(value) {
    return /^[A-Z0-9]{10,35}$/.test(normalizeUtr(value));
  }

  /** Unique reference shown to the user for every Add-Funds attempt (also the UPI note). */
  function generatePaymentId() {
    const t = Date.now().toString().slice(-8);
    const r = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return 'ADF' + t + r;
  }

  function fail(code, message, extra) {
    const e = new Error(message);
    e.code = code;
    if (extra) Object.assign(e, extra);
    return e;
  }

  // ── Wallet: pay for an order (atomic: balance check + debit + ledger + order) ──
  async function placeWalletOrder({ user, orderData, amountPaise }) {
    if (!user || !user.uid) throw fail('auth', 'Please sign in first.');
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw fail('amount', 'Invalid order amount.');
    const E = env();
    const userRef = E.db.collection('users').doc(user.uid);
    // Deterministic IDs make a retry after a dropped connection safe: it can never charge twice.
    const orderRef = E.db.collection('orders').doc(String(orderData.orderId));
    const txRef = E.db.collection('walletTx').doc('D' + String(orderData.orderId));

    return E.db.runTransaction(async (tx) => {
      const existing = await tx.get(orderRef);
      if (existing.exists) {
        const o = existing.data() || {};
        if (o.userId === user.uid && o.paymentMethod === 'wallet') {
          return { orderDocId: orderRef.id, txId: txRef.id, balanceAfter: null, already: true };
        }
        throw fail('collision', 'Order ID clash. Please try again.');
      }
      const snap = await tx.get(userRef);
      const balance = snap.exists ? Number((snap.data() || {}).balance) || 0 : 0;
      const f = checkFunds(balance, amountPaise);
      if (!f.ok) {
        throw fail('insufficient', 'Insufficient fund. Balance ' + formatINR(f.balance) + ', required ' + formatINR(f.cost) + '.', { balance: f.balance, shortfall: f.shortfall });
      }
      tx.update(userRef, { balance: f.after, lastTx: txRef.id, updatedAt: E.now() });
      tx.set(txRef, {
        userId: user.uid, userEmail: user.email || '', type: 'debit',
        amount: amountPaise, balanceAfter: f.after,
        orderDocId: orderRef.id, orderId: orderData.orderId,
        note: 'Order ' + orderData.orderId, createdAt: E.now()
      });
      tx.set(orderRef, {
        ...orderData,
        userId: user.uid,
        status: 'pending',
        paymentMethod: 'wallet',
        amountPaise: amountPaise,
        amountPaid: formatINR(amountPaise),
        walletTx: txRef.id,
        createdAt: E.now(), updatedAt: E.now()
      });
      return { orderDocId: orderRef.id, txId: txRef.id, balanceAfter: f.after };
    });
  }

  // ── Add Funds: user sends a request ──────────────────────────────────────────
  async function createFundRequest({ user, amountPaise, paymentId, utr }) {
    if (!user || !user.uid) throw fail('auth', 'Please sign in first.');
    if (!Number.isSafeInteger(amountPaise) || amountPaise < MIN_TOPUP_PAISE || amountPaise > MAX_TOPUP_PAISE) {
      throw fail('amount', 'Amount must be between ' + formatINR(MIN_TOPUP_PAISE) + ' and ' + formatINR(MAX_TOPUP_PAISE) + '.');
    }
    if (!isValidUtr(utr)) throw fail('utr', 'Enter a valid UTR / Transaction ID (10–35 letters or digits).');
    const E = env();
    const cleanUtr = normalizeUtr(utr);

    // A Transaction ID can be used for ONE payment only. The claim document is created together with
    // the request in one atomic step, so two people (or two tabs) can never use the same UTR.
    const claimRef = E.db.collection('utrClaims').doc(cleanUtr);
    const reqRef = E.db.collection('fundRequests').doc();
    await E.db.runTransaction(async (tx) => {
      const claim = await tx.get(claimRef);
      if (claim.exists) {
        throw fail('utr-used', 'This Transaction ID is already used. Please make another payment to process your request.');
      }
      tx.set(claimRef, { userId: user.uid, requestId: reqRef.id, createdAt: E.now() });
      tx.set(reqRef, {
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
        amount: amountPaise,
        paymentId: paymentId,
        utr: cleanUtr,
        status: 'pending',
        createdAt: E.now()
      });
    });
    return { id: reqRef.id };
  }

  // ── Admin: approve a fund request (credits the wallet, once) ────────────────
  async function approveFundRequest(requestId, adminEmail) {
    const E = env();
    const reqRef = E.db.collection('fundRequests').doc(requestId);
    const txRef = E.db.collection('walletTx').doc();

    return E.db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) throw fail('missing', 'Request not found.');
      const r = reqSnap.data();
      if (r.status !== 'pending') throw fail('state', 'This request was already ' + r.status + '.');
      const amount = Number(r.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw fail('amount', 'Request has an invalid amount.');

      const utrRef = E.db.collection('usedUtrs').doc(normalizeUtr(r.utr));
      const userRef = E.db.collection('users').doc(r.userId);
      const utrSnap = await tx.get(utrRef);
      if (utrSnap.exists) throw fail('utr-used', 'This UTR was already credited for another request. Reject this one.');
      const userSnap = await tx.get(userRef);
      const balance = userSnap.exists ? Number((userSnap.data() || {}).balance) || 0 : 0;
      const after = balance + amount;
      if (after > MAX_BALANCE_PAISE) throw fail('cap', 'Balance would exceed the maximum allowed.');

      tx.set(userRef, { balance: after, email: r.userEmail || '', updatedAt: E.now() }, { merge: true });
      tx.set(txRef, {
        userId: r.userId, userEmail: r.userEmail || '', type: 'credit',
        amount, balanceAfter: after, fundRequestId: requestId,
        paymentId: r.paymentId || '', utr: r.utr, approvedBy: adminEmail || 'admin',
        note: 'Funds added (' + (r.paymentId || r.utr) + ')', createdAt: E.now()
      });
      tx.update(reqRef, { status: 'approved', reviewedBy: adminEmail || 'admin', reviewedAt: E.now(), creditTx: txRef.id });
      tx.set(utrRef, { requestId, userId: r.userId, amount, at: E.now() });
      return { balanceAfter: after, amount, userEmail: r.userEmail };
    });
  }

  async function rejectFundRequest(requestId, adminEmail, reason) {
    const E = env();
    const reqRef = E.db.collection('fundRequests').doc(requestId);
    return E.db.runTransaction(async (tx) => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) throw fail('missing', 'Request not found.');
      if (snap.data().status !== 'pending') throw fail('state', 'This request was already ' + snap.data().status + '.');
      // free the Transaction ID so the customer can resubmit it correctly
      const claimRef = E.db.collection('utrClaims').doc(normalizeUtr(snap.data().utr));
      const claim = await tx.get(claimRef);
      if (claim.exists && claim.data().requestId === requestId) tx.delete(claimRef);
      tx.update(reqRef, { status: 'rejected', reviewedBy: adminEmail || 'admin', reviewedAt: E.now(), rejectReason: String(reason || '').slice(0, 200) });
      return true;
    });
  }

  // ── Admin: decline an order and refund the wallet (once) ─────────────────────
  async function declineOrderWithRefund(orderDocId, adminEmail) {
    const E = env();
    const orderRef = E.db.collection('orders').doc(orderDocId);
    const txRef = E.db.collection('walletTx').doc();

    return E.db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw fail('missing', 'Order not found.');
      const o = snap.data();
      if (o.status === 'declined') return { refunded: false, already: true };

      const isWallet = o.paymentMethod === 'wallet' && Number.isSafeInteger(o.amountPaise) && o.amountPaise > 0;
      if (!isWallet || o.refunded) {
        tx.update(orderRef, { status: 'declined', updatedAt: E.now(), updatedBy: adminEmail || 'admin' });
        return { refunded: false };
      }
      const userRef = E.db.collection('users').doc(o.userId);
      const userSnap = await tx.get(userRef);
      const balance = userSnap.exists ? Number((userSnap.data() || {}).balance) || 0 : 0;
      const after = balance + o.amountPaise;
      tx.set(userRef, { balance: after, updatedAt: E.now() }, { merge: true });
      tx.set(txRef, {
        userId: o.userId, userEmail: o.userEmail || '', type: 'refund',
        amount: o.amountPaise, balanceAfter: after,
        orderDocId, orderId: o.orderId || '', approvedBy: adminEmail || 'admin',
        note: 'Refund for declined order ' + (o.orderId || ''), createdAt: E.now()
      });
      tx.update(orderRef, { status: 'declined', refunded: true, refundTx: txRef.id, updatedAt: E.now(), updatedBy: adminEmail || 'admin' });
      return { refunded: true, amount: o.amountPaise, balanceAfter: after };
    });
  }

  // ── Live listeners ───────────────────────────────────────────────────────────
  function listenBalance(uid, onBalance, onError) {
    if (!uid) return () => {};
    return env().db.collection('users').doc(uid).onSnapshot(
      snap => onBalance(snap.exists ? (Number((snap.data() || {}).balance) || 0) : 0),
      err => { if (onError) onError(err); }
    );
  }
  function listenUserFundRequests(uid, onData, onError) {
    if (!uid) return () => {};
    return env().db.collection('fundRequests').where('userId', '==', uid).onSnapshot(snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
      onData(rows);
    }, err => { if (onError) onError(err); });
  }
  function ms(ts) { return ts && ts.toMillis ? ts.toMillis() : 0; }

  const Wallet = {
    MIN_TOPUP_PAISE, MAX_TOPUP_PAISE,
    toPaise, formatINR, priceInPaise, checkFunds, normalizeUtr, isValidUtr, generatePaymentId,
    placeWalletOrder, createFundRequest, approveFundRequest, rejectFundRequest, declineOrderWithRefund,
    listenBalance, listenUserFundRequests,
    _setEnv(e) { testEnv = e; }
  };
  root.Wallet = Wallet;
  if (typeof module !== 'undefined' && module.exports) module.exports = Wallet;
})(typeof window !== 'undefined' ? window : globalThis);
