// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// 🟢 متغيرات البيئة المطلوبة من Render
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;        // مثال: smartbot
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN; // التوكن الطويل من Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;  // مثال: 872960125902853

if (!VERIFY_TOKEN) console.warn("⚠️ VERIFY_TOKEN غير مضبوط في متغيرات البيئة");
if (!META_ACCESS_TOKEN) console.warn("⚠️ META_ACCESS_TOKEN غير مضبوط في متغيرات البيئة");
if (!PHONE_NUMBER_ID) console.warn("⚠️ PHONE_NUMBER_ID غير مضبوط في متغيرات البيئة");

// دالة إرسال رسالة عبر WhatsApp Cloud API
async function sendWhatsAppMessage(toWaId, text) {
  try {
    const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: toWaId,           // رقم العميل مثل: 9665XXXXXXX
      type: "text",
      text: {
        preview_url: false,
        body: text,
      },
    };

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    console.log("✅ تم إرسال رسالة إلى:", toWaId, "message_id:", res.data.messages?.[0]?.id);
  } catch (err) {
    console.error("❌ خطأ في إرسال رسالة عبر Meta:", err.response?.data || err.message);
  }
}

// 1) Webhook GET (للتحقق من ميتا)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("📡 Webhook GET:", mode, token);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ تم التحقق من Webhook بنجاح من Meta");
    return res.status(200).send(challenge);
  }

  console.warn("❌ فشل تحقق Webhook (Verify)");
  return res.sendStatus(403);
});

// 2) Webhook POST (استقبال رسائل الواتساب والرد عليها)
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔥🔥 وصلني Webhook من Meta (POST /webhook) 🔥🔥");
    console.log("BODY:", JSON.stringify(req.body, null, 2));

    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;
      const contacts = value?.contacts;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const fromWaId = msg.from; // رقم العميل مثل 9665XXXXXX
        let incomingText = "";

        if (msg.type === "text") {
          incomingText = msg.text?.body || "";
        } else {
          incomingText = `[رسالة من نوع ${msg.type}]`;
        }

        console.log("📩 رسالة من:", fromWaId, "النص:", incomingText);

        // 🔁 هنا نحدد الرد
        let replyText = "";

        // لو كتب خدمة العملاء
        const lower = incomingText.toLowerCase();
        if (
          incomingText.includes("خدمة العملاء") ||
          lower.includes("support") ||
          lower.includes("agent")
        ) {
          replyText =
            "تم تحويل طلبك لخدمة العملاء 👨‍💼👩‍💼\n" +
            "سنخدمك في أقرب وقت ممكن.\n" +
            "للالتواصل لاحقًا، اكتب أي رسالة جديدة.";
        } else {
          // رد افتراضي بسيط
          replyText =
            "هلا 👋\n" +
            "وصلتني رسالتك:\n" +
            incomingText +
            "\n\n" +
            "🔹 هذا رد تجريبي من Smart Bot عبر Meta.\n" +
            "اكتب: خدمة العملاء للتحويل لموظف.";
        }

        // إرسال الرد
        await sendWhatsAppMessage(fromWaId, replyText);
      }
    }

    // مهم: رد 200 عشان ميتا ما تعيد الطلب
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook POST error:", err);
    res.sendStatus(500);
  }
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log("🚀 Smart Bot Meta – يعمل على المنفذ " + PORT);
  console.log("📡 Webhook على /webhook جاهز.");
});
