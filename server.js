// server.js
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import config from "./config.js";

const app = express();
app.use(express.json());

// عميل OpenAI – يقرأ المفتاح من الـ ENV عبر config.OPENAI_API_KEY
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// مسار بسيط للتجربة
app.get("/", (req, res) => {
  res.send("✅ WhatsApp AI Bot is running");
});


// ✅ Webhook Verify (GET /webhook)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === config.VERIFY_TOKEN) {
    console.log("✅ WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  }

  console.log("❌ WEBHOOK_VERIFICATION_FAILED");
  return res.sendStatus(403);
});


// ✅ استقبال رسائل واتساب (POST /webhook)
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Incoming:", JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") {
      // لا يوجد رسالة نصية، نرد 200 فقط
      return res.sendStatus(200);
    }

    const from = message.from;              // رقم المرسل
    const text = message.text?.body || "";  // نص الرسالة

    console.log(`👤 From: ${from}`);
    console.log(`💬 Text: ${text}`);

    // نص الرد الافتراضي في حال حدث خطأ
    let replyText = "حدث خطأ تقني، حاول مرة أخرى لاحقًا.";

    if (!config.OPENAI_API_KEY) {
      console.error("❌ لا يوجد OPENAI_API_KEY في البيئة (ENV)");
      replyText = "البوت غير مهيأ بشكل كامل (مفتاح الذكاء الاصطناعي غير موجود).";
    } else {
      try {
        // استدعاء نموذج GPT للرد بالعربية
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "أنت مساعد ذكي ترد باللغة العربية بأسلوب مختصر وواضح، وتساعد المستخدم في فهم ما يطلبه.",
            },
            {
              role: "user",
              content: text,
            },
          ],
        });

        replyText =
          completion.choices?.[0]?.message?.content?.trim() ||
          "لم أتمكن من توليد رد، حاول كتابة سؤالك بشكل أوضح.";
      } catch (err) {
        console.error(
          "🔥 OpenAI ERROR:",
          err.response?.data || err.message || err
        );
        replyText =
          "حصل خطأ في خدمة الذكاء الاصطناعي، حاول مرة أخرى بعد قليل.";
      }
    }

    // إرسال الرد عبر WhatsApp Cloud API
    try {
      const url = `https://graph.facebook.com/v21.0/${config.PHONE_ID}/messages`;

      const payload = {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: replyText,
        },
      };

      await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.WABA_TOKEN}`,
        },
      });

      console.log("✅ Reply sent to user");
    } catch (err) {
      console.error(
        "🔥 WhatsApp SEND ERROR:",
        err.response?.data || err.message || err
      );
    }

    // لازم دايم نرجع 200 عشان واتساب ما تعيد الإرسال
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    return res.sendStatus(500);
  }
});


// 🚀 تشغيل السيرفر
app.listen(config.PORT, () => {
  console.log(`🚀 Server running on port ${config.PORT}`);
});
