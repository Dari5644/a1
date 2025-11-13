// server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";
import config from "./config.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ------------ OpenAI ------------
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// ------------ تخزين المحادثات + وضع الموظف فقط -------------
// conversations = { wa_id: [ { from:'user'|'bot'|'agent'|'system', text, time } ] }
const conversations = {};
// humanOnly = { wa_id: true/false }
const humanOnly = {};

// دالة مساعدة تضيف رسالة في المحادثة
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
}

// ------------ دالة إرسال رسالة واتساب -------------
async function sendWhatsAppMessage(waId, text, sender = "bot") {
  try {
    const url = `https://graph.facebook.com/v19.0/${config.PHONE_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: waId,
      type: "text",
      text: { body: text },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${config.WABA_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`✅ رسالة أرسلت إلى ${waId}: ${text}`);
    addMessage(waId, sender, text);
  } catch (err) {
    console.error("🔥 WhatsApp SEND ERROR:", err.response?.data || err.message);
  }
}

// ------------ Webhook Verify (GET) -------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.VERIFY_TOKEN) {
    console.log("✅ WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ------------ Webhook Receive (POST) -------------
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (
      body.object === "whatsapp_business_account" &&
      body.entry &&
      body.entry[0]?.changes &&
      body.entry[0].changes[0]?.value?.messages
    ) {
      const change = body.entry[0].changes[0];
      const value = change.value;
      const message = value.messages[0];
      const waId = message.from; // رقم العميل
      const text = message.text?.body || "";

      console.log("📩 Incoming:", JSON.stringify(body, null, 2));
      console.log(`👤 From: ${waId}`);
      console.log(`💬 Text: ${text}`);

      // خزّن رسالة المستخدم
      addMessage(waId, "user", text);

      const lower = text.trim().toLowerCase();

      // ---- اذا طلب "اكلم انسان" نفعل وضع الموظف فقط ----
      if (
        lower.includes("اكلم انسان") ||
        lower.includes("موظف") ||
        lower.includes("دعم") ||
        lower.includes("خدمة عملاء") ||
        lower.includes("خدمه عملاء") ||
        lower.includes("تكلم انسان")
      ) {
        humanOnly[waId] = true;
        const humanMsg =
          "تم تحويلك لموظف متجر الديم 👨‍💼، تقدر تكمل هنا وسيتم الرد عليك يدويًا بإذن الله.";
        await sendWhatsAppMessage(waId, humanMsg, "system");
        return res.sendStatus(200);
      }

      // ---- لو الرقم في وضع موظف فقط، البوت يسكت ----
      if (humanOnly[waId]) {
        console.log(`ℹ️ ${waId} في وضع موظف فقط، لا يتم الرد آليًا.`);
        return res.sendStatus(200);
      }

      // ---- لو كانت أول رسالة وبها سلام/اهلا، نرسل الترحيب الثابت ----
      const isFirstMessage = conversations[waId].length === 1;
      if (
        isFirstMessage &&
        (lower.includes("السلام عليكم") ||
          lower.startsWith("السلام") ||
          lower.includes("السلام عليكم و رحمه الله") ||
          lower.includes("السلام عليكم و رحمه الله وبركاته") ||
          lower.includes("السلام عليكم و رحمه الله وبركاتة"))
      ) {
        const greet =
          "وعليكم السلام، حياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟";
        await sendWhatsAppMessage(waId, greet, "bot");
        return res.sendStatus(200);
      }

      // ---- استدعاء OpenAI مع ذاكرة المحادثة ----
      try {
        // تجهيز آخر 8 رسائل كـ سياق
        const history = (conversations[waId] || []).slice(-8).map((m) => {
          if (m.from === "user") return { role: "user", content: m.text };
          if (m.from === "bot") return { role: "assistant", content: m.text };
          // لا نرسل رسائل الموظف أو النظام للـ AI
          return null;
        }).filter(Boolean);

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
أنت مساعد دردشة لمتجر "الديم للمفارش".

القواعد:
- تحدث بالعربية الفصحى البسيطة، مع لمسة ودية.
- إذا كان أول حديث فيه سلام أو ترحيب، جملة الترحيب الأساسية هي:
  "وعليكم السلام، حياك الله في متجر الديم ❤️🌹 كيف أقدر أخدمك؟"
- لا تعطي رابط المتجر إلا إذا طلبه العميل صراحة.
  رابط المتجر: https://aldeem35.com/
- إذا سأل عن منتج:
  • اشْرَح له المنتج بشكل بسيط (النوع، الاستخدام، الخ).
  • لا تخترع منتجات غير موجودة.
  • لا تذكر أسعار من عندك، فقط قل له إنه يقدر يتأكد من السعر والتوفر من المتجر.
- لا ترسل رسائل طويلة مزعجة، خلك مختصر وواضح.
- لا تقدم قائمة طويلة بما يمكنك فعله، فقط جاوب على السؤال المباشر.
- إذا سأل: "وش تقدر تخدمني؟" وضّح بشكل مختصر: تقدر أساعدك في الاستفسار عن المنتجات، المقاسات، وطريقة الطلب… إلخ.
- تفاعل كأنك إنسان من فريق متجر الديم، مو روبوت جامد.
- وانت تتكلم معه اذا بدا يقول اشياء ماتقدر تسويها قل تريد انقلك ل خدمه العملاء اذا قال لا استكمل معه اذا قال اي طف البوت `,
            },
            ...history,
            { role: "user", content: text },
          ],
        });

        const reply =
          completion.choices[0].message?.content ||
          "حياك الله في متجر الديم، كيف أقدر أخدمك؟";

        await sendWhatsAppMessage(waId, reply, "bot");
      } catch (aiErr) {
        console.error("🔥 OpenAI ERROR:", aiErr.message);
        await sendWhatsAppMessage(
          waId,
          "صار عندي خطأ تقني بسيط مع الذكاء الاصطناعي، جرب بعد شوي أو اكتب: ابي اكلم انسان 🤝",
          "system"
        );
      }

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("🔥 WEBHOOK HANDLER ERROR:", error);
    return res.sendStatus(500);
  }
});

// ------------ صفحة بسيطة (الرئيسية) -------------
app.get("/", (req, res) => {
  res.send(
    `<html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>WhatsApp AI Bot</title>
      </head>
      <body style="font-family: system-ui; background:#f5f7fb; padding:20px;">
        <h2>البوت شغال ✅</h2>
        <p><a href="/inbox" style="color:#0d9488; font-weight:bold;">🔔 فتح لوحة المحادثات (Inbox)</a></p>
      </body>
    </html>`
  );
});

// ------------ API لبيانات الـ Inbox (تُحدَّث تلقائيًا) -------------
app.get("/inbox/data", (req, res) => {
  res.json({
    conversations,
    humanOnly,
  });
});

// ------------ لوحة الـ Inbox + دردشة -------------
app.get("/inbox", (req, res) => {
  const initial = JSON.stringify({ conversations, humanOnly });

  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>لوحة محادثات واتساب - متجر الديم</title>
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #0f172a;
    }
    .layout {
      display: flex;
      height: 100vh;
    }
    .sidebar {
      width: 280px;
      background: #020617;
      color: #e5e7eb;
      border-left: 1px solid #1e293b;
      display: flex;
      flex-direction: column;
    }
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid #1e293b;
      font-weight: 700;
      font-size: 18px;
      display:flex;
      align-items:center;
      gap:8px;
    }
    .sidebar-header span.icon {
      width:28px;
      height:28px;
      border-radius:999px;
      background:#22c55e22;
      display:flex;
      align-items:center;
      justify-content:center;
      color:#22c55e;
    }
    .contact-list {
      flex: 1;
      overflow-y: auto;
    }
    .contact {
      padding: 10px 14px;
      cursor: pointer;
      border-bottom: 1px solid #020617;
      font-size: 14px;
    }
    .contact.active {
      background: #0f172a;
      color: #e5e7eb;
    }
    .contact small {
      color: #64748b;
      display:block;
      margin-top:2px;
      font-size:12px;
    }

    .chat {
      flex: 1;
      display:flex;
      flex-direction:column;
      background: radial-gradient(circle at top left,#0f172a,#020617);
      color:#e5e7eb;
    }
    .chat-header {
      padding: 14px 18px;
      border-bottom: 1px solid #1e293b;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 12px;
    }
    .chat-header .title {
      font-size: 16px;
      font-weight: 600;
    }
    .chat-header .subtitle {
      font-size: 12px;
      color: #94a3b8;
      margin-top:2px;
    }
    .chat-header-right {
      display:flex;
      flex-direction:column;
      align-items:flex-end;
      gap:4px;
      font-size:12px;
    }
    .status-pill {
      padding:3px 8px;
      border-radius:999px;
      border:1px solid #22c55e55;
      color:#bbf7d0;
      background:#16a34a22;
    }
    .status-pill.off {
      border-color:#f9737355;
      color:#fecaca;
      background:#b91c1c22;
    }
    .small-note {
      color:#94a3b8;
      font-size:11px;
    }
    .btn-reset {
      padding:4px 10px;
      border-radius:999px;
      border:none;
      background:linear-gradient(135deg,#22c55e,#a3e635);
      color:#022c22;
      font-weight:600;
      cursor:pointer;
      font-size:11px;
    }

    .chat-messages {
      flex:1;
      padding: 16px;
      overflow-y:auto;
      display:flex;
      flex-direction:column;
      gap:8px;
    }
    .bubble-row {
      display:flex;
      margin-bottom:4px;
    }
    .bubble {
      max-width: 70%;
      padding: 8px 10px;
      border-radius: 18px;
      font-size: 14px;
      line-height:1.4;
      position:relative;
    }
    .from-user {
      justify-content:flex-start;
    }
    .from-user .bubble {
      background:#0ea5e9;
      color:#f9fafb;
      border-bottom-right-radius:4px;
    }
    .from-bot {
      justify-content:flex-end;
    }
    .from-bot .bubble {
      background:#22c55e;
      color:#052e16;
      border-bottom-left-radius:4px;
    }
    .from-agent {
      justify-content:flex-end;
    }
    .from-agent .bubble {
      background:#e5e7eb;
      color:#020617;
      border-bottom-left-radius:4px;
      border:1px solid #cbd5f5;
    }
    .from-system {
      justify-content:center;
    }
    .from-system .bubble {
      background:#020617;
      color:#e5e7eb;
      border-radius:999px;
      font-size:12px;
      border:1px dashed #475569;
    }
    .time {
      font-size:11px;
      color:#cbd5f5;
      margin-top:2px;
      text-align:right;
    }

    .chat-input {
      border-top: 1px solid #1e293b;
      padding: 10px 14px;
      display:flex;
      gap:8px;
      background:#020617;
    }
    .chat-input input[type="text"] {
      flex:1;
      padding:9px 10px;
      border-radius:999px;
      border:1px solid #334155;
      background:#020617;
      color:#e5e7eb;
      outline:none;
      font-size:14px;
    }
    .chat-input button {
      padding: 9px 16px;
      border-radius:999px;
      border:none;
      background:linear-gradient(135deg,#22c55e,#a3e635);
      color:#022c22;
      font-weight:600;
      cursor:pointer;
      font-size:14px;
    }
    .chat-input button:hover {
      opacity:0.92;
    }
    .empty-state {
      flex:1;
      display:flex;
      align-items:center;
      justify-content:center;
      color:#64748b;
      font-size:14px;
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="icon">💬</span>
        <div>
          <div>محادثات واتساب</div>
          <div style="font-size:11px;color:#64748b;">متجر الديم للمفارش</div>
        </div>
      </div>
      <div id="contactList" class="contact-list"></div>
    </div>

    <div class="chat">
      <div class="chat-header">
        <div>
          <div class="title" id="chatTitle">اختر عميل من القائمة</div>
          <div class="subtitle" id="chatSubtitle">لن يتم حفظ أي بيانات في قاعدة بيانات، فقط في ذاكرة السيرفر.</div>
        </div>
        <div class="chat-header-right">
          <div id="botStatus" class="status-pill off">البوت غير نشط</div>
          <button id="botResetBtn" class="btn-reset" type="button">إعادة تشغيل البوت 🤖</button>
          <div class="small-note">إذا العميل قال: "ابي اكلم انسان" يتم إيقاف البوت لهذا الرقم.</div>
        </div>
      </div>
      <div id="chatMessages" class="chat-messages">
        <div class="empty-state">لا توجد محادثة محددة حتى الآن.</div>
      </div>
      <form id="agentForm" class="chat-input">
        <input type="hidden" id="wa_id" name="wa_id" />
        <input type="text" id="agentText" name="text" placeholder="اكتب ردك كموظف من متجر الديم..." autocomplete="off" />
        <button type="submit">إرسال ✅</button>
      </form>
    </div>
  </div>

  <script>
    const initialData = ${initial};
    let conversations = initialData.conversations || {};
    let humanOnly = initialData.humanOnly || {};

    const contactListEl = document.getElementById("contactList");
    const chatMessagesEl = document.getElementById("chatMessages");
    const chatTitleEl = document.getElementById("chatTitle");
    const chatSubtitleEl = document.getElementById("chatSubtitle");
    const waIdInput = document.getElementById("wa_id");
    const agentForm = document.getElementById("agentForm");
    const agentTextInput = document.getElementById("agentText");
    const botStatusEl = document.getElementById("botStatus");
    const botResetBtn = document.getElementById("botResetBtn");

    let currentWaId = null;

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
        div.innerHTML = "<strong>" + id + "</strong>" + 
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
      if (!currentWaId) {
        chatTitleEl.textContent = "اختر عميل من القائمة";
        chatSubtitleEl.textContent = "سيتم عرض المحادثة هنا.";
        botStatusEl.textContent = "البوت غير نشط";
        botStatusEl.classList.add("off");
        chatMessagesEl.innerHTML = '<div class="empty-state">لا توجد محادثة محددة حتى الآن.</div>';
        waIdInput.value = "";
        return;
      }
      const msgs = conversations[currentWaId] || [];
      chatTitleEl.textContent = "العميل: " + currentWaId;
      chatSubtitleEl.textContent = "عدد الرسائل: " + msgs.length;
      waIdInput.value = currentWaId;

      const isHumanOnly = !!humanOnly[currentWaId];
      if (isHumanOnly) {
        botStatusEl.textContent = "البوت متوقف (وضع موظف فقط)";
        botStatusEl.classList.add("off");
      } else {
        botStatusEl.textContent = "البوت نشط لهذا الرقم";
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
        row.innerHTML = '<div><div class="bubble">' + m.text + '</div><div class="time">' + (m.time || "") + '</div></div>';
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
        await fetch("/agent/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wa_id: waId, text }),
        });
        if (!conversations[waId]) conversations[waId] = [];
        conversations[waId].push({
          from: "agent",
          text,
          time: new Date().toLocaleTimeString("ar-SA", {hour:"2-digit",minute:"2-digit"})
        });
        agentTextInput.value = "";
        renderChat();
      } catch (err) {
        alert("حدث خطأ في الإرسال");
      }
    });

    botResetBtn.addEventListener("click", async () => {
      if (!currentWaId) return;
      try {
        await fetch("/agent/bot-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wa_id: currentWaId }),
        });
        humanOnly[currentWaId] = false;
        // نضيف رسالة سيستم محلياً
        if (!conversations[currentWaId]) conversations[currentWaId] = [];
        conversations[currentWaId].push({
          from: "system",
          text: "تم إعادة تشغيل البوت لهذا العميل.",
          time: new Date().toLocaleTimeString("ar-SA", {hour:"2-digit",minute:"2-digit"})
        });
        renderChat();
      } catch (err) {
        alert("تعذّر إعادة تشغيل البوت.");
      }
    });

    // تحديث تلقائي كل 3 ثواني
    async function refreshData() {
      try {
        const res = await fetch("/inbox/data");
        const data = await res.json();
        conversations = data.conversations || {};
        humanOnly = data.humanOnly || {};
        renderContacts();
        renderChat();
      } catch (e) {
        console.error("خطأ في التحديث التلقائي", e);
      }
    }

    renderContacts();
    renderChat();
    setInterval(refreshData, 3000);
  </script>
</body>
</html>
`);
});

// ------------ Endpoint إرسال من الموظف -------------
app.post("/agent/send", async (req, res) => {
  const { wa_id, text } = req.body || {};
  if (!wa_id || !text) return res.status(400).json({ ok: false });

  await sendWhatsAppMessage(wa_id, text, "agent");
  return res.json({ ok: true });
});

// ------------ Endpoint إعادة تشغيل البوت -------------
app.post("/agent/bot-reset", async (req, res) => {
  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });

  humanOnly[wa_id] = false;
  await sendWhatsAppMessage(
    wa_id,
    "تم إعادة تشغيل البوت لمتجر الديم 🤖، تقدر تكتب سؤالك الآن.",
    "system"
  );
  return res.json({ ok: true });
});

// ------------ تشغيل السيرفر -------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
