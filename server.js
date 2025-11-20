// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import {
  db,
  initDb,
  getSetting,
  setSetting,
  upsertContact,
  getContacts,
  getMessagesByContact,
  insertMessage,
  setBotPausedForContactId,
  deleteContact
} from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const N8N_SEND_WEBHOOK_URL = process.env.N8N_SEND_WEBHOOK_URL || "";
const N8N_SHARED_SECRET = process.env.N8N_SHARED_SECRET || "";

// تهيئة قاعدة البيانات
initDb();

// فحص السر المشترك مع n8n (اختياري)
function checkN8nSecret(req) {
  if (!N8N_SHARED_SECRET) return true;
  const header = req.headers["x-n8n-secret"];
  return header && header === N8N_SHARED_SECRET;
}

/**
 * 📥 Webhook من n8n → اللوحة
 * كل رسالة تمر في n8n (من العميل أو من البوت) ترسل نسخة هنا.
 *
 * مثال الجسم من n8n:
 * {
 *   "wa_id": "9665xxxxxxx",
 *   "name": "اسم العميل",
 *   "direction": "in" | "out",
 *   "body": "نص الرسالة",
 *   "type": "text",
 *   "timestamp": "2025-11-20T18:30:00Z"
 * }
 */
app.post("/n8n/incoming", async (req, res) => {
  try {
    if (!checkN8nSecret(req)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const { wa_id, name, direction, body, type, timestamp } = req.body;
    if (!wa_id || !body) {
      return res.status(400).json({ error: "wa_id_and_body_required" });
    }

    const contact = await upsertContact(wa_id, name || wa_id);
    const fromMe = direction === "out";

    await insertMessage(
      contact.id,
      fromMe,
      body,
      type || "text",
      timestamp || new Date().toISOString()
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /n8n/incoming error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ===== API للمحادثات =====
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
    const messages = await getMessagesByContact(contactId);
    res.json(messages);
  } catch (err) {
    console.error("❌ /api/contacts/:id/messages error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// إرسال من اللوحة → n8n → واتساب
app.post("/api/contacts/:id/send", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const { body } = req.body;

    if (!N8N_SEND_WEBHOOK_URL) {
      return res.status(500).json({ error: "N8N_SEND_WEBHOOK_URL_not_set" });
    }

    db.get(
      "SELECT * FROM contacts WHERE id = ?",
      [contactId],
      async (err, contact) => {
        if (err || !contact) {
          return res.status(404).json({ error: "contact_not_found" });
        }

        const wa_id = contact.wa_id;

        // نرسل لنود n8n
        try {
          await axios.post(
            N8N_SEND_WEBHOOK_URL,
            { wa_id, body },
            {
              headers: N8N_SHARED_SECRET
                ? { "x-n8n-secret": N8N_SHARED_SECRET }
                : {}
            }
          );
        } catch (err2) {
          console.error(
            "❌ Error posting to n8n send webhook:",
            err2.response?.data || err2.message
          );
          return res.status(500).json({ error: "n8n_send_failed" });
        }

        // نخزن الرسالة في قاعدة البيانات
        await insertMessage(
          contactId,
          true,
          body,
          "text",
          new Date().toISOString()
        );

        res.json({ success: true });
      }
    );
  } catch (err) {
    console.error("❌ /api/contacts/:id/send error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// إنشاء محادثة جديدة من اللوحة
app.post("/api/contacts/new", async (req, res) => {
  try {
    const { wa_id, display_name, first_message } = req.body;
    if (!wa_id) {
      return res.status(400).json({ error: "wa_id_required" });
    }

    const contact = await upsertContact(wa_id, display_name || wa_id);

    if (first_message && first_message.trim()) {
      if (!N8N_SEND_WEBHOOK_URL) {
        return res
          .status(500)
          .json({ error: "N8N_SEND_WEBHOOK_URL_not_set_for_first_message" });
      }

      try {
        await axios.post(
          N8N_SEND_WEBHOOK_URL,
          { wa_id, body: first_message },
          {
            headers: N8N_SHARED_SECRET
              ? { "x-n8n-secret": N8N_SHARED_SECRET }
              : {}
          }
        );
      } catch (err2) {
        console.error(
          "❌ Error posting first message to n8n:",
          err2.response?.data || err2.message
        );
        return res.status(500).json({ error: "n8n_send_failed" });
      }

      await insertMessage(
        contact.id,
        true,
        first_message,
        "text",
        new Date().toISOString()
      );
    }

    res.json(contact);
  } catch (err) {
    console.error("❌ /api/contacts/new error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// إيقاف / تشغيل البوت (علامة فقط)
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

// إعدادات (اسم وصورة البوت داخل اللوحة فقط)
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
    const { bot_name, bot_avatar } = req.body;
    if (bot_name) await setSetting("bot_name", bot_name);
    if (bot_avatar) await setSetting("bot_avatar", bot_avatar);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/settings POST error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Smart Bot panel (n8n mode) running on port ${PORT}`);
});
