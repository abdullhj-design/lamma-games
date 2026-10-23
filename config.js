/* إعدادات الموقع — هذا الملف الوحيد اللي يتغيّر بين مشروع وثاني.
   firebaseConfig: من Firebase ← Project settings ← Your apps. مو سري.
   adminEmail: إيميل Gmail اللي يدخل لوحة الإدارة.
   storage: خلّه false لين نفعّل رفع الملفات في Firebase Storage. */
window.LAMMA_CONFIG = {
  firebase: {
    apiKey: "AIzaSyB8tV4wII4R3L1rpoBa78e0j_Ctk7sfgiI",
    authDomain: "lamma-games.firebaseapp.com",
    databaseURL: "https://lamma-games-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "lamma-games",
    storageBucket: "lamma-games.firebasestorage.app",
    messagingSenderId: "288126553897",
    appId: "1:288126553897:web:1118aa49537cdf8de57138"
  },
  adminEmail: "abdullh.ail.1234454@gmail.com",
  storage: false
};
