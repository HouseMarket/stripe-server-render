import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Вебхук должен идти ДО express.json() и express.urlencoded()!
// ✅ Вебхук от Stripe
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    console.log("🔹 Вебхук получен от Stripe");

    let rawBodyBuffer = req.rawBody;
    if (!rawBodyBuffer || !Buffer.isBuffer(rawBodyBuffer)) {
        console.warn("⚠️ req.rawBody отсутствует, создаём Buffer вручную!");
        rawBodyBuffer = Buffer.from(req.body || "", "utf-8");
    }

    console.log("✅ req.rawBody создан, длина:", rawBodyBuffer.length, "байт");

    try {
        const sig = req.headers["stripe-signature"];
        const event = stripe.webhooks.constructEvent(rawBodyBuffer, sig.trim(), process.env.STRIPE_WEBHOOK_SECRET.trim());

        console.log("✅ Webhook received:", event.type);

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            const payment_key = session.metadata?.payment_key || "undefined";

            console.log("✅ Payment completed for:", payment_key);

            // 🔍 ЛОГИРУЕМ ОТПРАВКУ В CREATIUM
            console.log("📤 Отправляем запрос в Creatium:", {
                payment_key: payment_key,
                status: "succeeded"
            });

            try {
                const creatiumResponse = await fetch("https://api.creatium.io/integration-payment/third-party-payment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ payment_key, status: "succeeded" })
                });

                const responseText = await creatiumResponse.text(); // Читаем текст ответа
                console.log("📥 Ответ от Creatium:", responseText);

            } catch (fetchError) {
                console.error("❌ Ошибка при отправке в Creatium:", fetchError.message);
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error("❌ Webhook Signature Error:", error.message);
        res.status(400).json({ error: "Webhook signature verification failed", details: error.message });
    }
});

// ✅ Подключаем JSON-парсер после вебхуков
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Маршрут для создания сессии оплаты (Creatium)
app.post("/creatium-payment", async (req, res) => {
    try {
        console.log("\n🔹 Запрос от Creatium:", JSON.stringify(req.body, null, 2));

        const payment_key = req.body.payment?.key || req.body.payment?.external_id || `order_${Date.now()}`;
        const product = req.body.order?.fields_by_name?.["Название"] || req.body.cart?.items?.[0]?.title || "Unknown Product";
        const price = Math.round(parseFloat(req.body.payment?.amount) * 100) || null;
        const currency = req.body.payment?.currency || "nzd"; // ✅ По умолчанию NZD

        if (!payment_key || !product || isNaN(price) || !currency) {
            console.log("❌ Отсутствуют обязательные поля:", { payment_key, product, price, currency });
            return res.status(400).json({ error: "Missing required fields", received: { payment_key, product, price, currency } });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"], // ✅ Отключили Link
            locale: "en",
            allow_promotion_codes: false,
            metadata: { payment_key }, // ✅ Принудительно передаём `payment_key`
            line_items: [
                {
                    price_data: {
                        currency,
                        product_data: {
                            name: product,
                        },
                        unit_amount: price,
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `${process.env.CLIENT_URL}/payment-success?payment_key=${payment_key}`,
            cancel_url: `${process.env.CLIENT_URL}/cancel?payment_key=${payment_key}`,
        });

        console.log("✅ Создана платёжная сессия:", session.url);
        console.log("🔹 Metadata передано в Stripe:", session.metadata);

        res.json({ url: session.url });
    } catch (error) {
        console.log("❌ Ошибка при создании платежной сессии:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
