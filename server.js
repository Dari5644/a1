// server.js
// بوت واتساب + OpenAI + تحويل لخدمة العملاء + تنبيه الموظفين + يدعم تغيير اسم المتجر من سطر واحد

import express from "express";
import axios from "axios";
import OpenAI from "openai";

// =========== إعدادات قابلة للتعديل بسرعة ===========

// غيّر اسم المتجر هنا
const STORE_NAME = "متجر الديم";

// غيّر اسم البوت هنا (لو حاب تستخدمه في الردود)
const BOT_NAME = "مساعد " + STORE_NAME;

// غيّر رابط المتجر هنا (لما العميل يطلب رابط المتجر)
const STORE_URL = "https://aldeem35.com/";

// غيّر الدومين حق لوحة البوت (لما يرسل رابط المحادثة للموظفين)
const PANEL_BASE_URL = "https://a1-9b9e.onrender.com"; // عدّله إذا غيّرت دومين Render

// أرقام خدمة العملاء اللي تجيهم رسالة لما يتم تحويل عميل (بدون +)
const AGENT_NUMBERS = [
  // مثال:
  // "9665XXXXXXXX",
];

// هل البوت مفعّل على الكل؟ (تقدر تغيّره لاحقاً من API إذا تبي)
let GLOBAL_BOT_ENABLED = true;

// =========== مفاتيح من env (لا تحطها داخل الكود) ===========
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mawaheb_verify";
const WABA_TOKEN = process.env.WABA_TOKEN; // من Meta
const PHONE_ID = process.env.PHONE_ID;     // phone_number_id من Meta
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // من OpenAI

if (!WABA_TOKEN || !PHONE_ID || !OPENAI_API_KEY) {
  console.warn("⚠️ تأكد من ضبط WABA_TOKEN و PHONE_ID و OPENAI_API_KEY في env");
}

const app = express();
app.use(express.json());

// =========== OpenAI ===========

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// =========== ذاكرة المحادثات ===========

// نحفظ المحادثة لكل عميل في الذاكرة
const conversations = {};         // { waId: [ {role:'user'|'assistant', content} ] }
const humanOnly = {};             // { waId: true/false } إذا true → ما يرد البوت
const waitingTransferConfirm = {}; // { waId: true/false } إذا true → ينتظر من العميل (ايه/لا)

// إضافة رسالة للذاكرة
function addMessage(waId, role, content) {
  if (!conversations[waId]) conversations[waId] = [];
  conversations[waId].push({ role, content });

  // نخلي الذاكرة قصيرة (آخر 20 رسالة فقط)
  if (conversations[waId].length > 20) {
    conversations[waId] = conversations[waId].slice(-20);
  }
}

// إرسال رسالة واتساب
async function sendWhatsAppMessage(to, text, tag = "bot") {
  if (!WABA_TOKEN || !PHONE_ID) {
    console.error("❌ مفقود WABA_TOKEN أو PHONE_ID");
    return;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WABA_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`✅ WhatsApp (${tag}) → ${to}: ${text}`);
  } catch (err) {
    console.error("🔥 WhatsApp SEND ERROR:", err.response?.data || err.message);
  }
}

// تنبيه أرقام خدمة العملاء برسالة + رابط المحادثة
async function notifyAgents(waId, lastText, customerName) {
  if (!AGENT_NUMBERS.length) {
    console.log("ℹ️ لا يوجد أرقام موظفين في AGENT_NUMBERS");
    return;
  }

  const link = `${PANEL_BASE_URL}/inbox?wa=${waId}`;

  const msg =
    `🚨 عميل تم تحويله لخدمة العملاء في ${STORE_NAME}.\n\n` +
    `👤 الاسم: ${customerName || "عميل"}\n` +
    `📞 الرقم: ${waId}\n\n` +
    `💬 آخر رسالة من العميل:\n${lastText}\n\n` +
    `🧷 افتح المحادثة من هنا:\n${link}`;

  for (const num of AGENT_NUMBERS) {
    await sendWhatsAppMessage(num, msg, "agent-alert");
  }
}

// استدعاء OpenAI للرد
async function getAssistantReply(waId, userText) {
  addMessage(waId, "user", userText);

  const history = (conversations[waId] || []).slice(-10);

  const messages = [
    {
      role: "system",
      content: `
أنت ${BOT_NAME}، مساعد دردشة ذكي يعمل لصالح "${STORE_NAME}".

القواعد:
- تتحدث بالعربية البسيطة وبأسلوب محترم وودود.
- إذا قال العميل "السلام عليكم" أو "هلا" أو "اهلا" أو "مرحبا" → رحّب به بعبارة مثل:
  "وعليكم السلام، حياك الله في ${STORE_NAME} ❤️🌹 كيف أقدر أخدمك؟"
- لا تعطي رابط المتجر إلا إذا طلبه العميل صراحة، وعندها استخدم هذا الرابط فقط:
  ${STORE_URL}
- إذا سأل عن المنتجات، اشرحها بشكل عام (نوع المنتج، استخدامه...) لكن لا تخترع بيانات مخزون أو حالة طلب.
- لا تذكر أسعار دقيقة إذا لم تكن متأكداً، بل قل له يمكنه التأكد من الأسعار من خلال المتجر.
- لا ترسل رسائل طويلة مزعجة؛ كن مختصراً وواضحاً.
- إذا سأل "وش تقدر تخدمني؟" اذكر باختصار أنك تساعده في الاستفسار عن المنتجات، المقاسات، طريقة الشراء، ورابط المتجر عند الطلب.
- لا تذكر أنك نموذج ذكاء اصطناعي، بل تحدث كأنك موظف افتراضي من فريق ${STORE_NAME}.
`,
    },
    ...history,
    { role: "user", content: userText },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.4,
  });

  const reply = completion.choices[0]?.message?.content || `حياك الله في ${STORE_NAME} 💚`;
  addMessage(waId, "assistant", reply);
  return reply;
}

// ============ Webhook GET (التحقق من Meta) ============
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  console.log("❌ WEBHOOK VERIFY FAILED");
  return res.sendStatus(403);
});

// ============ Webhook POST (استقبال رسائل واتساب) ============
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("📩 Incoming:", JSON.stringify(body, null, 2));

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(200);
  }

  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];
    if (!message || message.type !== "text") {
      return res.sendStatus(200);
    }

    const waId = message.from; // رقم العميل
    const text = message.text?.body || "";
    const lower = text.trim().toLowerCase();
    const customerName = value?.contacts?.[0]?.profile?.name || "عميل";

    if (!conversations[waId]) conversations[waId] = [];

    // ========== أوامر تحكم من العميل ==========
    // إعادة تشغيل البوت
    if (
      lower.includes("اعاده تشغيل البوت") ||
      lower.includes("اعادة تشغيل البوت") ||
      lower.includes("رجع البوت") ||
      lower.includes("شغل البوت")
    ) {
      humanOnly[waId] = false;
      waitingTransferConfirm[waId] = false;

      await sendWhatsAppMessage(
        waId,
        `تم إعادة تشغيل البوت في ${STORE_NAME} 🤖.\nتفضل، كيف أقدر أخدمك الآن؟`,
        "system"
      );
      return res.sendStatus(200);
    }

    // ========== تأكيد/رفض تحويله لخدمة العملاء ==========
    if (waitingTransferConfirm[waId]) {
      if (
        lower.includes("ايه") ||
        lower.includes("ايوه") ||
        lower.includes("ايوا") ||
        lower.includes("نعم") ||
        lower.includes("حولني") ||
        lower.includes("طيب حولني")
      ) {
        waitingTransferConfirm[waId] = false;
        humanOnly[waId] = true;

        await sendWhatsAppMessage(
          waId,
          `تم تحويلك لخدمة العملاء في ${STORE_NAME} 👨‍💼، انتظر وسيتم الرد عليك يدويًا.`,
          "system"
        );

        await notifyAgents(waId, text, customerName);
        return res.sendStatus(200);
      }

      if (
        lower.includes("لا") ||
        lower.includes("خلاص") ||
        lower.includes("مو لازم") ||
        lower.includes("كمل انت")
      ) {
        waitingTransferConfirm[waId] = false;

        await sendWhatsAppMessage(
          waId,
          "تمام، بكمل معك هنا كمساعد خدمة العملاء 😊",
          "bot"
        );
        // ونكمل معالجة الرسالة عادة
      }
    }

    // ========== طلب خدمة عملاء صريح ==========
    if (
      lower.includes("اكلم انسان") ||
      lower.includes("ابي انسان") ||
      lower.includes("خدمة عملاء") ||
      lower.includes("خدمه عملاء") ||
      lower.includes("موظف") ||
      lower.includes("اكلم موظف")
    ) {
      humanOnly[waId] = true;
      waitingTransferConfirm[waId] = false;

      await sendWhatsAppMessage(
        waId,
        `تم تحويلك مباشرة لخدمة العملاء في ${STORE_NAME} 👨‍💼، انتظر وسيتم الرد عليك يدويًا.`,
        "system"
      );

      await notifyAgents(waId, text, customerName);
      return res.sendStatus(200);
    }

    // ========== في وضع خدمة عملاء فقط → لا يرد البوت ==========
    if (humanOnly[waId]) {
      addMessage(waId, "user", text);
      console.log(`🙋‍♂️ ${waId} في وضع خدمة عملاء فقط، الموظف يرد من النظام.`);
      return res.sendStatus(200);
    }

    // ========== لو البوت عالميًا مطفي ==========
    if (!GLOBAL_BOT_ENABLED) {
      addMessage(waId, "user", text);
      console.log("⚪ البوت مطفي عالميًا، لا يتم الرد.");
      return res.sendStatus(200);
    }

    // ========== لو العميل متضايق / ما فهم ==========
    const frustrated =
      lower.includes("ما فهمت") ||
      lower.includes("مافهمت") ||
      lower.includes("ما فهمتك") ||
      lower.includes("غير واضح") ||
      lower.includes("مو واضح") ||
      lower.includes("غلط") ||
      lower.includes("مو كذا") ||
      lower.includes("ما فاد") ||
      lower.includes("ما فادني") ||
      lower.includes("ما استفدت") ||
      lower.includes("مو مفيد") ||
      lower.includes("هذا مو اللي ابيه");

    if (frustrated) {
      waitingTransferConfirm[waId] = true;

      await sendWhatsAppMessage(
        waId,
        "يبدو إن الموضوع يحتاج متابعة من موظف خدمة العملاء 👨‍💼.\n" +
          "تحب أنقلك لهم؟ إذا حاب رد بـ (ايه) أو (نعم)، وإذا تبي تكمل معي قل (لا).",
        "bot"
      );
      return res.sendStatus(200);
    }

    // ========== رد طبيعي من OpenAI ==========
    try {
      const reply = await getAssistantReply(waId, text);
      await sendWhatsAppMessage(waId, reply, "bot");
    } catch (err) {
      console.error("🔥 OpenAI ERROR:", err.response?.data || err.message);
      await sendWhatsAppMessage(
        waId,
        "واجهتني مشكلة تقنية بسيطة أثناء إنشاء الرد 🤖، حاول تكتب رسالتك مرة ثانية أو بعد قليل.",
        "error"
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 WEBHOOK HANDLER ERROR:", err.message);
    return res.sendStatus(500);
  }
});

// ============ API بسيط لتشغيل/إيقاف البوت عالميًا ============

// إيقاف البوت على الكل
app.post("/api/bot/disable", (req, res) => {
  GLOBAL_BOT_ENABLED = false;
  console.log("⛔ تم إيقاف البوت عالميًا");
  res.json({ ok: true, botEnabled: GLOBAL_BOT_ENABLED });
});

// تشغيل البوت على الكل
app.post("/api/bot/enable", (req, res) => {
  GLOBAL_BOT_ENABLED = true;
  console.log("✅ تم تشغيل البوت عالميًا");
  res.json({ ok: true, botEnabled: GLOBAL_BOT_ENABLED });
});

// صفحة بسيطة للتأكد
app.get("/", (req, res) => {
  res.send(`
    <html dir="rtl" lang="ar">
      <head><meta charset="utf-8" /><title>${STORE_NAME} - بوت الواتساب</title></head>
      <body style="font-family: system-ui; background:#f4f4f5; padding:20px;">
        <h2>بوت واتساب لـ ${STORE_NAME} شغال ✅</h2>
        <p>اسم البوت الحالي: <b>${BOT_NAME}</b></p>
        <p>رابط المتجر المستخدم في الردود: <a href="${STORE_URL}" target="_blank">${STORE_URL}</a></p>
        <p>حالة البوت العامة: <b>${GLOBAL_BOT_ENABLED ? "مفعّل" : "متوقف"}</b></p>
        <hr />
        <p>لتغيير الاسم أو الرابط، عدّل القيم في أعلى ملف <code>server.js</code>:</p>
        <pre>
const STORE_NAME = "${STORE_NAME}";
const STORE_URL  = "${STORE_URL}";
        </pre>
      </body>
    </html>
  `);
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
