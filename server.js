// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import {
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
import { OWNER_PASSWORD, BOT_SYSTEM_PROMPT, VERIFY_TOKEN } from "./config.js";
import { sendWhatsAppMessageMeta } from "./meta.js";

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
  apiKey: process.env.OPENAI_API_KEY
});

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

// Webhook GET verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified with Meta.");
    return res.status(200).send(challenge);
  }
  console.warn("❌ Webhook verification failed.");
  return res.sendStatus(403);
});

// Webhook POST - receive messages
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;
      const contactsMeta = value?.contacts;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const contactMeta = contactsMeta?.[0];

        const fromWaId = msg.from;
        const name = contactMeta?.profile?.name || fromWaId;
        const timestamp = new Date(parseInt(msg.timestamp, 10) * 1000).toISOString();

        let text = "";
        if (msg.type === "text") {
          text = msg.text?.body || "";
        } else {
          text = `[رسالة نوع ${msg.type}]`;
        }

        console.log("📩 رسالة واردة من Meta:", fromWaId, "النص:", text);

        const contact = await upsertContact(fromWaId, name);
        await insertMessage(contact.id, false, text, msg.type || "text", timestamp);

        const clean = (text || "").trim();
        const lower = clean.toLowerCase();

        const needSupport =
          clean.includes("خدمة العملاء") ||
          clean.includes("مو واضح") ||
          clean.includes("ما فهمت") ||
          clean.includes("وش تقصد") ||
          clean.includes("وضح أكثر") ||
          lower.includes("support") ||
          lower.includes("agent");

        if (needSupport) {
          await setBotPausedForPhone(fromWaId, true);

          await sendWhatsAppMessageMeta(
            fromWaId,
            "تم تحويلك إلى خدمة العملاء 👨‍💼👩‍💼\n" +
              "سيتوقف البوت عن الرد مؤقتاً حتى يخدمك أحد موظفينا.\n" +
              "إذا حاب ترجع للرد الآلي بالذكاء الاصطناعي، اكتب: تشغيل البوت"
          );

          return res.sendStatus(200);
        }

        const freshContact = await getContactByWaId(fromWaId);
        if (freshContact && freshContact.bot_paused) {
          await sendWhatsAppMessageMeta(
            fromWaId,
            "أنت حالياً مع خدمة العملاء 👨‍💼👩‍💼\n" +
              "لن يقوم البوت بالرد حتى ينتهي تواصلك مع الموظف.\n" +
              "إذا حاب ترجع للرد الآلي بالذكاء الاصطناعي، اكتب: تشغيل البوت"
          );
          return res.sendStatus(200);
        }

        if (
          clean.includes("تشغيل البوت") ||
          clean.includes("رجع البوت") ||
          lower.includes("resume bot") ||
          lower.includes("start bot")
        ) {
          await setBotPausedForPhone(fromWaId, false);
          await sendWhatsAppMessageMeta(
            fromWaId,
            "تم إعادة تشغيل البوت 🤖✅\nاكتب سؤالك الآن، وسأساعدك باستخدام الذكاء الاصطناعي."
          );
          return res.sendStatus(200);
        }

        const aiReply = await askAI(clean);
        await insertMessage(contact.id, true, aiReply, "text", new Date().toISOString());
        await sendWhatsAppMessageMeta(fromWaId, aiReply);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook POST error:", err);
    res.sendStatus(500);
  }
});

// API for settings
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
    const { bot_name, bot_avatar, owner_password } = req.body;
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

// Contacts APIs
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
    const { body } = req.body;

    import("sqlite3").then((sqlite3Module) => {
      const sqlite3 = sqlite3Module.default;
      const dbPath = path.join(__dirname, "smartbot.db");
      const dbConn = new sqlite3.Database(dbPath);

      dbConn.get("SELECT * FROM contacts WHERE id = ?", [contactId], async (err, c) => {
        if (err || !c) {
          dbConn.close();
          return res.status(404).json({ error: "contact_not_found" });
        }
        await sendWhatsAppMessageMeta(c.wa_id, body);
        await insertMessage(contactId, true, body, "text", new Date().toISOString());
        dbConn.close();
        res.json({ success: true });
      });
    });
  } catch (err) {
    console.error("❌ /api/contacts/:id/send error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/contacts/:id/bot-toggle", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const { paused } = req.body;
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

// Serve SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("🚀 Smart Bot Meta panel running on port " + PORT);
  console.log("📡 جاهز لاستقبال Webhook على /webhook");
});
