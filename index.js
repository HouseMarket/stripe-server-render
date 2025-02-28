import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 🔥 Отключаем Render Proxy, чтобы запросы не изменялись
app.use((req, res, next) => {
    res.setHeader("x-render-proxy-ttl", "0");
    next();
});

// 🔥 Вебхук должен идти ДО express.json() и express.urlencoded()!
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    console.log("🔹 Вебхук получен от Stripe");
    console.log("🔹 Headers:", req.headers);
    console.log("🔹 Stripe signature:", req.headers["stripe-signature"]);
    console.log("🔹 Content-Type:", req.headers["content-type"]);

    if (!req.body || typeof req.body !== "object") {
        console.error("❌ req.body отсутствует или имеет неверный формат!");
        return res.status(400).json({ error: "Invalid request body" });
    }

    // 🔍 Создаём `Buffer` из `req.body`
    const rawBodyBuffer = Buffer.from(JSON.stringify(req.body));
    console.log("✅ req.rawBody type (Buffer):", Buffer.isBuffer(rawBodyBuffer) ? "✅ Да" : "❌ Нет");
    console.log("✅ req.rawBody length:", rawBodyBuffer.length, "bytes");

    // 🔍 Логируем HEX и SHA256 тела запроса
    console.log("🔹 req.rawBody HEX (первые 100 символов):", rawBodyBuffer.toString("hex").slice(0, 100));
    const computedHash = crypto.createHash("sha256").update(rawBodyBuffer).digest("hex");
    console.log("🔹 req.rawBody SHA256 (перед отправкой в constructEvent):", computedHash);

    try {
        const sig = req.headers["stripe-signature"];
        const event = stripe.webhooks.constructEvent(rawBodyBuffer, sig, process.env.STRIPE_WEBHOOK_SECRET);

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

// ✅ Подключаем JSON-парсер после вебхуков
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
