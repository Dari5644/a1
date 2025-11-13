// server.js
// بوت واتساب + OpenAI + لوحتين للتواصل (A و B)

import express from "express";
import axios from "axios";
import OpenAI from "openai";
import config from "./config.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== من config.js =====
const {
  VERIFY_TOKEN,
  WABA_TOKEN,
  PHONE_ID,
  STORE_NAME,
  STORE_URL,
  PANEL_BASE_URL,
  AGENT_NUMBERS,
} = config;

// مفتاح OpenAI من .env فقط
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY مفقود في env");
}
if (!WABA_TOKEN || !PHONE_ID) {
  console.warn("⚠️ تأكد من ضبط WABA_TOKEN و PHONE_ID في config.js");
}

const BOT_NAME = "مساعد " + STORE_NAME;

// OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== ذاكرة المحادثات ======
const conversations = {};          // { waId: [ {from, text, time} ] }
const humanOnly = {};              // { waId: true/false }
const waitingTransferConfirm = {}; // { waId: true/false }

// إضافة رسالة
function addMessage(waId, from, text) {
  if (!conversations[waId]) conversations[waId] = [];
  conversations[waId].push({
    from,
    text,
    time: new Date().toLocaleTimeString("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
  if (conversations[waId].length > 40) {
    conversations[waId] = conversations[waId].slice(-40);
  }
}

// إرسال رسالة واتساب
async function sendWhatsAppMessage(to, text, tag = "bot") {
  try {
    const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WABA_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`✅ WhatsApp (${tag}) → ${to}: ${text}`);
    addMessage(to, tag === "agent" ? "agent" : tag === "system" ? "system" : "bot", text);
  } catch (err) {
    console.error("🔥 WhatsApp SEND ERROR:", err.response?.data || err.message);
  }
}

// تنبيه الموظفين برابط المحادثة
async function notifyAgents(waId, lastText, customerName) {
  if (!AGENT_NUMBERS || !AGENT_NUMBERS.length) {
    console.log("ℹ️ لا يوجد أرقام في AGENT_NUMBERS للتنبيه.");
    return;
  }

  const link = `${PANEL_BASE_URL}/inbox-a?wa=${waId}`;

  const msg =
    `🚨 عميل تم تحويله إلى خدمة العملاء في ${STORE_NAME}.\n\n` +
    `👤 الاسم: ${customerName || "عميل"}\n` +
    `📞 الرقم: ${waId}\n\n` +
    `💬 آخر رسالة من العميل:\n${lastText}\n\n` +
    `🧷 افتح المحادثة من هنا:\n${link}`;

  for (const num of AGENT_NUMBERS) {
    await sendWhatsAppMessage(num, msg, "agent-alert");
  }
}

// استدعاء OpenAI
async function getAssistantReply(waId, userText) {
  // نحول المحادثة لصيغة messages لـ OpenAI
  const history = (conversations[waId] || []).slice(-10).map((m) => {
    if (m.from === "user") return { role: "user", content: m.text };
    if (m.from === "bot" || m.from === "assistant") return { role: "assistant", content: m.text };
    return null;
  }).filter(Boolean);

  const messages = [
    {
      role: "system",
      content: `
أنت ${BOT_NAME}، مساعد دردشة ذكي يعمل لصالح "${STORE_NAME}".

- تحدث بالعربية البسيطة وبأسلوب ودّي.
- إذا قال العميل "السلام عليكم" أو "هلا" أو "مرحبا" → رحّب به مثلاً:
  "وعليكم السلام، حياك الله في ${STORE_NAME} ❤️🌹 كيف أقدر أخدمك؟"
- لا تعطي رابط المتجر إلا إذا طلبه العميل صراحة. عندها استخدم هذا فقط:
  ${STORE_URL}
- إذا سأل عن منتجات، اشرح بشكل عام (نوع المنتج، استخدامه) بدون اختراع مخزون أو حالة طلب.
- لا تذكر أسعار دقيقة إن لم تكن متأكدًا، ووجّهه للمتجر.
- لا ترسل رسائل طويلة مزعجة، كن مختصراً وواضحاً.
- إذا سأل "وش تقدر تسوي؟" وضح باختصار أنك تساعده في الاستفسار عن المنتجات، المقاسات، طريقة الشراء، ورابط المتجر عند الطلب.
- لا تذكر أنك نموذج ذكاء اصطناعي، بل تحدث كأنك موظف افتراضي من فريق ${STORE_NAME}.
`,
    },
    ...history,
    { role: "user", content: userText },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.4,
  });

  const reply =
    completion.choices[0]?.message?.content ||
    `حياك الله في ${STORE_NAME} 💚 كيف أقدر أخدمك؟`;

  addMessage(waId, "bot", reply);
  return reply;
}

// ===== Webhook Verify (GET) =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  console.log("❌ WEBHOOK VERIFY FAILED");
  return res.sendStatus(403);
});

// ===== Webhook Receive (POST) =====
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("📩 Incoming:", JSON.stringify(body, null, 2));

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(200);
  }

  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg || msg.type !== "text") return res.sendStatus(200);

    const waId = msg.from;
    const text = msg.text?.body || "";
    const lower = text.trim().toLowerCase();
    const customerName = value?.contacts?.[0]?.profile?.name || "عميل";

    addMessage(waId, "user", text);

    // إعادة تشغيل البوت برسالة
    if (
      lower.includes("اعاده تشغيل البوت") ||
      lower.includes("اعادة تشغيل البوت") ||
      lower.includes("رجع البوت") ||
      lower.includes("شغل البوت")
    ) {
      humanOnly[waId] = false;
      waitingTransferConfirm[waId] = false;
      await sendWhatsAppMessage(
        waId,
        `تم إعادة تشغيل البوت في ${STORE_NAME} 🤖.\nتفضل، كيف أقدر أخدمك الآن؟`,
        "system"
      );
      return res.sendStatus(200);
    }

    // العميل في حالة "ننتظر تأكيد تحويله"
    if (waitingTransferConfirm[waId]) {
      // وافق
      if (
        lower.includes("ايه") ||
        lower.includes("ايوه") ||
        lower.includes("ايوا") ||
        lower.includes("نعم") ||
        lower.includes("حولني") ||
        lower.includes("طيب حولني")
      ) {
        waitingTransferConfirm[waId] = false;
        humanOnly[waId] = true;

        await sendWhatsAppMessage(
          waId,
          `تم تحويلك لخدمة العملاء في ${STORE_NAME} 👨‍💼، انتظر وسيتم الرد عليك يدويًا.`,
          "system"
        );
        await notifyAgents(waId, text, customerName);
        return res.sendStatus(200);
      }

      // رفض
      if (
        lower.includes("لا") ||
        lower.includes("خلاص") ||
        lower.includes("مو لازم") ||
        lower.includes("كمل انت")
      ) {
        waitingTransferConfirm[waId] = false;
        await sendWhatsAppMessage(
          waId,
          "تمام، بكمل معك هنا كمساعد خدمة العملاء 😊",
          "bot"
        );
        // يكمل الرد العادي تحت
      }
    }

    // طلب خدمة عملاء صريح
    if (
      lower.includes("اكلم انسان") ||
      lower.includes("ابي انسان") ||
      lower.includes("خدمة عملاء") ||
      lower.includes("خدمه عملاء") ||
      lower.includes("موظف") ||
      lower.includes("اكلم موظف")
    ) {
      humanOnly[waId] = true;
      waitingTransferConfirm[waId] = false;

      await sendWhatsAppMessage(
        waId,
        `تم تحويلك مباشرة لخدمة العملاء في ${STORE_NAME} 👨‍💼، انتظر وسيتم الرد عليك يدويًا.`,
        "system"
      );
      await notifyAgents(waId, text, customerName);
      return res.sendStatus(200);
    }

    // إذا العميل متضايق/مو فاهم → نقترح التحويل
    const frustrated =
      lower.includes("ما فهمت") ||
      lower.includes("مافهمت") ||
      lower.includes("ما فهمتك") ||
      lower.includes("غير واضح") ||
      lower.includes("مو واضح") ||
      lower.includes("غلط") ||
      lower.includes("مو كذا") ||
      lower.includes("ما فاد") ||
      lower.includes("ما فادني") ||
      lower.includes("ما استفدت") ||
      lower.includes("مو مفيد") ||
      lower.includes("هذا مو اللي ابيه");

    if (frustrated && !humanOnly[waId]) {
      waitingTransferConfirm[waId] = true;
      await sendWhatsAppMessage(
        waId,
        "يبدو إن الموضوع يحتاج متابعة من موظف خدمة العملاء 👨‍💼.\n" +
          "تحب أنقلك لهم؟ إذا حاب رد بـ (ايه) أو (نعم)، وإذا تبي تكمل معي قل (لا).",
        "bot"
      );
      return res.sendStatus(200);
    }

    // إذا في وضع خدمة عملاء فقط → الموظف يرد من اللوحة
    if (humanOnly[waId]) {
      console.log(`🙋‍♂️ ${waId} في وضع خدمة عملاء فقط، الموظف يرد من اللوحة.`);
      return res.sendStatus(200);
    }

    // رد طبيعي من OpenAI
    try {
      const reply = await getAssistantReply(waId, text);
      await sendWhatsAppMessage(waId, reply, "bot");
    } catch (err) {
      console.error("🔥 OpenAI ERROR:", err.response?.data || err.message);
      await sendWhatsAppMessage(
        waId,
        "واجهتني مشكلة تقنية بسيطة أثناء إنشاء الرد 🤖، حاول تكتب رسالتك مرة ثانية أو بعد قليل.",
        "error"
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 WEBHOOK HANDLER ERROR:", err.message);
    return res.sendStatus(500);
  }
});

// ===== API للوحة (الاثنتين) =====

// كل المحادثات
app.get("/api/conversations", (req, res) => {
  res.json({
    storeName: STORE_NAME,
    conversations,
    humanOnly,
  });
});

// إرسال رد من موظف
app.post("/api/agent/send", async (req, res) => {
  const { wa_id, text } = req.body || {};
  if (!wa_id || !text) return res.status(400).json({ ok: false, error: "missing wa_id or text" });

  await sendWhatsAppMessage(wa_id, text, "agent");
  res.json({ ok: true });
});

// إيقاف البوت لهذا العميل
app.post("/api/agent/bot-stop", async (req, res) => {
  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });

  humanOnly[wa_id] = true;
  await sendWhatsAppMessage(
    wa_id,
    `تم تحويل محادثتك لوضع خدمة العملاء في ${STORE_NAME} 👨‍💼، سيتم الرد عليك يدويًا.`,
    "system"
  );
  res.json({ ok: true });
});

// إعادة تشغيل البوت لهذا العميل
app.post("/api/agent/bot-reset", async (req, res) => {
  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });

  humanOnly[wa_id] = false;
  waitingTransferConfirm[wa_id] = false;
  await sendWhatsAppMessage(
    wa_id,
    `تم إعادة تشغيل البوت في ${STORE_NAME} 🤖، تقدر تكمل سؤالك هنا.`,
    "system"
  );
  res.json({ ok: true });
});

// ===== صفحة الرئيسية بسيطة =====
app.get("/", (req, res) => {
  res.send(`
    <html dir="rtl" lang="ar">
      <head><meta charset="utf-8" /><title>${STORE_NAME} - لوحة البوت</title></head>
      <body style="font-family: system-ui; background:#f4f4f5; padding:20px;">
        <h2>بوت واتساب لـ ${STORE_NAME} شغال ✅</h2>
        <p>اختر لوحة التواصل:</p>
        <ul>
          <li><a href="/inbox-a">📥 لوحة A (نمط واتساب ويب)</a></li>
          <li><a href="/inbox-b">📥 لوحة B (نمط بسيط فوق/تحت)</a></li>
        </ul>
      </body>
    </html>
  `);
});

// ===== لوحة A: WhatsApp Web style =====
app.get("/inbox-a", (req, res) => {
  const initialWa = req.query.wa || "";
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>لوحة A - محادثات ${STORE_NAME}</title>
  <style>
    body { margin:0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"; background:#0f172a; color:#e5e7eb; }
    .layout { display:flex; height:100vh; }
    .sidebar { width:280px; background:#020617; border-left:1px solid #1e293b; display:flex; flex-direction:column; }
    .sidebar-header { padding:16px; border-bottom:1px solid #1e293b; font-weight:700; font-size:16px; display:flex; align-items:center; gap:8px; }
    .sidebar-header span.icon { width:28px; height:28px; border-radius:999px; background:#a855f722; display:flex; align-items:center; justify-content:center; color:#a855f7; }
    .sidebar-sub { font-size:11px; color:#64748b; margin-top:2px; }
    .contact-list { flex:1; overflow-y:auto; }
    .contact { padding:10px 14px; cursor:pointer; border-bottom:1px solid #020617; font-size:14px; }
    .contact.active { background:#111827; }
    .contact strong { display:block; }
    .contact small { color:#64748b; display:block; margin-top:2px; font-size:11px; }
    .chat { flex:1; display:flex; flex-direction:column; background:radial-gradient(circle at top left,#1f2937,#020617); }
    .chat-header { padding:14px 18px; border-bottom:1px solid #1f2937; display:flex; align-items:center; justify-content:space-between; }
    .chat-title { font-size:15px; font-weight:600; }
    .chat-subtitle { font-size:12px; color:#9ca3af; margin-top:2px; }
    .chat-header-right { display:flex; flex-direction:column; align-items:flex-end; gap:4px; font-size:12px; }
    .status-pill { padding:3px 8px; border-radius:999px; border:1px solid #4ade8055; color:#bbf7d0; background:#16a34a22; }
    .status-pill.off { border-color:#f9737355; color:#fecaca; background:#b91c1c22; }
    .btn-small { padding:4px 10px; border-radius:999px; border:none; background:linear-gradient(135deg,#a855f7,#ec4899); color:#fff; font-size:11px; cursor:pointer; }
    .btn-small:hover { opacity:0.9; }
    .chat-messages { flex:1; padding:16px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
    .bubble-row { display:flex; }
    .bubble { max-width:70%; padding:8px 10px; border-radius:18px; font-size:13px; line-height:1.4; }
    .from-user { justify-content:flex-start; }
    .from-user .bubble { background:#0ea5e9; color:#f9fafb; border-bottom-right-radius:4px; }
    .from-bot { justify-content:flex-end; }
    .from-bot .bubble { background:#22c55e; color:#052e16; border-bottom-left-radius:4px; }
    .from-agent { justify-content:flex-end; }
    .from-agent .bubble { background:#e5e7eb; color:#020617; border-bottom-left-radius:4px; border:1px solid #c4b5fd; }
    .from-system { justify-content:center; }
    .from-system .bubble { background:#020617; color:#e5e7eb; border-radius:999px; border:1px dashed #4b5563; font-size:12px; }
    .time { font-size:10px; color:#d1d5db; margin-top:2px; text-align:left; }
    .bubble-wrap { display:flex; flex-direction:column; }
    .empty { flex:1; display:flex; align-items:center; justify-content:center; color:#6b7280; font-size:14px; }
    .chat-input { border-top:1px solid #1f2937; padding:10px 14px; display:flex; gap:8px; background:#020617; }
    .chat-input input { flex:1; padding:9px 10px; border-radius:999px; border:1px solid #374151; background:#020617; color:#e5e7eb; outline:none; font-size:13px; }
    .chat-input button { padding:9px 14px; border-radius:999px; border:none; background:linear-gradient(135deg,#a855f7,#ec4899); color:#fff; font-size:13px; font-weight:600; cursor:pointer; }
    .chat-input button:hover { opacity:0.9; }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="icon">💬</span>
        <div>
          <div>${STORE_NAME}</div>
          <div class="sidebar-sub">لوحة A - نمط واتساب ويب</div>
        </div>
      </div>
      <div id="contactList" class="contact-list"></div>
    </div>

    <div class="chat">
      <div class="chat-header">
        <div>
          <div id="chatTitle" class="chat-title">اختر عميل من القائمة</div>
          <div id="chatSubtitle" class="chat-subtitle">سيتم عرض المحادثة هنا.</div>
        </div>
        <div class="chat-header-right">
          <div id="botStatus" class="status-pill off">البوت غير نشط</div>
          <div style="display:flex; gap:6px;">
            <button id="btnBotReset" class="btn-small">تشغيل البوت 🤖</button>
            <button id="btnBotStop" class="btn-small" style="background:linear-gradient(135deg,#ef4444,#f97316);">إيقاف البوت 👨‍💼</button>
          </div>
        </div>
      </div>
      <div id="chatMessages" class="chat-messages">
        <div class="empty">لا توجد محادثة محددة بعد.</div>
      </div>
      <form id="agentForm" class="chat-input">
        <input type="hidden" id="wa_id" />
        <input type="text" id="agentText" placeholder="اكتب ردك كموظف..." autocomplete="off" />
        <button type="submit">إرسال ✅</button>
      </form>
    </div>
  </div>

  <script>
    let conversations = {};
    let humanOnly = {};
    let currentWaId = "${initialWa}";
    const contactListEl = document.getElementById("contactList");
    const chatMessagesEl = document.getElementById("chatMessages");
    const chatTitleEl = document.getElementById("chatTitle");
    const chatSubtitleEl = document.getElementById("chatSubtitle");
    const botStatusEl = document.getElementById("botStatus");
    const waIdInput = document.getElementById("wa_id");
    const agentForm = document.getElementById("agentForm");
    const agentTextInput = document.getElementById("agentText");
    const btnBotReset = document.getElementById("btnBotReset");
    const btnBotStop = document.getElementById("btnBotStop");

    async function loadData() {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        conversations = data.conversations || {};
        humanOnly = data.humanOnly || {};
        renderContacts();
        renderChat();
      } catch (e) {
        console.error("Error loading data", e);
      }
    }

    function renderContacts() {
      contactListEl.innerHTML = "";
      const ids = Object.keys(conversations);
      if (!ids.length) {
        contactListEl.innerHTML = '<div class="contact">لا توجد محادثات حتى الآن.</div>';
        return;
      }
      ids.forEach((id) => {
        const msgs = conversations[id] || [];
        const last = msgs[msgs.length - 1];
        const div = document.createElement("div");
        div.className = "contact" + (currentWaId === id ? " active" : "");
        div.dataset.waId = id;
        const isHuman = !!humanOnly[id];
        div.innerHTML = "<strong>" + id + (isHuman ? " 👨‍💼" : "") + "</strong>" +
          (last ? "<small>" + last.text.slice(0,40) + "</small>" : "");
        div.onclick = () => {
          currentWaId = id;
          renderContacts();
          renderChat();
        };
        contactListEl.appendChild(div);
      });
    }

    function renderChat() {
      if (!currentWaId || !conversations[currentWaId]) {
        chatTitleEl.textContent = "اختر عميل من القائمة";
        chatSubtitleEl.textContent = "سيتم عرض المحادثة هنا.";
        botStatusEl.textContent = "البوت غير نشط";
        botStatusEl.classList.add("off");
        waIdInput.value = "";
        chatMessagesEl.innerHTML = '<div class="empty">لا توجد محادثة محددة بعد.</div>';
        return;
      }

      const msgs = conversations[currentWaId] || [];
      chatTitleEl.textContent = "العميل: " + currentWaId;
      chatSubtitleEl.textContent = "عدد الرسائل: " + msgs.length;
      waIdInput.value = currentWaId;

      const isHuman = !!humanOnly[currentWaId];
      if (isHuman) {
        botStatusEl.textContent = "وضع خدمة العملاء (البوت متوقف)";
        botStatusEl.classList.add("off");
      } else {
        botStatusEl.textContent = "البوت نشط لهذا العميل";
        botStatusEl.classList.remove("off");
      }

      chatMessagesEl.innerHTML = "";
      msgs.forEach((m) => {
        const row = document.createElement("div");
        let cls = "from-user";
        if (m.from === "bot") cls = "from-bot";
        if (m.from === "agent") cls = "from-agent";
        if (m.from === "system") cls = "from-system";
        row.className = "bubble-row " + cls;
        const wrap = document.createElement("div");
        wrap.className = "bubble-wrap";
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = m.text;
        const time = document.createElement("div");
        time.className = "time";
        time.textContent = m.time || "";
        wrap.appendChild(bubble);
        wrap.appendChild(time);
        row.appendChild(wrap);
        chatMessagesEl.appendChild(row);
      });
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    agentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const waId = waIdInput.value.trim();
      const text = agentTextInput.value.trim();
      if (!waId || !text) return;
      try {
        await fetch("/api/agent/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wa_id: waId, text }),
        });
        agentTextInput.value = "";
        // نضيفها محليًا
        if (!conversations[waId]) conversations[waId] = [];
        conversations[waId].push({
          from: "agent",
          text,
          time: new Date().toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"})
        });
        renderChat();
      } catch (e) {
        alert("حدث خطأ في الإرسال");
      }
    });

    btnBotReset.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wa_id: currentWaId }),
      });
      humanOnly[currentWaId] = false;
      renderChat();
    });

    btnBotStop.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wa_id: currentWaId }),
      });
      humanOnly[currentWaId] = true;
      renderChat();
    });

    loadData();
    setInterval(loadData, 3000);
  </script>
</body>
</html>
  `);
});

// ===== لوحة B: بسيطة فوق/تحت =====
app.get("/inbox-b", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>لوحة B - محادثات ${STORE_NAME}</title>
  <style>
    body { margin:0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"; background:#0b1120; color:#e5e7eb; }
    .container { display:flex; flex-direction:column; height:100vh; }
    header { padding:14px 16px; border-bottom:1px solid #1f2937; display:flex; justify-content:space-between; align-items:center; background:#020617; }
    header .title { font-weight:600; font-size:16px; }
    header .sub { font-size:12px; color:#9ca3af; }
    .top-bar { padding:8px 16px; background:#020617; display:flex; flex-wrap:wrap; align-items:center; gap:8px; border-bottom:1px solid #1f2937; }
    select { background:#020617; color:#e5e7eb; border:1px solid #374151; border-radius:999px; padding:6px 10px; font-size:13px; min-width:140px; }
    .pill { padding:3px 8px; border-radius:999px; font-size:11px; border:1px solid #4ade8055; color:#bbf7d0; background:#16a34a22; }
    .pill.off { border-color:#f9737355; color:#fecaca; background:#b91c1c22; }
    button { border:none; border-radius:999px; padding:6px 10px; font-size:12px; cursor:pointer; }
    .btn-primary { background:linear-gradient(135deg,#a855f7,#ec4899); color:#fff; }
    .btn-danger { background:linear-gradient(135deg,#ef4444,#f97316); color:#fff; }
    main { flex:1; display:flex; flex-direction:column; }
    #chatMessages { flex:1; padding:16px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; background:radial-gradient(circle at top,#111827,#020617); }
    .bubble-row { display:flex; }
    .bubble { max-width:75%; padding:8px 10px; border-radius:18px; font-size:13px; line-height:1.4; }
    .from-user { justify-content:flex-start; }
    .from-user .bubble { background:#0ea5e9; color:#f9fafb; border-bottom-right-radius:4px; }
    .from-bot { justify-content:flex-end; }
    .from-bot .bubble { background:#22c55e; color:#052e16; border-bottom-left-radius:4px; }
    .from-agent { justify-content:flex-end; }
    .from-agent .bubble { background:#e5e7eb; color:#020617; border-bottom-left-radius:4px; border:1px solid #c4b5fd; }
    .from-system { justify-content:center; }
    .from-system .bubble { background:#020617; color:#e5e7eb; border-radius:999px; border:1px dashed #4b5563; font-size:12px; }
    .time { font-size:10px; color:#d1d5db; margin-top:2px; text-align:left; }
    .bubble-wrap { display:flex; flex-direction:column; }
    .empty { flex:1; display:flex; align-items:center; justify-content:center; color:#6b7280; }
    form { border-top:1px solid #1f2937; padding:10px 14px; display:flex; gap:8px; background:#020617; }
    form input { flex:1; padding:9px 10px; border-radius:999px; border:1px solid #374151; background:#020617; color:#e5e7eb; outline:none; font-size:13px; }
    form button { padding:9px 14px; font-size:13px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="title">${STORE_NAME}</div>
        <div class="sub">لوحة B - نمط بسيط فوق/تحت</div>
      </div>
      <div style="font-size:11px; color:#9ca3af;">مساعد: ${BOT_NAME}</div>
    </header>
    <div class="top-bar">
      <label for="clientSelect" style="font-size:12px;">المحادثة:</label>
      <select id="clientSelect"></select>
      <span id="botStatusB" class="pill off">البوت غير نشط</span>
      <button id="btnResetB" class="btn-primary">تشغيل البوت 🤖</button>
      <button id="btnStopB" class="btn-danger">إيقاف البوت 👨‍💼</button>
    </div>
    <main>
      <div id="chatMessages" class="chat-messages">
        <div class="empty">لا توجد محادثة محددة بعد.</div>
      </div>
      <form id="agentFormB">
        <input type="hidden" id="wa_id_b" />
        <input type="text" id="agentTextB" placeholder="اكتب ردك كموظف..." autocomplete="off" />
        <button type="submit" class="btn-primary">إرسال ✅</button>
      </form>
    </main>
  </div>

  <script>
    let conversations = {};
    let humanOnly = {};
    let currentWaId = "";
    const clientSelect = document.getElementById("clientSelect");
    const chatMessagesEl = document.getElementById("chatMessages");
    const botStatusEl = document.getElementById("botStatusB");
    const agentForm = document.getElementById("agentFormB");
    const waIdInput = document.getElementById("wa_id_b");
    const agentTextInput = document.getElementById("agentTextB");
    const btnReset = document.getElementById("btnResetB");
    const btnStop = document.getElementById("btnStopB");

    async function loadData() {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        conversations = data.conversations || {};
        humanOnly = data.humanOnly || {};
        renderClients();
        renderChat();
      } catch (e) {
        console.error("Error loading data", e);
      }
    }

    function renderClients() {
      const ids = Object.keys(conversations);
      clientSelect.innerHTML = "";
      if (!ids.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "لا توجد محادثات";
        clientSelect.appendChild(opt);
        currentWaId = "";
        return;
      }
      if (!currentWaId || !conversations[currentWaId]) {
        currentWaId = ids[0];
      }
      ids.forEach((id) => {
        const msgs = conversations[id] || [];
        const last = msgs[msgs.length - 1];
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id + (last ? " - " + (last.text.slice(0,20)) : "");
        if (id === currentWaId) opt.selected = true;
        clientSelect.appendChild(opt);
      });
    }

    function renderChat() {
      if (!currentWaId || !conversations[currentWaId]) {
        chatMessagesEl.innerHTML = '<div class="empty">لا توجد محادثة محددة بعد.</div>';
        botStatusEl.textContent = "البوت غير نشط";
        botStatusEl.classList.add("off");
        waIdInput.value = "";
        return;
      }
      waIdInput.value = currentWaId;
      const msgs = conversations[currentWaId] || [];
      const isHuman = !!humanOnly[currentWaId];
      if (isHuman) {
        botStatusEl.textContent = "وضع خدمة العملاء (البوت متوقف)";
        botStatusEl.classList.add("off");
      } else {
        botStatusEl.textContent = "البوت نشط لهذا العميل";
        botStatusEl.classList.remove("off");
      }

      chatMessagesEl.innerHTML = "";
      msgs.forEach((m) => {
        const row = document.createElement("div");
        let cls = "from-user";
        if (m.from === "bot") cls = "from-bot";
        if (m.from === "agent") cls = "from-agent";
        if (m.from === "system") cls = "from-system";
        row.className = "bubble-row " + cls;
        const wrap = document.createElement("div");
        wrap.className = "bubble-wrap";
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = m.text;
        const time = document.createElement("div");
        time.className = "time";
        time.textContent = m.time || "";
        wrap.appendChild(bubble);
        wrap.appendChild(time);
        row.appendChild(wrap);
        chatMessagesEl.appendChild(row);
      });
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    clientSelect.addEventListener("change", () => {
      currentWaId = clientSelect.value;
      renderChat();
    });

    agentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const waId = waIdInput.value.trim();
      const text = agentTextInput.value.trim();
      if (!waId || !text) return;
      try {
        await fetch("/api/agent/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wa_id: waId, text }),
        });
        agentTextInput.value = "";
        if (!conversations[waId]) conversations[waId] = [];
        conversations[waId].push({
          from: "agent",
          text,
          time: new Date().toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"})
        });
        renderChat();
      } catch (e) {
        alert("حدث خطأ في الإرسال");
      }
    });

    btnReset.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wa_id: currentWaId }),
      });
      humanOnly[currentWaId] = false;
      renderChat();
    });

    btnStop.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wa_id: currentWaId }),
      });
      humanOnly[currentWaId] = true;
      renderChat();
    });

    loadData();
    setInterval(loadData, 3000);
  </script>
</body>
</html>
  `);
});

// ===== تشغيل السيرفر =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
