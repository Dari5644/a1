// bot.js

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

// عميل OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// تعريف البوت (عدّله حسب اللي تبيه)
const SYSTEM_PROMPT = `
أنت بوت ذكاء اصطناعي ترد على رسائل الواتساب.
- ردودك قصيرة وواضحة وباللغة العربية.
- إذا سلّم عليك أحد (السلام عليكم / هلا / مرحبا) رد بتحية لطيفة ثم اسأله: "كيف أقدر أساعدك؟"
- لا تعطي روابط ولا أرقام إلا إذا طلبها المستخدم صراحة.
- إذا سألك عن شيء عام (سؤال ثقافي، استفسار، مساعدة) جاوبه بشكل مختصر.
- تجنّب الفقرات الطويلة والرسائل المملة، خلك خفيف وواضح.
`;

// إعداد واتساب ويب
const client = new Client({
  authStrategy: new LocalAuth(),      // يحفظ الجلسة في مجلد .wwebjs_auth
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("📲 امسح هذا الـ QR من تطبيق واتساب (استخدام الجهاز المرتبط):");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ البوت متصل بالواتساب وجاهز للرد على الرسائل.");
});

client.on("authenticated", () => {
  console.log("🔐 تم تسجيل الدخول بنجاح (Authenticated).");
});

client.on("auth_failure", (msg) => {
  console.error("❌ فشل في تسجيل الدخول:", msg);
});

client.on("disconnected", (reason) => {
  console.log("⚠️ تم فصل الاتصال:", reason);
});

// معالجة الرسائل
client.on("message", async (msg) => {
  try {
    const from = msg.from;        // رقم المرسل
    const body = (msg.body || "").trim();

    // تجاهل رسائل النظام / الستاتس
    if (msg.type !== "chat") return;

    // اختياري: تجاهل المجموعات (خليه يرد على الخاص فقط)
    if (msg.from.endsWith("@g.us")) {
      return;
    }

    console.log(`📩 رسالة من ${from}: ${body}`);

    // في حال رسائل قصيرة جدًا ما تحتاج AI (مثل "هلا")
    if (!body) return;

    // استدعاء OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: body },
      ],
      temperature: 0.4,
      max_tokens: 250,
    });

    const reply = completion.choices[0].message.content.trim();
    console.log(`🤖 رد البوت إلى ${from}: ${reply}`);

    await msg.reply(reply);
  } catch (err) {
    console.error("🔥 خطأ أثناء الرد:", err);
    try {
      await msg.reply("صار عندنا خلل تقني بسيط، حاول بعد شوي 🌹");
    } catch (_) {}
  }
});

// تشغيل البوت
client.initialize();
