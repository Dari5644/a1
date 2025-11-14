// config.js
export const config = {
  PORT: process.env.PORT || 3000,

  // التحقق من Webhook (نفس اللي حطيته في Meta)
  VERIFY_TOKEN: 'mawaheb_verify',

  // بيانات واتساب من Meta Developers → WhatsApp → API Setup
  WABA_TOKEN: 'EAAMlJZBsLvHQBP430JnAZA3a1ymKksXew7rsERa7fYzFQKoUehqIDPqNwYoVg3RIC6OwQGd3ZA2K7ZBEn390s1SeP5Gvbs1Wi3B75UPyEYT1gKs2Sae5w0emCo7L9EqeE6ktDNFjsqZAcBnnsBFdZA8qZAI73c7jthFxFvLiMXnZC2nZBNoIgc0InxBuI5SefnAZDZD',
  PHONE_ID: '830233543513578',          // phone_number_id (مو رقم الجوال)
  WABA_ID: '1325564105512012',          // WhatsApp Business Account ID
  META_VERSION: 'v20.0',

  // بيانات المتجر
  STORE_NAME: 'متجر الديم',
  STORE_URL: 'https://aldeem35.com/',

  // اسم قالب واتساب المعتمد (جاهز في اللوحة)
  BROADCAST_TEMPLATE: 'hello_world',    // أو "dari" أو أي اسم قالب آخر

  // إعدادات مالك اللوحة
  OWNER_EMAIL: 'mmaa.3551@hotmail.com',
  OWNER_PASSWORD: '12345678',             // يفضل لاحقاً تشفيرها

  // أرقام الموظفين اللي تجيهم إشعارات (E.164 بدون +)
  STAFF_ALERT_NUMBERS: [
    '966554986089',
    '966551234567'
  ],

  // إعدادات عامة للوحة
  PANEL_JWT_SECRET: 'super-secret-panel', // لو حبيت تطور الدخول لاحقاً
};
