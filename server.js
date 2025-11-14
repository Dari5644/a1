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
  addNotification,
} from "./db.js";

const app = express();
initDb();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============ Helpers ============

async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/${config.META_VERSION}/${config.PHONE_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${config.WABA_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("WhatsApp Error:", err.response?.data || err.message);
  }
}

async function sendTemplate(to, templateName, variables = []) {
  const url = `https://graph.facebook.com/${config.META_VERSION}/${config.PHONE_ID}/messages`;

  const components =
    variables.length > 0
      ? [
          {
            type: "body",
            parameters: variables.map((v) => ({
              type: "text",
              text: v,
            })),
          },
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
        components,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${config.WABA_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

function isHumanRequest(text) {
  const t = text.toLowerCase();
  const keys = [
    "خدمة عملاء",
    "اكلم انسان",
    "أكلم إنسان",
    "موظف",
    "بشر",
    "اريد موظف",
  ];
  return keys.some((k) => t.includes(k));
}

// ============ OpenAI bot logic ============

async function generateBotReply(userText) {
  const systemPrompt = `
أنت بوت خدمة عملاء لمتجر "${config.STORE_NAME}" رابط المتجر: ${config.STORE_URL}.
قواعدك:
- إذا قال العميل "السلام عليكم" أو تحية مشابهة، رد: "وعليكم السلام، حياك الله في ${config.STORE_NAME} ❤️🌹 كيف أقدر أخدمك؟"
- لا ترسل رابط المتجر إلا إذا طلبه العميل صراحة.
- إذا سأل عن منتج، تخيل أنك تبحث داخل المتجر ورد بإيجاز (جملة أو جملتين).
- إذا سأل عن حالة الطلب، قل له أنك لا تستطيع رؤية الطلب وتطلب منه انتظار رد خدمة العملاء.
- لا ترسل فقرات طويلة، ردودك قصيرة وواضحة فقط.
- لا تقدّم خدمات خارج نطاق متجر ${config.STORE_NAME}.
- الرد دائمًا بالعربية وبأسلوب بسيط.
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.4,
      max_tokens: 220,
    });

    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI Error:", err.response?.data || err.message);
    return "صار عندنا خلل تقني بسيط، حاول بعد شوي أو اطلب تحويلك لخدمة العملاء 🌹";
  }
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
    const from = msg.from; // 9665xxxx
    const name = value.contacts?.[0]?.profile?.name || "";
    const text = msg.text?.body || "";

    let conv = await getOrCreateConversation(from, name);

    // طلب خدمة عملاء
    if (isHumanRequest(text)) {
      await setConversationMode(conv.id, "human");
      await addNotification("human_request", { id: conv.id, wa_id: from });

      await sendWhatsAppText(
        from,
        "تم تحويلك لخدمة العملاء 🌹 سيتم الرد عليك من أحد الموظفين."
      );
      return res.sendStatus(200);
    }

    // إذا المحادثة في وضع human → الموظف يتولى الرد
    conv = await getConversationById(conv.id);
    if (conv.mode === "human") {
      await addMessage(conv.id, from, "user", text);
      return res.sendStatus(200);
    }

    // حفظ رسالة العميل
    await addMessage(conv.id, from, "user", text);

    // رد البوت
    const reply = await generateBotReply(text);
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
  try {
    const rows = await listConversations();
    res.json(rows);
  } catch (err) {
    console.error("API /conversations error:", err);
    res.sendStatus(500);
  }
});

// ============ API: رسائل محادثة ============

app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await getMessagesForConversation(id);
    res.json(rows);
  } catch (err) {
    console.error("API /messages error:", err);
    res.sendStatus(500);
  }
});

// ============ API: رد موظف ============

app.post("/api/conversations/:id/send", async (req, res) => {
  try {
    const convId = Number(req.params.id);
    const { text, staffEmail } = req.body;

    if (!text) return res.status(400).json({ error: "no text" });

    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: "not found" });

    await setConversationMode(convId, "human", staffEmail || null);
    await sendWhatsAppText(conv.wa_id, text);
    await addMessage(convId, conv.wa_id, "staff", text);

    res.json({ ok: true });
  } catch (err) {
    console.error("API /send error:", err);
    res.sendStatus(500);
  }
});

// ============ API: إعادة تشغيل البوت ============

app.post("/api/conversations/:id/restart-bot", async (req, res) => {
  try {
    const convId = Number(req.params.id);
    await setConversationMode(convId, "bot", null);
    res.json({ ok: true });
  } catch (err) {
    console.error("API restart-bot error:", err);
    res.sendStatus(500);
  }
});

// ============ API: إرسال قالب جماعي بسيط ============

app.post("/api/broadcast", async (req, res) => {
  try {
    const { numbers } = req.body;
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ error: "no numbers" });
    }

    const results = [];
    for (const num of numbers) {
      const to = num.startsWith("0") ? "966" + num.slice(1) : num;
      try {
        await sendTemplate(to, config.BROADCAST_TEMPLATE);
        results.push({ number: to, ok: true });
      } catch (err) {
        results.push({
          number: to,
          ok: false,
          error: err.response?.data || err.message,
        });
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error("API broadcast error:", err);
    res.sendStatus(500);
  }
});

// ============ واجهة الموقع (Inbox) ============

app.get("/", (req, res) => {
  res.send(`
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>لوحة محادثات واتساب - ${config.STORE_NAME}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #020617;
      color: #e5e7eb;
      direction: rtl;
    }
    .app {
      display: flex;
      height: 100vh;
    }
    .sidebar {
      width: 28%;
      border-left: 1px solid #111827;
      background: #020617;
      display: flex;
      flex-direction: column;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      padding: 10px 16px;
      border-bottom: 1px solid #111827;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #020617;
    }
    .topbar h1 {
      font-size: 16px;
      margin: 0;
    }
    .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #1f2937;
      background: #020617;
      color: #9ca3af;
    }
    .conv-list {
      flex: 1;
      overflow-y: auto;
    }
    .conv-item {
      padding: 10px 12px;
      border-bottom: 1px solid #0f172a;
      cursor: pointer;
      transition: background 0.15s;
    }
    .conv-item:hover {
      background: #020617;
    }
    .conv-item.active {
      background: #111827;
    }
    .conv-title {
      font-size: 14px;
      margin-bottom: 4px;
    }
    .conv-last {
      font-size: 12px;
      color: #9ca3af;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .conv-meta {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
      display: flex;
      justify-content: space-between;
    }
    .chat-header {
      padding: 10px 16px;
      border-bottom: 1px solid #111827;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #020617;
    }
    .chat-header-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .chat-header-title {
      font-size: 14px;
      font-weight: 600;
    }
    .chat-header-sub {
      font-size: 11px;
      color: #9ca3af;
    }
    .chat-header-actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      border-radius: 999px;
      border: none;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
    }
    .btn-primary {
      background: #22c55e;
      color: #020617;
    }
    .btn-secondary {
      background: #020617;
      color: #e5e7eb;
      border: 1px solid #1f2937;
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .chat-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      background: radial-gradient(circle at top, #0f172a, #020617 55%);
    }
    .msg-row {
      margin-bottom: 8px;
      display: flex;
      flex-direction: column;
      max-width: 70%;
    }
    .msg-user {
      align-items: flex-start;
    }
    .msg-bot {
      align-items: flex-end;
      margin-left: auto;
    }
    .msg-staff {
      align-items: flex-end;
      margin-left: auto;
    }
    .msg-bubble {
      padding: 8px 10px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .msg-bubble-user {
      background: #111827;
      border-bottom-left-radius: 2px;
    }
    .msg-bubble-bot {
      background: #22c55e;
      color: #022c22;
      border-bottom-right-radius: 2px;
    }
    .msg-bubble-staff {
      background: #0ea5e9;
      color: #0b1120;
      border-bottom-right-radius: 2px;
    }
    .msg-meta {
      font-size: 10px;
      color: #9ca3af;
      margin-top: 2px;
    }
    .chat-input {
      border-top: 1px solid #111827;
      padding: 8px 10px;
      display: flex;
      gap: 8px;
      background: #020617;
    }
    .chat-input textarea {
      flex: 1;
      resize: none;
      border-radius: 12px;
      border: 1px solid #1f2937;
      background: #020617;
      color: #e5e7eb;
      font-size: 13px;
      padding: 8px 10px;
      min-height: 40px;
      max-height: 120px;
    }
    .chat-input textarea:focus {
      outline: none;
      border-color: #22c55e;
    }
    .chat-input .btn-send {
      align-self: flex-end;
    }
    .sidebar-header {
      padding: 10px 12px;
      border-bottom: 1px solid #111827;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #020617;
    }
    .sidebar-title {
      font-size: 14px;
      font-weight: 600;
    }
    .sidebar-sub {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 2px;
    }
    .sidebar-footer {
      padding: 8px 12px;
      border-top: 1px solid #111827;
      font-size: 11px;
      color: #6b7280;
    }
    .pill {
      border-radius: 999px;
      border: 1px solid #1f2937;
      padding: 2px 8px;
      font-size: 11px;
      color: #9ca3af;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #22c55e;
    }
    .mode-chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #1f2937;
      color: #9ca3af;
    }
    .mode-chip-human {
      border-color: #f97316;
      color: #fed7aa;
    }
    .mode-chip-bot {
      border-color: #22c55e;
      color: #bbf7d0;
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="sidebar">
      <div class="sidebar-header">
        <div>
          <div class="sidebar-title">محادثات واتساب</div>
          <div class="sidebar-sub">${config.STORE_NAME}</div>
        </div>
        <div class="pill">
          <span class="status-dot"></span>
          البوت متصل
        </div>
      </div>
      <div class="conv-list" id="conversations"></div>
      <div class="sidebar-footer">
        يعرض آخر المحادثات المتصلة برقم واتساب البوت.
      </div>
    </div>
    <div class="main">
      <div class="chat-header">
        <div class="chat-header-info">
          <div class="chat-header-title" id="chat-title">اختر محادثة من اليسار</div>
          <div class="chat-header-sub" id="chat-sub"></div>
        </div>
        <div class="chat-header-actions">
          <span class="mode-chip mode-chip-bot" id="mode-chip" style="display:none;"></span>
          <button class="btn btn-secondary" id="restart-btn" disabled>إعادة تشغيل البوت</button>
        </div>
      </div>
      <div class="chat-body" id="chat-body">
        <p style="font-size:13px;color:#9ca3af;">اختر محادثة من القائمة لعرض الرسائل والرد على العميل.</p>
      </div>
      <div class="chat-input">
        <textarea id="reply-text" placeholder="اكتب ردك هنا كموظف خدمة العملاء..." disabled></textarea>
        <button class="btn btn-primary btn-send" id="send-btn" disabled>إرسال</button>
      </div>
    </div>
  </div>

  <script>
    let currentConversationId = null;
    let conversationsCache = [];
    const STAFF_EMAIL = "agent@aldeem.com"; // عدّل الإيميل لو حاب تميّز الموظف

    async function loadConversations() {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        conversationsCache = data;
        renderConversations();
      } catch (e) {
        console.error("loadConversations error", e);
      }
    }

    function renderConversations() {
      const container = document.getElementById("conversations");
      container.innerHTML = "";
      if (!conversationsCache.length) {
        container.innerHTML = '<div style="padding:12px;font-size:13px;color:#9ca3af;">لا توجد محادثات بعد.</div>';
        return;
      }
      conversationsCache.forEach(conv => {
        const div = document.createElement("div");
        div.className = "conv-item" + (conv.id === currentConversationId ? " active" : "");
        div.onclick = () => selectConversation(conv.id);

        const title = document.createElement("div");
        title.className = "conv-title";
        title.textContent = conv.name && conv.name.trim() ? conv.name + " - " + conv.wa_id : conv.wa_id;

        const last = document.createElement("div");
        last.className = "conv-last";
        last.textContent = conv.last_message || "";

        const meta = document.createElement("div");
        meta.className = "conv-meta";
        const mode = conv.mode === "human" ? "خدمة عملاء" : "بوت";
        const lastFrom = conv.last_from === "user" ? "عميل" :
                         conv.last_from === "bot" ? "بوت" :
                         conv.last_from === "staff" ? "موظف" :
                         conv.last_from || "غير معروف";

        meta.innerHTML = '<span>' + mode + '</span><span>آخر رسالة من: ' + lastFrom + '</span>';

        div.appendChild(title);
        div.appendChild(last);
        div.appendChild(meta);

        container.appendChild(div);
      });
    }

    async function selectConversation(id) {
      currentConversationId = id;
      renderConversations();
      await loadMessages(id);
      updateHeader();
      enableInput(true);
    }

    async function loadMessages(id) {
      try {
        const res = await fetch("/api/conversations/" + id + "/messages");
        const data = await res.json();
        renderMessages(data);
      } catch (e) {
        console.error("loadMessages error", e);
      }
    }

    function formatTime(ts) {
      if (!ts) return "";
      try {
        const d = new Date(ts);
        return d.toLocaleString("ar-SA");
      } catch {
        return "";
      }
    }

    function renderMessages(msgs) {
      const container = document.getElementById("chat-body");
      container.innerHTML = "";

      if (!msgs.length) {
        container.innerHTML = '<p style="font-size:13px;color:#9ca3af;">لا توجد رسائل بعد في هذه المحادثة.</p>';
        return;
      }

      msgs.forEach(m => {
        const row = document.createElement("div");
        let cls = "msg-row msg-user";
        if (m.from_type === "bot") cls = "msg-row msg-bot";
        if (m.from_type === "staff") cls = "msg-row msg-staff";
        row.className = cls;

        const bubble = document.createElement("div");
        bubble.className = "msg-bubble " +
          (m.from_type === "user"
            ? "msg-bubble-user"
            : m.from_type === "staff"
            ? "msg-bubble-staff"
            : "msg-bubble-bot");

        bubble.textContent = m.body;

        const meta = document.createElement("div");
        meta.className = "msg-meta";
        let src = m.from_type === "user" ? "عميل" :
                  m.from_type === "bot" ? "بوت" :
                  "موظف";
        meta.textContent = src + " • " + formatTime(m.created_at);

        row.appendChild(bubble);
        row.appendChild(meta);

        container.appendChild(row);
      });

      container.scrollTop = container.scrollHeight;
    }

    function updateHeader() {
      const titleEl = document.getElementById("chat-title");
      const subEl = document.getElementById("chat-sub");
      const modeChip = document.getElementById("mode-chip");
      const restartBtn = document.getElementById("restart-btn");

      if (!currentConversationId) {
        titleEl.textContent = "اختر محادثة من اليسار";
        subEl.textContent = "";
        modeChip.style.display = "none";
        restartBtn.disabled = true;
        return;
      }

      const conv = conversationsCache.find(c => c.id === currentConversationId);
      if (!conv) return;

      titleEl.textContent = conv.name && conv.name.trim() ? conv.name : conv.wa_id;
      subEl.textContent = "رقم العميل: " + conv.wa_id;

      modeChip.style.display = "inline-flex";
      if (conv.mode === "human") {
        modeChip.textContent = "الوضع: خدمة عملاء";
        modeChip.className = "mode-chip mode-chip-human";
      } else {
        modeChip.textContent = "الوضع: بوت";
        modeChip.className = "mode-chip mode-chip-bot";
      }

      restartBtn.disabled = conv.mode === "bot";
    }

    function enableInput(enabled) {
      const ta = document.getElementById("reply-text");
      const btn = document.getElementById("send-btn");
      ta.disabled = !enabled;
      btn.disabled = !enabled;
      if (enabled) ta.focus();
    }

    async function sendReply() {
      if (!currentConversationId) return;
      const ta = document.getElementById("reply-text");
      const text = ta.value.trim();
      if (!text) return;

      try {
        const res = await fetch("/api/conversations/" + currentConversationId + "/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            staffEmail: STAFF_EMAIL
          })
        });
        const data = await res.json();
        if (data.ok) {
          ta.value = "";
          await loadMessages(currentConversationId);
          await loadConversations();
          updateHeader();
        } else {
          console.error("sendReply error", data);
        }
      } catch (e) {
        console.error("sendReply error", e);
      }
    }

    async function restartBot() {
      if (!currentConversationId) return;
      try {
        const res = await fetch("/api/conversations/" + currentConversationId + "/restart-bot", {
          method: "POST"
        });
        const data = await res.json();
        if (data.ok) {
          await loadConversations();
          updateHeader();
        }
      } catch (e) {
        console.error("restartBot error", e);
      }
    }

    document.getElementById("send-btn").addEventListener("click", sendReply);
    document.getElementById("reply-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
    });
    document.getElementById("restart-btn").addEventListener("click", restartBot);

    // تحديث تلقائي كل 5 ثواني
    setInterval(async () => {
      await loadConversations();
      if (currentConversationId) {
        await loadMessages(currentConversationId);
      }
      updateHeader();
    }, 5000);

    // أول تحميل
    loadConversations();
  </script>
</body>
</html>
  `);
});

// ============ Start server ============

app.listen(config.PORT, () => {
  console.log("🚀 SERVER RUNNING ON PORT " + config.PORT);
});
