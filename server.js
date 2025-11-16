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

// خريطة بسيطة للاشتراكات (يفضل تتحول لقاعدة بيانات لاحقاً)
const subscriptions = new Map();
// key = activationToken
// value = { type, days, orderId, customerPhone, whatsappNumber, botName, welcomeMessage, stopKeyword, humanKeyword, expiresAt, used, createdAt }

function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

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

// 🧷 Webhook من زد
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

    // الحقول المخصصة اللي تضيفها في زد
    const whatsappNumber = getCustomField(event, "whatsapp_number");
    const botName = getCustomField(event, "bot_name");
    const welcomeMessage = getCustomField(event, "welcome_message");
    const stopKeyword = getCustomField(event, "stop_keyword");
    const humanKeyword = getCustomField(event, "human_keyword");

    for (const item of items) {
      const productId = item.product_id || item.sku || item.id;

      const config = productsConfig[productId];
      if (!config) continue; // مو واحد من منتجات البوتات

      const token = generateToken();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + config.days * 24 * 60 * 60 * 1000
      );

      subscriptions.set(token, {
        type: config.type,
        days: config.days,
        productName: config.name,
        orderId,
        customerPhone,
        whatsappNumber: whatsappNumber || customerPhone,
        botName: botName || "البوت الخاص بك",
        welcomeMessage:
          welcomeMessage || "مرحباً بك! كيف أقدر أخدمك؟ 👋",
        stopKeyword: stopKeyword || "إيقاف البوت",
        humanKeyword: humanKeyword || "خدمة العملاء",
        expiresAt,
        used: false,
        createdAt: now
      });

      const activationLink = `${BASE_URL}/activate/${token}`;

      console.log("🎟 تم إنشاء اشتراك جديد مع رابط تفعيل:", activationLink);

      // TODO: هنا ترسل الرابط للعميل برسالة واتساب / SMS / إيميل
      // مثال (وهمي):
      // sendWhatsApp(customerPhone, `تم تفعيل اشتراك ${config.name}.\nرابط التفعيل (مرة واحدة فقط): ${activationLink}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Webhook ERR:", err);
    res.sendStatus(500);
  }
});

// صفحة تفعيل الاشتراك (مرة واحدة فقط)
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

  // نعده مستخدماً، بحيث ما يشتغل إلا مرة
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

// دوال توليد HTML بتصميم حلو (تستخدم style.css)
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
      <p>صُنع بحب 🤍 لمتجر البوتات الذكية</p>
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
    <h2>طريقة التفعيل</h2>
    <ol>
      <li>شغّل سكربت البوت في السيرفر الخاص بك.</li>
      <li>استخدم هذا التوكن داخل إعدادات البوت لقراءة إعدادات هذا الاشتراك:</li>
    </ol>
    <pre class="token-box">${token}</pre>
    <p class="text small">
      يمكنك ربط هذا التوكن مع سكربت البوت بحيث يفعّل الردود لمدة الاشتراك المحددة، 
      ويستخدم الرسالة التعريفية وكلمات الإيقاف وخدمة العملاء تلقائياً.
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
    <h2>خطوات إنشاء بوت تيليجرام</h2>
    <ol>
      <li>افتح تيليجرام وابحث عن <strong>@BotFather</strong>.</li>
      <li>أنشئ بوت جديد واحصل على <strong>Token</strong>.</li>
      <li>في لوحة التحكم الخاصة بنا (أو سكربت البوت لديك)، اربط:
        <br/>- توكن تيليجرام
        <br/>- هذا التوكن الخاص بالاشتراك:
      </li>
    </ol>
    <pre class="token-box">${token}</pre>
    <p class="text small">
      سكربت البوت سيستخدم هذا التوكن لمعرفة إعدادات الاشتراك والمدة تلقائياً.
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
      سكربت الويدجت سيستخدم هذا التوكن لقراءة إعدادات البوت (التعريف + كلمات التحكم) 
      وتفعيل الذكاء الاصطناعي على موقعك طوال مدة الاشتراك.
    </p>
  </div>
</section>
`;
  return renderLayout("تفعيل بوت المتجر الذكي", inner);
}

// صفحات ثابتة للتعريف (ماركتنج)
app.get("/", (req, res) => {
  res.redirect("/whatsapp.html");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
