/* إعدادات الموقع — هذا الملف الوحيد اللي يتغيّر بين مشروع وثاني.
   firebaseConfig: انسخه من Firebase ← Project settings ← Your apps. مو سري.
   adminEmail: إيميل Gmail اللي يدخل لوحة الإدارة.
   storage: خلّه false لين نفعّل رفع الملفات في Firebase Storage. */
window.LAMMA_CONFIG = {
  firebase: {
    apiKey: "PUT_API_KEY_HERE",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },
  adminEmail: "PUT_ADMIN_GMAIL_HERE",
  storage: false
};
