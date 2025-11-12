import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ====== بيئة التشغيل ======
const PORT         = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WABA_TOKEN   = process.env.WABA_TOKEN;   // Permanent Access Token
const PHONE_ID     = process.env.PHONE_ID;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

// ====== تحقق Webhook (Meta calls GET once) ======
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ====== استقبال رسائل واتساب (Meta calls POST for messages) ======
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "mawaheb_verify";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});


    // نتعامل مع النص فقط كبداية
    const from = msg.from;              // رقم العميل
    const name = entry?.contacts?.[0]?.profile?.name || "ضيفنا";
    let userText = "";

    if (msg.type === "text") {
      userText = msg.text?.body?.trim() || "";
    } else {
      await sendWhatsApp(from, "أرسل سؤالك نصيًا من فضلك ✍️");
      return res.sendStatus(200);
    }

    // مفاتيح التحويل للبشري
    if (/موظف|بشري|اتصال|human/i.test(userText)) {
      await sendWhatsApp(from, "تم تحويلك لموظف خدمة العملاء. لحظات وسيتم الرد عليك 🙏");
      // هنا ممكن تبعث إشعار للتيم عندك أو تدخل WATI/Inbox يدويًا
      return res.sendStatus(200);
    }

    // رد ترحيبي بسيط إذا رسالة أولى/قصيرة
    if (/^مرحبا|^السلام|^هاي|^hello/i.test(userText)) {
      await sendWhatsApp(from,
        `أهلًا ${name} 👋
أنا مساعد جمعية تنمية المواهب بالذكاء الاصطناعي.
اكتب سؤالك أو اختر:
1) التسجيل في البرامج
2) مواعيد الدورات
3) شراكات ودعم
4) تواصل مع موظف`
      );
      return res.sendStatus(200);
    }

    // نسأل الذكاء الاصطناعي
    const aiReply = await askAI(userText);
    await sendWhatsApp(from, aiReply || "لم أفهم سؤالك جيدًا، هل تقدر تعيد بصيغة أخرى؟");

    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    return res.sendStatus(200);
  }
});

// ====== ذكاء اصطناعي (OpenAI) ======
async function askAI(userMsg) {
  const systemPrompt = `
أنت مساعد ذكي لجمعية تنمية المواهب برفحاء.
- أجب بالعربية الواضحة.
- إذا سُئلت عن التسجيل فاطلب: الاسم/العمر/المدينة/الهاتف.
- لا تخترع معلومات غير مؤكدة. إن لم تكن متأكدًا فاطلب تحويل لموظف.
- اختصر الرد وكن عمليًا.
`;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg }
      ]
    })
  });
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim();
}

// ====== إرسال رسالة واتساب ======
async function sendWhatsApp(to, body) {
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WABA_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const err = await r.text();
    console.error("WhatsApp send error:", err);
  }
}

app.listen(PORT, () => console.log(`✅ Bot running on :${PORT}`));
