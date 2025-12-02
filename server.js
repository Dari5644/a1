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
app.use(bodyParser.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || FALLBACK_VERIFY_TOKEN;

const openaiApiKey = process.env.OPENAI_API_KEY;
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

async function askAI(userText) {
  if (!openai) {
    return (
      "أنا بوت *Smart Bot* 🤖\n" +
      "أساعدك في الطلبات والاستفسارات عن البوتات.\n" +
      "رابط المتجر:\n" +
      "https://smart-bot0.netlify.app/\n\n" +
      "سؤالك كان:\n" +
      userText
    );
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "أنت بوت خدمة عملاء لمتجر Smart Bot. ردودك:\n" +
            "- قصيرة، واضحة، ولطيفة.\n" +
            "- تشرح الخدمات (بوتات واتساب، بوتات تليجرام، ذكاء اصطناعي).\n" +
            "- تذكر رابط المتجر عند الحاجة: https://smart-bot0.netlify.app/\n" +
            "- لا تتحدث عن الأكواد الداخلية، ركز على تجربة العميل."
        },
        { role: "user", content: userText }
      ]
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "حصل خطأ بسيط، حاول تكتب سؤالك مرة ثانية 🙏";
    return reply;
  } catch (err) {
    console.error("❌ خطأ من OpenAI:", err?.response?.data || err.message);
    return "حصل خلل مؤقت في خدمة الذكاء الاصطناعي، حاول بعد قليل 🙏";
  }
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("📡 Webhook GET:", mode, token);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified with Meta.");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verification failed.");
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("🔥🔥 Webhook POST من Meta 🔥🔥");
    console.log("BODY:", JSON.stringify(req.body, null, 2));

    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      const entry = body.entry && body.entry[0];
      const changes = entry && entry.changes && entry.changes[0];
      const value = changes && changes.value;
      const messages = value && value.messages;
      const contactsMeta = value && value.contacts;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const contactMeta = contactsMeta && contactsMeta[0];

        const fromWaId = msg.from;
        const name =
          contactMeta &&
          contactMeta.profile &&
          contactMeta.profile.name
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

        console.log("📩 رسالة من:", fromWaId, "النص:", text);

        const contact = await upsertContact(fromWaId, name);

        await insertMessage(
          contact.id,
          false,
          text,
          msg.type || "text",
          timestamp
        );

        const clean = (text || "").trim();
        const lower = clean.toLowerCase();

        if (
          clean.includes("تشغيل البوت") ||
          clean.includes("رجع البوت") ||
          lower.includes("resume bot") ||
          lower.includes("start bot")
        ) {
          await setBotPausedForPhone(fromWaId, false);
          const reply =
            "تم إعادة تشغيل البوت 🤖✅\n" +
            "اكتب سؤالك الآن، وسأرد عليك.";
          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppMessage(fromWaId, reply);
          return res.sendStatus(200);
        }

        const wantsAgent =
          clean.includes("حولني") ||
          clean.includes("خدمة العملاء") ||
          lower.includes("talk to agent") ||
          lower.includes("human");

        if (wantsAgent) {
          await setBotPausedForPhone(fromWaId, true);
          const reply =
            "تم تحويلك إلى خدمة العملاء 👨‍💼👩‍💼\n" +
            "سيتوقف البوت عن الرد مؤقتاً حتى يخدمك أحد موظفينا.\n" +
            "لإعادة تشغيل البوت لاحقاً، اكتب: تشغيل البوت";
          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppMessage(fromWaId, reply);
          return res.sendStatus(200);
        }

        const freshContact = await getContactByWaId(fromWaId);
        if (freshContact && freshContact.bot_paused) {
          const reply =
            "أنت حالياً مع خدمة العملاء 👨‍💼👩‍💼\n" +
            "لن يقوم البوت بالرد حتى ينتهي تواصلك مع الموظف.\n" +
            "لإعادة تشغيل البوت اكتب: تشغيل البوت";
          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppMessage(fromWaId, reply);
          return res.sendStatus(200);
        }

        const seemsConfused =
          clean.includes("ما فهمت") ||
          clean.includes("مو واضح") ||
          clean.includes("مدري وش") ||
          clean.includes("شنو تقصد") ||
          lower.includes("dont understand") ||
          lower.includes("don't understand") ||
          lower.includes("not clear");

        if (seemsConfused) {
          const reply =
            "أحس إن ردي ما كان واضح بالكامل 😅\n" +
            "حاب أحولك على خدمة العملاء يتكلم معك شخص حقيقي؟\n" +
            "إذا حاب، اكتب: حولني";
          await insertMessage(
            contact.id,
            true,
            reply,
            "text",
            new Date().toISOString()
          );
          await sendWhatsAppMessage(fromWaId, reply);
          return res.sendStatus(200);
        }

        const intro =
          "أهلاً بك في *Smart Bot* 🤖\n" +
          "نشكرك على تواصلك معنا، نحن مختصون في حلول البوتات والذكاء الاصطناعي.\n" +
          "رابط المتجر:\n" +
          "https://smart-bot0.netlify.app/\n";

        const aiReply = await askAI(clean);
        const replyText = intro + "\n" + aiReply;

        await insertMessage(
          contact.id,
          true,
          replyText,
          "text",
          new Date().toISOString()
        );
        await sendWhatsAppMessage(fromWaId, replyText);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook POST error:", err);
    res.sendStatus(500);
  }
});

app.post("/order-webhook", async (req, res) => {
  try {
    const {
      customer_phone,
      customer_name,
      product_name,
      status
    } = req.body || {};

    if (!customer_phone || !product_name) {
      return res.status(400).json({ error: "missing_fields" });
    }

    let wa = customer_phone.toString().trim();
    wa = wa.replace(/\s+/g, "");
    if (wa.startsWith("+")) wa = wa.slice(1);
    if (wa.startsWith("0")) wa = "966" + wa.slice(1);

    const name = customer_name || wa;
    const contact = await upsertContact(wa, name);

    let msg = "";

    if (status === "paid") {
      msg =
        "أهلاً " +
        name +
        " 🌟\n" +
        "تم تأكيد دفع طلبك لمنتج: *" +
        product_name +
        "* ✅\n\n" +
        "سيتم تفعيل خدمتك أو تسليم البوت خلال مدة من ٣ أيام إلى أسبوع كحد أقصى بإذن الله.\n" +
        "في حال وجود أي استفسار، رد على هذه الرسالة مباشرة وسنخدمك بسرور 🤝";
    } else {
      msg =
        "مرحباً " +
        name +
        " 🤍\n" +
        "نشكرك على طلبك لمنتج: *" +
        product_name +
        "* من متجر *Smart Bot*.\n\n" +
        "إذا لم تُكمل عملية الدفع بعد، يمكنك العودة لإتمامها من رابط الفاتورة أو سلة الشراء.\n" +
        "بعد إتمام الدفع ستصلك رسالة تؤكد بدء تفعيل خدمتك بإذن الله 🙏";
    }

    await insertMessage(
      contact.id,
      true,
      msg,
      "text",
      new Date().toISOString()
    );
    await sendWhatsAppMessage(wa, msg);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /order-webhook error:", err);
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
    const body = req.body.body;

    db.get("SELECT * FROM contacts WHERE id = ?", [contactId], async (err, c) => {
      if (err || !c) {
        return res.status(404).json({ error: "contact_not_found" });
      }

      await sendWhatsAppMessage(c.wa_id, body);
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

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname2, "index.html"));
});

app.listen(PORT, () => {
  console.log("🚀 Smart Bot Meta panel running on port " + PORT);
  console.log("📡 جاهز لاستقبال Webhook على /webhook و /order-webhook");
});
