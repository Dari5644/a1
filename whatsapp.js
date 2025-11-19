// whatsapp.js
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import pino from "pino";
import { shopConfig } from "./config.js";
import { getActiveSubscriptionByPhone } from "./db.js";

// لو حاب تستخدم OpenAI مستقبلاً، تقدر تضيفه هنا
 import OpenAI from "openai";
 import { BOT_SYSTEM_PROMPT } from "./config.js";

let sock = null;

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

async function handleIncomingMessage(fromJid, text) {
  const phone = fromJid.split("@")[0]; // 9665...
  const msg = (text || "").trim();

  console.log("📩 رسالة من:", phone, "النص:", msg);

  // 🔹 أوامر "مساعدة"
  const lower = msg.toLowerCase();
  if (
    lower === "مساعدة" ||
    lower === "help" ||
    lower === "menu" ||
    lower === "help me"
  ) {
    const sub = await getActiveSubscriptionByPhone(phone);
    if (!sub) {
      const reply =
        "هذا البوت مخصص لعملاء Smart Bot المشتركين في خدمات البوتات 🌟\n\n" +
        "للاشتراك أو التجديد، تفضل بزيارة المتجر:\n" +
        shopConfig.storeLink +
        "\n\n" +
        "🇬🇧 This bot is dedicated to *Smart Bot* customers only.\n" +
        "To subscribe or renew, please visit our store link above.";
      return sendWhatsAppMessage(phone, reply);
    } else {
      const reply =
        "📋 *قائمة المساعدة – Smart Bot*\n\n" +
        "1️⃣ لمعرفة حالة البوت: اكتب `حالة البوت`\n" +
        "2️⃣ لإيقاف الرد الآلي مؤقتاً: اكتب `إيقاف البوت`\n" +
        "3️⃣ لإعادة تشغيل البوت: اكتب `تشغيل البوت`\n" +
        "4️⃣ للتحويل إلى خدمة العملاء: اكتب `خدمة العملاء`\n\n" +
        "🇬🇧 *Help Menu – Smart Bot*\n" +
        "- Bot status: type `status`\n" +
        "- Pause bot: type `pause`\n" +
        "- Resume bot: type `resume`\n" +
        "- Human support: type `agent`";
      return sendWhatsAppMessage(phone, reply);
    }
  }

  // 🔹 غير مشترك – يذكّره إن البوت لعملاء Smart Bot فقط
  const sub = await getActiveSubscriptionByPhone(phone);
  if (!sub) {
    const reply =
      "مرحباً 👋\n" +
      "هذا البوت يخدم عملاء *Smart Bot* المشتركين في باقات البوتات.\n\n" +
      "للاشتراك أو تجربة الخدمات، تفضل بزيارة المتجر:\n" +
      shopConfig.storeLink +
      "\n\n" +
      "🇬🇧 Hi! This bot serves *Smart Bot* subscribed customers only.\n" +
      "Please visit our store to subscribe.";
    return sendWhatsAppMessage(phone, reply);
  }

  // 🔹 هنا منطق الذكاء الاصطناعي / الردود المتقدمة
  // الآن نخليه رد بسيط، وتقدر لاحقاً تشبك OpenAI هنا:
  const reply =
    "شكرًا لتواصلك مع Smart Bot 🤖\n" +
    "يمكنني مساعدتك في الاستفسار عن خدمات البوتات أو إعدادها.\n" +
    "اكتب كلمة *مساعدة* لرؤية قائمة الأوامر.";
  await sendWhatsAppMessage(phone, reply);

  // مثال لو ربطت OpenAI مستقبلاً:
  
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: BOT_SYSTEM_PROMPT },
      { role: "user", content: msg }
    ]
  });
  const aiReply = completion.choices[0]?.message?.content?.trim();
  if (aiReply) {
    await sendWhatsAppMessage(phone, aiReply);
  }
  
}

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");

  const { version } = await fetchLatestBaileysVersion();
  console.log("📦 Baileys version:", version);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true, // يطبع QR في الـ CMD
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("🔵 امسح الـ QR هذا من واتساب بالجوال:");
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
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid; // 9665...@s.whatsapp.net
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.[Object.keys(msg.message)[0]]?.text ||
      "";

    await handleIncomingMessage(from, text);
  });
}
