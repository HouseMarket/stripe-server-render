import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());

// Эндпоинт для обработки вебхуков от Stripe (должен быть до express.json())
app.post("/webhook", express.raw({ 
    type: "application/json", 
    verify: (req, res, buf) => { req.rawBody = buf; } // Сохраняем "сырое" тело запроса
}), async (req, res) => {
    console.log("🔹 Вебхук получен от Stripe");
    console.log("🔹 Headers:", req.headers);
    console.log("🔹 Stripe signature:", req.headers["stripe-signature"]);

    const sig = req.headers["stripe-signature"];
    let event;

    try {
        // Проверяем, есть ли req.rawBody
        if (!req.rawBody) {
            console.error("❌ req.rawBody отсутствует! Express мог его перезаписать.");
            return res.status(400).json({ error: "rawBody is missing" });
        }

        console.log("🔹 req.rawBody (первые 200 символов):", req.rawBody.toString().slice(0, 200));

        // Проверяем правильность подписания вебхука
        console.log("🔹 Headers:", req.headers);
console.log("🔹 Stripe signature:", req.headers["stripe-signature"]);
console.log("🔹 Content-Type:", req.headers["content-type"]);
console.log("🔹 req.rawBody type:", typeof req.rawBody);
console.log("🔹 req.rawBody (первые 200 символов):", req.rawBody.toString().slice(0, 200));
        event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log("✅ Webhook received:", event.type);

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            const payment_key = session.success_url.split("payment_key=")[1];

            console.log("✅ Payment completed for:", payment_key);

            // Отправляем статус оплаты в Creatium
            await fetch("https://api.creatium.io/integration-payment/third-party-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payment_key, status: "succeeded" })
            });

            console.log("✅ Notification sent to Creatium");
        }

        res.json({ received: true });
    } catch (error) {
        console.error("❌ Webhook Error:", error.message);
        res.status(400).json({ error: "Webhook error" });
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

