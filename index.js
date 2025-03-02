import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Вебхук должен идти ДО express.json() и express.urlencoded()!
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    console.log("🔹 Вебхук получен от Stripe");
    console.log("🔹 Headers:", req.headers);
    console.log("🔹 Stripe signature:", req.headers["stripe-signature"]);
    console.log("🔹 Content-Type:", req.headers["content-type"]);

    // ✅ Проверяем наличие req.rawBody, если его нет, создаём Buffer вручную
    let rawBodyBuffer = req.rawBody;
    if (!rawBodyBuffer || !Buffer.isBuffer(rawBodyBuffer)) {
        console.warn("⚠️ req.rawBody отсутствует, создаём Buffer вручную!");
        rawBodyBuffer = Buffer.from(req.body || "", "utf-8"); // Создаём Buffer с правильной кодировкой
    }

    console.log("✅ req.rawBody создан, длина:", rawBodyBuffer.length, "байт");

    // 🔍 Логируем SHA256 и HEX перед отправкой в constructEvent()
const computedHash = crypto.createHash("sha256").update(rawBodyBuffer).digest("hex");
console.log("🔹 req.rawBody SHA256:", computedHash);
console.log("🔹 req.rawBody HEX (первые 100 символов):", rawBodyBuffer.toString("hex").slice(0, 100));

try {
    let sig = req.headers["stripe-signature"] || "";

    if (!sig) {
        console.error("❌ Webhook Signature Error: Stripe signature отсутствует!");
        console.log("🔹 Все заголовки запроса:", req.headers);
        return res.status(400).json({ error: "Missing Stripe signature" });
    }

    // 🔥 ОЧЕНЬ ВАЖНО: Используем именно `rawBodyBuffer` без изменений
    const event = stripe.webhooks.constructEvent(rawBodyBuffer, sig, process.env.STRIPE_WEBHOOK_SECRET.trim());
    
    console.log("✅ Webhook received:", event.type);
    
    // (Здесь остальной код для обработки события)
    
} catch (error) {
    console.error("❌ Webhook Signature Error:", error.message);
    return res.status(400).json({ error: "Webhook signature verification failed", details: error.message });
}       

        console.log("✅ Webhook received:", event.type);

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            const payment_key = session.metadata?.payment_key || session.id;

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
        console.error("❌ Webhook Signature Error:", error.message);
        res.status(400).json({ error: "Webhook signature verification failed", details: error.message });
    }
});

// ✅ Эндпоинт для обработки запроса от Creatium
app.post("/creatium-payment", express.json(), async (req, res) => {
    console.log("🔹 Запрос от Creatium:", req.body);

    // ✅ Извлекаем payment_key
    const payment_key = req.body.page?.query?.payment_key || req.body.payment?.key || "undefined";
    console.log("✅ Извлечён payment_key:", payment_key);

    if (payment_key === "undefined") {
        console.error("❌ Ошибка: payment_key не найден!");
        return res.status(400).json({ error: "payment_key is missing" });
    }

    // ✅ Создаём сессию оплаты
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        locale: "en",
        success_url: `${process.env.CLIENT_URL}/payment-success?payment_key=${payment_key}`,
        cancel_url: `${process.env.CLIENT_URL}/cancel?payment_key=${payment_key}`,
        line_items: [{
            price_data: {
                currency: "nzd",
                product_data: { name: "Creatium Payment" },
                unit_amount: Math.round(req.body.cart?.items[0]?.price * 100 || 0),
            },
            quantity: 1,
        }],
        metadata: { payment_key },
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
