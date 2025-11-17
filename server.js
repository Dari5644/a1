// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { APP_CONFIG } from "./config.js";
import {
  loadOrders,
  loadActivations,
  updateActivation
} from "./storage.js";
import { startMailWatcher } from "./mailWatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ========= Helpers =========
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Basic ", "");

  // Basic auth: base64("username:password")
  const expectedUser = APP_CONFIG.admin.username;
  const expectedPass = process.env.ADMIN_PASSWORD || "change-me";

  const expected = Buffer.from(`${expectedUser}:${expectedPass}`).toString(
    "base64"
  );

  if (token === expected) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Smart Bot Admin"');
  return res.status(401).send("Unauthorized");
}

// ========= Routes =========

app.get("/", (req, res) => {
  res.send(
    `<html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>${APP_CONFIG.brandName}</title>
        <style>
          body { font-family: system-ui, sans-serif; background:#050816; color:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; }
          .card { background:#111827; padding:24px 32px; border-radius:18px; box-shadow:0 10px 40px rgba(0,0,0,.6); max-width:560px; width:100%; text-align:center; }
          h1 { margin-bottom:12px; font-size:24px; }
          p { color:#9ca3af; line-height:1.7; }
          a.btn { display:inline-block; margin-top:16px; background:#22c55e; color:#000; padding:10px 18px; border-radius:999px; text-decoration:none; font-weight:600; }
          a.btn:hover { background:#16a34a; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>${APP_CONFIG.brandName}</h1>
          <p>جسر ربط بين متجر زد و تفعيلات البوت (Smart Bot) عن طريق البريد الإلكتروني.</p>
          <p>يتم إنشاء رابط تفعيل و باركود تلقائياً لكل طلب مدفوع.</p>
          <a href="/admin" class="btn">لوحة الإدارة</a>
        </div>
      </body>
    </html>`
  );
});

// قائمة التفعيلات (JSON) – ممكن تستخدمها من موقع خارجي
app.get("/api/activations", (req, res) => {
  const activations = loadActivations();
  res.json(activations);
});

// قائمة الطلبات (JSON)
app.get("/api/orders", (req, res) => {
  const orders = loadOrders();
  res.json(orders);
});

// تفعيل برابط – يعمل مرة واحدة فقط
app.get("/activate/:code", (req, res) => {
  const code = req.params.code;
  const activations = loadActivations();
  const activation = activations.find((a) => a.activationCode === code);

  if (!activation) {
    return res.status(404).send("رابط التفعيل غير صالح.");
  }

  const now = new Date();
  const exp = new Date(activation.expiresAt);

  if (activation.used) {
    return res.status(400).send("تم استخدام هذا الرابط من قبل.");
  }

  if (now > exp) {
    return res.status(400).send("انتهت صلاحية هذا التفعيل.");
  }

  // نحدّث الحالة إلى used = true
  updateActivation(activation.id, { used: true, usedAt: now.toISOString() });

  // هنا مكانك تستدعي سكربت تشغيل البوت الفعلي (واتساب/تلغرام/موقع)
  // مثلاً: callSmartBotProvisioning(activation);

  res.send(
    `<html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>تم تفعيل البوت</title>
        <style>
          body { font-family: system-ui, sans-serif; background:#020617; color:#e5e7eb; display:flex; align-items:center; justify-content:center; min-height:100vh; }
          .wrap { background:#111827; padding:24px 30px; border-radius:16px; max-width:520px; width:100%; box-shadow:0 20px 40px rgba(0,0,0,.7); }
          h1 { font-size:22px; margin-bottom:10px; color:#22c55e; }
          p { color:#9ca3af; line-height:1.8; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1>تم تفعيل اشتراك البوت بنجاح ✅</h1>
          <p>المنتج: ${activation.productName}</p>
          <p>رقم الطلب: ${activation.orderId}</p>
          <p>المدة: حتى ${activation.expiresAt}</p>
          <p>سيتم الآن تجهيز البوت لك تلقائيًا حسب إعداداتك.</p>
        </div>
      </body>
    </html>`
  );
});

// صفحة إدارة بسيطة (تحميها Basic Auth)
app.get("/admin", requireAdmin, (req, res) => {
  const activations = loadActivations();
  const orders = loadOrders();

  const rows = activations
    .slice()
    .reverse()
    .map(
      (a) => `
      <tr>
        <td>${a.orderId}</td>
        <td>${a.customerPhone || "-"}</td>
        <td>${a.productName}</td>
        <td>${a.createdAt}</td>
        <td>${a.expiresAt}</td>
        <td>${a.used ? "✅" : "⏳"}</td>
        <td><a href="${a.activationLink}" target="_blank">الرابط</a></td>
      </tr>`
    )
    .join("");

  res.send(
    `<html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>لوحة الإدارة - ${APP_CONFIG.brandName}</title>
        <style>
          body { font-family: system-ui, sans-serif; background:#020617; color:#e5e7eb; margin:0; padding:0; }
          header { padding:16px 24px; background:#111827; display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; z-index:10; }
          header h1 { font-size:19px; margin:0; }
          header span { color:#9ca3af; font-size:13px; }
          main { padding:18px 24px 32px; }
          table { width:100%; border-collapse:collapse; margin-top:12px; }
          th, td { padding:8px 10px; border-bottom:1px solid #1f2937; font-size:13px; text-align:right; }
          th { background:#0b1120; position:sticky; top:52px; z-index:5; }
          tr:hover { background:#020617; }
          a { color:#38bdf8; text-decoration:none; }
          a:hover { text-decoration:underline; }
          .pill { display:inline-flex; align-items:center; border-radius:999px; padding:4px 10px; font-size:12px; background:#0f172a; color:#a5b4fc; }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>${APP_CONFIG.brandName}</h1>
            <span>لوحة ربط زد ↔️ سمارت بوت (بريد)</span>
          </div>
          <div class="pill">الإجمالي: ${activations.length} تفعيل</div>
        </header>
        <main>
          <h2>التفعيلات</h2>
          <table>
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>رقم العميل</th>
                <th>المنتج</th>
                <th>تاريخ الإنشاء</th>
                <th>تاريخ الانتهاء</th>
                <th>الحالة</th>
                <th>الرابط</th>
              </tr>
            </thead>
            <tbody>
              ${rows || "<tr><td colspan='7'>لا يوجد تفعيلات بعد.</td></tr>"}
            </tbody>
          </table>

          <h2 style="margin-top:32px;">الطلبات الخام (من البريد)</h2>
          <pre style="background:#020617; padding:12px 14px; border-radius:12px; font-size:12px; white-space:pre; max-height:260px; overflow:auto;">${JSON.stringify(
            orders.slice(-20),
            null,
            2
          )}</pre>
        </main>
      </body>
    </html>`
  );
});

// ========== تشغيل السيرفر + مراقب الإيميل ==========

app.listen(PORT, () => {
  console.log(`🚀 Smart Bot Zid Bridge يعمل على المنفذ ${PORT}`);
  console.log(`🔗 ${APP_CONFIG.publicBaseUrl}`);
});

// تشغيل مراقبة البريد في الخلفية
startMailWatcher().catch((err) => {
  console.error("❌ فشل تشغيل مراقب البريد:", err);
});
