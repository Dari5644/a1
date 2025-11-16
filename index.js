// index.js
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@adiwajshing/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import OpenAI from "openai";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { STORE_CONFIG, BOT_SYSTEM_PROMPT, ZID_CONFIG } from "./config.js";

dotenv.config();

// ====== إعداد مسارات الملفات ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== OpenAI ======
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// ====== رقم صاحب البوت ======
const OWNER_NUMBER = (process.env.BOT_OWNER_NUMBER || "").replace(/\D/g, "");

// ====== توكن زد ======
const ZID_ACCESS_TOKEN = process.env.ZID_ACCESS_TOKEN || "";

// ====== متغيّرات عالمية ======
let waSock = null;
let waReady = false;

// تخزين الاشتراكات: { phone, type, productKey, months, expiresAt, lastOrderId }
let subscriptions = loadJson(ZID_CONFIG.SUBSCRIPTIONS_FILE, []);

// الطلبات المعالجة من زد
const processedOrders = new Set(
  loadJson(ZID_CONFIG.PROCESSED_ORDERS_FILE, []).map(String)
);

// حالة المحادثة: وضع البوت + أسئلة التأكيد
// state = { mode: 'bot' | 'human', pendingHumanConfirm: boolean, pendingBotConfirm: boolean }
const chatState = new Map();

// ====== دوال تخزين ======
function loadJson(filePath, defaultValue) {
  try {
    const fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) return defaultValue;
    const raw = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ خطأ في قراءة ${filePath}:`, err.message);
    return defaultValue;
  }
}

function saveJson(filePath, data) {
  try {
    const fullPath = path.join(__dirname, filePath);
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`❌ خطأ في حفظ ${filePath}:`, err.message);
  }
}

function saveSubscriptions() {
  saveJson(ZID_CONFIG.SUBSCRIPTIONS_FILE, subscriptions);
}

function saveProcessedOrders() {
  saveJson(ZID_CONFIG.PROCESSED_ORDERS_FILE, [...processedOrders]);
}

// ====== حالات المحادثة ======
function getChatState(jid) {
  if (!chatState.has(jid)) {
    chatState.set(jid, {
      mode: "bot",
      pendingHumanConfirm: false,
      pendingBotConfirm: false
    });
  }
  return chatState.get(jid);
}

// ====== دوال رقم الجوال ======
function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("00966")) p = p.slice(4);
  if (p.startsWith("9660")) p = "966" + p.slice(4);
  if (p.startsWith("05")) p = "966" + p.slice(1);
  if (/^5\d{8}$/.test(p)) p = "966" + p;
  if (!p.startsWith("966")) p = "966" + p;
  return p;
}

function phoneToJid(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return `${p}@s.whatsapp.net`;
}

// ====== اشتراكات ======
function getSubscription(phone, type = "whatsapp") {
  const p = normalizePhone(phone);
  if (!p) return null;
  const now = new Date();
  const sub = subscriptions.find(
    (s) => s.phone === p && s.type === type
  );
  if (!sub) return null;
  if (new Date(sub.expiresAt) < now) return null;
  return sub;
}

function upsertSubscription({ phone, type, months, productKey, orderId }) {
  const p = normalizePhone(phone);
  if (!p) return;

  const now = new Date();
  let start = now;
  let existing = subscriptions.find(
    (s) => s.phone === p && s.type === type
  );

  if (existing && new Date(existing.expiresAt) > now) {
    // مدّد من الانتهاء الحالي
    start = new Date(existing.expiresAt);
    subscriptions = subscriptions.filter(
      (s) => !(s.phone === p && s.type === type)
    );
  }

  const expires = new Date(start);
  expires.setMonth(expires.getMonth() + months);

  const newSub = {
    phone: p,
    type,
    productKey,
    months,
    lastOrderId: String(orderId),
    startsAt: start.toISOString(),
    expiresAt: expires.toISOString()
  };

  subscriptions.push(newSub);
  saveSubscriptions();
  return newSub;
}

// ====== أدوات نصية للبوت ======
function isGreeting(text = "") {
  const t = text.trim();
  return (
    t === "السلام عليكم" ||
    t === "سلام عليكم" ||
    t === "سلام" ||
    t === "هلا" ||
    t === "اهلا" ||
    t === "مرحبا"
  );
}

function containsAny(text, list) {
  const t = text.toLowerCase();
  return list.some((word) => t.includes(word.toLowerCase()));
}

function isYes(text = "") {
  const t = text.trim().toLowerCase();
  const yesWords = ["نعم", "اي", "ايه", "أيه", "ايوه", "أيوه", "يب", "تمام", "اوكي", "ok", "اوكيه"];
  return yesWords.some((w) => t.includes(w.toLowerCase()));
}

async function getAIReply(userText) {
  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: BOT_SYSTEM_PROMPT },
        { role: "user", content: userText }
      ],
      max_tokens: 200,
      temperature: 0.5
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    return reply || "تمام، كيف أقدر أخدمك؟";
  } catch (err) {
    console.error("🔥 OpenAI ERROR:", err.message);
    return "أواجه مشكلة تقنية بسيطة حالياً، جرّب تعيد رسالتك بعد شوي 🌹";
  }
}

// ====== رسالة عن عدم وجود اشتراك ======
function buildNoSubscriptionMessage() {
  return [
    "هلا 👋",
    "هذه خدمة بوت خاصة بعملاء *سمارت بوت – Smart Bot* اللي اشتروا باقة البوت.",
    "",
    "تقدر تطلب باقة البوت من الموقع ويتم تفعيلها على رقمك تلقائيًا:",
    STORE_CONFIG.storeUrl
  ].join("\n");
}

// ====== تحديد هل الطلب مدفوع في زد ======
function isOrderPaid(order) {
  // نحاول نغطي أكثر من حقل محتمل من زد
  const status =
    (order.financial_status || order.payment_status || order.status || "")
      .toString()
      .toLowerCase();

  const paidStatuses = [
    "paid",
    "تم الدفع",
    "paid_online",
    "completed",
    "مكتمل",
    "processing",
    "processing_payment"
  ];

  // لو فيه حقل total_due أو amount_due و > 0 نعتبره غير مدفوع
  const totalDue = Number(order.total_due || order.amount_due || 0);
  if (!status && totalDue > 0) return false;

  if (paidStatuses.some((s) => status.includes(s))) return true;

  // لو صفر مستحقات و فيه total > 0 نعتبره مدفوع
  const total = Number(order.total || order.total_price || 0);
  if (total > 0 && totalDue === 0) return true;

  return false;
}

// ====== ربط واتساب ويب (Baileys) ======
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log("📦 WA version:", version, "isLatest:", isLatest);

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    auth: state
  });

  waSock = sock;

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📲 امسح هذا الكود بواسطة واتساب للرقم 0561340876:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      waReady = true;
      console.log("✅ البوت متصل بنجاح من خلال واتساب ويب (Smart Bot).");
    } else if (connection === "close") {
      waReady = false;
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      console.log("❌ الاتصال انقطع، shouldReconnect =", shouldReconnect);
      if (shouldReconnect) {
        startWhatsApp();
      } else {
        console.log("تم تسجيل الخروج من واتساب، احذف مجلد auth وأعد التشغيل.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // استقبال الرسائل
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        const from = msg.key.remoteJid;
        const fromMe = msg.key.fromMe;
        const isGroup = from.endsWith("@g.us");
        if (isGroup) continue;

        const rawText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          "";

        const text = rawText.trim();
        if (!text) continue;

        console.log("📩 رسالة من:", from, "النص:", text);

        const normalizedFrom = from.replace(/\D/g, "");
        const isOwner =
          OWNER_NUMBER && normalizedFrom.endsWith(OWNER_NUMBER);

        const state = getChatState(from);

        // ====== رسائل المالك (أنت) ======
        if (fromMe && isOwner) {
          // لو كتبت جملة فيها كلمات رجوع البوت (مثلاً: "اخليك مع البوت")
          if (containsAny(text, STORE_CONFIG.botResumeKeywords)) {
            // نجهز البوت ينتظر موافقة العميل
            state.pendingBotConfirm = true;
            state.pendingHumanConfirm = false;
            chatState.set(from, state);
            console.log("⏳ بانتظار موافقة العميل لإرجاع البوت في هذه المحادثة.");
          }
          // ما نرد عليك كمالك من البوت
          continue;
        }

        // ====== رسائل العميل ======
        const clientPhone = normalizedFrom;

        // تحقق الاشتراك (للبوت واتساب)
        const sub = getSubscription(clientPhone, "whatsapp");
        if (!sub) {
          const msgNoSub = buildNoSubscriptionMessage();
          await sock.sendMessage(from, { text: msgNoSub });
          continue;
        }

        // 1) لو كنا ننتظر موافقة "خدمة العملاء؟"
        if (state.pendingHumanConfirm) {
          if (isYes(text)) {
            // تحويل لخدمة العملاء
            state.mode = "human";
            state.pendingHumanConfirm = false;
            chatState.set(from, state);

            await sock.sendMessage(from, {
              text: STORE_CONFIG.humanTransferMessage
            });
          } else {
            // ما يبغى خدمة عملاء -> نرجع لوضع البوت ونكمّل عادي
            state.mode = "bot";
            state.pendingHumanConfirm = false;
            chatState.set(from, state);

            const reply = await getAIReply(text);
            await sock.sendMessage(from, { text: reply });
          }
          continue;
        }

        // 2) لو كنا ننتظر موافقة "رجوع للبوت" بعد ما الموظف قال له "اخليك مع البوت؟"
        if (state.pendingBotConfirm) {
          if (isYes(text)) {
            state.mode = "bot";
            state.pendingBotConfirm = false;
            chatState.set(from, state);

            await sock.sendMessage(from, {
              text: "تم إرجاعك للبوت الذكي (Smart Bot) 🤖✨"
            });
          } else {
            // رفض يرجع للبوت
            state.mode = "human";
            state.pendingBotConfirm = false;
            chatState.set(from, state);

            await sock.sendMessage(from, {
              text: "تمام، راح نكمّل مع خدمة العملاء 🌹"
            });
          }
          continue;
        }

        // 3) لو العميل طلب خدمة عملاء (بدون ما نكون في وضع تأكيد)
        if (containsAny(text, STORE_CONFIG.humanKeywords)) {
          state.pendingHumanConfirm = true;
          state.pendingBotConfirm = false;
          chatState.set(from, state);

          await sock.sendMessage(from, {
            text:
              "واضح يمكن جوابي ما كان كافي 😊\nتحب أحوّلك على خدمة العملاء؟ اكتب نعم أو لا."
          });
          continue;
        }

        // 4) لو المحادثة في وضع "خدمة عملاء" -> البوت ما يرد
        if (state.mode === "human") {
          console.log("👤 المحادثة حالياً عند خدمة العملاء، البوت ساكت.");
          continue;
        }

        // 5) أول رسالة تحية
        if (isGreeting(text)) {
          await sock.sendMessage(from, {
            text: STORE_CONFIG.welcomeReply
          });
          continue;
        }

        // 6) رد بالذكاء الاصطناعي
        const reply = await getAIReply(text);
        await sock.sendMessage(from, { text: reply });
      } catch (err) {
        console.error("❌ ERROR in message handler:", err);
      }
    }
  });
}

// ====== زد: جلب الطلبات الجديدة ومعالجتها ======
async function fetchNewZidOrders() {
  if (!ZID_ACCESS_TOKEN) return [];

  try {
    const url = `${ZID_CONFIG.API_BASE}/managers/store/orders`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${ZID_ACCESS_TOKEN}`,
        "Accept-Language": "ar"
      },
      params: {
        per_page: 30,
        sort: "-created_at"
      }
    });

    const orders = res.data?.orders || res.data?.data || [];
    // نرجع الطلبات اللي ما عالجناها بعد
    return orders.filter((o) => !processedOrders.has(String(o.id)));
  } catch (err) {
    console.error(
      "❌ خطأ في الاتصال بزد:",
      err.response?.data || err.message
    );
    return [];
  }
}

// معرفة نوع البوت من عناصر الطلب
function detectProductKey(order) {
  const items = order.items || order.order_items || [];
  const entries = Object.entries(ZID_CONFIG.PRODUCTS);

  for (const item of items) {
    const pid = String(item.product_id || item.sku || "").trim();
    if (!pid) continue;
    const match = entries.find(
      ([, p]) => String(p.zidProductId) === pid
    );
    if (match) return match[0]; // productKey
  }

  return null;
}

// استخراج رقم العميل من الطلب
function extractOrderPhone(order) {
  const phone =
    order.customer?.phone ||
    order.customer?.mobile ||
    order.billing_address?.phone ||
    order.shipping_address?.phone;
  return normalizePhone(phone);
}

// رسالة تفعيل يرسلها البوت للعميل بعد الشراء
function buildActivationMessage(sub, product) {
  const exp = new Date(sub.expiresAt);
  const expDate = exp.toLocaleDateString("ar-SA");

  return [
    `حياك الله في ${STORE_CONFIG.storeName} 🌹`,
    "",
    `تم تفعيل باقتك: ${product.label}`,
    `مدة الاشتراك: ${sub.months} شهر/أشهر.`,
    `تاريخ انتهاء الاشتراك: ${expDate}`,
    "",
    "من الآن البوت بيخدمك على هذا الرقم في الواتساب 🤖.",
    "",
    `رابط الموقع: ${STORE_CONFIG.storeUrl}`
  ].join("\n");
}

// حلقة معالجة طلبات زد
async function processZidOrdersLoop() {
  if (!ZID_ACCESS_TOKEN) {
    console.log("⏭️ لا يوجد ZID_ACCESS_TOKEN – تعطيل ربط زد");
    return;
  }

  console.log(
    "🔁 بدء فحص طلبات زد كل",
    ZID_CONFIG.POLL_INTERVAL_MS / 1000,
    "ثانية"
  );

  const run = async () => {
    try {
      const newOrders = await fetchNewZidOrders();
      if (!newOrders.length) return;

      for (const order of newOrders) {
        const id = String(order.id);

        // ✅ هنا الشرط اللي طلبته: لازم الطلب يكون "مدفوع" في قاعدة بيانات زد
        if (!isOrderPaid(order)) {
          console.log(`⏳ الطلب ${id} غير مدفوع بعد، لن يتم تفعيل البوت.`);
          // ما نعلّمه processed عشان إذا تغيّر لحالة مدفوعة نلتقطه في المرة الجاية
          continue;
        }

        const productKey = detectProductKey(order);

        if (!productKey) {
          // ليس منتج بوت -> نعلّم الطلب كمُعالَج ونمشي
          processedOrders.add(id);
          continue;
        }

        const product = ZID_CONFIG.PRODUCTS[productKey];
        const phone = extractOrderPhone(order);

        if (!phone) {
          console.warn(
            `⚠️ لم يتم العثور على رقم جوال للطلب ${id} لمنتج بوت`
          );
          processedOrders.add(id);
          continue;
        }

        // تحديث/إنشاء اشتراك
        const sub = upsertSubscription({
          phone,
          type: "whatsapp", // البوت الحالي واتساب فقط
          months: product.months,
          productKey,
          orderId: id
        });

        // إرسال رسالة تفعيل لو واتساب وجاهز
        if (waReady && waSock) {
          const jid = phoneToJid(phone);
          if (jid) {
            const msg = buildActivationMessage(sub, product);
            await waSock.sendMessage(jid, { text: msg });
            console.log(
              `✅ تم إرسال رسالة تفعيل بوت (${product.type}) للطلب ${id} على الرقم ${phone}`
            );
          }
        }

        processedOrders.add(id);
      }

      saveProcessedOrders();
    } catch (err) {
      console.error("❌ خطأ عام في حلقة زد:", err.message);
    }
  };

  // تشغيل أول مرة
  await run();
  // تكرار
  setInterval(run, ZID_CONFIG.POLL_INTERVAL_MS);
}

// ====== تشغيل البوت ======
(async () => {
  await startWhatsApp();
  await processZidOrdersLoop();
})();
