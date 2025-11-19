// whatsapp.js
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import pino from "pino";
import OpenAI from "openai";

import { BOT_SYSTEM_PROMPT, shopConfig, supportPhones } from "./config.js";
import {
  getActiveSubscriptionByPhone,
  setBotPausedForPhone
} from "./db.js";

let sock = null;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().trim();
  p = p.replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "966" + p.slice(1);
  return p;
}

export async function sendWhatsAppMessage(phone, text) {
  if (!sock) {
    console.error("❌ WhatsApp socket غير جاهز بعد.");
    return;
  }
  const normalized = normalizePhone(phone);
  if (!normalized) return;

  const jid = `${normalized}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
}

async function askAI(userText) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: BOT_SYSTEM_PROMPT },
        { role: "user", content: userText }
      ]
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    return reply || "حصل خطأ بسيط، حاول تكتب سؤالك مرة ثانية 🙏";
  } catch (err) {
    console.error("❌ خطأ من OpenAI:", err?.response?.data || err.message);
    return "حصل خلل مؤقت في خدمة الذكاء الاصطناعي، حاول بعد قليل 🙏";
  }
}

async function notifySupportAboutCustomer(phone, lastMessage) {
  if (!supportPhones || supportPhones.length === 0) return;
  const text =
    `📢 عميل طلب خدمة العملاء.\n` +
    `رقم العميل: ${phone}\n` +
    (lastMessage
      ? `آخر رسالة من العميل:\n"${lastMessage}"`
      : "") +
    `\n\nادخل على واتساب من رقمك وتواصل معه مباشرة. (البوت متوقف حالياً لهذا العميل).`;

  for (const sp of supportPhones) {
    await sendWhatsAppMessage(sp, text);
  }
}

async function handleIncomingMessage(fromJid, text, fromMe = false) {
  const phone = fromJid.split("@")[0]; // 9665...
  const msg = (text || "").trim();
  const lower = msg.toLowerCase();

  // احنا نهتم فقط برسائل العملاء (fromMe = false)
  if (fromMe) {
    // تقدر مستقبلاً تسمح للموظف بكلمة خاصة ترجع البوت، لكن الآن نخلي التحكم من العميل نفسه فقط.
    return;
  }

  console.log("📩 رسالة من:", phone, "النص:", msg);

  // 1) أوامر "مساعدة" دائماً تشتغل حتى لغير المشترك (بس توضح له)
  if (
    msg === "مساعدة" ||
    msg === "HELP" ||
    lower === "help" ||
    lower === "menu" ||
    lower === "help me"
  ) {
    const sub = await getActiveSubscriptionByPhone(phone);
    if (!sub) {
      const reply =
        "هذا البوت مخصص فقط لعملاء *Smart Bot* المشتركين في باقات البوتات 🌟\n\n" +
        "للاشتراك أو التجديد، تفضل بزيارة المتجر:\n" +
        shopConfig.storeLink +
        "\n\n" +
        "🇬🇧 This bot is dedicated to *Smart Bot* subscribed customers.\n" +
        "To subscribe or renew, please visit our store link above.";
      return sendWhatsAppMessage(phone, reply);
    } else {
      const reply =
        "📋 *قائمة المساعدة – Smart Bot*\n\n" +
        "• اكتب سؤالك مباشرة عن أي شيء يخص البوتات والخدمات وسأجيبك بالذكاء الاصطناعي 🤖\n" +
        "• للتحويل إلى خدمة العملاء، اكتب: خدمة العملاء\n" +
        "• لإعادة تشغيل البوت بعد التحويل، اكتب: تشغيل البوت";
      return sendWhatsAppMessage(phone, reply);
    }
  }

  // 2) التحقق من أن عنده اشتراك نشط
  const sub = await getActiveSubscriptionByPhone(phone);
  if (!sub) {
    const reply =
      "مرحباً 👋\n" +
      "هذا البوت مخصص فقط لعملاء *Smart Bot* المشتركين في خدمات البوتات.\n\n" +
      "للاشتراك أو تجربة الخدمات، تفضل بزيارة المتجر:\n" +
      shopConfig.storeLink +
      "\n\n" +
      "🇬🇧 Hi! This bot serves *Smart Bot* subscribed customers only.\n" +
      "Please visit our store to subscribe.";
    return sendWhatsAppMessage(phone, reply);
  }

  // 3) أمر التحويل إلى خدمة العملاء
  if (
    msg.includes("خدمة العملاء") ||
    lower.includes("support") ||
    lower.includes("agent")
  ) {
    await setBotPausedForPhone(phone, true);

    const reply =
      "تم تحويلك إلى خدمة العملاء 👨‍💼👩‍💼\n" +
      "سيتوقف البوت عن الرد مؤقتاً حتى يخدمك أحد موظفينا.\n" +
      "إذا حاب ترجع للرد الآلي بالذكاء الاصطناعي، اكتب: تشغيل البوت";
    await sendWhatsAppMessage(phone, reply);

    await notifySupportAboutCustomer(phone, msg);
    return;
  }

  // 4) أمر إعادة تشغيل البوت
  if (
    msg.includes("تشغيل البوت") ||
    msg.includes("رجع البوت") ||
    lower.includes("resume bot") ||
    lower.includes("start bot")
  ) {
    await setBotPausedForPhone(phone, false);
    const reply =
      "تم إعادة تشغيل البوت 🤖✅\n" +
      "اكتب سؤالك الآن، وسأساعدك باستخدام الذكاء الاصطناعي.";
    await sendWhatsAppMessage(phone, reply);
    return;
  }

  // 5) لو البوت موقّف لهذا العميل
  if (sub.paused) {
    const reply =
      "أنت حالياً مع خدمة العملاء 👨‍💼👩‍💼\n" +
      "لن يقوم البوت بالرد حتى ينتهي تواصلك مع الموظف.\n" +
      "إذا حاب ترجع للرد الآلي بالذكاء الاصطناعي، اكتب: تشغيل البوت";
    await sendWhatsAppMessage(phone, reply);
    return;
  }

  // 6) الذكاء الاصطناعي للمشتركين فقط
  const aiReply = await askAI(msg);
  await sendWhatsAppMessage(phone, aiReply);
}

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  console.log("📦 Baileys version:", version);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true, // يطلع QR في الـ CMD عشان تربط الرقم مرة واحدة
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("🔵 امسح الـ QR من واتساب للجوال الأساسي:");
      console.log(qr);
    }
    if (connection === "open") {
      console.log("✅ تم الاتصال بواتساب بنجاح.");
    } else if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ الاتصال انقطع، السبب:", reason);
      if (reason !== DisconnectReason.loggedOut) {
        console.log("🔄 إعادة محاولة الاتصال...");
        startWhatsApp().catch(console.error);
      } else {
        console.log("تم تسجيل خروج الجوال من واتساب ويب، امسح QR من جديد.");
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
    if (!msg || !msg.message) return;

    const from = msg.key.remoteJid;
    const isFromMe = !!msg.key.fromMe;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.[Object.keys(msg.message)[0]]?.text ||
      "";

    await handleIncomingMessage(from, text, isFromMe);
  });
}
