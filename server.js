// server.js
import express from "express";
import cors from "cors";
import axios from "axios";
import bodyParser from "body-parser";
import { OpenAI } from "openai";

import { config } from "./config.js";
import {
  initDb,
  getOrCreateConversation,
  addMessage,
  setConversationMode,
  listConversations,
  getMessagesForConversation,
  getConversationById,
  addNotification
} from "./db.js";

const app = express();
initDb();

app.use(cors());
app.use(bodyParser.json());

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============ إرسال رسالة نصية WhatsApp ============
async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/${config.META_VERSION}/${config.PHONE_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${config.WABA_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("WhatsApp Error:", err.response?.data || err.message);
  }
}

// ============ إرسال قالب Template ============
async function sendTemplate(to, templateName, variables = []) {
  const url = `https://graph.facebook.com/${config.META_VERSION}/${config.PHONE_ID}/messages`;

  const components =
    variables.length > 0
      ? [
          {
            type: "body",
            parameters: variables.map(v => ({
              type: "text",
              text: v
            }))
          }
        ]
      : [];

  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        components
      }
    },
    {
      headers: {
        Authorization: `Bearer ${config.WABA_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ============ Webhook Verify ============
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === config.VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// ============ Webhook Receive ============
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    if (data.object !== "whatsapp_business_account") return res.sendStatus(404);

    const entry = data.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const name = value.contacts?.[0]?.profile?.name || "";
    const text = msg.text?.body || "";

    const conv = await getOrCreateConversation(from, name);

    // إذا طلب خدمة عملاء
    if (text.includes("خدمة عملاء") || text.includes("اكلم انسان")) {
      await setConversationMode(conv.id, "human");
      addNotification("human_request", { id: conv.id, wa_id: from });

      await sendWhatsAppText(from, "تم تحويلك لخدمة العملاء 🌹");
      return res.sendStatus(200);
    }

    // إذا المحادثة human → لا يتدخل البوت
    if (conv.mode === "human") return res.sendStatus(200);

    // حفظ رسالة المستخدم
    await addMessage(conv.id, from, "user", text);

    // رد البوت
    const systemPrompt = `
أنت بوت خدمة عملاء لمتجر ${config.STORE_NAME}.
لا ترسل رابط المتجر إلا إذا طلب العميل.
رد بجمل قصيرة فقط.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ]
    });

    const reply = completion.choices[0].message.content.trim();

    await sendWhatsAppText(from, reply);
    await addMessage(conv.id, from, "bot", reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err);
    res.sendStatus(500);
  }
});

// ============ API: قائمة المحادثات ============
app.get("/api/conversations", async (req, res) => {
  const rows = await listConversations();
  res.json(rows);
});

// ============ API: رسائل المحادثة ============
app.get("/api/conversations/:id/messages", async (req, res) => {
  const id = req.params.id;
  const rows = await getMessagesForConversation(id);
  res.json(rows);
});

// ============ API: إرسال رد من الموظف ============
app.post("/api/conversations/:id/send", async (req, res) => {
  const { text, staffEmail } = req.body;
  const convId = req.params.id;

  const conv = getConversationById(convId);
  if (!conv) return res.json({ error: "not found" });

  await setConversationMode(convId, "human", staffEmail);

  await sendWhatsAppText(conv.wa_id, text);
  await addMessage(convId, conv.wa_id, "staff", text);

  res.json({ ok: true });
});

// ============ إعادة تشغيل البوت ============
app.post("/api/conversations/:id/restart-bot", async (req, res) => {
  await setConversationMode(req.params.id, "bot");
  res.json({ ok: true });
});

// ============ إرسال قالب hello_world ============
app.post("/api/broadcast", async (req, res) => {
  const { numbers } = req.body;

  const results = [];

  for (const num of numbers) {
    const fixed = num.replace(/^0/, "966");
    try {
      await sendTemplate(fixed, config.BROADCAST_TEMPLATE);
      results.push({ number: fixed, ok: true });
    } catch (err) {
      results.push({
        number: fixed,
        ok: false,
        error: err.response?.data || err.message
      });
    }
  }

  res.json({ results });
});

// ============ الصفحة الرئيسية ============
app.get("/", (req, res) => {
  res.send("WhatsApp Bot Server Running ✔");
});

app.listen(config.PORT, () =>
  console.log("🚀 SERVER RUNNING ON PORT " + config.PORT)
);
