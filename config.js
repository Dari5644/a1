// config.js

export default {
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
  STORE_URL: "",

  // رابط السيرفر (دومين Render أو غيره)
  PANEL_BASE_URL: "https://a1-9b9e.onrender.com",

  // أرقام خدمة العملاء اللي تجيهم رسالة إذا تم تحويل عميل (بدون +)
  AGENT_NUMBERS: [
    // مثال:
    "0554986089",
  ],
};

export default config;
