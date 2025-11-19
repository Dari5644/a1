// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";

import { shopConfig, productsMap } from "./config.js";
import { addActivation } from "./db.js";
import { startWhatsApp, sendWhatsAppMessage } from "./whatsapp.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().trim();
  p = p.replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "966" + p.slice(1);
  return p;
}

// Webhook من زد → لما تكون الحالة order.paid
app.post("/zid/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📦 Webhook من زد:", JSON.stringify(body, null, 2));

    if (body.event !== "order.paid") {
      return res.status(200).send("IGNORED");
    }

    const order = body.data;
    const customerPhone = normalizePhone(order.customer?.phone);
    const customerName = order.customer?.name || "";
    const items = order.items || [];

    if (!customerPhone) {
      console.log("⚠️ لا يوجد رقم جوال في الطلب.");
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

      await addActivation({
        phone: customerPhone,
        customerName,
        productId,
        productName,
        botType,
        durationDays,
        orderId: order.id
      });

      const waLink = `https://wa.me/${shopConfig.whatsappNumber}`;

      const message =
        `مرحباً ${customerName} 👋\n` +
        `شكراً لطلبك *${productName}* من ${shopConfig.shopName}.\n\n` +
        `✅ تم تفعيل اشتراكك لمدة ${durationDays} يوم.\n` +
        `ابدأ المحادثة مع البوت من خلال هذا الرابط:\n${waLink}\n\n` +
        `تذكير: هذا البوت مخصص فقط لعملاء Smart Bot المشتركين.\n` +
        `للأسئلة داخل الواتساب اكتب: مساعدة أو خدمة العملاء.`;

      await sendWhatsAppMessage(customerPhone, message);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ خطأ في Webhook زد:", err.response?.data || err.message);
    res.status(500).send("ERROR");
  }
});

app.get("/", (req, res) => {
  res.send("Smart Bot – تكامل زد + واتساب + ذكاء اصطناعي + خدمة عملاء ✅");
});

app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
  startWhatsApp().catch((err) =>
    console.error("❌ خطأ في تشغيل واتساب:", err)
  );
});
