import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json()); // Вместо bodyParser.json()
app.use(express.urlencoded({ extended: true })); // Добавляем поддержку form-data

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
            billing_address_collection: "required", // Убираем сохранённые методы оплаты
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

        const payment_key = req.body.payment?.key;
        const product = req.body.order?.fields_by_name?.["Название"] || req.body.cart?.text?.split(";")[0].split(" - ")[1] || "Товар без названия";
        const price = Math.round(parseFloat(req.body.payment?.amount) * 100); // Преобразуем в центы
        const currency = "nzd"; // Валюта фиксирована в NZD

        if (!payment_key || !product || isNaN(price) || !currency) {
            console.log("Missing required fields", { payment_key, product, price, currency });
            return res.status(400).json({ error: "Missing required fields", received: { payment_key, product, price, currency } });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"], // Отключаем Link
            locale: "en",
            allow_promotion_codes: false,
            billing_address_collection: "required", // Убираем сохранённые методы оплаты
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

        console.log("Session created:", session.url);
        res.json({ url: session.url });
    } catch (error) {
        console.log("Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для обработки вебхуков от Stripe
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            const payment_key = session.success_url.split("payment_key=")[1];
            console.log("Payment completed for:", payment_key);

            await fetch("https://api.creatium.io/integration-payment/third-party-payment", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    payment_key: payment_key,
                    status: "succeeded"
                })
            });
        }

        res.json({ received: true });
    } catch (error) {
        console.log("Webhook Error:", error.message);
        res.status(400).json({ error: "Webhook error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

