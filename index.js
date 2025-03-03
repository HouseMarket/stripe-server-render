import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Вебхук Stripe (должен идти перед express.json!)
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    console.log("🔹 Вебхук получен от Stripe");
    console.log("🔹 Headers:", req.headers);

    let rawBodyBuffer = req.rawBody;
    if (!rawBodyBuffer || !Buffer.isBuffer(rawBodyBuffer)) {
        console.warn("⚠️ req.rawBody отсутствует, создаём Buffer вручную!");
        rawBodyBuffer = Buffer.from(req.body || "", "utf-8");
    }

    console.log("✅ req.rawBody создан, длина:", rawBodyBuffer.length, "байт");

    // 🔍 Логируем SHA256 и HEX перед отправкой в constructEvent
    const computedHash = crypto.createHash("sha256").update(rawBodyBuffer).digest("hex");
    console.log("🔹 req.rawBody SHA256:", computedHash);
    console.log("🔹 req.rawBody HEX (первые 100 символов):", rawBodyBuffer.toString("hex").slice(0, 100));

    try {
        const sig = req.headers["stripe-signature"] || "";

        if (!sig) {
            console.error("❌ Webhook Signature Error: Stripe signature отсутствует!");
            console.log("🔹 Все заголовки запроса:", req.headers);
            return res.status(400).json({ error: "Missing Stripe signature" });
        }

        const event = stripe.webhooks.constructEvent(rawBodyBuffer, sig, process.env.STRIPE_WEBHOOK_SECRET.trim());

        console.log("✅ Webhook received:", event.type);

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            const payment_key = session.metadata?.payment_key || session.id || "undefined";
            const order_id = session.metadata?.order_id || "undefined"; // ✅ Добавляем Order ID

            console.log("✅ Payment completed for:", payment_key);
            console.log("✅ Order ID:", order_id);

            if (payment_key === "undefined") {
                console.error("❌ Ошибка: payment_key не найден, не отправляем в Creatium.");
            } else {
                console.log("📤 Отправляем запрос в Creatium...");

                try {
                    const creatiumResponse = await fetch("https://api.creatium.io/integration-payment/third-party-payment", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ payment_key, status: "succeeded" }),
                    });

                    const responseText = await creatiumResponse.text();
                    console.log("📥 Ответ от Creatium:", responseText);
                } catch (fetchError) {
                    console.error("❌ Ошибка при отправке запроса в Creatium:", fetchError);
                }
            }

            console.log("📤 Отправляем запрос в Интегромат...");

            try {
                const integromatResponse = await fetch("https://hook.us1.make.com/mrsw7jk8plde2fif7s2pszyqjr9rz1c1", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ payment_key, order_id, status: "succeeded" }), // ✅ Отправляем Order ID
                });

                const integromatText = await integromatResponse.text();
                console.log("📥 Ответ от Интегромата:", integromatText);
            } catch (fetchError) {
                console.error("❌ Ошибка при отправке запроса в Интегромат:", fetchError);
            }
        }

        res.json({ received: true });

    } catch (error) {
        console.error("❌ Webhook Signature Error:", error.message);
        res.status(400).json({ error: "Webhook signature verification failed", details: error.message });
    }
});

// ✅ Эндпоинт для обработки запроса от Creatium
app.post("/creatium-payment", express.json(), async (req, res) => {
    console.log("🟢 Запрос от Creatium:", JSON.stringify(req.body, null, 2));

    const payment_key = req.body.payment?.key || req.body.order?.id || req.body.member?.id || "undefined";
    const order_id = req.body.order?.id || "undefined"; // ✅ Добавляем Order ID
    const product = req.body.order?.fields_by_name?.["Название"] || req.body.cart?.items?.[0]?.title || "Unknown Product";
    const price = Math.round(parseFloat(req.body.payment?.amount) * 100) || null;
    const currency = req.body.payment?.currency || "nzd";

    if (!payment_key || !product || isNaN(price) || !currency) {
        console.log("❌ Ошибка: отсутствуют обязательные поля", { payment_key, product, price, currency });
        return res.status(400).json({ error: "Missing required fields", received: { payment_key, product, price, currency } });
    }

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        locale: "en",
        allow_promotion_codes: false,
        line_items: [
            {
                price_data: {
                    currency,
                    product_data: { name: product },
                    unit_amount: price,
                },
                quantity: 1,
            },
        ],
        metadata: { payment_key, order_id },
        mode: "payment",
        success_url: `${process.env.CLIENT_URL}/payment-success?payment_key=${payment_key}`,
        cancel_url: `${process.env.CLIENT_URL}/cancel?payment_key=${payment_key}`,
    });

    console.log("✅ Создана платёжная сессия:", session.url);
    console.log("🔹 Metadata передано в Stripe:", session.metadata);

    res.json({ url: session.url });
});

// ✅ Подключаем JSON-парсер после вебхуков
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));