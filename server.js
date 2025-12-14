// server.js (FULL)
// Meta Cloud API + WhatsApp-like panel + AI replies + Customer Service mode + Strong logs + Debug tools

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

import {
  db,
  initDb,
  getSetting,
  setSetting,
  getContacts,
  getMessagesByContact,
  deleteContact,
  setBotPausedForContactId,
  upsertContact,
  getContactByWaId,
  insertMessage,
  setBotPausedForPhone
} from "./db.js";

import { OWNER_PASSWORD, FALLBACK_VERIFY_TOKEN } from "./config.js";
import { sendWhatsAppMessage } from "./meta.js";

dotenv.config();
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || FALLBACK_VERIFY_TOKEN;

// OpenAI (اختياري)
const openaiApiKey = process.env.OPENAI_API_KEY;
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

// رابط المتجر (عدلّه إذا تبغى)
const STORE_LINK = process.env.STORE_LINK || "https://smart-bot0.netlify.app/";

// ---------------- Helpers ----------------
function nowIso() {
  return new Date().toISOString();
}

// ---------------- AI ----------------
async function askAI(userText) {
  if (!openai) {
    return (
      "أنا بوت *Smart Bot* 🤖\n" +
      "أساعدك في الطلبات والاستفسارات عن البوتات والخدمات.\n" +
      "رابط المتجر:\n" +
      STORE_LINK +
      "\n\n" +
      "اكتب سؤالك بوضوح وسأساعدك 🙌"
    );
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "أنت بوت خدمة عملاء لمتجر Smart Bot. قواعد الرد:\n" +
            "- ردود قصيرة وواضحة.\n" +
            "- إذا سأل عن شراء/طلب: وجّهه لرابط المتجر.\n" +
            "- لا تتكلم عن الأكواد أو السيرفر.\n" +
            "- إذا العميل يبدو غير فاهم: اعرض التحويل لخدمة العملاء.\n" +
            `- رابط المتجر: ${STORE_LINK}`
        },
        { role: "user", content: userText }
      ]
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ||
      "حصل خطأ بسيط، حاول تكتب سؤالك مرة ثانية 🙏"
    );
  } catch (err) {
    console.error("❌ OpenAI error:", err?.response?.data || err.message);
    return "حصل خلل مؤقت في خدمة الذكاء الاصطناعي، حاول بعد قليل 🙏";
  }
}

// ---------------- Health ----------------
app.get("/ping", (req, res) => res.send("OK - Smart Bot server is running"));

// Debug: إرسال يدوي (يفصل مشكلة الإرسال 100%)
app.get("/debug-send", async (req, res) => {
  try {
    const to = (req.query.to || "").toString().trim();
    const text = (req.query.text || "hello").toString();
    if (!to) return res.status(400).json({ error: "missing_to" });

    await sendWhatsAppMessage(to, text);
    return res.json({ ok: true, to, text });
  } catch (e) {
    console.error("❌ /debug-send error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------- Webhook Verify (GET) ----------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("📡 Webhook GET:", { mode, token });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified with Meta.");
    return res.status(200).send(challenge);
  }
  console.warn("❌ Webhook verification failed.");
  return res.sendStatus(403);
});

// ---------------- Webhook Receive (POST) ----------------
app.post("/webhook", async (req, res) => {
  console.log("🔥🔥 POST /webhook from Meta 🔥🔥");
  console.log("BODY:", JSON.stringify(req.body, null, 2));

  const body = req.body;

  try {
    if (!body || body.object !== "whatsapp_business_account") {
      console.log("ℹ️ Not a whatsapp_business_account event.");
      return res.sendStatus(200);
    }

    // نقرأ كل entry وكل change (مهم جداً لأن Meta ترسل أكثر من واحد)
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        const messages = value.messages || [];
        const contactsMeta = value.contacts || [];

        // إذا ما فيه رسائل غالباً statuses
        if (!messages.length) {
          console.log("ℹ️ Event without messages (likely statuses).");
          // اطبعها عشان نعرف وش الواصل
          console.log("VALUE:", JSON.stringify(value, null, 2));
          continue;
        }

        // لكل رسالة
        for (const msg of messages) {
          const fromWaId = msg.from; // 9665xxxxxx
          const contactMeta = contactsMeta[0];
          const name = contactMeta?.profile?.name ? contactMeta.profile.name : fromWaId;

          const ts = parseInt(msg.timestamp || "0", 10) * 1000;
          const timestamp = ts ? new Date(ts).toISOString() : nowIso();

          let text = "";
          if (msg.type === "text") text = msg.text?.body || "";
          else text = `[رسالة نوع ${msg.type}]`;

          console.log("📩 MESSAGE:", { fromWaId, name, type: msg.type, text });

          // خزّن جهة الاتصال + الرسالة
          const contact = await upsertContact(fromWaId, name);
          await insertMessage(contact.id, false, text, msg.type || "text", timestamp);

          const clean = (text || "").trim();
          const lower = clean.toLowerCase();

          // أوامر تشغيل/إيقاف
          const resumeCmd =
            clean.includes("تشغيل البوت") ||
            clean.includes("رجع البوت") ||
            lower.includes("resume bot") ||
            lower.includes("start bot");

          const wantsAgent =
            clean.includes("حولني") ||
            clean.includes("خدمة العملاء") ||
            lower.includes("talk to agent") ||
            lower.includes("human");

          if (resumeCmd) {
            await setBotPausedForPhone(fromWaId, false);
            const reply =
              "تم إعادة تشغيل البوت 🤖✅\n" +
              "اكتب سؤالك الآن، وسأرد عليك.";
            await insertMessage(contact.id, true, reply, "text", nowIso());
            await sendWhatsAppMessage(fromWaId, reply);
            console.log("✅ Sent resume reply to:", fromWaId);
            continue;
          }

          if (wantsAgent) {
            await setBotPausedForPhone(fromWaId, true);
            const reply =
              "تم تحويلك إلى خدمة العملاء 👨‍💼👩‍💼\n" +
              "سيتوقف البوت عن الرد مؤقتاً حتى يخدمك أحد موظفينا.\n" +
              "لإعادة تشغيل البوت لاحقاً، اكتب: تشغيل البوت";
            await insertMessage(contact.id, true, reply, "text", nowIso());
            await sendWhatsAppMessage(fromWaId, reply);
            console.log("✅ Sent agent transfer reply to:", fromWaId);
            continue;
          }

          // هل البوت متوقف لهذا العميل؟
          const freshContact = await getContactByWaId(fromWaId);
          if (freshContact?.bot_paused) {
            const reply =
              "أنت حالياً مع خدمة العملاء 👨‍💼👩‍💼\n" +
              "لن يقوم البوت بالرد حتى ينتهي تواصلك مع الموظف.\n" +
              "لإعادة تشغيل البوت اكتب: تشغيل البوت";
            await insertMessage(contact.id, true, reply, "text", nowIso());
            await sendWhatsAppMessage(fromWaId, reply);
            console.log("ℹ️ Contact paused, reminded:", fromWaId);
            continue;
          }

          // لو العميل يقول ما فهمت
          const seemsConfused =
            clean.includes("ما فهمت") ||
            clean.includes("مو واضح") ||
            clean.includes("مدري") ||
            clean.includes("شنو تقصد") ||
            lower.includes("dont understand") ||
            lower.includes("not clear");

          if (seemsConfused) {
            const reply =
              "أحس إن ردي ما كان واضح بالكامل 😅\n" +
              "حاب أحولك على خدمة العملاء يتكلم معك شخص حقيقي؟\n" +
              "إذا حاب، اكتب: حولني";
            await insertMessage(contact.id, true, reply, "text", nowIso());
            await sendWhatsAppMessage(fromWaId, reply);
            console.log("✅ Asked to transfer to agent:", fromWaId);
            continue;
          }

          // رد تلقائي
          const intro =
            "أهلاً بك في *Smart Bot* 🤖\n" +
            "نشكرك على تواصلك معنا، نحن مختصون في حلول البوتات والذكاء الاصطناعي.\n" +
            "رابط المتجر:\n" +
            STORE_LINK +
            "\n";

          const aiReply = await askAI(clean || "رسالة فارغة");
          const replyText = intro + "\n" + aiReply;

          await insertMessage(contact.id, true, replyText, "text", nowIso());
          await sendWhatsAppMessage(fromWaId, replyText);
          console.log("✅ Sent bot reply to:", fromWaId);
        }
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook POST error:", err);
    return res.sendStatus(500);
  }
});

// ---------------- Order webhook (اختياري) ----------------
app.post("/order-webhook", async (req, res) => {
  try {
    const { customer_phone, customer_name, product_name, status } = req.body || {};

    console.log("📦 /order-webhook:", req.body);

    if (!customer_phone || !product_name) {
      return res.status(400).json({ error: "missing_fields" });
    }

    let wa = customer_phone.toString().trim().replace(/\s+/g, "");
    if (wa.startsWith("+")) wa = wa.slice(1);
    if (wa.startsWith("0")) wa = "966" + wa.slice(1);

    const name = customer_name || wa;
    const contact = await upsertContact(wa, name);

    let msg = "";
    if (status === "paid") {
      msg =
        `أهلاً ${name} 🌟\n` +
        `تم تأكيد دفع طلبك لمنتج: *${product_name}* ✅\n\n` +
        "سيتم تفعيل خدمتك خلال مدة من ٣ أيام إلى أسبوع بإذن الله.\n" +
        "إذا عندك سؤال، رد على هذه الرسالة مباشرة 🤝";
    } else {
      msg =
        `مرحباً ${name} 🤍\n` +
        `نشكرك على طلبك لمنتج: *${product_name}* من متجر *Smart Bot*.\n\n` +
        "إذا لم تُكمل الدفع بعد، تقدر ترجع تكملها.\n" +
        "بعد الدفع ستصلك رسالة تأكيد بدء التفعيل بإذن الله 🙏";
    }

    await insertMessage(contact.id, true, msg, "text", nowIso());
    await sendWhatsAppMessage(wa, msg);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ /order-webhook error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------- Panel APIs ----------------
app.get("/api/settings", async (req, res) => {
  try {
    const bot_name = await getSetting("bot_name");
    const bot_avatar = await getSetting("bot_avatar");
    res.json({ bot_name, bot_avatar });
  } catch (err) {
    console.error("❌ /api/settings error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/settings", async (req, res) => {
  try {
    const { bot_name, bot_avatar, owner_password } = req.body || {};
    if (owner_password !== OWNER_PASSWORD) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (bot_name) await setSetting("bot_name", bot_name);
    if (bot_avatar) await setSetting("bot_avatar", bot_avatar);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/settings POST error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/contacts", async (req, res) => {
  try {
    const contacts = await getContacts();
    res.json(contacts);
  } catch (err) {
    console.error("❌ /api/contacts error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/contacts/:id/messages", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const rows = await getMessagesByContact(contactId);
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/contacts/:id/messages error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/contacts/:id/send", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const messageBody = (req.body?.body || "").toString();

    db.get("SELECT * FROM contacts WHERE id = ?", [contactId], async (err, c) => {
      if (err || !c) return res.status(404).json({ error: "contact_not_found" });

      await sendWhatsAppMessage(c.wa_id, messageBody);
      await insertMessage(contactId, true, messageBody, "text", nowIso());

      res.json({ success: true });
    });
  } catch (err) {
    console.error("❌ /api/contacts/:id/send error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/contacts/:id/bot-toggle", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const paused = !!req.body?.paused;
    await setBotPausedForContactId(contactId, paused);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/contacts/:id/bot-toggle error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.delete("/api/contacts/:id", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    await deleteContact(contactId);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/contacts/:id delete error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Serve UI
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("🚀 Smart Bot running on port:", PORT);
  console.log("✅ VERIFY_TOKEN:", VERIFY_TOKEN);
  console.log("📡 Webhook endpoints: /webhook , /order-webhook");
});
