// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import QRCode from "qrcode";

import { shopConfig, productsMap } from "./config.js";
import {
  addActivation,
  getActivationByToken,
  markActivationUsed
} from "./db.js";
import { startWhatsApp, sendWhatsAppMessage } from "./whatsapp.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().trim();
  p = p.replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "966" + p.slice(1);
  return p;
}

// ✅ Webhook من زد: order.paid
app.post("/zid/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📦 Webhook من زد:", JSON.stringify(body, null, 2));

    if (body.event !== "order.paid") {
      return res.status(200).send("IGNORED");
    }

    const order = body.data;
    const orderId = order.id;
    const customerPhone = normalizePhone(order.customer?.phone);
    const customerName = order.customer?.name || "";
    const items = order.items || [];

    if (!customerPhone) {
      console.log("⚠️ لا يوجد رقم جوال للعميل.");
      return res.status(200).send("NO_PHONE");
    }

    for (const item of items) {
      const productId = item.product_id || item.sku || item.id;
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
      const qrUrl = `${BASE_URL}/whatsapp-qr`;

      const message =
        `مرحباً ${customerName || ""} 👋\n` +
        `شكراً لطلبك *${productName}* من ${shopConfig.shopName}.\n\n` +
        `1️⃣ لبدء المحادثة مع رقم البوت، افتح هذا الرابط لمسح باركود الواتساب:\n${qrUrl}\n\n` +
        `2️⃣ رابط تفعيل الاشتراك (مرة واحدة فقط):\n${activationUrl}\n\n` +
        `في حال واجهت أي مشكلة، تواصل معنا على هذا الرقم: ${shopConfig.whatsappNumber}.`;

      await sendWhatsAppMessage(customerPhone, message);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ خطأ في Webhook زد:", err.response?.data || err.message);
    res.status(500).send("ERROR");
  }
});

// صفحة QR لفتح محادثة الواتساب مع رقم البوت
app.get("/whatsapp-qr", async (req, res) => {
  try {
    const waNumber = shopConfig.whatsappNumber; // 9665...
    const waLink = `https://wa.me/${waNumber}`;
    const qrDataUrl = await QRCode.toDataURL(waLink);

    res.send(`
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>بدء المحادثة مع Smart Bot</title>
          <style>
            body { font-family: system-ui, sans-serif; background:#0F172A; color:#E5E7EB; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
            .card { background:#111827; padding:24px 32px; border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,.6); max-width:420px; text-align:center; }
            h1 { margin-top:0; font-size:22px; }
            p { font-size:14px; color:#CBD5F5; }
            img { margin-top:16px; background:#fff; padding:12px; border-radius:12px; }
            a { color:#38BDF8; text-decoration:none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>مرحباً بك في Smart Bot 🤖</h1>
            <p>امسح هذا الباركود بكاميرا واتساب لبدء المحادثة مع رقم البوت الأساسي.</p>
            <img src="${qrDataUrl}" alt="WhatsApp QR" />
            <p>أو اضغط على هذا الرابط مباشرة:<br/><a href="${waLink}">فتح الواتساب الآن</a></p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ خطأ في صفحة QR:", err);
    res.status(500).send("Error generating QR");
  }
});

// صفحة تفعيل الاشتراك
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

    await markActivationUsed(token);

    res.send(`
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>تفعيل ${shopConfig.botBrand}</title>
          <style>
            body { font-family: system-ui, sans-serif; background:#020617; color:#E5E7EB; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
            .card { background:#0F172A; padding:24px 32px; border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,.6); max-width:420px; text-align:center; }
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

app.get("/", (req, res) => {
  res.send("Smart Bot – تكامل زد + واتساب ويب ✅");
});

// تشغيل السيرفر + واتساب
app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
  startWhatsApp().catch((err) =>
    console.error("❌ خطأ في تشغيل واتساب:", err)
  );
});
