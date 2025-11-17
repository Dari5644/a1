// config.js
export const APP_CONFIG = {
  // اسم البراند اللي يظهر في الرسائل والواجهة
  brandName: "سمارت بوت - Smart Bot",

  // الرابط الأساس للموقع بعد النشر (عدله بعد ما ترفع على Render أو غيره)
  publicBaseUrl: "https://a1-9b9e.onrender.com",

  // إعدادات بريد الطلبات من زد (IMAP)
  mail: {
    host: "imap.your-mail-provider.com", // مثال: imap.gmail.com أو imap.mail.yahoo.com
    port: 993,
    secure: true, // IMAPS = true
    user: "smartbotontop@gmail.com", // إيميل المتجر اللي تجيه إشعارات الطلبات
    // الباسورد الحقيقي ما نحطه هنا، نجيبه من .env
  },

  // فلترة رسائل زد
  zidMailFilter: {
    fromIncludes: "no-reply@zid.sa", // غيّرها على حسب الـ From اللي يظهر في إيميل زد
    subjectIncludes: "", // أو "تم الدفع" حسب صيغة زد عندك
    // لو ودك تخليه يقرأ كل الإيميلات خليهم فاضيين
  },

  // تعريف المنتجات (من زد)
  // تستخدم code أو الاسم اللي يظهر في الإيميل
  products: {
    // مثال: المنتج اللي عطيتني كوده
    "Z.17632374787413204": {
      name: "بوت واتساب – شهر واحد",
      durationDays: 30,
      type: "whatsapp"
    },
    // تقدر تضيف منتجات أخرى نفس الفكرة:
    // "Z.XXXXXXX": { name: "بوت واتساب – 3 شهور", durationDays: 90, type: "whatsapp" },
    // "T.XXXXXXX": { name: "بوت تيليجرام – شهر", durationDays: 30, type: "telegram" },
    // ...
  },

  // إعدادات لوحة الإدارة البسيطة
  admin: {
    // استخدم كلمة مرور قوية وحطها في .env بدل ما تثبتها هنا
    // هنا بس اسم المستخدم الظاهر
    username: "owner",
    // الباسورد الحقيقي في ENV
  }
};
