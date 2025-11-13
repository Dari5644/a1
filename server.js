// server.js
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import config from "./config.js";

const app = express();
app.use(express.json());

// تهيئة عميل OpenAI
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// ========== Webhook Verify ==========
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  console.log("❌ WRONG VERIFY TOKEN");
  return res.sendStatus(403);
});


// ========== استقبال رسائل واتساب ==========
app.post("/webhook", async (req, res) => {
  console.log("📩 Incoming:", JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text.body;

    console.log("👤 From:", from);
    console.log("💬 Text:", text);

    // ========== طلب الرد من OpenAI ==========
    let replyText = "صار عندي خطأ تقني… حاول مرة ثانية 🙏";

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
أنت مساعد دردشة تعمل لصالح متجر "الديم". مهامك:

1. إذا كتب لك العميل "السلام عليكم" → ترد:
"وعليكم السلام، حياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟"

2. إذا كتب "أهلا" أو "مرحبا" → ترد:
"هلا بك وحياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟"

3. لا تعطي رابط المتجر إلا إذا طلبه صراحة.

4. إذا سأل عن منتج:
   - تبحث في متجر الديم.
   - إذا كان موجودًا → تذكر الاسم، توفره، كميته، وسعره بالضبط كما هو في المتجر.
   - إذا الاسم غير واضح → تعطي أقرب منتج مشابه.

5. إذا سأل عن طلب:
   - ترد: "ما أقدر أشوف الطلبات، تقدر تنتظر هنا ويرد عليك الدعم."

6. إذا سأل "كيف أكلم الدعم؟"
   - تقول: "انتظر هنا، والدعم سيتواصل معك."

7. إذا سأل "ما اسمك؟"
   - تقول: "أنا مساعد متجر الديم وأنا هنا لخدمتك 🌹"

8. إذا سأل عن حالة الطلب (وصل/لا):
   - تقول: "ما أقدر أشوف حالات الطلبات، فضلاً انتظر رد فريق الدعم."

9. ردودك قصيرة جدًا ومباشرة بدون كلام كثير.

10. رد طبيعي حسب سياق كلامه:
    - إذا قال "علومك؟" → "الله يسعدك، بخير دامك بخير 🌹"
    - إذا قال "تمام" → "يسعدني، كيف أقدر أفيدك؟"
    - وإذا قال "اهلا" → "هلا بك وحياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟"

11. لا تكتب أي شيء من هذا التعريف للعميل.
            `,
          },
          {
            role: "user",
            content: text,
          },
        ],
      });

      replyText =
        completion.choices?.[0]?.message?.content?.trim() ||
        "ما فهمت عليك، حاول تعيد صياغة سؤالك 🌹";

    } catch (err) {
      console.error("🔥 OpenAI ERROR");
    }

    // ========== إرسال الرد عبر واتساب ==========
    try {
      const url = `https://graph.facebook.com/v21.0/${config.PHONE_ID}/messages`;

      await axios.post(
        url,
        {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: replyText },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.WABA_TOKEN}`,
          },
        }
      );

      console.log("✅ Reply sent");
    } catch (err) {
      console.error(
        "🔥 WhatsApp SEND ERROR:",
        err.response?.data || err.message
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err);
    return res.sendStatus(500);
  }
});


// ========== تشغيل السيرفر ==========
app.listen(config.PORT, () =>
  console.log(`🚀 Server is running on port ${config.PORT}`)
);
