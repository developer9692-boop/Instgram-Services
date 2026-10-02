// ============================================================
// AstroPulse SMM Panel - Firebase Configuration
// ============================================================

// Firebase SDK imports are expected to be loaded in your HTML
// before this file.

// ============================================================
// FIREBASE CONFIG
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyAmvcyfpgFsFY_JLtC2T3t36KnUKyLQL0o",
  authDomain: "astropulsesmm.firebaseapp.com",
  projectId: "astropulsesmm",
  storageBucket: "astropulsesmm.firebasestorage.app",
  messagingSenderId: "24067828012",
  appId: "1:24067828012:web:ede9ad262bae059006a489",
  measurementId: "G-YCEKPEDNR6"

};

// Prevent Firebase from being initialized twice
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();


// ============================================================
// GEMINI CONFIGURATION
// ============================================================

// IMPORTANT:
// Use a NEW/ROTATED Gemini API key.
// Do not use a key that was previously exposed publicly.

const GEMINI_API_KEY = "AQ.Ab8RN6KSjLpUS1niHGOQXT9G80QEHQdXNj5QlANiLy6sD19DeA";

const GEMINI_MODEL = "gemini-2.0-flash";


// ============================================================
// ADMIN CHECK
// ============================================================

function isUserAdmin(user) {
    if (!user) return false;

    const adminEmails = [
        "astropulsesmmpanel@gmail.com"
    ];

    return adminEmails.includes(
        String(user.email || "").toLowerCase()
    );
}


// ============================================================
// ORDER ID NORMALIZATION
// ============================================================

function normalizeOrderId(value) {

    const text = String(value || "").toUpperCase();

    const match = text.match(
        /\bASTR\s*[-#:]?\s*(\d{6,12})\b/
    );

    if (!match) return null;

    return `ASTR${match[1]}`;
}


function extractOrderId(text) {
    return normalizeOrderId(text);
}


// ============================================================
// REFILL INTENT DETECTION
// ============================================================

function isRefillIntent(text) {

    const message = String(text || "");

    return /\b(
        refill|
        refil|
        re-fill|
        top\s*up|
        dropped|
        drop\s*followers|
        drop\s*views|
        drop\s*likes|
        replacement
    )\b/ix.test(message);
}


// ============================================================
// CHECK WHETHER SERVICE SUPPORTS REFILL
// ============================================================

function serviceAllowsRefill(order) {

    if (!order) return false;

    // Explicit database settings have priority
    if (order.refillEligible === true) return true;
    if (order.refill === true) return true;
    if (order.hasRefill === true) return true;

    if (
        order.refillEligible === false ||
        order.refill === false ||
        order.hasRefill === false
    ) {
        return false;
    }

    const serviceText = String(
        order.service ||
        order.serviceName ||
        ""
    ).toLowerCase();

    // Explicitly non-refill services
    if (
        serviceText.includes("no refill") ||
        serviceText.includes("without refill") ||
        serviceText.includes("non-refill")
    ) {
        return false;
    }

    // Services containing refill information
    if (
        serviceText.includes("lifetime refill") ||
        serviceText.includes("refill")
    ) {
        return true;
    }

    // If your database does not explicitly specify refill,
    // allow the request to continue for admin verification.
    return true;
}


// ============================================================
// GET ORDER BY PUBLIC ORDER ID
// ============================================================

async function getOrderByPublicId(orderId) {

    const normalizedId = normalizeOrderId(orderId);

    if (!normalizedId) {
        return null;
    }

    const user = auth.currentUser;

    if (!user) {
        throw new Error(
            "Please login to check your order."
        );
    }


    // --------------------------------------------------------
    // ADMIN
    // --------------------------------------------------------

    if (isUserAdmin(user)) {

        const snapshot = await db
            .collection("orders")
            .where("orderId", "==", normalizedId)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return null;
        }

        const doc = snapshot.docs[0];

        return {
            id: doc.id,
            ...doc.data()
        };
    }


    // --------------------------------------------------------
    // NORMAL USER
    // --------------------------------------------------------
    // We intentionally query by userId first.
    //
    // This avoids the compound Firestore query that was causing
    // index/security-rule problems in the previous version.
    // --------------------------------------------------------

    const snapshot = await db
        .collection("orders")
        .where("userId", "==", user.uid)
        .get();

    let foundOrder = null;

    snapshot.forEach(doc => {

        const data = doc.data();

        const dbOrderId = normalizeOrderId(
            data.orderId
        );

        if (
            dbOrderId &&
            dbOrderId === normalizedId
        ) {
            foundOrder = {
                id: doc.id,
                ...data
            };
        }
    });

    return foundOrder;
}


// ============================================================
// PROCESS REFILL REQUEST
// ============================================================

async function processOrderRefill(orderId) {

    const normalizedId = normalizeOrderId(orderId);

    if (!normalizedId) {

        return {
            success: false,
            message:
                "Please provide a valid AstroPulse Order ID, for example ASTR38572197."
        };
    }


    const user = auth.currentUser;

    if (!user) {

        return {
            success: false,
            message:
                "Please login to request a refill."
        };
    }


    try {

        // ----------------------------------------------------
        // FIND ORDER
        // ----------------------------------------------------

        const order = await getOrderByPublicId(
            normalizedId
        );


        if (!order) {

            return {
                success: false,
                message:
                    `I could not find order ${normalizedId} in your account. Please check the Order ID.`
            };
        }


        // ----------------------------------------------------
        // ORDER STATUS
        // ----------------------------------------------------

        const status = String(
            order.status ||
            order.orderStatus ||
            ""
        )
            .trim()
            .toLowerCase();


        const completedStatuses = [
            "completed",
            "complete",
            "success",
            "successful"
        ];


        const activeStatuses = [
            "pending",
            "processing",
            "in progress",
            "in-progress",
            "partial"
        ];


        const failedStatuses = [
            "declined",
            "cancelled",
            "canceled",
            "failed"
        ];


        if (activeStatuses.includes(status)) {

            return {
                success: false,
                message:
                    `Order ${normalizedId} is currently ${status}. A refill can only be requested after the order is completed.`
            };
        }


        if (failedStatuses.includes(status)) {

            return {
                success: false,
                message:
                    `Order ${normalizedId} has status "${status}". This order is not eligible for a refill request.`
            };
        }


        if (
            status &&
            !completedStatuses.includes(status)
        ) {

            return {
                success: false,
                message:
                    `Order ${normalizedId} currently has status "${status}". Please contact support if you believe it should be eligible for refill.`
            };
        }


        // ----------------------------------------------------
        // CHECK REFILL ELIGIBILITY
        // ----------------------------------------------------

        if (!serviceAllowsRefill(order)) {

            return {
                success: false,
                message:
                    `Order ${normalizedId} does not appear to be eligible for refill based on its service.`
            };
        }


        // ----------------------------------------------------
        // CHECK EXISTING REFILL REQUESTS
        // ----------------------------------------------------
        // Query only by userId to avoid permission/index issues.
        // Then check orderId locally.
        // ----------------------------------------------------

        const existingSnapshot = await db
            .collection("refillRequests")
            .where("userId", "==", user.uid)
            .get();


        let existingRequest = null;


        existingSnapshot.forEach(doc => {

            const data = doc.data();

            const requestOrderId =
                normalizeOrderId(data.orderId);

            const requestStatus =
                String(data.status || "")
                    .toLowerCase()
                    .trim();


            if (
                requestOrderId === normalizedId &&
                (
                    requestStatus === "pending" ||
                    requestStatus === "processing"
                )
            ) {

                existingRequest = {
                    id: doc.id,
                    ...data
                };
            }
        });


        if (existingRequest) {

            return {
                success: false,
                message:
                    `A refill request for ${normalizedId} is already ${existingRequest.status}. Please wait for it to be processed.`,
                requestId: existingRequest.id
            };
        }


        // ----------------------------------------------------
        // CREATE REFILL REQUEST
        // ----------------------------------------------------

        const refillData = {

            orderId: normalizedId,

            orderDocId: order.id,

            userId: user.uid,

            userEmail:
                user.email || "",

            userName:
                user.displayName ||
                order.userName ||
                "",

            service:
                order.service ||
                order.serviceName ||
                "",

            serviceId:
                order.serviceId ||
                "",

            quantity:
                order.quantity ||
                order.amount ||
                0,

            originalOrderStatus:
                order.status ||
                "",

            status:
                "pending",

            source:
                "website",

            createdAt:
                firebase.firestore.FieldValue.serverTimestamp(),

            updatedAt:
                firebase.firestore.FieldValue.serverTimestamp()
        };


        const requestRef = await db
            .collection("refillRequests")
            .add(refillData);


        return {

            success: true,

            requestId:
                requestRef.id,

            orderId:
                normalizedId,

            message:
                `Your refill request for order ${normalizedId} has been submitted successfully.`
        };


    } catch (error) {

        console.error(
            "Refill processing error:",
            error
        );


        return {

            success: false,

            message:
                error.message ||
                "Unable to process the refill request right now."
        };
    }
}


// ============================================================
// GEMINI AI
// ============================================================

async function askGeminiAI(
    userMessage,
    conversationHistory = []
) {

    if (!GEMINI_API_KEY) {

        return getLocalBotResponse(
            userMessage
        );
    }


    try {

        const systemInstruction = `
You are the official AstroPulse SMM Panel support assistant.

Your job is to help users understand and use AstroPulse.

IMPORTANT RULES:

1. Never invent order information.
2. Never invent order status.
3. Never invent payment status.
4. Never invent prices.
5. Never claim that a refill was completed unless the actual refill function confirms it.
6. Never pretend that you called an external SMM provider API.
7. Never make up an Order ID.
8. If the user asks for a refill but does not provide an Order ID, ask for their Order ID.
9. Understand natural language, spelling mistakes, Hinglish, and different Order ID formats.
10. Order IDs normally look like ASTR38572197.
11. A user may write an Order ID as:
   ASTR38572197
   ASTR-38572197
   ASTR 38572197
   ASTR#38572197
12. If a user asks about a specific order, identify the Order ID from their message.
13. Refill requests are handled by the website's real refill function.
14. Do not say "I have refilled your order" unless the application function actually confirms the request.
15. If the user asks something outside AstroPulse knowledge, clearly say that you do not have verified information.
16. Keep answers professional, concise and useful.
17. Support English and simple Hinglish.

AstroPulse supported platforms include:
Instagram
Telegram
Facebook
Twitter/X
YouTube

Support:
Telegram: @astropulsesmmsupport
Email: astropulsesmmpanel@gmail.com

When talking about prices, only use prices that are actually supplied by the application/database.
Do not invent prices or guarantees.
`;


        const contents = [];


        // System instruction
        contents.push({
            role: "user",
            parts: [
                {
                    text: systemInstruction
                }
            ]
        });


        // Previous conversation
        if (
            Array.isArray(conversationHistory)
        ) {

            conversationHistory
                .slice(-10)
                .forEach(item => {

                    if (
                        !item ||
                        !item.text
                    ) {
                        return;
                    }


                    contents.push({

                        role:
                            item.role === "user"
                                ? "user"
                                : "model",

                        parts: [
                            {
                                text:
                                    String(item.text)
                            }
                        ]
                    });

                });
        }


        // Current message
        contents.push({

            role: "user",

            parts: [
                {
                    text:
                        String(userMessage)
                }
            ]
        });


        const response = await fetch(

            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,

            {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    contents,

                    generationConfig: {

                        temperature: 0.2,

                        topP: 0.8,

                        topK: 20,

                        maxOutputTokens: 700
                    }

                })
            }
        );


        if (!response.ok) {

            const errorText =
                await response.text();

            console.error(
                "Gemini API error:",
                errorText
            );

            return getLocalBotResponse(
                userMessage
            );
        }


        const data =
            await response.json();


        const answer =
            data?.candidates?.[0]?.content?.parts
                ?.map(part => part.text || "")
                .join("")
                .trim();


        if (!answer) {

            return getLocalBotResponse(
                userMessage
            );
        }


        return answer;


    } catch (error) {

        console.error(
            "AI error:",
            error
        );

        return getLocalBotResponse(
            userMessage
        );
    }
}


// ============================================================
// LOCAL FALLBACK AI
// ============================================================

function getLocalBotResponse(message) {

    const text =
        String(message || "")
            .trim()
            .toLowerCase();


    const orderId =
        extractOrderId(message);


    // --------------------------------------------------------
    // REFILL
    // --------------------------------------------------------

    if (
        isRefillIntent(message)
    ) {

        if (!orderId) {

            return `
Sure. I can help with a refill request.

Please send your AstroPulse Order ID.

Example:
ASTR38572197
            `.trim();
        }


        return `
I found Order ID ${orderId}.

I will verify the order status and refill eligibility before submitting the refill request.
        `.trim();
    }


    // --------------------------------------------------------
    // ORDER TRACKING
    // --------------------------------------------------------

    if (
        orderId &&
        (
            text.includes("status") ||
            text.includes("track") ||
            text.includes("order")
        )
    ) {

        return `
Your Order ID is ${orderId}.

For the latest verified order status, please use the order history section of your AstroPulse account.
        `.trim();
    }


    // --------------------------------------------------------
    // GREETING
    // --------------------------------------------------------

    if (
        /^(hi|hello|hey|hii|helo)\b/i.test(
            text
        )
    ) {

        return `
Hello! 👋

Welcome to AstroPulse Support.

I can help you with:
• Orders
• Refills
• Payments
• Services
• Order IDs
• General panel support

How can I help you?
        `.trim();
    }


    // --------------------------------------------------------
    // PRICE
    // --------------------------------------------------------

    if (
        text.includes("price") ||
        text.includes("pricing") ||
        text.includes("cost") ||
        text.includes("rate")
    ) {

        return `
You can check the latest AstroPulse service prices directly in the Services section.

Prices may vary by service, so I don't want to give you an incorrect price.
        `.trim();
    }


    // --------------------------------------------------------
    // PAYMENT
    // --------------------------------------------------------

    if (
        text.includes("payment") ||
        text.includes("upi") ||
        text.includes("utr") ||
        text.includes("paid")
    ) {

        return `
For payment-related issues, please provide your payment/UTR details through the appropriate payment section.

If the issue continues, contact:
Telegram: @astropulsesmmsupport
Email: astropulsesmmpanel@gmail.com
        `.trim();
    }


    // --------------------------------------------------------
    // START TIME
    // --------------------------------------------------------

    if (
        text.includes("start") &&
        (
            text.includes("time") ||
            text.includes("when")
        )
    ) {

        return `
Order start time depends on the selected service and provider.

You can check the order details from your Order History.
        `.trim();
    }


    // --------------------------------------------------------
    // SECURITY
    // --------------------------------------------------------

    if (
        text.includes("safe") ||
        text.includes("security") ||
        text.includes("secure")
    ) {

        return `
Please use only your public social-media profile information when ordering services.

Never share your social-media password, OTP, recovery code, or private login credentials.
        `.trim();
    }


    // --------------------------------------------------------
    // SUPPORT
    // --------------------------------------------------------

    if (
        text.includes("support") ||
        text.includes("contact") ||
        text.includes("help")
    ) {

        return `
AstroPulse Support:

Telegram: @astropulsesmmsupport
Email: astropulsesmmpanel@gmail.com

Please include your Order ID when contacting support about an order.
        `.trim();
    }


    // --------------------------------------------------------
    // SERVICES
    // --------------------------------------------------------

    if (
        text.includes("service") ||
        text.includes("instagram") ||
        text.includes("youtube") ||
        text.includes("telegram") ||
        text.includes("facebook") ||
        text.includes("twitter")
    ) {

        return `
AstroPulse provides SMM services for platforms including Instagram, Telegram, Facebook, Twitter/X and YouTube.

Open the Services section to see the currently available services.
        `.trim();
    }


    // --------------------------------------------------------
    // DEFAULT
    // --------------------------------------------------------

    return `
I'm AstroPulse Support Assistant.

I can help with orders, refills, payments, services and general panel questions.

If you need a refill, simply send your Order ID, for example:

ASTR38572197
    `.trim();
}


// ============================================================
// OPTIONAL GLOBAL EXPORTS
// ============================================================

window.normalizeOrderId =
    normalizeOrderId;

window.extractOrderId =
    extractOrderId;

window.isRefillIntent =
    isRefillIntent;

window.getOrderByPublicId =
    getOrderByPublicId;

window.processOrderRefill =
    processOrderRefill;

window.askGeminiAI =
    askGeminiAI;

window.getLocalBotResponse =
    getLocalBotResponse;

window.isUserAdmin =
    isUserAdmin;
