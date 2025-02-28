import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());

import * as crypto from "crypto";

// Эндпоинт для обработки вебхуков от Stripe (должен быть до express.json())
app.post("/webhook", express.raw({ 
    type: "application/json", 
    verify: (req, res, buf) => { req.rawBody = buf; } // Сохраняем Buffer
}), async (req, res) => {
    console.log("🔹 Вебхук получен от Stripe");
    console.log("🔹 Headers:", req.headers);
    console.log("🔹 Stripe signature:", req.headers["stripe-signature"]);
    console.log("🔹 Content-Type:", req.headers["content-type"]);

    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
        console.error("❌ req.rawBody отсутствует или имеет неверный формат!");
        return res.status(400).json({ error: "rawBody is missing or incorrect format" });
    }

    console.log("🔹 req.rawBody type (должен быть Buffer):", Buffer.isBuffer(req.rawBody) ? "✅ Buffer" : "❌ NOT Buffer");

    // Принудительно сохраняем rawBody как строку перед подписью
    const rawBody = req.rawBody.toString();

    console.log("🔹 rawBody (как строка перед подписью):", rawBody);

    // 🔍 Вычисляем новый SHA256-хеш и сравниваем его с оригинальным
    const computedHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    console.log("🔹 rawBody SHA256 (после обработки):", computedHash);

    try {
        const sig = req.headers["stripe-signature"];
        const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);

        console.log("✅ Webhook received:", event.type);

        return res.json({ received: true });  // ✅ Успешный ответ Stripe
    } catch (error) {
        console.error("❌ Webhook Error:", error.message);
        return res.status(400).json({ error: "Webhook error" });
    }
});

// Подключаем JSON-парсер ПОСЛЕ вебхуков
app.use(express.json()); // Обычный JSON-парсинг для всех эндпоинтов, кроме вебхуков
app.use(express.urlencoded({ extended: true }));

// Эндпоинт для создания платежной сессии
app.post("/create-checkout-session", async (req, res) => {
    try {
        const { product, price, currency } = req.body;

        if (!product || !price || !currency) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"], // Отключаем Link
            locale: "en",
            allow_promotion_codes: false,
            line_items: [
                {
                    price_data: {
                        currency,
                        product_data: {
                            name: product,
                        },
                        unit_amount: price * 100,
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `${process.env.CLIENT_URL}/payment-success`,
            cancel_url: `${process.env.CLIENT_URL}/cancel`,
        });

        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Новый маршрут для Creatium
app.post("/creatium-payment", async (req, res) => {
    try {
        console.log("Received request from Creatium:", JSON.stringify(req.body, null, 2));

        const payment_key = req.body.payment?.key || req.body.payment?.external_id || null;
        const product = req.body.order?.fields_by_name?.["Название"] || req.body.cart?.items?.[0]?.title || "Unknown Product";
        const price = Math.round(parseFloat(req.body.payment?.amount) * 100) || null;
        const currency = req.body.payment?.currency || "nzd"; // Если пусто, ставим NZD

        if (!payment_key || !product || isNaN(price) || !currency) {
            console.log("❌ Missing required fields:", { payment_key, product, price, currency });
            return res.status(400).json({ error: "Missing required fields", received: { payment_key, product, price, currency } });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"], // Отключаем Link
            locale: "en",
            allow_promotion_codes: false,
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

        console.log("✅ Payment session created:", session.url);
        res.json({ url: session.url });
    } catch (error) {
        console.log("❌ Error creating payment session:", error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

