// mailWatcher.js
import { ImapFlow } from "imapflow";
import { APP_CONFIG } from "./config.js";
import {
  addOrder,
  addActivation,
  loadActivations
} from "./storage.js";
import crypto from "crypto";
import QRCode from "qrcode";

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * هذه الدالة تحاول تفهم إيميل زد وتستخرج:
 * - رقم الطلب
 * - حالة الدفع
 * - رقم العميل (جوال)
 * - المنتجات (الكود/الاسم)
 *
 * ✏️ عدّلها حسب الرسائل اللي تشوفها في بريدك.
 */
function parseZidEmail(subject, text) {
  // مثال تقريبي:
  // subject: "تم الدفع للطلب رقم #12345"
  // في النص: "رقم الجوال: 0554986089"
  //          "المنتج: Z.17632374787413204 - بوت واتساب شهر"

  const isPaid =
    subject.includes("تم الدفع") ||
    text.includes("تم الدفع") ||
    text.includes("مدفوع");

  if (!isPaid) {
    return null; // ما يهمنا إلا المدفوع
  }

  // رقم الطلب من العنوان
  const orderMatch = subject.match(/#?(\d{3,})/);
  const orderId = orderMatch ? orderMatch[1] : `UNKNOWN-${Date.now()}`;

  // رقم الجوال
  const phoneMatch =
    text.match(/(?:جوال|هاتف|الجوال)\s*[:\-]?\s*(05\d{8})/) ||
    text.match(/(05\d{8})/);

  const customerPhone = phoneMatch ? phoneMatch[1] : null;

  // نحاول نلقط كود المنتج
  const productCodeMatch =
    text.match(/(Z\.\d{5,})/) || text.match(/SKU\s*[:\-]?\s*(Z\.\d{5,})/);

  const productCode = productCodeMatch ? productCodeMatch[1] : null;

  // لو ما عرفنا المنتج نرجع null
  if (!productCode) return null;

  return {
    orderId,
    customerPhone,
    productCode,
    rawText: text
  };
}

/**
 * إنشاء كود تفعيل ورابط وباركود
 */
async function createActivationFromOrder(order) {
  const productDef = APP_CONFIG.products[order.productCode];
  if (!productDef) {
    console.warn("⚠️ منتج غير معروف في config.products:", order.productCode);
    return null;
  }

  const id = crypto.randomUUID();
  const activationCode = crypto.randomBytes(16).toString("hex");

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + productDef.durationDays * 24 * 60 * 60 * 1000
  );

  const activationLink = `${APP_CONFIG.publicBaseUrl}/activate/${activationCode}`;

  // توليد QR كـ Data URL (تقدر تخليه ملف لاحقاً)
  const qrDataUrl = await QRCode.toDataURL(activationLink, {
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 6
  });

  const activation = {
    id,
    orderId: order.orderId,
    customerPhone: order.customerPhone,
    productCode: order.productCode,
    productName: productDef.name,
    type: productDef.type,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    activationCode,
    activationLink,
    qrDataUrl,
    used: false
  };

  addActivation(activation);
  console.log("✅ تم إنشاء تفعيل جديد:", activation);

  // هنا تقدر تنادي دالة ترسل الرسالة للعميل عبر الواتساب/الإيميل
  // مثلاً: await notifyCustomer(activation);

  return activation;
}

/**
 * تشغيل مراقب IMAP
 */
export async function startMailWatcher() {
  const { mail, zidMailFilter } = APP_CONFIG;
  const { MAIL_PASSWORD } = process.env;

  if (!MAIL_PASSWORD) {
    console.error("❌ MAIL_PASSWORD غير موجود في .env");
    return;
  }

  const client = new ImapFlow({
    host: mail.host,
    port: mail.port,
    secure: mail.secure,
    auth: {
      user: mail.user,
      pass: MAIL_PASSWORD
    }
  });

  client.on("error", (err) => {
    console.error("❌ خطأ في IMAP:", err);
  });

  while (true) {
    try {
      console.log("📬 الاتصال بصندوق البريد...");
      await client.connect();

      // افتح Inbox
      let lock = await client.getMailboxLock("INBOX");
      try {
        console.log("📥 مراقبة INBOX...");

        // نقرأ الرسائل الجديدة (غير المقروءة) أول مرة
        for await (let message of client.fetch(
          { seen: false },
          { envelope: true, source: true, bodyStructure: true, bodyParts: ["text"] }
        )) {
          await handleMessage(client, message, zidMailFilter);
        }

        // ثم نعمل idle لانتظار رسائل جديدة
        for await (let notif of client.idle()) {
          if (notif.exists) {
            // رسائل جديدة وصلت
            for await (let message of client.fetch(
              { uid: notif.exists },
              { envelope: true, source: true, bodyStructure: true, bodyParts: ["text"] }
            )) {
              await handleMessage(client, message, zidMailFilter);
            }
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      console.error("❌ خطأ في حلقة IMAP، إعادة المحاولة بعد 10 ثواني:", err);
      await sleep(10000);
    } finally {
      try {
        await client.logout();
      } catch (e) {}
    }
  }
}

/**
 * معالجة رسالة واحدة
 */
async function handleMessage(client, message, zidMailFilter) {
  try {
    const envelope = message.envelope || {};
    const subject = envelope.subject || "";
    const from = (envelope.from && envelope.from[0] && envelope.from[0].address) || "";

    // فلترة حسب الإعدادات
    if (zidMailFilter.fromIncludes && !from.includes(zidMailFilter.fromIncludes)) {
      return;
    }
    if (zidMailFilter.subjectIncludes && !subject.includes(zidMailFilter.subjectIncludes)) {
      return;
    }

    // نجيب النص العادي
    let text = "";
    if (message.bodyParts && message.bodyParts.length > 0) {
      for await (let part of client.download(message.uid, message.bodyParts[0])) {
        text += part.toString("utf8");
      }
    }

    console.log("📧 إيميل جديد من زد محتمل:", { from, subject });

    const parsed = parseZidEmail(subject, text);
    if (!parsed) {
      console.log("⚠️ لم أستطع تحليل هذا الإيميل كطلب مدفوع من زد.");
      return;
    }

    const order = {
      orderId: parsed.orderId,
      customerPhone: parsed.customerPhone,
      productCode: parsed.productCode,
      createdAt: new Date().toISOString(),
      raw: parsed.rawText
    };

    addOrder(order);
    console.log("🧾 تم حفظ طلب جديد:", order);

    // توليد تفعيل لهذا الطلب
    await createActivationFromOrder(order);
  } catch (err) {
    console.error("❌ خطأ أثناء معالجة رسالة:", err);
  }
}
