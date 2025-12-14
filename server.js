// server.js (FIXED FOR "NO LOGS / NO MESSAGES" ISSUE)
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import {
  initDb,
  upsertContact,
  insertMessage,
  getContactByWaId,
  setBotPausedForPhone
} from "./db.js";

import { FALLBACK_VERIFY_TOKEN } from "./config.js";
import { sendWhatsAppMessage } from "./meta.js";

dotenv.config();
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// ✅ نخزن آخر Webhook وصل عشان نعرضه في /debug-last
let LAST_WEBHOOK = null;

// ✅ middleware يطبع أي Request يوصل للسيرفر (عشان نثبت هل ميتا ترسل ولا لا)
app.use((req, res, next) => {
  console.log("➡️ REQ:", req.method, req.path);
  next();
});

// لازم قبل routes
app.use(bodyParser.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || FALLBACK_VERIFY_TOKEN;

// ✅ Health
app.get("/ping", (req, res) => res.send("OK"));

// ✅ تشوف آخر Webhook وصل (حتى لو ما انتبهت للوغ)
app.get("/debug-last", (req, res) => {
  res.json({
    has_last: !!LAST_WEBHOOK,
    last: LAST_WEBHOOK
  });
});

// ✅ Webhook Verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("📡 VERIFY GET:", { mode, token });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Verified OK");
    return res.status(200).send(challenge);
  }
  console.log("❌ Verify failed");
  return res.sendStatus(403);
});

// ✅ Webhook POST (الأهم)
app.post("/webhook", async (req, res) => {
  try {
    LAST_WEBHOOK = {
      time: new Date().toISOString(),
      body: req.body
    };

    console.log("🔥 WEBHOOK POST RECEIVED 🔥");
    console.log("BODY:", JSON.stringify(req.body, null, 2));

    const body = req.body;

    if (!body || body.object !== "whatsapp_business_account") {
      console.log("ℹ️ Not whatsapp_business_account event");
      return res.sendStatus(200);
    }

    // ✅ نقرأ كل entry/changes
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        const messages = value.messages || [];
        const statuses = value.statuses || [];
        const contactsMeta = value.contacts || [];

        // ✅ إذا ما فيه messages نطبع السبب
        if (!messages.length) {
          console.log("⚠️ No messages in this event.");
          if (statuses.length) {
            console.log("✅ This event contains STATUSES only (not messages).");
          }
          console.log("VALUE:", JSON.stringify(value, null, 2));
          continue;
        }

        // ✅ هنا وصلت رسائل فعلًا
        for (const msg of messages) {
          const fromWaId = msg.from;
          const name = contactsMeta?.[0]?.profile?.name || fromWaId;

          let text = "";
          if (msg.type === "text") text = msg.text?.body || "";
          else text = `[${msg.type}]`;

          console.log("✅✅ MESSAGE RECEIVED:", { fromWaId, name, type: msg.type, text });

          // حفظ الرسالة
          const contact = await upsertContact(fromWaId, name);
          await insertMessage(contact.id, false, text, msg.type || "text", new Date().toISOString());

          const clean = (text || "").trim();
          const lower = clean.toLowerCase();

          // أوامر تشغيل/إيقاف
          const resume =
            clean.includes("تشغيل البوت") ||
            lower.includes("start bot") ||
            lower.includes("resume bot");

          const wantsAgent =
            clean.includes("حولني") ||
            clean.includes("خدمة العملاء") ||
            lower.includes("agent") ||
            lower.includes("human");

          if (resume) {
            await setBotPausedForPhone(fromWaId, false);
            const reply = "تم تشغيل البوت ✅\nاكتب سؤالك الآن.";
            await insertMessage(contact.id, true, reply, "text", new Date().toISOString());
            await sendWhatsAppMessage(fromWaId, reply);
            console.log("📤 Sent resume reply");
            continue;
          }

          if (wantsAgent) {
            await setBotPausedForPhone(fromWaId, true);
            const reply =
              "تم تحويلك لخدمة العملاء 👨‍💼\n" +
              "البوت سيتوقف مؤقتًا.\n" +
              "للعودة للبوت اكتب: تشغيل البوت";
            await insertMessage(contact.id, true, reply, "text", new Date().toISOString());
            await sendWhatsAppMessage(fromWaId, reply);
            console.log("📤 Sent agent transfer reply");
            continue;
          }

          // إذا البوت متوقف للعميل
          const fresh = await getContactByWaId(fromWaId);
          if (fresh?.bot_paused) {
            console.log("⛔ Bot paused for this contact, not replying normally.");
            const reply = "أنت الآن مع خدمة العملاء. للعودة اكتب: تشغيل البوت";
            await insertMessage(contact.id, true, reply, "text", new Date().toISOString());
            await sendWhatsAppMessage(fromWaId, reply);
            continue;
          }

          // ✅ رد تجريبي ثابت الآن (عشان نثبت الإرسال شغال 100%)
          const reply =
            "أهلاً بك في Smart Bot 🤖\n" +
            "تم استلام رسالتك بنجاح ✅\n" +
            "إذا حاب خدمة العملاء اكتب: حولني";
          await insertMessage(contact.id, true, reply, "text", new Date().toISOString());
          await sendWhatsAppMessage(fromWaId, reply);
          console.log("📤 Sent default reply OK");
        }
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.sendStatus(500);
  }
});

// ✅ بعد الويبهوك نضيف الستاتيك (مهم)
app.use(express.static(__dirname));

// fallback للواجهة (لو عندك index.html)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("🚀 Running on port:", PORT);
  console.log("✅ VERIFY_TOKEN:", VERIFY_TOKEN);
});
