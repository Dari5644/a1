// ========================
//  WhatsApp + OpenAI Bot
//  server.js — ES Modules
// ========================

import express from "express";
import axios from "axios";
import OpenAI from "openai";

// ------------------------
//  التوكنات اللي انت عطيتني اياها
// ------------------------
const PORT = 3000;
const VERIFY_TOKEN = "mawaheb_verify";

const WABA_TOKEN =
  "EAAMlJZBsLvHQBP430JnAZA3a1ymKksXew7rsERa7fYzFQKoUehqIDPqNwYoVg3RIC6OwQGd3ZA2K7ZBEn390s1SeP5Gvbs1Wi3B75UPyEYT1gKs2Sae5w0emCo7L9EqeE6ktDNFjsqZAcBnnsBFdZA8qZAI73c7jthFxFvLiMXnZC2nZBNoIgc0InxBuI5SefnAZDZD";

const PHONE_ID = "830233543513578"; // ⚠️ هذا رقم جوال، المفروض Phone Number ID يكون رقم طويل من Meta مثل 1234567890
const WABA_ID = "1325564105512012";

const OPENAI_API_KEY =
  "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";

// ------------------------
//  تهيئة OpenAI
// ------------------------
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// ------------------------
// دالة الذكاء الاصطناعي
// ------------------------
async function getAIReply(message) {
  try {
    const response = await openai.responses.create({
      model: "gpt-4-mini",
      input: [
        {
          role: "user",
          content: message,
        },
      ],
    });

    return response.output[0].content[0].text;
  } catch (err) {
    console.error("🔥 OpenAI ERROR:", err.response?.data || err.message);
    return "صار عندي خطأ تقني وأنا أحاول أفهم رسالتك، جرّب مرة ثانية 🙏";
  }
}

// ------------------------
// إرسال رسالة واتساب
// ------------------------
async function sendWhatsAppMessage(to, text) {
  try {
    const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;

    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${WABA_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📤 Message sent:", to);
  } catch (err) {
    console.error("🔥 WhatsApp SEND ERROR:", err.response?.data || err.message);
  }
}

// ------------------------
// GET — التحقق من Webhook
// ------------------------
const app = express();
app.use(express.json());

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ WEBHOOK_VERIFICATION_FAILED");
    return res.sendStatus(403);
  }
});

// ------------------------
// POST — استقبال رسائل واتساب
// ------------------------
app.post("/webhook", async (req, res) => {
  console.log("📩 Incoming:", JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text.body;

    console.log("👤 From:", from);
    console.log("💬 Text:", text);

    const reply = await getAIReply(text);

    await sendWhatsAppMessage(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err);
    res.sendStatus(500);
  }
});

// ------------------------
// تشغيل السيرفر
// ------------------------
app.get("/", (req, res) => {
  res.send("WhatsApp AI Bot is running 🚀");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on PORT ${PORT}`);
});
