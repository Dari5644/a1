// server.js
const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const crypto = require("crypto");
const path = require("path");
const { productsConfig } = require("./config");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// خريطة بسيطة للاشتراكات (لو تبي دائم، استبدلها بقاعدة بيانات)
const subscriptions = new Map();
// key = activationToken
// value = { type, plan, days, productName, orderId, customerPhone, botName, whatsappNumber, welcomeMessage, stopKeyword, humanKeyword, expiresAt, used, createdAt }

function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

// جلب قيمة حقل مخصص من الطلب (تضبطها في زد)
function getCustomField(event, key) {
  const fields =
    event.custom_fields ||
    event.customFields ||
    event.metadata ||
    [];

  const found = fields.find(
    (f) =>
      f.key === key ||
      f.name === key ||
      f.field === key
  );

  return found ? found.value : null;
}

// 🔔 دالة إرسال رسالة واتساب (تعديلها حسب نظامك)
// حالياً بس تطبع في الـ console –
// أنت هنا تربطها مع ميزة الإرسال اللي عندك (Meta, WATI, API ثاني…)
async function sendWhatsAppMessage(toPhone, message) {
  console.log("📨 [FAKE WHATSAPP SEND] إلى:", toPhone);
  console.log(message);
  // TODO: هنا تربط مع النظام الحقيقي اللي يرسل واتساب
}

// 🧷 Webhook من زد – استقباله عند اكتمال الطلب
app.post("/webhook/zid", async (req, res) => {
  try {
    const event = req.body;
    console.log("📦 Webhook من زد:", JSON.stringify(event, null, 2));

    const orderId = event.order_id || event.id || event.orderId;
    const customerPhone =
      event.customer_phone ||
      (event.customer && event.customer.phone) ||
      null;

    const items = event.items || event.order_items || event.products || [];

    if (!customerPhone || !items.length) {
      console.warn("❗ لا يوجد رقم عميل أو منتجات في الطلب");
      return res.sendStatus(400);
    }

    // الحقول المخصصة في زد (تضيفها في صفحة الطلب)
    const whatsappNumber = getCustomField(event, "whatsapp_number"); // رقم الواتساب اللي بيشغل البوت
    const botName      = getCustomField(event, "bot_name");          // اسم البوت / المتجر
    const welcomeMsg   = getCustomField(event, "welcome_message");   // الرسالة التعريفية
    const stopKeyword  = getCustomField(event, "stop_keyword");      // كلمة إيقاف البوت
    const humanKeyword = getCustomField(event, "human_keyword");     // كلمة خدمة العملاء

    // نمشي على كل المنتجات في الطلب
    for (const item of items) {
      const productId = item.product_id || item.sku || item.id;

      const config = productsConfig[productId];
      if (!config) continue; // منتج عادي مو بوت

      const token = generateToken();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + config.days * 24 * 60 * 60 * 1000
      );

      const sub = {
        type: config.type,
        plan: config.plan,
        days: config.days,
        productName: config.name,
        orderId,
        customerPhone,
        botName: botName || "البوت الخاص بك",
        whatsappNumber: whatsappNumber || customerPhone,
        welcomeMessage:
          welcomeMsg || "مرحباً بك! كيف أقدر أخدمك؟ 👋",
        stopKeyword: stopKeyword || "إيقاف البوت",
        humanKeyword: humanKeyword || "خدمة العملاء",
        expiresAt,
        used: false,
        createdAt: now
      };

      subscriptions.set(token, sub);

      const activationLink = `${BASE_URL}/activate/${token}`;
      console.log("🎟 تم إنشاء اشتراك جديد مع رابط تفعيل:", activationLink);

      // ✅ هنا يرسل الرابط للرقم المرتبط
      // واحد من الاثنين:
      // - ترسله على رقم الواتساب الخاص بالعميل
      // - أو رقم الواتساب المخصص للبوت (whatsappNumber)
      const targetPhone = sub.whatsappNumber || customerPhone;

      const msg = [
        `مرحباً 👋`,
        `تم تفعيل اشتراك: ${config.name}`,
        `مدة الاشتراك: ${config.days} يوم`,
        ``,
        `رابط التفعيل (يعمل مرة واحدة فقط):`,
        activationLink
      ].join("\n");

      await sendWhatsAppMessage(targetPhone, msg);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Webhook ERR:", err);
    res.sendStatus(500);
  }
});

// صفحة تفعيل الاشتراك (رابط يعمل مرة واحدة)
app.get("/activate/:token", (req, res) => {
  const { token } = req.params;
  const sub = subscriptions.get(token);

  if (!sub) {
    return res
      .status(404)
      .send(renderSimplePage("رابط غير صالح ❌", "الرابط الذي استخدمته غير صالح."));
  }

  if (sub.used) {
    return res
      .status(400)
      .send(renderSimplePage("تم استخدام الرابط ✅", "تم استخدام رابط التفعيل من قبل."));
  }

  const now = new Date();
  if (now > sub.expiresAt) {
    return res
      .status(400)
      .send(renderSimplePage("انتهت صلاحية الرابط ⏰", "انتهت مدة صلاحية هذا الرابط."));
  }

  // نعدّه مستخدماً، عشان ما يشتغل إلا مرة وحده
  sub.used = true;
  subscriptions.set(token, sub);

  // نعرض صفحة حسب نوع البوت
  if (sub.type === "whatsapp_bot") {
    return res.send(renderWhatsAppActivationPage(sub, token));
  }

  if (sub.type === "telegram_bot") {
    return res.send(renderTelegramActivationPage(sub, token));
  }

  if (sub.type === "store_ai_bot") {
    return res.send(renderStoreAIActivationPage(sub, token));
  }

  return res.send(
    renderSimplePage("نوع اشتراك غير معروف", "لا يمكن تحديد نوع الاشتراك.")
  );
});

// ✅ API للـ client bots عشان يجيب إعدادات الاشتراك
app.get("/api/subscription/:token", (req, res) => {
  const { token } = req.params;
  const sub = subscriptions.get(token);
  if (!sub) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const now = new Date();
  const active = !sub.used || now <= sub.expiresAt; // حسب ما تبي (هنا مثال)

  return res.json({
    ok: true,
    active: now <= sub.expiresAt,
    type: sub.type,
    plan: sub.plan,
    days: sub.days,
    productName: sub.productName,
    botName: sub.botName,
    whatsappNumber: sub.whatsappNumber,
    welcomeMessage: sub.welcomeMessage,
    stopKeyword: sub.stopKeyword,
    humanKeyword: sub.humanKeyword,
    expiresAt: sub.expiresAt,
    createdAt: sub.createdAt
  });
});

// ====== HTML / تصميم الصفحات ======
function renderLayout(title, contentHtml) {
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="stylesheet" href="/css/style.css" />
</head>
<body>
  <div class="page-wrapper">
    <header class="main-header">
      <div class="logo">Smart <span>Bot</span></div>
      <nav class="nav-links">
        <a href="/whatsapp.html">بوت واتساب</a>
        <a href="/telegram.html">بوت تيليجرام</a>
        <a href="/store-ai.html">بوت المتجر الذكي</a>
      </nav>
    </header>

    <main class="content">
      ${contentHtml}
    </main>

    <footer class="main-footer">
      <p>صُنع بحب 🤍 لنظام بيع البوتات الذكية عبر زد</p>
    </footer>
  </div>
</body>
</html>
`;
}

function renderSimplePage(title, message) {
  const inner = `
  <section class="card">
    <h1 class="title">${title}</h1>
    <p class="text">${message}</p>
  </section>
  `;
  return renderLayout(title, inner);
}

function renderWhatsAppActivationPage(sub, token) {
  const inner = `
<section class="card">
  <h1 class="title">تفعيل ${sub.productName || "بوت واتساب"}</h1>
  <p class="text">مرحباً بك 👋، تم إنشاء اشتراك بوت واتساب لمدة <strong>${sub.days} يوماً</strong>.</p>

  <div class="info-grid">
    <div>
      <h3>اسم البوت</h3>
      <p>${sub.botName}</p>
    </div>
    <div>
      <h3>رقم الواتساب المرتبط</h3>
      <p>${sub.whatsappNumber}</p>
    </div>
    <div>
      <h3>الرسالة التعريفية</h3>
      <p>${sub.welcomeMessage}</p>
    </div>
    <div>
      <h3>كلمة إيقاف البوت</h3>
      <p>${sub.stopKeyword}</p>
    </div>
    <div>
      <h3>كلمة خدمة العملاء</h3>
      <p>${sub.humanKeyword}</p>
    </div>
    <div>
      <h3>ينتهي الاشتراك في</h3>
      <p>${sub.expiresAt.toLocaleString("ar-SA")}</p>
    </div>
  </div>

  <div class="highlight-box">
    <h2>طريقة استخدام هذا الاشتراك</h2>
    <ol>
      <li>نزّل سكربت البوت الخاص بك (client-bot-whatsapp.js مثلاً).</li>
      <li>ضع التوكن التالي داخل السكربت:</li>
    </ol>
    <pre class="token-box">${token}</pre>
    <p class="text small">
      سكربت البوت سيستخدم هذا التوكن للاتصال بـ /api/subscription/${token}
      وجلب إعدادات البوت (التعريف + كلمات الإيقاف + خدمة العملاء) والتحقق من مدة الاشتراك.
    </p>
  </div>
</section>
`;
  return renderLayout("تفعيل بوت واتساب", inner);
}

function renderTelegramActivationPage(sub, token) {
  const inner = `
<section class="card">
  <h1 class="title">تفعيل ${sub.productName || "بوت تيليجرام"}</h1>
  <p class="text">تم إنشاء اشتراك بوت تيليجرام لمدة <strong>${sub.days} يوماً</strong>.</p>

  <div class="info-grid">
    <div>
      <h3>اسم البوت</h3>
      <p>${sub.botName}</p>
    </div>
    <div>
      <h3>ينتهي الاشتراك في</h3>
      <p>${sub.expiresAt.toLocaleString("ar-SA")}</p>
    </div>
  </div>

  <div class="highlight-box">
    <h2>خطوات ربط بوت تيليجرام</h2>
    <ol>
      <li>إنشاء بوت جديد من <strong>@BotFather</strong> والحصول على Token.</li>
      <li>ضبط سكربت بوت تيليجرام (client-bot-telegram.js مثلاً) مع هذا التوكن:</li>
    </ol>
    <pre class="token-box">${token}</pre>
    <p class="text small">
      سكربت البوت سيستخدم هذا التوكن للاتصال بـ /api/subscription/${token}
      وجلب إعدادات ومدة الاشتراك.
    </p>
  </div>
</section>
`;
  return renderLayout("تفعيل بوت تيليجرام", inner);
}

function renderStoreAIActivationPage(sub, token) {
  const inner = `
<section class="card">
  <h1 class="title">تفعيل ${sub.productName || "بوت المتجر الذكي"}</h1>
  <p class="text">تم إنشاء اشتراك بوت ذكاء اصطناعي لمتجرك لمدة <strong>${sub.days} يوماً</strong>.</p>

  <div class="info-grid">
    <div>
      <h3>اسم البوت / المتجر</h3>
      <p>${sub.botName}</p>
    </div>
    <div>
      <h3>الرسالة التعريفية</h3>
      <p>${sub.welcomeMessage}</p>
    </div>
    <div>
      <h3>كلمة إيقاف البوت</h3>
      <p>${sub.stopKeyword}</p>
    </div>
    <div>
      <h3>كلمة خدمة العملاء</h3>
      <p>${sub.humanKeyword}</p>
    </div>
  </div>

  <div class="highlight-box">
    <h2>تركيب البوت في موقعك</h2>
    <p class="text">أضف الكود التالي داخل &lt;head&gt; أو قبل &lt;/body&gt; في موقعك:</p>
    <pre class="token-box">&lt;script src="${BASE_URL}/widget.js" data-token="${token}"&gt;&lt;/script&gt;</pre>
    <p class="text small">
      سكربت الويدجت سيستخدم هذا التوكن للاتصال بـ /api/subscription/${token}
      وتشغيل بوت الذكاء الاصطناعي داخل موقعك طوال مدة الاشتراك.
    </p>
  </div>
</section>
`;
  return renderLayout("تفعيل بوت المتجر الذكي", inner);
}

// صفحة افتراضية
app.get("/", (req, res) => {
  res.redirect("/whatsapp.html");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
