// server.js  (ES Module)

// نستعمل import بدل require
import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 10000;

// نقرأ المتغيّرات من البيئة (من لوحة Render)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;   // توكن واتساب من Meta
const OPENAI_API_KEY = "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";   // مفتاح OpenAI
const VERIFY_TOKEN = "mawaheb_verify";       // mawaheb_verify مثلاً

// تهيئة OpenAI
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// حتى يقرأ JSON من Webhook
app.use(bodyParser.json());

/**
 * GET /webhook
 * هذا الراوت يستخدمه فيسبوك للتحقق من الـ VERIFY_TOKEN أول مرة
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  }

  console.log("WEBHOOK_VERIFICATION_FAILED");
  return res.sendStatus(403);
});

/**
 * POST /webhook
 * هنا تجينا رسائل الواتساب الفعلية
 */
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // لو ما فيه رسائل، رجّع OK بس
    if (
      !body?.entry ||
      !body.entry[0]?.changes ||
      !body.entry[0].changes[0]?.value?.messages
    ) {
      return res.sendStatus(200);
    }

    const entry = body.entry[0];
    const changes = entry.changes[0];
    const value = changes.value;
    const messages = value.messages;
    const metadata = value.metadata;

    const msg = messages[0];
    const from = msg.from; // رقم الشخص اللي أرسل
    const text = msg.text?.body || "";

    const phoneNumberId = metadata.phone_number_id; // ID رقم الواتساب التجاري

    console.log("📩 رسالة من:", from, "النص:", text);

    // نرسل النص لـ OpenAI ونجيب رد ذكي
    const replyText = await generateAIReply(text);

    // نرسل الرد للواتساب
    await sendWhatsAppMessage(phoneNumberId, from, replyText);

    // لازم نرجّع 200 لواتساب
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in /webhook:", err);
    res.sendStatus(500);
  }
});

/**
 * دالة تتصل بـ OpenAI وترجع رد
 */
async function generateAIReply(userText) {
  try {
    if (!OPENAI_API_KEY) {
      console.warn("⚠️ OPENAI_API_KEY غير موجود في Environment");
      return "عذرًا، الخدمة غير مفعّلة حاليًا.";
    }

    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "أنت بوت واتساب ذكي، تجاوب باختصار وبأسلوب لطيف باللغة العربية.",
        },
        {
          role: "user",
          content: userText || "مرحبا",
        },
      ],
      max_output_tokens: 200,
    });

    const answer =
      completion.output[0].content[0].text || "لم أفهم سؤالك، حاول صياغته بشكل أوضح.";
    return answer;
  } catch (err) {
    console.error("❌ Error calling OpenAI:", err);
    return "واجهتني مشكلة أثناء معالجة سؤالك، حاول لاحقًا.";
  }
}

/**
 * دالة إرسال رسالة واتساب عبر Graph API
 */
async function sendWhatsAppMessage(phoneNumberId, to, text) {
  if (!WHATSAPP_TOKEN) {
    console.error("❌ WHATSAPP_TOKEN غير موجود في Environment");
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  console.log("📤 WhatsApp response:", data);

  if (!res.ok) {
    console.error("❌ Error sending WhatsApp message:", data);
  }
}

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
