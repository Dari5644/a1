// bot.js

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const dotenv = require("dotenv");
const OpenAI = require("openai");
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let HUMAN_SUPPORT = {}; 
// { "96655xxxxxx": true/false } 

const SYSTEM_PROMPT = `
أنت بوت متخصص لهذه القواعد:
- رد باختصار.
- إذا طلب المستخدم خدمة العملاء، اسأله "هل تود تحويلك لموظف خدمة العملاء؟"
- لا تحوّل إلا إذا قال: نعم، ايوه، ايه، حولني.
`;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

// QR صغير + نص خام
client.on("qr", (qr) => {
  console.clear();
  console.log("\n🔹 QR RAW:\n" + qr + "\n");
  console.log("🔹 QR صغير:\n");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => console.log("✅ البوت جاهز"));
client.on("authenticated", () => console.log("🔐 سجل الدخول"));
client.on("auth_failure", () => console.log("❌ خطأ مصادقة"));
client.on("disconnected", () => console.log("⚠️ انقطع الاتصال"));

// ---------- استقبال الرسائل ----------
client.on("message", async (msg) => {
  const from = msg.from;
  const body = msg.body.trim();

  console.log(`📩 ${from}: ${body}`);

  // --------------------
  // 1) إعادة تشغيل البوت
  // --------------------
// 1) إعادة تشغيل البوت بكلمات داخل أي جملة
// ------- إعادة تشغيل البوت ----------

if (body.match(/رجع|ارجع|اشتغل|شغل|اخليك مع البوت|رجعي|رجوع/i)) {

    // يرجّع البوت لو كان في وضع خدمة العملاء
    if (HUMAN_SUPPORT[from] === true) {

        HUMAN_SUPPORT[from] = false;

        await msg.reply("✨ تم خدمتك، وبخليك الآن مع البوت 🌹");

        return;
    }
}



  // --------------------
  // 2) لو في وضع خدمة العملاء → لا يرد البوت
  // --------------------
  if (HUMAN_SUPPORT[from] === true) return;

  // --------------------
  // 3) طلب خدمة العملاء
  // --------------------
  const ask_transfer = [
    "ابي خدمة العملاء",
    "اريد خدمة العملاء",
    "ابي موظف",
    "حولني",
    "ما فهمت",
    "ماني فاهم",
    "ابي انسان"
  ];

  if (ask_transfer.some(w => body.includes(w))) {
    await msg.reply("هل تود أن أحولك لموظف خدمة العملاء؟");
    HUMAN_SUPPORT[from] = "waiting_confirmation";
    return;
  }

  // --------------------
  // 4) تأكيد التحويل
  // --------------------
  if (HUMAN_SUPPORT[from] === "waiting_confirmation") {
    if (body.match(/نعم|ايه|ايوه|حولني|طيب/i)) {
      HUMAN_SUPPORT[from] = true; // تفعيل خدمة العملاء
      await msg.reply("تم تحويلك لموظف خدمة العملاء ✨");
      return;
    } else {
      HUMAN_SUPPORT[from] = false;
      await msg.reply("تمام، بخليك مع البوت 🌹");
    }
  }

  // --------------------
  // 5) الرد بالذكاء الاصطناعي
  // --------------------
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: body }
      ]
    });

    const reply = completion.choices[0].message.content.trim();
    await msg.reply(reply);

  } catch (err) {
    console.log("🔥 AI ERROR", err);
    await msg.reply("صار خلل بسيط، حاول بعد شوي 🌹");
  }
});

client.initialize();
