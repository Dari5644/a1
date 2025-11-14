// bot.js

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// تعريف البوت
const SYSTEM_PROMPT = `
أنت بوت ذكاء اصطناعي ترد على رسائل الواتساب.
- ردودك قصيرة وواضحة وباللغة العربية.
- إذا سلّم عليك أحد رد بتحية لطيفة ثم اسأله: "كيف أقدر أساعدك؟"
- لا تعطي روابط ولا أرقام إلا إذا طلبها المستخدم صراحة.
- تجنّب الفقرات الطويلة.
`;

// إعداد واتساب
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// هنا الباركود 👇
client.on("qr", (qr) => {
  console.clear();
  console.log("📲 هذا هو كود الـ QR (خام)، تقدر تنسخه وتلصقه في أي موقع توليد QR:\n");
  console.log(qr);
  console.log("\n📌 الآن نعرض QR صغير في التيرمنال، قرّب الجوال وامسحه 👇\n");
  qrcode.generate(qr, { small: true }); // هذا الـ QR الصغير
});

client.on("ready", () => {
  console.log("✅ البوت متصل بالواتساب وجاهز للرد على الرسائل.");
});

client.on("authenticated", () => {
  console.log("🔐 تم تسجيل الدخول بنجاح.");
});

client.on("auth_failure", (msg) => {
  console.error("❌ فشل في تسجيل الدخول:", msg);
});

client.on("disconnected", (reason) => {
  console.log("⚠️ تم فصل الاتصال:", reason);
});

// استقبال الرسائل
client.on("message", async (msg) => {
  try {
    const from = msg.from;
    const body = (msg.body || "").trim();

    if (msg.type !== "chat") return;
    if (msg.from.endsWith("@g.us")) return; // تجاهل القروبات

    console.log(`📩 رسالة من ${from}: ${body}`);

    if (!body) return;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: body },
      ],
      temperature: 0.5,
      max_tokens: 200,
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

client.initialize();
