// server.js
// بسيط – يستقبل رسائل واتساب من Meta Webhook ويرد عليها

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ---- الإعدادات (من المتغيرات البيئية في Render) ----

// التوكن الطويل المدى من واتساب (اللي أرسلته لي)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// رقم هاتف واتساب (Phone Number ID) من لوحة Meta
// من الصور القديمة عندك كان شيء مثل: 830233543513578
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// التوكن اللي استخدمناه في التحقق من الـ Webhook
// أنت كنت تستخدم: mawaheb_verify
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mawaheb_verify';

// بورت السيرفر (Render يعطيه تلقائيًا)
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------

// صفحة بسيطة للتأكد أن السيرفر شغال
app.get('/', (req, res) => {
  res.send('WhatsApp bot is running ✅');
});

// ✅ خطوة التحقق من Webhook (GET /webhook)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('WEBHOOK VERIFICATION TRY:', { mode, token, challenge });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ WEBHOOK_VERIFIED');
    return res.status(200).send(challenge);
  } else {
    console.log('❌ WEBHOOK_VERIFICATION_FAILED');
    return res.sendStatus(403);
  }
});

// ✅ استقبال الرسائل من واتساب (POST /webhook)
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // نتأكد أن الطلب من "whatsapp_business_account"
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (messages && messages.length > 0) {
        const message = messages[0];

        // رقم المرسل
        const from = message.from;
        // نص الرسالة
        const msgBody = message.text?.body || '';

        console.log('📩 رسالة جديدة من:', from, 'النص:', msgBody);

        // هنا تقدر تحط منطق الذكاء الاصطناعي – حالياً بنرسل رد بسيط
        const replyText = `شكرًا لرسالتك 🤍\n\nأستلمت منك:\n"${msgBody}"`;

        await sendWhatsAppMessage(from, replyText);
      }
    }

    // لازم نرجع 200 عشان Meta ما تعيد إرسال الطلب
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error in /webhook POST:', error?.response?.data || error.message);
    res.sendStatus(500);
  }
});

// ✉️ دالة إرسال رسالة عبر WhatsApp Cloud API
async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('❌ WHATSAPP_TOKEN أو PHONE_NUMBER_ID غير مضبوطين في المتغيرات البيئية!');
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: 'whatsapp',
    to,
    text: { body: text },
  };

  try {
    const res = await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('✅ تم إرسال الرد بنجاح:', res.data);
  } catch (error) {
    console.error(
      '❌ خطأ في إرسال رسالة واتساب:',
      error?.response?.data || error.message
    );
  }
}

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
