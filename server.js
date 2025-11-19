// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import QRCode from "qrcode";
import axios from "axios";
import { shopConfig, productsMap } from "./config.js";
import { addActivation, getActivationByToken, markActivationUsed } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ZID_TOKEN = process.env.ZID_ACCESS_TOKEN;

// دالة وهمية لإرسال واتساب – هنا تركّب كود البوت حقك
async function sendWhatsAppMessage(phone, message) {
  // TODO: ركب هنا كود Baileys أو أي كود يرسل من رقم 0561340876
  console.log(`📲 [FAKE WHATSAPP] إرسال رسالة إلى ${phone}:\n${message}\n`);
}

// ✅ استقبال Webhook من زد
app.post("/zid/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📦 Webhook من زد:", JSON.stringify(body, null, 2));

    // نتاكد إن الحدث فعلاً order.paid
    if (body.event !== "order.paid") {
      return res.status(200).send("IGNORED");
    }

    const order = body.data;

    // تأكيد حالة الدفع من الطلب نفسه لو زد ترسل Status
    // لو فيه status === "paid" تقدر تتحقق منه هنا أيضاً

    const orderId = order.id;
    const customerPhone = normalizePhone(order.customer?.phone);
    const customerName = order.customer?.name || "";

    if (!customerPhone) {
      console.log("⚠️ لا يوجد رقم عميل صالح في الطلب");
      return res.status(200).send("NO_PHONE");
    }

    const items = order.items || [];

    // نسوي تفعيلات لكل منتج من المنتجات المطلوبة
    for (const item of items) {
      const productId = item.product_id || item.sku || item.id; // حسب شكل الرد من زد
      const productConf = productsMap[productId];

      if (!productConf) {
        console.log("ℹ️ منتج غير معرف في config:", productId);
        continue;
      }

      const { botType, durationDays, name: productName } = productConf;

      const activationRecord = await addActivation({
        phone: customerPhone,
        customerName,
        productId,
        productName,
        botType,
        durationDays,
        orderId
      });

      const activationUrl = `${BASE_URL}/activate/${activationRecord.token}`;
      const message = shopConfig.defaultWelcomeMessage(
        customerName,
        productName,
        durationDays,
        activationUrl
      );

      await sendWhatsAppMessage(customerPhone, message);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ خطأ في Webhook زد:", err.response?.data || err.message);
    res.status(500).send("ERROR");
  }
});
// صفحة تعرض QR يفتح محادثة واتساب مع الرقم الأساسي
app.get("/whatsapp-qr", async (req, res) => {
  try {
    // غيّر الرقم لرقم البوت حقك بصيغة دولية بدون +
    const waNumber = "966561340876"; // مثال: 9665XXXXXX
    const waLink = `https://wa.me/${waNumber}`;

    const qrDataUrl = await QRCode.toDataURL(waLink);

    res.send(`
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>الدخول لمحادثة الواتساب</title>
          <style>
            body { font-family: system-ui, sans-serif; background:#0F172A; color:#E5E7EB; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
            .card { background:#111827; padding:24px 32px; border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,.6); max-width:420px; text-align:center; }
            h1 { margin-top:0; font-size:22px; }
            p { font-size:14px; color:#CBD5F5; }
            img { margin-top:16px; background:#fff; padding:12px; border-radius:12px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>مرحباً 👋</h1>
            <p>امسح هذا الباركود بكاميرا الواتساب لبدء المحادثة مع رقم البوت الأساسي.</p>
            <img src="${qrDataUrl}" alt="WhatsApp QR" />
            <p>أو اضغط على هذا الرابط مباشرة:<br/><a href="${waLink}" style="color:#38BDF8;">فتح الواتساب</a></p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ خطأ في صفحة QR:", err);
    res.status(500).send("Error generating QR");
  }
});

// ✨ صفحة التفعيل
app.get("/activate/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const record = await getActivationByToken(token);

    if (!record) {
      return res.status(404).send("رابط التفعيل غير صالح ❌");
    }

    if (record.used) {
      return res.status(400).send("تم استخدام رابط التفعيل من قبل ⚠️");
    }

    const now = new Date();
    const exp = new Date(record.expiresAt);
    if (exp < now) {
      return res.status(400).send("انتهت مدة الاشتراك 😔");
    }

    // علامة أنه تم “أول تفعيل” (single-use)
    await markActivationUsed(token);

    res.send(`
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>تفعيل ${shopConfig.botBrand}</title>
          <style>
            body { font-family: system-ui, sans-serif; background:#0F172A; color: #E5E7EB; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
            .card { background:#111827; padding:24px 32px; border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,.6); max-width:420px; text-align:center; }
            h1 { margin-top:0; font-size:24px; }
            .badge { display:inline-block; background:#22C55E33; color:#22C55E; padding:4px 12px; border-radius:999px; font-size:12px; margin-bottom:12px;}
            .bot { color:#38BDF8; font-weight:bold;}
            .muted { color:#9CA3AF; font-size:13px; margin-top:16px;}
            .highlight { color:#FACC15; font-weight:bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">تم التفعيل بنجاح ✅</div>
            <h1>مرحباً ${record.customerName || ""}</h1>
            <p>تم تفعيل اشتراكك في <span class="bot">${shopConfig.botBrand}</span> لنوع البوت:</p>
            <p><strong>${record.productName}</strong></p>
            <p>مدة الاشتراك: <span class="highlight">${record.durationDays} يوم</span></p>
            <p>رقم الواتساب المرتبط: <strong>${record.phone}</strong></p>
            <p class="muted">يمكنك الآن استخدام البوت. في حال احتجت مساعدة، تواصل معنا على واتساب: ${shopConfig.whatsappNumber}</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ خطأ في صفحة التفعيل:", err);
    res.status(500).send("حدث خطأ غير متوقع.");
  }
});

// 🔧 دالة مساعدة لتنسيق رقم الجوال (مثال بسيط)
function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().trim();
  // نحذف أي مسافات
  p = p.replace(/\s+/g, "");
  // لو يبدأ بـ 0 نخليه 9665...
  if (p.startsWith("0")) p = "966" + p.slice(1);
  // لو يبدأ بـ + نشيله
  if (p.startsWith("+")) p = p.slice(1);
  return p;
}

app.get("/", (req, res) => {
  res.send("Smart Bot – تكامل زد مع البوتات ✅");
});

app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
});
