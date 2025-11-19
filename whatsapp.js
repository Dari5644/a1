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

// =========================
//  GLOBAL
// =========================
let sock = null;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =========================
// NORMALIZE PHONE
// =========================
function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().trim();
  p = p.replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "966" + p.slice(1);
  return p;
}

// =========================
// SEND WHATSAPP MESSAGE
// =========================
export async function sendWhatsAppMessage(phone, text) {
  if (!sock) {
    console.error("❌ WhatsApp socket غير جاهز بعد.");
    return;
  }

  const normalized = normalizePhone(phone);
  if (!normalized) return;

  const jid = `${normalized}@s.whatsapp.net`;

  // هل هو كود طويل؟ → نحوله QR تلقائياً
  const isProbablyCode =
    typeof text === "string" &&
    text.startsWith("2@") &&
    text.length > 50 &&
    text.includes("=") &&
    text.includes(",");

  if (isProbablyCode) {
    try {
      const qrUrl =
        "https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=" +
        encodeURIComponent(text);

      await sock.sendMessage(jid, {
        image: { url: qrUrl },
        caption: "📦 هذا هو باركود الاستلام 👇"
      });

      return;
    } catch (err) {
      console.error("❌ فشل إرسال صورة الباركود:", err);
    }
  }

  // إرسال نص عادي
  await sock.sendMessage(jid, { text });
}

// =========================
// ASK AI
// =========================
async function askAI(userText) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: BOT_SYSTEM_PROMPT },
        { role: "user", content: userText }
      ]
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ||
      "حدث خطأ بسيط، حاول مرة ثانية 🙏"
    );
  } catch (err) {
    console.error("❌ خطأ OpenAI:", err);
    return "حصل خلل مؤقت في خدمة الذكاء الاصطناعي.";
  }
}

// =========================
// SUPPORT NOTIFY
// =========================
async function notifySupportAboutCustomer(phone, lastMessage) {
  if (!supportPhones || supportPhones.length === 0) return;

  const msg =
    `📢 عميل طلب خدمة العملاء.\n` +
    `رقم العميل: ${phone}\n` +
    (lastMessage ? `آخر رسالة:\n"${lastMessage}"` : "") +
    `\n\nتواصل معه الآن، البوت موقّف لهذا العميل.`;

  for (const sp of supportPhones) {
    await sendWhatsAppMessage(sp, msg);
  }
}

// =========================
// HANDLE INCOMING
// =========================
async function handleIncomingMessage(fromJid, text, fromMe = false) {
  const phone = fromJid.split("@")[0];
  const msg = (text || "").trim();
  const lower = msg.toLowerCase();

  if (fromMe) return;

  console.log("📩 رسالة من:", phone, "→", msg);

  // 1) أمر "مساعدة"
  if (
    msg === "مساعدة" ||
    msg === "HELP" ||
    lower === "help" ||
    lower === "menu"
  ) {
    const sub = await getActiveSubscriptionByPhone(phone);

    if (!sub) {
      return sendWhatsAppMessage(
        phone,
        `هذا البوت مخصص فقط لعملاء Smart Bot.\nللاشتراك:\n${shopConfig.storeLink}`
      );
    }

    return sendWhatsAppMessage(
      phone,
      "📋 قائمة المساعدة:\n• الذكاء الاصطناعي\n• خدمة العملاء\n• تشغيل البوت"
    );
  }

  // 2) اشتراك؟
  const sub = await getActiveSubscriptionByPhone(phone);

  if (!sub) {
    return sendWhatsAppMessage(
      phone,
      `مرحباً 👋\nهذا البوت مخصص فقط لعملاء Smart Bot.\nرابط المتجر:\n${shopConfig.storeLink}`
    );
  }

  // 3) توقف البوت
  if (
    msg.includes("خدمة العملاء") ||
    lower.includes("support") ||
    lower.includes("agent")
  ) {
    await setBotPausedForPhone(phone, true);

    await sendWhatsAppMessage(
      phone,
      "تم تحويلك إلى خدمة العملاء.\nاكتب: تشغيل البوت للرجوع."
    );

    await notifySupportAboutCustomer(phone, msg);
    return;
  }

  // 4) تشغيل البوت
  if (
    msg.includes("تشغيل البوت") ||
    lower.includes("resume") ||
    lower.includes("start bot")
  ) {
    await setBotPausedForPhone(phone, false);
    return sendWhatsAppMessage(
      phone,
      "تم تشغيل البوت.\nاكتب سؤالك الآن 🤖."
    );
  }

  // 5) البوت موقّف
  if (sub.paused) {
    return sendWhatsAppMessage(
      phone,
      "أنت حالياً مع خدمة العملاء.\nاكتب: تشغيل البوت للرجوع."
    );
  }

  // 6) ذكاء اصطناعي
  const aiReply = await askAI(msg);
  await sendWhatsAppMessage(phone, aiReply);
}

// =========================
// START WHATSAPP
// =========================
export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  console.log("🚀 Baileys version:", version);

  sock = makeWASoc
