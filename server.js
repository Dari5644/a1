// server.js
import express from "express";
import axios from "axios";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { CONFIG } from "./config.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// =================== تخزين داخل الذاكرة ===================
let chats = {};      // { wa_id: { id, wa_id, name, messages:[], botEnabled:true, blocked:false } }
let chatOrder = [];  // ترتيب المحادثات
let agents = (CONFIG.AGENTS || []).map((a, i) => ({
  id: a.id || String(i + 1),
  name: a.name,
  wa_id: a.wa_id,      // رقم الموظف الدولي (مثل 9665XXXXXXXX)
  notify: !!a.notify,  // هل يستقبل إشعارات خدمة العملاء؟
}));

// إضافة رسالة لمحادثة
function addMessageToChat(wa_id, msg) {
  if (!chats[wa_id]) {
    chats[wa_id] = {
      id: wa_id,
      wa_id,
      name: msg.name || "عميل",
      botEnabled: true,
      blocked: false,
      lastUpdated: Date.now(),
      messages: [],
    };
    chatOrder.unshift(wa_id);
  }
  chats[wa_id].messages.push(msg);
  chats[wa_id].lastUpdated = Date.now();
}

// =================== دوال واتساب ===================

async function sendWhatsAppText(to, text) {
  try {
    const url = `https://graph.facebook.com/v18.0/${CONFIG.PHONE_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };
    const headers = {
      Authorization: `Bearer ${CONFIG.WABA_TOKEN}`,
      "Content-Type": "application/json",
    };
    const { data } = await axios.post(url, payload, { headers });
    console.log("✔ WHATSAPP SENT:", data);
    return { ok: true, data };
  } catch (e) {
    console.error("🔥 WhatsApp SEND ERROR:", e.response?.data || e.message);
    return { ok: false, error: e.response?.data || e.message };
  }
}

async function sendTemplateMessage(to, vars = []) {
  try {
    const url = `https://graph.facebook.com/v18.0/${CONFIG.PHONE_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: CONFIG.TEMPLATE_NAME,
        language: { code: CONFIG.TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: vars.map((v) => ({ type: "text", text: v })),
          },
        ],
      },
    };
    const headers = {
      Authorization: `Bearer ${CONFIG.WABA_TOKEN}`,
      "Content-Type": "application/json",
    };
    const { data } = await axios.post(url, payload, { headers });
    console.log("✔ TEMPLATE SENT:", data);
    return { ok: true, data };
  } catch (e) {
    console.error("🔥 TEMPLATE ERROR:", e.response?.data || e.message);
    return { ok: false, error: e.response?.data || e.message };
  }
}

// =================== منطق البوت ===================

function buildWelcomeReply(name) {
  return (
    `وعليكم السلام، حياك الله في ${CONFIG.STORE_NAME} ❤️🌹\n` +
    `كيف أقدر أخدمك يا ${name}؟`
  );
}

function isAskingForHuman(text) {
  const t = (text || "").trim();
  const keywords = [
    "اكلم انسان",
    "أكلم إنسان",
    "كلم انسان",
    "كلم إنسان",
    "خدمة عملاء",
    "ابي موظف",
    "موظف",
    "بشري",
    "ابي اكلم احد",
    "أبي أكلم أحد",
    "عامل",
    "التواصل مع موظف",
  ];
  return keywords.some((k) => t.includes(k));
}

async function notifyAgentsForCustomer(wa_id, customerName, text) {
  const targetAgents = agents.filter((a) => a.notify);
  if (targetAgents.length === 0) {
    console.log("⚠ لا يوجد موظفين مفعّل لهم الإشعارات.");
    return;
  }

  const link = `${CONFIG.PANEL_URL}?chat=${wa_id}`;

  for (const a of targetAgents) {
    await sendWhatsAppText(
      a.wa_id,
      `🔔 يوجد عميل طلب خدمة العملاء في ${CONFIG.STORE_NAME}\n` +
        `الاسم: ${customerName}\n` +
        `رقم الواتساب: ${wa_id}\n` +
        `الرسالة: ${text}\n\n` +
        `اضغط هنا لفتح المحادثة في لوحة المتابعة:\n${link}`
    );
  }
}

async function botReply(wa_id, customerName, text) {
  // لو طلب خدمة عملاء → وقف البوت وأرسل إشعار للموظفين
  if (isAskingForHuman(text)) {
    chats[wa_id].botEnabled = false;

    const msg =
      `تم تحويلك لخدمة العملاء في ${CONFIG.STORE_NAME} 🌹\n` +
      `سيقوم أحد الموظفين بالرد عليك قريبًا.`;

    await notifyAgentsForCustomer(wa_id, customerName, text);
    return msg;
  }

  // لو أول رسالة
  if (!chats[wa_id] || chats[wa_id].messages.length === 0) {
    return buildWelcomeReply(customerName || "صديقنا");
  }

  // رد ذكي باستخدام OpenAI لو متوفر
  try {
    if (process.env.OPENAI_API_KEY) {
      const completion = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                `أنت موظف خدمة عملاء  (${CONFIG.STORE_NAME}) .
إذا كتب لك العميل "السلام عليكم" أو "هلا" ترد:
"وعليكم السلام حياك الله في (${CONFIG.STORE_NAME}) ❤️🌹 كيف أقدر أخدمك؟" أو رد قريب منها وبأسلوب لطيف.

لا ترسل رابط المتجر إلا إذا سأل العميل عنه، وعندها أرسل هذا الرابط فقط:
(${CONFIG.STORE_URL})

إذا سأل عن منتج: ابحث عنه في المتجر، وأخبره فقط إذا كان متوفرًا أو لا، مع السعر الصحيح نفسه الموجود في المتجر وبدون تطويل.
إذا سأل عن طلبه أو حالة الشحنة قل له إنك لا تستطيع مشاهدة الطلبات واطلب منه الانتظار حتى يرد عليه موظفو الدعم.
إذا سألك "وش تقدر تخدمني فيه؟" قل له باختصار إنك تساعده في: معرفة اسم المنتج، توفره، سعره، أو استفسار عام عن الطلب مع توجيهه لخدمة العملاء.
تكلم دائمًا بأسلوب طبيعي وبسيط، ورد على كل رسالة بجواب مفيد مختصر يطابق سؤال العميل فقط، بدون رسائل طويلة أو تكرار لعبارة الترحيب كل مرة.`,
            },
            {
              role: "user",
              content: text,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const answer = completion.data.choices?.[0]?.message?.content?.trim();
      if (answer) return answer;
    }
  } catch (e) {
    console.error("🔥 OpenAI ERROR:", e.response?.data || e.message);
  }

  // رد احتياطي
  return (
    `شكرًا لرسالتك 🌹\n` +
    `سأحاول مساعدتك قدر المستطاع في ${CONFIG.STORE_NAME}.\n` +
    `سؤالك: "${text}"`
  );
}

// =================== Webhook ===================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message || !contact) return res.sendStatus(200);

    const from = message.from; // wa_id (رقم العميل)
    const text = message.text?.body || "";
    const name = contact.profile?.name || "عميل";

    console.log("📩 Incoming:", { from, text });

    addMessageToChat(from, {
      from: "customer",
      name,
      text,
      timestamp: Date.now(),
    });

    // بلوك → تجاهل
    if (chats[from].blocked) return res.sendStatus(200);

    // البوت موقوف (خدمة عملاء) → لا يرد
    if (!chats[from].botEnabled) return res.sendStatus(200);

    const reply = await botReply(from, name, text);

    if (reply) {
      await sendWhatsAppText(from, reply);

      addMessageToChat(from, {
        from: "bot",
        name: CONFIG.STORE_NAME,
        text: reply,
        timestamp: Date.now(),
      });
    }
  } catch (e) {
    console.error("🔥 Webhook error:", e.message);
  }

  res.sendStatus(200);
});

// =================== APIs للمحادثات ===================

// قائمة المحادثات
app.get("/api/chats", (req, res) => {
  const list = chatOrder.map((id) => {
    const c = chats[id];
    return {
      id: c.id,
      wa_id: c.wa_id,
      name: c.name,
      lastUpdated: c.lastUpdated,
      botEnabled: c.botEnabled,
      blocked: c.blocked,
    };
  });
  res.json({ ok: true, chats: list });
});

// رسائل محادثة معينة
app.get("/api/chats/:id/messages", (req, res) => {
  const id = req.params.id;
  if (!chats[id]) return res.json({ ok: false, messages: [] });
  res.json({ ok: true, messages: chats[id].messages });
});

// إرسال رد من موظف
app.post("/api/chats/:id/send", async (req, res) => {
  const id = req.params.id;
  const { text, senderName } = req.body;
  if (!chats[id]) return res.status(404).json({ ok: false, msg: "محادثة غير موجودة" });
  if (!text) return res.status(400).json({ ok: false, msg: "نص مفقود" });

  const result = await sendWhatsAppText(id, text);

  addMessageToChat(id, {
    from: "agent",
    name: senderName || "موظف",
    text,
    timestamp: Date.now(),
  });

  res.json(result);
});

// إيقاف / تشغيل البوت
app.post("/api/chats/:id/bot", (req, res) => {
  const id = req.params.id;
  const { enabled } = req.body;
  if (!chats[id]) return res.status(404).json({ ok: false, msg: "محادثة غير موجودة" });
  chats[id].botEnabled = !!enabled;
  res.json({ ok: true, botEnabled: chats[id].botEnabled });
});

// بلوك / إلغاء بلوك
app.post("/api/chats/:id/block", (req, res) => {
  const id = req.params.id;
  const { blocked } = req.body;
  if (!chats[id]) return res.status(404).json({ ok: false, msg: "محادثة غير موجودة" });
  chats[id].blocked = !!blocked;
  res.json({ ok: true, blocked: chats[id].blocked });
});

// =================== APIs للموظفين (Agents) ===================

// جلب قائمة الموظفين
app.get("/api/agents", (req, res) => {
  res.json({ ok: true, agents });
});

// إضافة موظف جديد
app.post("/api/agents", (req, res) => {
  const { name, phone, notify } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ ok: false, msg: "الاسم أو الرقم مفقود" });
  }

  // تحويل 05XXXXXXXX → 9665XXXXXXXX
  let wa_id = phone.trim();
  if (/^05/.test(wa_id)) {
    wa_id = "966" + wa_id.slice(1);
  }

  const id = Date.now().toString();
  const agent = {
    id,
    name,
    wa_id,
    notify: !!notify,
  };
  agents.push(agent);

  res.json({ ok: true, agent });
});

// تعديل حالة الإشعار لموظف
app.post("/api/agents/:id/notify", (req, res) => {
  const id = req.params.id;
  const { notify } = req.body;
  const idx = agents.findIndex((a) => a.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, msg: "الموظف غير موجود" });
  agents[idx].notify = !!notify;
  res.json({ ok: true, agent: agents[idx] });
});

// =================== إرسال رسالة جماعية بالقالب ===================

app.post("/api/broadcast", async (req, res) => {
  const { numbers, vars } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ ok: false, msg: "لا يوجد أرقام" });
  }

  let results = [];
  for (let n of numbers) {
    let wa = n.trim();
    if (/^05/.test(wa)) wa = "966" + wa.slice(1);
    const r = await sendTemplateMessage(wa, vars || []);
    results.push({ number: wa, result: r.ok });
  }

  res.json({ ok: true, results });
});

// =================== واجهة HTML للوحة المحادثات ===================

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>لوحة محادثات ${CONFIG.STORE_NAME}</title>
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#0f172a; color:#e5e7eb; }
    .layout { display:flex; height:100vh; }
    .sidebar { width:360px; border-left:1px solid #1f2937; background:#020617; display:flex; flex-direction:column; }
    .header { padding:12px 16px; border-bottom:1px solid #1f2937; display:flex; justify-content:space-between; align-items:center; }
    .header-title { font-weight:bold; font-size:14px; }
    .tag { font-size:11px; padding:2px 8px; border-radius:999px; background:#22c55e22; color:#bbf7d0; }
    .btn { border-radius:999px; border:1px solid #4b5563; padding:6px 12px; font-size:11px; background:#020617; color:#e5e7eb; cursor:pointer; }
    .btn:hover { background:#111827; }
    .btn-danger { border-color:#7f1d1d; color:#fecaca; }
    .btn-primary { border-color:#2563eb; color:#bfdbfe; }
    .chat-list { flex:1; overflow-y:auto; }
    .chat-item { padding:10px 12px; border-bottom:1px solid #0f172a; cursor:pointer; }
    .chat-item:hover { background:#020617; }
    .chat-item.active { background:#1e293b; }
    .chat-name { font-size:13px; font-weight:600; }
    .chat-meta { font-size:11px; color:#9ca3af; margin-top:2px; display:flex; gap:8px; align-items:center; }
    .badge { font-size:10px; padding:2px 6px; border-radius:999px; border:1px solid #374151; }
    .badge-red { border-color:#b91c1c; color:#fecaca; }
    .badge-green { border-color:#15803d; color:#bbf7d0; }
    .content { flex:1; display:flex; flex-direction:column; }
    .topbar { padding:10px 14px; border-bottom:1px solid #1f2937; display:flex; align-items:center; justify-content:space-between; }
    .top-title { font-size:14px; font-weight:500; }
    .top-actions { display:flex; gap:8px; align-items:center; }
    .messages { flex:1; padding:12px 16px; overflow-y:auto; background:#020617; }
    .bubble { max-width:70%; padding:8px 10px; border-radius:12px; margin-bottom:6px; font-size:13px; line-height:1.5; }
    .bubble.me { background:#1d4ed8; margin-left:auto; border-bottom-right-radius:2px; }
    .bubble.other { background:#111827; margin-right:auto; border-bottom-left-radius:2px; }
    .bubble .meta { font-size:10px; color:#d1d5db; margin-top:2px; }
    .input-area { padding:10px 14px; border-top:1px solid #1f2937; display:flex; gap:8px; }
    .input { flex:1; border-radius:999px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; padding:8px 12px; font-size:13px; }
    .panel { padding:8px 14px; border-bottom:1px solid #0f172a; font-size:12px; color:#9ca3af; }
    .panel input[type="text"], .panel input[type="password"], .panel textarea {
      width:100%; margin-top:4px; border-radius:8px; border:1px solid #4b5563;
      background:#020617; color:#e5e7eb; padding:6px 8px; font-size:12px;
    }
    .panel textarea { min-height:60px; resize:vertical; }
    .owner-only { display:none; }
    .agents-list { max-height:120px; overflow-y:auto; margin-top:6px; border-radius:8px; border:1px solid #1f2937; padding:6px; background:#020617; }
    .agent-item { display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px dashed #111827; font-size:11px; }
    .agent-item:last-child { border-bottom:none; }
    .agent-name { font-weight:500; }
    .agent-phone { color:#9ca3af; font-size:10px; }
    .switch { display:inline-flex; align-items:center; gap:4px; cursor:pointer; }
    .switch input { cursor:pointer; }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div class="header">
        <div>
          <div class="header-title">${CONFIG.STORE_NAME}</div>
          <div style="font-size:11px;color:#9ca3af;">لوحة المحادثات</div>
        </div>
        <span class="tag" id="roleTag">موظف</span>
      </div>

      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span>وضع الحساب:</span>
          <button class="btn" id="btnAsAgent">موظف</button>
          <button class="btn" id="btnAsOwner">مالك</button>
        </div>
        <div id="ownerLogin" style="margin-top:6px; display:none;">
          <input type="password" id="ownerPass" placeholder="كلمة مرور المالك" />
          <button class="btn btn-primary" style="width:100%;margin-top:4px;" id="btnOwnerLogin">دخول</button>
        </div>
      </div>

      <!-- إدارة الموظفين -->
      <div class="panel owner-only" id="ownerAgentsPanel">
        <div style="font-weight:600;margin-bottom:4px;">الموظفون (إشعارات خدمة العملاء)</div>
        <div style="font-size:11px;margin-bottom:4px;">
          أضف موظف وحدد من يستقبل إشعار "طلب خدمة العملاء".
        </div>
        <div>
          <input type="text" id="agentName" placeholder="اسم الموظف" />
          <input type="text" id="agentPhone" placeholder="رقم الجوال يبدأ بـ 05" style="margin-top:4px;" />
          <label class="switch" style="margin-top:4px;font-size:11px;">
            <input type="checkbox" id="agentNotify" checked />
            يستقبل إشعار
          </label>
          <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="btnAddAgent">إضافة موظف</button>
        </div>
        <div class="agents-list" id="agentsList"></div>
      </div>

      <!-- رسالة جماعية -->
      <div class="panel owner-only" id="ownerBroadcastPanel">
        <div style="font-weight:600;margin-bottom:4px;">رسالة جماعية (قالب واتساب)</div>
        <label>الأرقام (سطر لكل رقم يبدأ بـ 05):</label>
        <textarea id="broadcastNumbers" placeholder="0512345678&#10;0598765432"></textarea>
        <label>متغيرات القالب {{1}}, {{2}} ... (سطر لكل متغير):</label>
        <textarea id="broadcastVars" placeholder="عميلنا العزيز"></textarea>
        <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="btnBroadcast">إرسال جماعي</button>
        <div id="broadcastStatus" style="font-size:11px;margin-top:4px;"></div>
      </div>

      <div class="chat-list" id="chatList"></div>
    </div>

    <div class="content">
      <div class="topbar">
        <div class="top-title" id="chatTitle">اختر محادثة</div>
        <div class="top-actions">
          <span id="chatFlags" style="font-size:11px;color:#9ca3af;"></span>
          <button class="btn btn-primary" id="btnToggleBot" disabled>إيقاف البوت</button>
          <button class="btn btn-danger" id="btnBlock" disabled>بلوك</button>
        </div>
      </div>
      <div class="messages" id="messages"></div>
      <div class="input-area">
        <input class="input" id="msgInput" placeholder="اكتب ردك كموظف..." />
        <button class="btn btn-primary" id="btnSend" disabled>إرسال</button>
      </div>
    </div>
  </div>

  <script>
    const apiBase = "";
    let currentChatId = null;
    let role = "agent"; // agent / owner
    let senderName = "موظف";
    let agents = [];

    function setRole(r) {
      role = r;
      document.getElementById("roleTag").textContent = (r === "owner" ? "مالك" : "موظف");
      const ownerElems = document.querySelectorAll(".owner-only");
      ownerElems.forEach(el => el.style.display = (r === "owner" ? "block" : "none"));
      senderName = (r === "owner" ? "${CONFIG.OWNER_NAME}" : "موظف");
      localStorage.setItem("panelRole", r);
    }

    const savedRole = localStorage.getItem("panelRole");
    if (savedRole === "owner") setRole("owner");
    else setRole("agent");

    document.getElementById("btnAsAgent").onclick = () => setRole("agent");
    document.getElementById("btnAsOwner").onclick = () => {
      document.getElementById("ownerLogin").style.display = "block";
    };
    document.getElementById("btnOwnerLogin").onclick = () => {
      const pass = document.getElementById("ownerPass").value;
      if (pass === "${CONFIG.OWNER_PASSWORD}") {
        setRole("owner");
        document.getElementById("ownerLogin").style.display = "none";
        loadAgents();
      } else {
        alert("كلمة مرور غير صحيحة");
      }
    };

    async function fetchJSON(url, options) {
      const res = await fetch(url, options || {});
      return res.json();
    }

    // --------- إدارة الموظفين في الواجهة ---------

    async function loadAgents() {
      const data = await fetchJSON(apiBase + "/api/agents");
      if (!data.ok) return;
      agents = data.agents || [];
      renderAgents();
    }

    function renderAgents() {
      const box = document.getElementById("agentsList");
      box.innerHTML = "";
      if (!agents.length) {
        box.innerHTML = '<div style="font-size:11px;color:#6b7280;">لا يوجد موظفون مضافون بعد.</div>';
        return;
      }
      agents.forEach((a) => {
        const div = document.createElement("div");
        div.className = "agent-item";
        div.innerHTML = \`
          <div>
            <div class="agent-name">\${a.name}</div>
            <div class="agent-phone">\${a.wa_id}</div>
          </div>
          <label class="switch">
            <input type="checkbox" \${a.notify ? "checked" : ""} data-id="\${a.id}" />
            <span>\${a.notify ? "يستقبل" : "موقّف"}</span>
          </label>
        \`;
        const checkbox = div.querySelector("input[type='checkbox']");
        checkbox.onchange = async (e) => {
          const id = e.target.dataset.id;
          const notify = e.target.checked;
          const res = await fetchJSON(apiBase + "/api/agents/" + id + "/notify", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ notify })
          });
          if (res.ok) {
            const idx = agents.findIndex(x => x.id === id);
            if (idx !== -1) agents[idx].notify = notify;
            renderAgents();
          }
        };
        box.appendChild(div);
      });
    }

    document.getElementById("btnAddAgent").onclick = async () => {
      const name = document.getElementById("agentName").value.trim();
      const phone = document.getElementById("agentPhone").value.trim();
      const notify = document.getElementById("agentNotify").checked;
      if (!name || !phone) {
        alert("الرجاء إدخال اسم ورقم الموظف");
        return;
      }
      const res = await fetchJSON(apiBase + "/api/agents", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ name, phone, notify })
      });
      if (res.ok) {
        document.getElementById("agentName").value = "";
        document.getElementById("agentPhone").value = "";
        await loadAgents();
      } else {
        alert("فشل إضافة الموظف");
      }
    };

    // --------- المحادثات ---------

    async function loadChats() {
      const data = await fetchJSON(apiBase + "/api/chats");
      const list = document.getElementById("chatList");
      list.innerHTML = "";
      if (!data.ok) return;
      data.chats.forEach((c) => {
        const div = document.createElement("div");
        div.className = "chat-item" + (c.id === currentChatId ? " active" : "");
        div.onclick = () => { currentChatId = c.id; renderChats(data.chats); loadMessages(); };
        div.innerHTML = \`
          <div class="chat-name">\${c.name} (\${c.wa_id})</div>
          <div class="chat-meta">
            <span class="badge \${c.botEnabled ? "badge-green" : "badge-red"}">\${c.botEnabled ? "البوت يعمل" : "خدمة عملاء"}</span>
            \${c.blocked ? '<span class="badge badge-red">بلوك</span>' : ""}
          </div>
        \`;
        list.appendChild(div);
      });
      renderChats(data.chats);
    }

    function renderChats(chatsData) {
      const list = document.getElementById("chatList").children;
      for (let i = 0; i < list.length; i++) {
        list[i].classList.remove("active");
      }
      if (!currentChatId) {
        document.getElementById("chatTitle").textContent = "اختر محادثة";
        document.getElementById("chatFlags").textContent = "";
        document.getElementById("btnToggleBot").disabled = true;
        document.getElementById("btnBlock").disabled = true;
        document.getElementById("btnSend").disabled = true;
        return;
      }
      const chat = chatsData.find(c => c.id === currentChatId);
      if (!chat) return;

      document.getElementById("chatTitle").textContent = chat.name + " (" + chat.wa_id + ")";
      document.getElementById("chatFlags").textContent =
        (chat.botEnabled ? "البوت يعمل" : "خدمة عملاء") +
        (chat.blocked ? " • محظور" : "");

      document.getElementById("btnToggleBot").textContent = chat.botEnabled ? "إيقاف البوت" : "تشغيل البوت";
      document.getElementById("btnToggleBot").dataset.enabled = chat.botEnabled ? "1" : "0";

      document.getElementById("btnBlock").textContent = chat.blocked ? "إلغاء البلوك" : "بلوك";
      document.getElementById("btnBlock").dataset.blocked = chat.blocked ? "1" : "0";

      document.getElementById("btnToggleBot").disabled = false;
      document.getElementById("btnBlock").disabled = false;
      document.getElementById("btnSend").disabled = false;

      const items = document.getElementById("chatList").children;
      for (let i = 0; i < items.length; i++) {
        if (items[i].querySelector(".chat-name").textContent.includes(chat.wa_id)) {
          items[i].classList.add("active");
        }
      }
    }

    async function loadMessages() {
      if (!currentChatId) return;
      const data = await fetchJSON(apiBase + "/api/chats/" + currentChatId + "/messages");
      const box = document.getElementById("messages");
      box.innerHTML = "";
      if (!data.ok) return;
      data.messages.forEach((m) => {
        const div = document.createElement("div");
        div.className = "bubble " + (m.from === "customer" ? "other" : "me");
        const date = new Date(m.timestamp || Date.now());
        div.innerHTML = "<div>" + m.text.replace(/\\n/g, "<br>") + "</div>" +
          '<div class="meta">' + (m.name || "") + " • " + date.toLocaleTimeString("ar-SA", { hour:"2-digit", minute:"2-digit" }) + "</div>";
        box.appendChild(div);
      });
      box.scrollTop = box.scrollHeight;
    }

    document.getElementById("btnSend").onclick = async () => {
      if (!currentChatId) return;
      const text = document.getElementById("msgInput").value.trim();
      if (!text) return;
      document.getElementById("msgInput").value = "";
      await fetchJSON(apiBase + "/api/chats/" + currentChatId + "/send", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ text, senderName })
      });
      await loadMessages();
    };

    document.getElementById("btnToggleBot").onclick = async () => {
      if (!currentChatId) return;
      const enabled = document.getElementById("btnToggleBot").dataset.enabled === "1";
      await fetchJSON(apiBase + "/api/chats/" + currentChatId + "/bot", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ enabled: !enabled })
      });
      await loadChats();
      await loadMessages();
    };

    document.getElementById("btnBlock").onclick = async () => {
      if (!currentChatId) return;
      const blocked = document.getElementById("btnBlock").dataset.blocked === "1";
      await fetchJSON(apiBase + "/api/chats/" + currentChatId + "/block", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ blocked: !blocked })
      });
      await loadChats();
      await loadMessages();
    };

    // إرسال جماعي بالقالب
    document.getElementById("btnBroadcast").onclick = async () => {
      const numsText = document.getElementById("broadcastNumbers").value.trim();
      const varsText = document.getElementById("broadcastVars").value.trim();
      const status = document.getElementById("broadcastStatus");
      const numbers = numsText.split(/\\r?\\n/).map(x => x.trim()).filter(Boolean);
      const vars = varsText.split(/\\r?\\n/).map(x => x.trim()).filter(Boolean);

      if (numbers.length === 0) {
        status.textContent = "لا يوجد أرقام";
        return;
      }
      status.textContent = "جار الإرسال...";
      const res = await fetchJSON(apiBase + "/api/broadcast", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ numbers, vars })
      });
      status.textContent = res.ok ? "تم إرسال القالب إلى " + numbers.length + " رقم" : "فشل الإرسال";
    };

    // تحديث دوري للمحادثات
    loadChats();
    setInterval(() => { loadChats(); if (currentChatId) loadMessages(); }, 6000);

    // لو فتحنا اللوحة برابط فيه ?chat=wa_id يحدد المحادثة مباشرة
    const params = new URLSearchParams(window.location.search);
    const chatFromUrl = params.get("chat");
    if (chatFromUrl) {
      currentChatId = chatFromUrl;
      setTimeout(() => { loadChats(); loadMessages(); }, 1000);
    }
  </script>
</body>
</html>
  `);
});

// =================== تشغيل السيرفر ===================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 SERVER RUNNING ON PORT", PORT);
});
