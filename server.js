// server.js
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
  setBotPausedForPhone,
} from "./db.js";
import { OWNER_PASSWORD, BOT_SYSTEM_PROMPT, VERIFY_TOKEN } from "./config.js";
import { sendWhatsAppMessageMeta } from "./meta.js";

// =============================
// إعدادات أساسية
// =============================
dotenv.config();
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =============================
// دالة الذكاء الاصطناعي
// =============================
async function askAI(userText) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: BOT_SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
    });
    const reply =
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content
        ? completion.choices[0].message.content.trim()
        : null;

    return reply || "حصل خطأ بسيط، حاول تكتب سؤالك مرة ثانية 🙏";
  } catch (err) {
    console.error("❌ خطأ من OpenAI:", err && err.response && err.response.data ? err.response.data : err.message);
    return "حصل خلل مؤقت في خدمة الذكاء الاصطناعي، حاول بعد قليل 🙏";
  }
}

// =============================
// Webhook GET (تحقق من ميتا)
// =============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("📡 طلب تحقق Webhook GET:", mode, token);

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified with Meta.");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verification failed.");
  return res.sendStatus(403);
});

// =============================
// Webhook POST (استقبال رسائل واتساب)
// =============================
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔥🔥 وصلني Webhook من Meta (POST /webhook) 🔥🔥");
    console.log("BODY:", JSON.stringify(req.body, null, 2));

    const body = req.body;

    if (body && body.object === "whatsapp_business_account") {
      const entry = body.entry && body.entry[0];
      const changes = entry && entry.changes && entry.changes[0];
      const value = changes && changes.value;
      const messages = value && value.messages;
      const contactsMeta = value && value.contacts;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const contactMeta = contactsMeta && contactsMeta[0];

        const fromWaId = msg.from; // رقم الواتساب مثل 9665XXXX
        const name =
          contactMeta && contactMeta.profile && contactMeta.profile.name
            ? contactMeta.profile.name
            : fromWaId;

        const ts = parseInt(msg.timestamp, 10) * 1000;
        const timestamp = new Date(ts).toISOString();

        let text = "";
        if (msg.type === "text") {
          text = (msg.text && msg.text.body) || "";
        } else {
          text = "[رسالة نوع " + msg.type + "]";
        }

        console.log("📩 رسالة واردة من Meta:", fromWaId, "النص:", text);

        // حفظ/تحديث جهة الاتصال
        const contact = await upsertContact(fromWaId, name);

        // حفظ الرسالة الواردة
        await insertMessage(
          contact.id,
          false,
          text,
          msg.type || "text",
          timestamp
        );

        const clean = (text || "").trim();
        const lower = clean.toLowerCase();

        // 1) أمر تشغيل البوت من جديد
        if (
          clean.indexOf("تشغيل البوت") !== -1 ||
          clean.indexOf("رجع البوت") !== -1 ||
          lower.indexOf("resume bot") !== -1 ||
          lower.indexOf("start bot") !== -1
        ) {
          await setBotPausedForPhone(fromWaId, false);

          const reply =
            "تم إعادة تشغيل البوت 🤖✅\n" +
            "اكتب سؤالك الآن، وسأساعدك باستخدام الذكاء الاصطناعي.";

          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppMessageMeta(fromWaId, reply);
          return res.sendStatus(200);
        }

        // 2) كلمات تدل أنه محتاج خدمة العملاء
        const needSupport =
          clean.indexOf("خدمة العملاء") !== -1 ||
          clean.indexOf("مو واضح") !== -1 ||
          clean.indexOf("ما فهمت") !== -1 ||
          clean.indexOf("وش تقصد") !== -1 ||
          clean.indexOf("وضح أكثر") !== -1 ||
          lower.indexOf("support") !== -1 ||
          lower.indexOf("agent") !== -1;

        if (needSupport) {
          await setBotPausedForPhone(fromWaId, true);

          const reply =
            "تم تحويلك إلى خدمة العملاء 👨‍💼👩‍💼\n" +
            "سيتوقف البوت عن الرد مؤقتاً حتى يخدمك أحد موظفينا.\n" +
            "إذا حاب ترجع للرد الآلي بالذكاء الاصطناعي، اكتب: تشغيل البوت";

          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppMessageMeta(fromWaId, reply);
          return res.sendStatus(200);
        }

        // 3) لو البوت موقّف لهذا العميل
        const freshContact = await getContactByWaId(fromWaId);
        if (freshContact && freshContact.bot_paused) {
          const reply =
            "أنت حالياً مع خدمة العملاء 👨‍💼👩‍💼\n" +
            "لن يقوم البوت بالرد حتى ينتهي تواصلك مع الموظف.\n" +
            "إذا حاب ترجع للرد الآلي بالذكاء الاصطناعي، اكتب: تشغيل البوت";

          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppMessageMeta(fromWaId, reply);
          return res.sendStatus(200);
        }

        // 4) رد الذكاء الاصطناعي (الافتراضي)
        const aiReply = await askAI(clean);
        await insertMessage(
          contact.id,
          true,
          aiReply,
          "text",
          new Date().toISOString()
        );
        await sendWhatsAppMessageMeta(fromWaId, aiReply);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook POST error:", err);
    res.sendStatus(500);
  }
});

// =============================
// API: إعدادات اسم وصورة البوت
// =============================
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
    const body = req.body;
    const bot_name = body.bot_name;
    const bot_avatar = body.bot_avatar;
    const owner_password = body.owner_password;

    if (owner_password !== OWNER_PASSWORD) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (bot_name) {
      await setSetting("bot_name", bot_name);
    }
    if (bot_avatar) {
      await setSetting("bot_avatar", bot_avatar);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/settings POST error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// =============================
// API: جهات الاتصال والمحادثات
// =============================
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

// إرسال رسالة من اللوحة للعميل
app.post("/api/contacts/:id/send", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const body = req.body.body;

    db.get("SELECT * FROM contacts WHERE id = ?", [contactId], async (err, c) => {
      if (err || !c) {
        return res.status(404).json({ error: "contact_not_found" });
      }

      await sendWhatsAppMessageMeta(c.wa_id, body);
      await insertMessage(
        contactId,
        true,
        body,
        "text",
        new Date().toISOString()
      );

      res.json({ success: true });
    });
  } catch (err) {
    console.error("❌ /api/contacts/:id/send error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// إيقاف / تشغيل البوت لعميل معين من اللوحة
app.post("/api/contacts/:id/bot-toggle", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const paused = !!req.body.paused;

    await setBotPausedForContactId(contactId, paused);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/contacts/:id/bot-toggle error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// حذف محادثة كاملة
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

// =============================
// تقديم الواجهة الأمامية (index.html)
// =============================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// =============================
// تشغيل السيرفر
// =============================
app.listen(PORT, () => {
  console.log("🚀 Smart Bot Meta panel running on port " + PORT);
  console.log("📡 جاهز لاستقبال Webhook على /webhook");
});
