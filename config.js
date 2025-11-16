// config.js

// هنا تعرّف المنتجات اللي في زد
// عدّل IDs حسب الموجود عندك في لوحة زد
const productsConfig = {
  // ✅ مثال: منتج بوت واتساب 1 شهر
  "Z.17632374787413204": {
    type: "whatsapp_bot",
    days: 30,
    plan: "wa_basic", // باقة أساسية (رد على العملاء فقط)
    name: "بوت واتساب - اشتراك شهر (أساسي)"
  },

  // مثال لبوت واتساب + رسائل جماعية (ضيفه أنت في زد)
  "Z.WA_BROADCAST_1M": {
    type: "whatsapp_bot",
    days: 30,
    plan: "wa_broadcast", // فيه رسائل جماعية
    name: "بوت واتساب - شهر + رسائل جماعية"
  },

  // مثال لبوت تيليجرام شهر
  "Z.TELEGRAM_BOT_1M": {
    type: "telegram_bot",
    days: 30,
    plan: "tg_basic",
    name: "بوت تيليجرام - اشتراك شهر"
  },

  // مثال لبوت ذكاء اصطناعي للمتجر / الموقع
  "Z.STORE_AI_BOT_1M": {
    type: "store_ai_bot",
    days: 30,
    plan: "store_ai_basic",
    name: "بوت المتجر الذكي - اشتراك شهر"
  }
};

module.exports = {
  productsConfig
};
