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
  getContactByWaId,
  getContacts,
  insertMessage,
  getMessagesByContact,
  setBotPausedForContactId,
  deleteContact
} from "./db.js";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "smartbot";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

initDb();

async function sendWhatsAppText(toWaId, body) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error("WhatsApp config missing.");
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: toWaId,
        type: "text",
        text: { body }
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("✅ Sent WhatsApp message to", toWaId);
  } catch (err) {
    console.error(
      "❌ Error sending WhatsApp message:",
      err.response?.data || err.message
    );
  }
}

async function getAIReply(message) {
  if (!openai) {
    return "شكراً لتواصلك مع Smart Bot 🤖\nتم استلام رسالتك وسنقوم بالرد عليك قريباً.";
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "أنت بوت خدمة عملاء لبوتات الواتساب في متجر اسمه Smart Bot. رد بأجوبة قصيرة وواضحة وبلهجة عربية بسيطة."
        },
        { role: "user", content: message }
      ]
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ||
      "شكراً لتواصلك مع Smart Bot 🤖"
    );
  } catch (err) {
    console.error("❌ OpenAI error:", err.response?.data || err.message);
    return "حصل خلل مؤقت في خدمة الرد الآلي، سيتم الرد عليك من خدمة العملاء قريباً.";
  }
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  const body = req.body;

  try {
    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const from = msg.from;
        const profileName = value?.contacts?.[0]?.profile?.name || from;
        const text =
          msg.text?.body ||
          msg.interactive?.button_reply?.title ||
          msg.interactive?.list_reply?.title ||
          "";

        console.log("📩 Incoming WhatsApp:", from, "=>", text);

        const contact = await upsertContact(from, profileName);

        await insertMessage(
          contact.id,
          false,
          text,
          msg.type || "text",
          new Date().toISOString()
        );

        const lower = text.toLowerCase();
        if (
          text.includes("خدمة العملاء") ||
          lower.includes("support") ||
          lower.includes("agent")
        ) {
          await setBotPausedForContactId(contact.id, true);
          const reply = "تم تحويلك إلى خدمة العملاء 👨‍💼👩‍💼";
          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppText(
            from,
            reply + "\nسيتم الرد عليك من الفريق البشري."
          );
        } else if (
          text.includes("تشغيل البوت") ||
          lower.includes("start bot") ||
          lower.includes("resume bot")
        ) {
          await setBotPausedForContactId(contact.id, false);
          const reply =
            "تم إعادة تشغيل البوت 🤖✅\nاكتب سؤالك الآن، وسنخدمك بالرد الذكي.";
          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppText(from, reply);
        } else {
          if (!contact.bot_paused) {
            const ai = await getAIReply(text);
            await insertMessage(
              contact.id,
              true,
              ai,
              "text",
              new Date().toISOString()
            );
            await sendWhatsAppText(from, ai);
          } else {
            console.log(
              "ℹ البوت متوقف لهذا العميل، لن يتم الرد آلياً. فقط تخزين الرسائل."
            );
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in webhook handler:", err);
    res.sendStatus(500);
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
    const messages = await getMessagesByContact(contactId);
    res.json(messages);
  } catch (err) {
    console.error("❌ /api/contacts/:id/messages error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/contacts/:id/send", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const { body } = req.body;

    db.get(
      "SELECT * FROM contacts WHERE id = ?",
      [contactId],
      async (err, contact) => {
        if (err || !contact) {
          return res.status(404).json({ error: "contact_not_found" });
        }

        const wa_id = contact.wa_id;
        await sendWhatsAppText(wa_id, body);
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

app.post("/api/contacts/new", async (req, res) => {
  try {
    const { wa_id, display_name, first_message } = req.body;
    const contact = await upsertContact(wa_id, display_name || wa_id);

    if (first_message && first_message.trim()) {
      await sendWhatsAppText(wa_id, first_message);
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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Smart Bot panel running on port ${PORT}`);
});
