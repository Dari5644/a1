// config.js

export const CONFIG = {

// 👑 بيانات المالك (تسجيل الدخول)
    OWNER_EMAIL: "mmaa.3551@hotmil.com",       // <-- عدّلها للإيميل حق المالك
    OWNER_PASSWORD: "Mmaa3551",    // <-- عدّلها للرقم السري حق المالك
    OWNER_NAME: "ماجد",             // اسم يظهر في اللوحات



    
    PORT: process.env.PORT || 3000,

    // WhatsApp API Config
    VERIFY_TOKEN: "mawaheb_verify",

    // من لوحة Meta – API Setup
    WABA_TOKEN: "EAAMlJZBsLvHQBP430JnAZA3a1ymKksXew7rsERa7fYzFQKoUehqIDPqNwYoVg3RIC6OwQGd3ZA2K7ZBEn390s1SeP5Gvbs1Wi3B75UPyEYT1gKs2Sae5w0emCo7L9EqeE6ktDNFjsqZAcBnnsBFdZA8qZAI73c7jthFxFvLiMXnZC2nZBNoIgc0InxBuI5SefnAZDZD",

    // 🔥 هذا هو الـ phone_number_id الحقيقي
    PHONE_ID: "830233543513578",

    // WhatsApp Business Account ID
    WABA_ID: "1325564105512012",

 STORE_NAME: "جمعية تنمية المواهب",

  // رابط المتجر (إذا طلبه العميل)
  STORE_URL: "https://aldeem35.com/",

  // رابط السيرفر (دومين Render أو غيره)
  PANEL_BASE_URL: "https://a1-9b9e.onrender.com",
     // رابط لوحة المحادثات (الموقع اللي تكلم منه العميل)
  // حط هنا رابط السيرفر حقك (مثال: https://a1-9b9e.onrender.com)
  PANEL_URL: "https://a1-9b9e.onrender.com",

 DEFAULT_STAFF: [
    // مثال:
    // {
    //   id: "1",
    //   name: "موظف 1",
    //   email: "staff1@example.com",
    //   password: "123456",
    //   canBroadcast: true,
    // },
  ],

      UI: {
    theme: "dark",
    accentColor: "#fff",
  // إعداد قالب الرسالة الجماعية (Template)
  TEMPLATE_NAME: "hello_world",     // اسم القالب في واتساب (مثال: promo_offer_v1)
  TEMPLATE_LANG: "en_US",                     // ar أو en حسب تعريف القالب

};

