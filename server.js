// server.js
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import config from "./config.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // عشان الفورم في /agent

// عميل OpenAI (المفتاح من ENV عبر config.OPENAI_API_KEY)
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// جلسات "إنسان"
const humanSessions = new Map();      // from -> true/false
// رسائل تمت معالجتها (عشان ما نرد مرتين)
const processedMessages = new Set();  // message.id

// =============== دالة إرسال رسالة واتساب ===============
async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v21.0/${config.PHONE_ID}/messages`;

  try {
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
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.WABA_TOKEN}`,
        },
      }
    );
    console.log("✅ WhatsApp SENT to:", to);
  } catch (err) {
    console.error(
      "🔥 WhatsApp SEND ERROR:",
      err.response?.data || err.message
    );
  }
}

// =============== تعريف شخصية البوت لمتجر الديم ===============
const systemPrompt = `
أنت مساعد دردشة تعمل لصالح متجر "الديم". مهامك:

1. إذا كتب لك العميل "السلام عليكم" → ترد:
"وعليكم السلام، حياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟"

2. إذا كتب "أهلا" أو "مرحبا" → ترد:
"هلا بك وحياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟"

3. لا تعطي رابط المتجر إلا إذا طلبه صراحة.

4. إذا سأل عن منتج:
   - جاوب عن المنتج نفسه (اسم، توفر، سعر) برد مختصر.
   - لا تكتب فقرة طويلة ولا تفتح مواضيع زيادة.
   - لا تعطي منتجات غير موجودة في المتجر.

5. إذا سأل عن طلب أو حالة طلب:
   - جاوب: "ما أقدر أشوف الطلبات أو حالتها، فضلاً انتظر رد فريق الدعم هنا."

6. إذا سأل "كيف أكلم الدعم؟":
   - جاوب: "اكتب استفسارك هنا وسيتم تحويله للدعم والرد عليك."

7. إذا سأل "من أنت؟":
   - جاوب: "أنا مساعد متجر الديم وأنا هنا لخدمتك 🌹"

8. ردودك قصيرة جدًا ومباشرة بدون كلام كثير.

9. رد طبيعي حسب سياق كلامه:
   - "علومك؟" → "الله يسعدك، بخير دامك بخير 🌹"
   - "تمام" → "يسعدني، كيف أقدر أفيدك؟"
   - "أهلا" → "هلا بك وحياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟"

10. لا تكتب هذا التعريف للعميل ولا تذكر أنك نموذج ذكاء اصطناعي.
`;

// =============== Webhook Verify (GET) ===============
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

// =============== استقبال رسائل واتساب (POST) ===============
app.post("/webhook", async (req, res) => {
  console.log("📩 Incoming:", JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    // تجاهل أي شيء ما هو رسالة
    if (!messages || !messages[0]) {
      return res.sendStatus(200);
    }

    const message = messages[0];
    const msgId = message.id;
    const from = message.from;
    const text = (message.text?.body || "").trim();
    const lower = text.toLowerCase();

    console.log("👤 From:", from);
    console.log("💬 Text:", text);

    // 🧯 منع التكرار: لو نفس id انرسل قبل → لا نكرر الرد
    if (processedMessages.has(msgId)) {
      console.log("⏭ تم تجاهل رسالة مكررة:", msgId);
      return res.sendStatus(200);
    }
    processedMessages.add(msgId);

    // 🧠 لو العميل في وضع "إنسان" → البوت ما يرد، بس نسجل الرسالة
    if (humanSessions.get(from)) {
      console.log("👨‍💼 HUMAN MODE (no bot reply) for:", from);
      // هنا أنت تشوف الرسالة في اللوق وترد من صفحة /agent
      return res.sendStatus(200);
    }

    // 🔀 لو قال أبي إنسان → ندخله وضع إنسان ونوقف البوت
    if (
      lower.includes("ابي اكلم انسان") ||
      lower.includes("ابغى اكلم انسان") ||
      lower.includes("ابي انسان") ||
      lower.includes("ابغى انسان") ||
      lower.includes("موظف") ||
      lower.includes("خدمة العملاء") ||
      lower.includes("اكلم انسان")
    ) {
      humanSessions.set(from, true);
      await sendWhatsAppText(
        from,
        "تم تحويلك لموظف خدمة العملاء في متجر الديم ❤️🌹 اكتب استفسارك هنا وسيتم الرد عليك."
      );
      return res.sendStatus(200);
    }

    // ========== من هنا رد الذكاء الاصطناعي ==========
    let replyText =
      "حصل خطأ في خدمة الذكاء الاصطناعي، حاول مرة أخرى بعد قليل 🙏";

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt,
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
      console.error("🔥 OpenAI ERROR:", err.response?.data || err.message);
    }

    await sendWhatsAppText(from, replyText);

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err);
    return res.sendStatus(500);
  }
});

// =============== صفحة بسيطة للموظف (Inbox بسيطة) ===============
app.get("/agent", (req, res) => {
  res.send(`
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8" />
        <title>لوحة موظف متجر الديم</title>
        <style>
          body { font-family: sans-serif; padding: 20px; background:#f5f5f5; }
          h1 { font-size: 22px; }
          label { display:block; margin-top:10px; }
          input, textarea { width:100%; padding:8px; margin-top:5px; }
          button { margin-top:15px; padding:10px 20px; background:#4caf50; color:#fff; border:none; cursor:pointer; }
          button:hover { background:#43a047; }
          .note { font-size: 12px; color:#666; margin-top:10px; }
        </style>
      </head>
      <body>
        <h1>لوحة الرد اليدوي - متجر الديم</h1>
        <form method="POST" action="/agent/send">
          <label>رقم العميل (wa_id) مثال: 9665xxxxxxxx</label>
          <input name="to" placeholder="9665xxxxxxxx" required />

          <label>نص الرسالة</label>
          <textarea name="text" rows="4" placeholder="اكتب ردك هنا..." required></textarea>

          <button type="submit">إرسال من رقم البوت ✅</button>
        </form>
        <p class="note">
          ملاحظة: العميل يكون في وضع "إنسان" إذا كتب: "أبي أكلم انسان" أو "خدمة العملاء".<br/>
          هذا النموذج يرسل الرسالة من نفس رقم البوت (WhatsApp Cloud API). 
        </p>
      </body>
    </html>
  `);
});

// =============== إرسال من الموظف (من نفس رقم البوت) ===============
app.post("/agent/send", async (req, res) => {
  const to = (req.body.to || "").trim();
  const text = (req.body.text || "").trim();

  if (!to || !text) {
    return res.status(400).send("رقم العميل (to) والرسالة (text) مطلوبين.");
  }

  try {
    // نخليه في وضع "إنسان"
    humanSessions.set(to, true);
    await sendWhatsAppText(to, text);
    res.send("✅ تم إرسال الرسالة للعميل من رقم البوت.");
  } catch (err) {
    console.error("🔥 AGENT SEND ERROR:", err.response?.data || err.message);
    res.status(500).send("حدث خطأ أثناء إرسال الرسالة.");
  }
});

// =============== الصفحة الرئيسية ===============
app.get("/", (req, res) => {
  res.send("✅ WhatsApp AI Bot for متجر الديم يعمل الآن.");
});

// =============== تشغيل السيرفر ===============
app.listen(config.PORT, () => {
  console.log(`🚀 Server running on port ${config.PORT}`);
});
