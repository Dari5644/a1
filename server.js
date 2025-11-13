// server.js
// بوت واتساب + OpenAI + تسجيل دخول مالك/موظفين + لوحتين تواصل + بلوك/إزالة/برودكاست + رفع ملف أرقام

import express from "express";
import axios from "axios";
import OpenAI from "openai";
import crypto from "crypto";
import config from "./config.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== إعدادات من config.js =====
const {
  OWNER_EMAIL,
  OWNER_PASSWORD,
  OWNER_NAME,
  VERIFY_TOKEN,
  WABA_TOKEN,
  PHONE_ID,
  STORE_NAME,
  STORE_URL,
  PANEL_BASE_URL,
} = config;

// مفتاح OpenAI في .env فقط
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY مفقود في env");
if (!WABA_TOKEN || !PHONE_ID)
  console.warn("⚠️ تأكد من WABA_TOKEN و PHONE_ID في config.js");

const BOT_NAME = "مساعد " + STORE_NAME;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== دالة لتنسيق أرقام الجوال ======
// تستقبل: 05xxxxxxxx أو 9665xxxxxxxx أو أي شكل وفي النهاية تحاول تعطي 9665xxxxxxxx
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");

  // لو بصيغة محلية 05xxxxxxxx
  if (digits.startsWith("05") && digits.length === 10) {
    return "966" + digits.slice(1); // 9665xxxxxxxx
  }

  // لو بصيغة دولية صحيحة
  if (digits.startsWith("9665") && digits.length === 12) {
    return digits;
  }

  // لو 5xxxxxxxx (بدون 0)
  if (digits.startsWith("5") && digits.length === 9) {
    return "966" + digits;
  }

  // غير متوقع، نرجعه كما هو لو كان طوله معقول
  if (digits.length >= 8) return digits;
  return null;
}

// ======== تخزين داخلي =========

// المستخدمين (مالك + موظفين)
const users = {}; // key: email → {id, name, email, password, role, whatsapp, canBroadcast}
const sessions = {}; // sessionId → { userId }

// إنشاء المالك
const ownerId = "owner-" + Date.now();
users[OWNER_EMAIL] = {
  id: ownerId,
  name: OWNER_NAME,
  email: OWNER_EMAIL,
  password: OWNER_PASSWORD,
  role: "owner",
  whatsapp: null,
  canBroadcast: true,
};

// المحادثات
const conversations = {}; // waId → [ {from,text,time,agentName?,agentEmail?} ]
const humanOnly = {}; // waId → true/false
const waitingTransferConfirm = {}; // waId → true/false
const blocked = {}; // waId → true/false

// ====== أدوات عامة ======
function addMessage(waId, from, text, meta = {}) {
  if (!conversations[waId]) conversations[waId] = [];
  conversations[waId].push({
    from,
    text,
    time: new Date().toLocaleTimeString("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    ...meta,
  });
  if (conversations[waId].length > 60) {
    conversations[waId] = conversations[waId].slice(-60);
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((p) => {
    const [k, v] = p.split("=").map((s) => s.trim());
    cookies[k] = decodeURIComponent(v || "");
  });
  return cookies;
}

function getUserFromSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (!sid || !sessions[sid]) return null;
  const userId = sessions[sid].userId;
  const user = Object.values(users).find((u) => u.id === userId);
  return user || null;
}

function requireLogin(handler, role = null) {
  return (req, res) => {
    const user = getUserFromSession(req);
    if (!user) {
      return res.redirect("/login");
    }
    if (role && user.role !== role) {
      return res.status(403).send("لا تملك صلاحية الوصول لهذه الصفحة.");
    }
    req.user = user;
    handler(req, res);
  };
}

// إرسال واتساب
async function sendWhatsAppMessage(to, text, tag = "bot", meta = {}) {
  if (!WABA_TOKEN || !PHONE_ID) {
    console.error("❌ مفقود WABA_TOKEN أو PHONE_ID");
    return;
  }
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

    // نسجل الرسالة في المحادثة
    if (tag === "bot") {
      addMessage(to, "bot", text);
    } else if (tag === "agent") {
      addMessage(to, "agent", text, meta);
    } else if (tag === "system" || tag === "error" || tag === "agent-alert") {
      addMessage(to, "system", text);
    }

    console.log(`✅ WhatsApp (${tag}) → ${to}: ${text}`);
  } catch (err) {
    console.error("🔥 WhatsApp SEND ERROR:", err.response?.data || err.message);
  }
}

// تنبيه الموظفين عند طلب خدمة العملاء
async function notifyAgents(waId, lastText, customerName) {
  const link = `${PANEL_BASE_URL}/inbox-a?wa=${waId}`;

  const msg =
    `🚨 عميل طلب خدمة العملاء الآن في ${STORE_NAME}.\n\n` +
    `👤 الاسم: ${customerName || "عميل"}\n` +
    `📞 الرقم: ${waId}\n\n` +
    `💬 آخر رسالة من العميل:\n${lastText}\n\n` +
    `🧷 افتح المحادثة مباشرة من هنا:\n${link}`;

  for (const u of Object.values(users)) {
    if (u.whatsapp && u.canBroadcast !== false) {
      await sendWhatsAppMessage(u.whatsapp, msg, "agent-alert");
    }
  }
}

// رد OpenAI
async function getAssistantReply(waId, userText) {
  const hist = (conversations[waId] || [])
    .slice(-10)
    .map((m) => {
      if (m.from === "user") return { role: "user", content: m.text };
      if (m.from === "bot") return { role: "assistant", content: m.text };
      return null;
    })
    .filter(Boolean);

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
- إذا سأل "وش تقدر تسوي؟" وضّح أنك تساعد في الاستفسار عن المنتجات، المقاسات، طريقة الشراء، ورابط المتجر عند الطلب.
- لا تذكر أنك نموذج ذكاء اصطناعي، بل تحدث كأنك موظف افتراضي من فريق ${STORE_NAME}.
`,
    },
    ...hist,
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

  return reply;
}

// ========== WEBHOOK GET ==========
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

// ========== WEBHOOK POST ==========
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

    if (blocked[waId]) {
      console.log(`🚫 الرقم ${waId} محظور، تجاهل الرسالة.`);
      return res.sendStatus(200);
    }

    addMessage(waId, "user", text);

    // إعادة تشغيل البوت من العميل
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

    // في حالة انتظار تأكيد تحويل خدمة العملاء
    if (waitingTransferConfirm[waId]) {
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
          "system"
        );
        // يكمل البوت تحت
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

    // إذا متضايق → عرض التحويل
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
        "system"
      );
      return res.sendStatus(200);
    }

    // وضع خدمة العملاء فقط → لا يرد البوت
    if (humanOnly[waId]) {
      console.log(`🙋‍♂️ ${waId} في وضع خدمة عملاء فقط.`);
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
        "واجهتني مشكلة تقنية بسيطة أثناء إنشاء الرد 🤖، حاول بعد قليل.",
        "error"
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 WEBHOOK HANDLER ERROR:", err.message);
    return res.sendStatus(500);
  }
});

// ========== API للمحادثات ==========
app.get("/api/conversations", (req, res) => {
  const data = {
    storeName: STORE_NAME,
    conversations,
    humanOnly,
    blocked,
  };
  res.json(data);
});

// إرسال رد من موظف
app.post("/api/agent/send", (req, res) => {
  const user = getUserFromSession(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  const { wa_id, text } = req.body || {};
  if (!wa_id || !text)
    return res.status(400).json({ ok: false, error: "missing" });

  sendWhatsAppMessage(wa_id, text, "agent", {
    agentName: user.name,
    agentEmail: user.email,
  });
  res.json({ ok: true });
});

// إيقاف/تشغيل البوت/بلوك/إزالة/حذف
app.post("/api/agent/bot-stop", (req, res) => {
  const user = getUserFromSession(req);
  if (!user) return res.status(401).json({ ok: false });

  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });

  humanOnly[wa_id] = true;
  res.json({ ok: true });
});

app.post("/api/agent/bot-reset", (req, res) => {
  const user = getUserFromSession(req);
  if (!user) return res.status(401).json({ ok: false });

  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });

  humanOnly[wa_id] = false;
  waitingTransferConfirm[wa_id] = false;
  res.json({ ok: true });
});

app.post("/api/agent/block", (req, res) => {
  const user = getUserFromSession(req);
  if (!user) return res.status(401).json({ ok: false });

  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });
  blocked[wa_id] = true;
  humanOnly[wa_id] = true;
  res.json({ ok: true });
});

app.post("/api/agent/unblock", (req, res) => {
  const user = getUserFromSession(req);
  if (!user) return res.status(401).json({ ok: false });

  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });
  blocked[wa_id] = false;
  res.json({ ok: true });
});

app.post("/api/agent/delete", (req, res) => {
  const user = getUserFromSession(req);
  if (!user) return res.status(401).json({ ok: false });

  const { wa_id } = req.body || {};
  if (!wa_id) return res.status(400).json({ ok: false });

  delete conversations[wa_id];
  delete humanOnly[wa_id];
  delete waitingTransferConfirm[wa_id];
  delete blocked[wa_id];

  res.json({ ok: true });
});

// ========== تسجيل الدخول ==========
app.get("/login", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>تسجيل الدخول - لوحة ${STORE_NAME}</title>
  <style>
    body { margin:0; font-family: system-ui; background:#0f172a; color:#e5e7eb; display:flex; align-items:center; justify-content:center; height:100vh; }
    .card { background:#020617; padding:24px 28px; border-radius:18px; width:320px; box-shadow:0 18px 40px rgba(15,23,42,0.6); border:1px solid #1e293b; }
    h2 { margin:0 0 4px; font-size:18px; }
    p { margin:0 0 16px; font-size:12px; color:#9ca3af; }
    label { font-size:12px; color:#e5e7eb; display:block; margin-bottom:4px; }
    input { width:100%; padding:8px 10px; border-radius:999px; border:1px solid #374151; background:#020617; color:#e5e7eb; outline:none; font-size:13px; margin-bottom:10px; }
    button { width:100%; padding:9px 10px; border-radius:999px; border:none; background:linear-gradient(135deg,#a855f7,#ec4899); color:#fff; font-weight:600; cursor:pointer; font-size:14px; margin-top:6px; }
    button:hover { opacity:0.9; }
    .msg { margin-top:8px; font-size:11px; color:#f97373; min-height:16px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>لوحة ${STORE_NAME}</h2>
    <p>سجّل دخولك كمالك أو موظف.</p>
    <form id="loginForm">
      <label>الإيميل</label>
      <input type="email" id="email" required />
      <label>كلمة المرور</label>
      <input type="password" id="password" required />
      <button type="submit">تسجيل الدخول</button>
      <div id="msg" class="msg"></div>
    </form>
  </div>
  <script>
    const form = document.getElementById("loginForm");
    const msg = document.getElementById("msg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "";
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value.trim();
      try {
        const res = await fetch("/login", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({email,password})
        });
        const data = await res.json();
        if(!data.ok){
          msg.textContent = data.error || "بيانات غير صحيحة";
        } else {
          window.location.href = data.redirect || "/";
        }
      } catch(e){
        msg.textContent = "خطأ في الاتصال بالخادم.";
      }
    });
  </script>
</body>
</html>
  `);
});

app.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.json({ ok: false, error: "أدخل الإيميل وكلمة المرور" });
  }

  const u = users[email];
  if (!u || u.password !== password) {
    return res.json({ ok: false, error: "إيميل أو كلمة مرور غير صحيحة" });
  }

  const sid = crypto.randomBytes(16).toString("hex");
  sessions[sid] = { userId: u.id };

  res.setHeader(
    "Set-Cookie",
    `sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Lax`
  );

  const redirect = u.role === "owner" ? "/owner" : "/inbox-a";
  res.json({ ok: true, redirect });
});

app.get("/logout", (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (sid) delete sessions[sid];
  res.setHeader("Set-Cookie", "sid=; Max-Age=0; Path=/;");
  res.redirect("/login");
});

// ========== لوحة المالك ==========
app.get(
  "/owner",
  requireLogin((req, res) => {
    const user = req.user;
    if (user.role !== "owner") {
      return res.status(403).send("هذه الصفحة خاصة بالمالك فقط.");
    }
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>قائمة المالك - ${STORE_NAME}</title>
  <style>
    body { margin:0; font-family:system-ui; background:#020617; color:#e5e7eb; }
    header { padding:14px 18px; border-bottom:1px solid #1f2937; display:flex; justify-content:space-between; align-items:center; background:#020617; }
    .title { font-weight:600; font-size:16px; }
    .sub { font-size:12px; color:#9ca3af; }
    a { color:#a855f7; text-decoration:none; }
    .layout { display:flex; padding:16px; gap:12px; flex-wrap:wrap; }
    .card { background:#0f172a; border-radius:16px; padding:14px; border:1px solid #1e293b; flex:1; min-width:280px; max-width:400px; }
    h3 { margin:0 0 8px; font-size:14px; }
    label { font-size:11px; display:block; margin-top:6px; margin-bottom:2px; color:#cbd5f5; }
    input, textarea, select { width:100%; padding:6px 8px; border-radius:10px; border:1px solid #374151; background:#020617; color:#e5e7eb; font-size:12px; }
    textarea { min-height:60px; }
    button { margin-top:8px; padding:7px 10px; border-radius:999px; border:none; cursor:pointer; font-size:12px; }
    .btn-primary { background:linear-gradient(135deg,#a855f7,#ec4899); color:#fff; }
    .btn-danger { background:linear-gradient(135deg,#ef4444,#f97316); color:#fff; }
    .list { margin-top:8px; max-height:150px; overflow-y:auto; font-size:11px; }
    .row { padding:4px 0; border-bottom:1px solid #111827; display:flex; justify-content:space-between; align-items:center; gap:4px; }
    .danger-link { color:#fca5a5; cursor:pointer; font-size:11px; }
    small { color:#9ca3af; font-size:10px; display:block; margin-top:2px; }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="title">قائمة المالك - ${STORE_NAME}</div>
      <div class="sub">مرحبًا ${user.name} (${user.email})</div>
    </div>
    <div style="font-size:12px;">
      <a href="/inbox-a">لوحة A (الموظفين)</a> •
      <a href="/inbox-b">لوحة B</a> •
      <a href="/logout">تسجيل خروج</a>
    </div>
  </header>

  <div class="layout">
    <!-- إدارة الموظفين -->
    <div class="card">
      <h3>إدارة الموظفين</h3>
      <form id="addAgentForm">
        <label>اسم الموظف</label>
        <input type="text" id="agentName" required />
        <label>الإيميل</label>
        <input type="email" id="agentEmail" required />
        <label>كلمة المرور</label>
        <input type="text" id="agentPassword" required />
        <label>رقم واتساب الموظف (يبدأ بـ 05)</label>
        <input type="text" id="agentWhatsapp" placeholder="مثال: 05xxxxxxxx" />
        <label>صلاحيات</label>
        <select id="agentBroadcast">
          <option value="1">يستقبل تنبيهات و يرسل رسائل جماعية</option>
          <option value="0">لا يستقبل تنبيهات ولا رسائل جماعية</option>
        </select>
        <button type="submit" class="btn-primary">إضافة موظف</button>
      </form>
      <div class="list" id="agentsList"></div>
    </div>

    <!-- إنشاء محادثة -->
    <div class="card">
      <h3>إنشاء محادثة فردية</h3>
      <form id="startChatForm">
        <label>رقم واتساب العميل (يبدأ بـ 05)</label>
        <input type="text" id="chatWa" placeholder="مثال: 05xxxxxxxx" required />
        <label>الرسالة الأولى</label>
        <textarea id="chatText" placeholder="نص الرسالة..."></textarea>
        <button type="submit" class="btn-primary">إرسال رسالة</button>
        <small>الرقم يجب أن يكون بالشكل 05xxxxxxxx، وسيتم تحويله تلقائيًا لصيغة واتساب.</small>
      </form>
    </div>

    <!-- رسائل جماعية -->
    <div class="card">
      <h3>رسائل جماعية</h3>
      <form id="broadcastForm">
        <label>الأرقام يدويًا (كل رقم في سطر أو مفصولة بمسافة)</label>
        <textarea id="broadcastNumbers" placeholder="05xxxxxxxx\n05yyyyyyyy"></textarea>
        <label>أو ملف أرقام (.txt / .csv)</label>
        <input type="file" id="broadcastFile" accept=".txt,.csv" />
        <label>نص الرسالة</label>
        <textarea id="broadcastText" placeholder="نص الرسالة..."></textarea>
        <button type="submit" class="btn-primary">إرسال جماعي</button>
        <small>كل رقم يجب أن يبدأ بـ 05، وسيتم تحويله تلقائيًا لـ 9665... قبل الإرسال.</small>
      </form>
    </div>
  </div>

  <script>
    let broadcastFileContent = "";

    async function loadAgents() {
      const res = await fetch("/api/owner/agents");
      const data = await res.json();
      const list = document.getElementById("agentsList");
      list.innerHTML = "";
      data.agents.forEach(a => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = \`
          <div>
            <div>\${a.name} - \${a.email}</div>
            <small>واتساب: \${a.whatsapp || "غير محدد"} | صلاحية جماعية: \${a.canBroadcast ? "نعم" : "لا"}</small>
          </div>
          <div>
            <span class="danger-link" data-email="\${a.email}">حذف</span>
          </div>
        \`;
        row.querySelector(".danger-link").onclick = async () => {
          if(!confirm("متأكد من حذف هذا الموظف؟")) return;
          await fetch("/api/owner/agents/delete", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({email:a.email})
          });
          loadAgents();
        };
        list.appendChild(row);
      });
    }

    document.getElementById("broadcastFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) {
        broadcastFileContent = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        broadcastFileContent = reader.result || "";
      };
      reader.readAsText(file, "utf-8");
    });

    document.getElementById("addAgentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("agentName").value.trim();
      const email = document.getElementById("agentEmail").value.trim();
      const password = document.getElementById("agentPassword").value.trim();
      const whatsapp = document.getElementById("agentWhatsapp").value.trim();
      const canBroadcast = document.getElementById("agentBroadcast").value === "1";
      await fetch("/api/owner/agents/add", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name,email,password,whatsapp,canBroadcast})
      });
      document.getElementById("agentName").value = "";
      document.getElementById("agentEmail").value = "";
      document.getElementById("agentPassword").value = "";
      document.getElementById("agentWhatsapp").value = "";
      loadAgents();
    });

    document.getElementById("startChatForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const wa = document.getElementById("chatWa").value.trim();
      const text = document.getElementById("chatText").value.trim();
      if(!wa || !text) return alert("أدخل الرقم والنص");
      await fetch("/api/owner/start-chat", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:wa,text})
      });
      alert("تم إرسال الرسالة.");
      document.getElementById("chatWa").value = "";
      document.getElementById("chatText").value = "";
    });

    document.getElementById("broadcastForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const numsRaw = document.getElementById("broadcastNumbers").value.trim();
      const text = document.getElementById("broadcastText").value.trim();
      if(!text) return alert("أدخل نص الرسالة");
      await fetch("/api/owner/broadcast", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          numbersText: numsRaw,
          fileContent: broadcastFileContent,
          text
        })
      });
      alert("تم إرسال الرسائل الجماعية (قد يستغرق التنفيذ قليلاً).");
    });

    loadAgents();
  </script>
</body>
</html>
    `);
  }, "owner")
);

// ========== API إدارة الموظفين / المالك ==========
app.get(
  "/api/owner/agents",
  requireLogin((req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ ok: false, error: "forbidden" });
    const agents = Object.values(users).filter((u) => u.role === "agent");
    res.json({ agents });
  }, "owner")
);

app.post(
  "/api/owner/agents/add",
  requireLogin((req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ ok: false, error: "forbidden" });

    const { name, email, password, whatsapp, canBroadcast } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ ok: false });
    }
    if (users[email]) {
      return res.json({ ok: false, error: "الموظف موجود مسبقًا" });
    }
    const id = "agent-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
    const normalizedWhatsapp = whatsapp ? normalizePhone(whatsapp) : null;
    users[email] = {
      id,
      name,
      email,
      password,
      role: "agent",
      whatsapp: normalizedWhatsapp,
      canBroadcast: !!canBroadcast,
    };
    res.json({ ok: true });
  }, "owner")
);

app.post(
  "/api/owner/agents/delete",
  requireLogin((req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ ok: false, error: "forbidden" });
    const { email } = req.body || {};
    if (!email || !users[email] || users[email].role !== "agent") {
      return res.status(400).json({ ok: false });
    }
    delete users[email];
    res.json({ ok: true });
  }, "owner")
);

// إنشاء محادثة فردية من المالك
app.post(
  "/api/owner/start-chat",
  requireLogin((req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ ok: false, error: "forbidden" });

    const user = req.user;
    const { wa_id, text } = req.body || {};
    if (!wa_id || !text) return res.status(400).json({ ok: false });
    const normalized = normalizePhone(wa_id);
    if (!normalized) {
      return res
        .status(400)
        .json({ ok: false, error: "رقم غير صحيح، استخدم 05xxxxxxxx" });
    }
    addMessage(normalized, "agent", text, {
      agentName: user.name,
      agentEmail: user.email,
    });
    sendWhatsAppMessage(normalized, text, "agent", {
      agentName: user.name,
      agentEmail: user.email,
    });
    res.json({ ok: true });
  }, "owner")
);

// إرسال جماعي (من المالك أو موظف له صلاحية)
app.post("/api/owner/broadcast", (req, res) => {
  const user = getUserFromSession(req);
  if (!user) return res.status(401).json({ ok: false });
  if (user.role !== "owner" && !user.canBroadcast) {
    return res
      .status(403)
      .json({ ok: false, error: "لا تملك صلاحية الإرسال الجماعي" });
  }
  const { numbersText, fileContent, text } = req.body || {};
  if (!text) {
    return res
      .status(400)
      .json({ ok: false, error: "لابد من نص الرسالة" });
  }

  let rawNumbers = [];

  if (numbersText && numbersText.trim()) {
    rawNumbers = rawNumbers.concat(numbersText.split(/\s+/));
  }

  if (fileContent && fileContent.trim()) {
    // نفصل على سطور أو فواصل أو مسافات
    rawNumbers = rawNumbers.concat(fileContent.split(/[\s,;]+/));
  }

  const normalizedSet = new Set();
  const finalNumbers = [];

  rawNumbers.forEach((n) => {
    const norm = normalizePhone(n);
    if (norm && !normalizedSet.has(norm)) {
      normalizedSet.add(norm);
      finalNumbers.push(norm);
    }
  });

  if (!finalNumbers.length) {
    return res
      .status(400)
      .json({ ok: false, error: "لم يتم العثور على أرقام صالحة" });
  }

  finalNumbers.forEach((wa) => {
    addMessage(wa, "agent", text, {
      agentName: user.name,
      agentEmail: user.email,
    });
    sendWhatsAppMessage(wa, text, "agent", {
      agentName: user.name,
      agentEmail: user.email,
    });
  });

  res.json({ ok: true, count: finalNumbers.length });
});

// ========== الصفحة الرئيسية ==========
app.get(
  "/",
  requireLogin((req, res) => {
    const isOwner = req.user.role === "owner";
    res.send(`
<html dir="rtl" lang="ar">
<head><meta charset="utf-8" /><title>${STORE_NAME} - لوحة البوت</title></head>
<body style="font-family:system-ui;background:#020617;color:#e5e7eb;padding:20px;">
  <h2>لوحة ${STORE_NAME}</h2>
  <p>مرحباً ${req.user.name} (${req.user.email})</p>
  <ul>
    <li><a href="/inbox-a" style="color:#a855f7;">لوحة A (نمط واتساب ويب)</a></li>
    <li><a href="/inbox-b" style="color:#a855f7;">لوحة B (نمط بسيط)</a></li>
    ${
      isOwner
        ? '<li><a href="/owner" style="color:#a855f7;">قائمة المالك</a></li>'
        : ""
    }
    <li><a href="/logout" style="color:#f97373;">تسجيل خروج</a></li>
  </ul>
</body>
</html>
    `);
  })
);

// ========== لوحة A ==========
app.get(
  "/inbox-a",
  requireLogin((req, res) => {
    const initialWa = req.query.wa || "";
    const isOwner = req.user.role === "owner";
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>لوحة A - محادثات ${STORE_NAME}</title>
  <style>
    body { margin:0; font-family: system-ui; background:#0f172a; color:#e5e7eb; }
    .layout { display:flex; height:100vh; }
    .sidebar { width:280px; background:#020617; border-left:1px solid #1e293b; display:flex; flex-direction:column; }
    .sidebar-header { padding:16px; border-bottom:1px solid #1e293b; font-weight:700; font-size:16px; display:flex; align-items:center; gap:8px; }
    .sidebar-header span.icon { width:28px; height:28px; border-radius:999px; background:#a855f722; display:flex; align-items:center; justify-content:center; color:#a855f7; }
    .sidebar-sub { font-size:11px; color:#64748b; margin-top:2px; }
    .sidebar-actions { padding:6px 12px; font-size:11px; border-bottom:1px solid #0b1120; display:flex; justify-content:space-between; align-items:center; color:#9ca3af; }
    .sidebar-actions a { color:#a855f7; text-decoration:none; }
    .contact-list { flex:1; overflow-y:auto; }
    .contact { padding:10px 14px; cursor:pointer; border-bottom:1px solid #020617; font-size:14px; display:flex; justify-content:space-between; align-items:center; gap:4px; }
    .contact.active { background:#111827; }
    .contact strong { display:block; }
    .contact small { color:#64748b; display:block; margin-top:2px; font-size:11px; }
    .tag { font-size:10px; padding:1px 5px; border-radius:999px; border:1px solid #4b5563; color:#9ca3af; }
    .tag.block { border-color:#f97373; color:#fecaca; }
    .chat { flex:1; display:flex; flex-direction:column; background:radial-gradient(circle at top left,#1f2937,#020617); }
    .chat-header { padding:10px 14px; border-bottom:1px solid #1f2937; display:flex; align-items:center; justify-content:space-between; }
    .chat-title { font-size:15px; font-weight:600; }
    .chat-subtitle { font-size:12px; color:#9ca3af; margin-top:2px; }
    .chat-header-right { display:flex; flex-direction:column; align-items:flex-end; gap:4px; font-size:12px; }
    .status-pill { padding:3px 8px; border-radius:999px; border:1px solid #4ade8055; color:#bbf7d0; background:#16a34a22; }
    .status-pill.off { border-color:#f9737355; color:#fecaca; background:#b91c1c22; }
    .chat-header-buttons {
      display:flex;
      gap:6px;
      background:#020617;
      padding:6px 8px;
      border-radius:999px;
      border:1px solid #1f2937;
      box-shadow:0 8px 18px rgba(15,23,42,0.7);
    }
    .btn-small { padding:4px 9px; border-radius:999px; border:none; background:linear-gradient(135deg,#a855f7,#ec4899); color:#fff; font-size:11px; cursor:pointer; }
    .btn-small.danger { background:linear-gradient(135deg,#ef4444,#f97316); }
    .btn-small.block { background:linear-gradient(135deg,#f97316,#b91c1c); }
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
    .meta { font-size:10px; color:#4b5563; margin-bottom:2px; text-align:left; }
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
      <div class="sidebar-actions">
        <span style="font-size:11px;">مرحباً ${req.user.name}</span>
        <span>
          ${
            isOwner
              ? '<a href="/owner">المالك</a> • '
              : ""
          }
          <a href="/logout">خروج</a>
        </span>
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
          <div class="chat-header-buttons">
            <button id="btnBotReset" class="btn-small">تشغيل البوت 🤖</button>
            <button id="btnBotStop" class="btn-small">إيقاف البوت 👨‍💼</button>
            <button id="btnBlock" class="btn-small block">بلوك 🚫</button>
            <button id="btnUnblock" class="btn-small">إزالة البلوك ✅</button>
            <button id="btnDelete" class="btn-small danger">حذف المحادثة 🗑️</button>
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
    let blocked = {};
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
    const btnBlock = document.getElementById("btnBlock");
    const btnUnblock = document.getElementById("btnUnblock");
    const btnDelete = document.getElementById("btnDelete");

    async function loadData() {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        conversations = data.conversations || {};
        humanOnly = data.humanOnly || {};
        blocked = data.blocked || {};
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
        contactListEl.innerHTML = '<div class="contact"><div><strong>لا توجد محادثات</strong><small>انتظر وصول رسائل من العملاء.</small></div></div>';
        return;
      }
      ids.forEach((id) => {
        const msgs = conversations[id] || [];
        const last = msgs[msgs.length - 1];
        const div = document.createElement("div");
        div.className = "contact" + (currentWaId === id ? " active" : "");
        div.dataset.waId = id;
        const isHuman = !!humanOnly[id];
        const isBlocked = !!blocked[id];
        const tags = [];
        if (isHuman) tags.push("خدمة عملاء");
        if (isBlocked) tags.push("بلوك");
        div.innerHTML = "<div><strong>" + id + "</strong>" +
          (last ? "<small>" + last.text.slice(0,40) + "</small>" : "") +
          "</div><div>" +
          tags.map(t => '<span class="tag '+(t==="بلوك"?"block":"")+'">'+t+'</span>').join(" ") +
          "</div>";
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
      const isBlocked = !!blocked[currentWaId];
      if (isBlocked) {
        botStatusEl.textContent = "🚫 الرقم محظور";
        botStatusEl.classList.add("off");
      } else if (isHuman) {
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

        if (m.from === "agent" && (m.agentName || m.agentEmail)) {
          const meta = document.createElement("div");
          meta.className = "meta";
          meta.textContent = "موظف: " + (m.agentName || "") + (m.agentEmail ? " ("+m.agentEmail+")" : "");
          wrap.appendChild(meta);
        }

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
      if (blocked[waId]) {
        alert("هذا الرقم محظور، لا يمكن الإرسال.");
        return;
      }
      try {
        await fetch("/api/agent/send", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({wa_id:waId,text})
        });
        agentTextInput.value = "";
        if (!conversations[waId]) conversations[waId] = [];
        conversations[waId].push({
          from:"agent",
          text,
          time:new Date().toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"})
        });
        renderChat();
      } catch(e) {
        alert("خطأ في الإرسال");
      }
    });

    btnBotReset.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-reset", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      humanOnly[currentWaId] = false;
      blocked[currentWaId] = false;
      renderChat();
    });

    btnBotStop.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-stop", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      humanOnly[currentWaId] = true;
      renderChat();
    });

    btnBlock.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/block", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      blocked[currentWaId] = true;
      humanOnly[currentWaId] = true;
      renderChat();
    });

    btnUnblock.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/unblock", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      blocked[currentWaId] = false;
      renderChat();
    });

    btnDelete.addEventListener("click", async () => {
      if (!currentWaId) return;
      if (!confirm("متأكد من حذف هذه المحادثة؟")) return;
      await fetch("/api/agent/delete", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      delete conversations[currentWaId];
      delete humanOnly[currentWaId];
      delete blocked[currentWaId];
      currentWaId = "";
      renderContacts();
      renderChat();
    });

    loadData();
    setInterval(loadData, 3000);
  </script>
</body>
</html>
    `);
  })
);

// ========== لوحة B ==========
app.get(
  "/inbox-b",
  requireLogin((req, res) => {
    const isOwner = req.user.role === "owner";
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>لوحة B - محادثات ${STORE_NAME}</title>
  <style>
    body { margin:0; font-family: system-ui; background:#0b1120; color:#e5e7eb; }
    .container { display:flex; flex-direction:column; height:100vh; }
    header { padding:10px 16px; border-bottom:1px solid #1f2937; display:flex; justify-content:space-between; align-items:center; background:#020617; }
    header .title { font-weight:600; font-size:15px; }
    header .sub { font-size:11px; color:#9ca3af; }
    header a { color:#a855f7; text-decoration:none; font-size:11px; }
    .top-bar { padding:8px 16px; background:#020617; display:flex; flex-wrap:wrap; align-items:center; gap:8px; border-bottom:1px solid #1f2937; }
    select { background:#020617; color:#e5e7eb; border:1px solid #374151; border-radius:999px; padding:6px 10px; font-size:13px; min-width:160px; }
    .pill { padding:3px 8px; border-radius:999px; font-size:11px; border:1px solid #4ade8055; color:#bbf7d0; background:#16a34a22; }
    .pill.off { border-color:#f9737355; color:#fecaca; background:#b91c1c22; }
    button { border:none; border-radius:999px; padding:6px 10px; font-size:12px; cursor:pointer; }
    .btn-primary { background:linear-gradient(135deg,#a855f7,#ec4899); color:#fff; }
    .btn-danger { background:linear-gradient(135deg,#ef4444,#f97316); color:#fff; }
    .btn-block { background:linear-gradient(135deg,#f97316,#b91c1c); color:#fff; }
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
    .meta { font-size:10px; color:#4b5563; margin-bottom:2px; text-align:left; }
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
        <div class="sub">لوحة B - نمط بسيط</div>
      </div>
      <div>
        ${
          isOwner
            ? '<a href="/owner">المالك</a> • '
            : ""
        }
        <a href="/">الرئيسية</a> •
        <a href="/logout">خروج</a>
      </div>
    </header>
    <div class="top-bar">
      <label for="clientSelect" style="font-size:12px;">المحادثة:</label>
      <select id="clientSelect"></select>
      <span id="botStatusB" class="pill off">البوت غير نشط</span>
      <button id="btnResetB" class="btn-primary">تشغيل البوت 🤖</button>
      <button id="btnStopB" class="btn-primary">إيقاف البوت 👨‍💼</button>
      <button id="btnBlockB" class="btn-block">بلوك 🚫</button>
      <button id="btnUnblockB" class="btn-primary">إزالة البلوك ✅</button>
      <button id="btnDeleteB" class="btn-danger">حذف 🗑️</button>
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
    let blocked = {};
    let currentWaId = "";
    const clientSelect = document.getElementById("clientSelect");
    const chatMessagesEl = document.getElementById("chatMessages");
    const botStatusEl = document.getElementById("botStatusB");
    const agentForm = document.getElementById("agentFormB");
    const waIdInput = document.getElementById("wa_id_b");
    const agentTextInput = document.getElementById("agentTextB");
    const btnReset = document.getElementById("btnResetB");
    const btnStop = document.getElementById("btnStopB");
    const btnBlock = document.getElementById("btnBlockB");
    const btnUnblock = document.getElementById("btnUnblockB");
    const btnDelete = document.getElementById("btnDeleteB");

    async function loadData() {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        conversations = data.conversations || {};
        humanOnly = data.humanOnly || {};
        blocked = data.blocked || {};
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
        const extra = blocked[id] ? " (بلوك)" : humanOnly[id] ? " (خدمة عملاء)" : "";
        opt.textContent = id + extra + (last ? " - " + last.text.slice(0,16) : "");
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
      const isBlocked = !!blocked[currentWaId];
      if (isBlocked) {
        botStatusEl.textContent = "🚫 الرقم محظور";
        botStatusEl.classList.add("off");
      } else if (isHuman) {
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
        if (m.from === "agent" && (m.agentName || m.agentEmail)) {
          const meta = document.createElement("div");
          meta.className = "meta";
          meta.textContent = "موظف: " + (m.agentName || "") + (m.agentEmail ? " ("+m.agentEmail+")" : "");
          wrap.appendChild(meta);
        }
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
      if (blocked[waId]) {
        alert("هذا الرقم محظور، لا يمكن الإرسال.");
        return;
      }
      await fetch("/api/agent/send", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:waId,text})
      });
      agentTextInput.value = "";
      if (!conversations[waId]) conversations[waId] = [];
      conversations[waId].push({
        from:"agent",
        text,
        time:new Date().toLocaleTimeString("ar-SA",{hour:"2-digit",minute:"2-digit"})
      });
      renderChat();
    });

    btnReset.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-reset", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      humanOnly[currentWaId] = false;
      blocked[currentWaId] = false;
      renderChat();
    });

    btnStop.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/bot-stop", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      humanOnly[currentWaId] = true;
      renderChat();
    });

    btnBlock.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/block", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      blocked[currentWaId] = true;
      humanOnly[currentWaId] = true;
      renderChat();
    });

    btnUnblock.addEventListener("click", async () => {
      if (!currentWaId) return;
      await fetch("/api/agent/unblock", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      blocked[currentWaId] = false;
      renderChat();
    });

    btnDelete.addEventListener("click", async () => {
      if (!currentWaId) return;
      if (!confirm("متأكد من حذف هذه المحادثة؟")) return;
      await fetch("/api/agent/delete", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({wa_id:currentWaId})
      });
      delete conversations[currentWaId];
      delete humanOnly[currentWaId];
      delete blocked[currentWaId];
      currentWaId = "";
      renderClients();
      renderChat();
    });

    loadData();
    setInterval(loadData, 3000);
  </script>
</body>
</html>
    `);
  })
);

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
