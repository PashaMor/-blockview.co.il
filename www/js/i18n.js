/* BlockView — i18n (HE · EN · AR · FR · RU). HE & AR are RTL. */
(function () {
  const RTL = ["he", "ar"];
  const LANGS = [
    { code: "he", name: "עברית", flag: "🇮🇱" },
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "ar", name: "العربية", flag: "🇸🇦" },
    { code: "fr", name: "Français", flag: "🇫🇷" },
    { code: "ru", name: "Русский", flag: "🇷🇺" },
  ];

  const T = {
    he: {
      filter: "סינון", deal_type: "סוג עסקה", all: "הכל", sale: "מכירה", rent: "השכרה",
      prop_type: "סוג נכס", flat: "דירה", house: "בית", city: "עיר", rooms: "חדרים",
      floor_min: "קומה (מינימום)", any_floor: "כל קומה", price_range: "טווח מחיר (₪)",
      no_limit: "ללא הגבלה", building_age: "גיל הבניין", new: "חדש", old: "ישן", extras: "נוספים",
      furnished: "🛋️ מרוהט", pets: "🐾 חיות מחמד", parking: "🅿️ חניה", elevator: "🛗 מעלית",
      show: "הצג", properties: "נכסים", all_cities: "כל הערים",
      search_ph: "חפש כתובת, בניין, תחנת רכבת...", no_results: "לא נמצאו תוצאות",
      building: "בניין", follow: "🔔 עקוב אחר הבניין", following: "🔔 עוקב אחר הבניין",
      no_match: "אין נכסים התואמים לסינון בבניין זה.",
      saved: "שמורים", my_favs: "המועדפים שלי", favs_sub: "נכסים ששמרת לבדיקה מאוחר יותר",
      favs_empty: "עדיין לא שמרת נכסים. גע ב-♥ על נכס כדי לשמור אותו כאן.",
      tracking: "מעקב", alerts_title: "התראות ועדכונים", alerts_sub: "שינויים בבניינים שאתה עוקב אחריהם",
      alerts_empty: "אינך עוקב אחר בניינים. פתח בניין וגע ב-🔔 כדי לקבל עדכונים.",
      account: "חשבון", sign_in: "התחברות", sign_up: "הרשמה",
      auth_sub: "התחבר כדי לשמור נכסים, לעקוב אחר בניינים ולהוסיף הערות",
      continue_google: "המשך עם Google", continue_apple: "המשך עם Apple", or_email: "או באמצעות אימייל",
      email: "אימייל", password: "סיסמה", do_sign_in: "התחבר", do_sign_up: "צור חשבון",
      your_plan: "התוכנית שלך:", free: "חינם", saved_props: "נכסים שמורים", followed_buildings: "בניינים במעקב",
      push_notif: "התראות פוש", saved_filter: "סינון שמור", clear: "נקה",
      upgrade_pro: "⭐ שדרג ל-Pro", sign_out: "התנתק",
      pro_sub: "שדרג ל-Pro להסרת כל המגבלות.", feat1: "שמירת נכסים ללא הגבלה",
      feat2: "מעקב אחר בניינים ללא הגבלה", feat3: "התראות מיידיות על שינויים",
      yearly: "שנתי", monthly: "חודשי", save42: "חסכון 42%", upgrade_now: "שדרג עכשיו", maybe_later: "אולי מאוחר יותר",
      dl_title: "פתח באפליקציית BlockView", dl_sub: "צפה בנכס בתלת-מימד עם החוויה המלאה.", dl_continue: "המשך בדפדפן",
      descr: "תיאור", my_note: "הערה אישית", note_ph: "כתוב לעצמך הערה על הנכס...",
      save: "♥ שמור", share: "🔗 שתף", send_msg: "שליחת הודעה", language: "שפה", for_sale: "למכירה", for_rent: "להשכרה",
    },
    en: {
      filter: "Filter", deal_type: "Deal type", all: "All", sale: "Sale", rent: "Rent",
      prop_type: "Property type", flat: "Apartment", house: "House", city: "City", rooms: "Rooms",
      floor_min: "Floor (min)", any_floor: "Any floor", price_range: "Price range (₪)",
      no_limit: "No limit", building_age: "Building age", new: "New", old: "Old", extras: "Extras",
      furnished: "🛋️ Furnished", pets: "🐾 Pets", parking: "🅿️ Parking", elevator: "🛗 Elevator",
      show: "Show", properties: "properties", all_cities: "All cities",
      search_ph: "Search address, building, station...", no_results: "No results",
      building: "Building", follow: "🔔 Follow building", following: "🔔 Following building",
      no_match: "No properties match the filter in this building.",
      saved: "Saved", my_favs: "My favorites", favs_sub: "Properties you saved for later",
      favs_empty: "No saved properties yet. Tap ♥ on a property to save it here.",
      tracking: "Tracking", alerts_title: "Alerts & updates", alerts_sub: "Changes in buildings you follow",
      alerts_empty: "You're not following any buildings. Open a building and tap 🔔 for updates.",
      account: "Account", sign_in: "Sign in", sign_up: "Sign up",
      auth_sub: "Sign in to save properties, follow buildings and add notes",
      continue_google: "Continue with Google", continue_apple: "Continue with Apple", or_email: "or with email",
      email: "Email", password: "Password", do_sign_in: "Sign in", do_sign_up: "Create account",
      your_plan: "Your plan:", free: "Free", saved_props: "Saved properties", followed_buildings: "Followed buildings",
      push_notif: "Push notifications", saved_filter: "Saved filter", clear: "Clear",
      upgrade_pro: "⭐ Upgrade to Pro", sign_out: "Sign out",
      pro_sub: "Upgrade to Pro to remove all limits.", feat1: "Unlimited saved properties",
      feat2: "Unlimited building follows", feat3: "Instant change alerts",
      yearly: "Yearly", monthly: "Monthly", save42: "Save 42%", upgrade_now: "Upgrade now", maybe_later: "Maybe later",
      dl_title: "Open in the BlockView app", dl_sub: "View the property in 3D with the full experience.", dl_continue: "Continue in browser",
      descr: "Description", my_note: "Personal note", note_ph: "Write yourself a note about this property...",
      save: "♥ Save", share: "🔗 Share", send_msg: "Send message", language: "Language", for_sale: "For sale", for_rent: "For rent",
    },
    ar: {
      filter: "تصفية", deal_type: "نوع الصفقة", all: "الكل", sale: "بيع", rent: "إيجار",
      prop_type: "نوع العقار", flat: "شقة", house: "منزل", city: "المدينة", rooms: "غرف",
      floor_min: "الطابق (الأدنى)", any_floor: "أي طابق", price_range: "نطاق السعر (₪)",
      no_limit: "بلا حد", building_age: "عمر المبنى", new: "جديد", old: "قديم", extras: "إضافات",
      furnished: "🛋️ مفروش", pets: "🐾 حيوانات أليفة", parking: "🅿️ موقف", elevator: "🛗 مصعد",
      show: "عرض", properties: "عقارات", all_cities: "كل المدن",
      search_ph: "ابحث عن عنوان، مبنى، محطة...", no_results: "لا توجد نتائج",
      building: "مبنى", follow: "🔔 متابعة المبنى", following: "🔔 تتم المتابعة",
      no_match: "لا توجد عقارات مطابقة للتصفية في هذا المبنى.",
      saved: "المحفوظة", my_favs: "المفضلة لدي", favs_sub: "عقارات حفظتها للمراجعة لاحقاً",
      favs_empty: "لم تحفظ أي عقار بعد. اضغط ♥ على عقار لحفظه هنا.",
      tracking: "متابعة", alerts_title: "التنبيهات والتحديثات", alerts_sub: "تغييرات في المباني التي تتابعها",
      alerts_empty: "أنت لا تتابع أي مبانٍ. افتح مبنى واضغط 🔔 للتحديثات.",
      account: "الحساب", sign_in: "تسجيل الدخول", sign_up: "إنشاء حساب",
      auth_sub: "سجّل الدخول لحفظ العقارات ومتابعة المباني وإضافة الملاحظات",
      continue_google: "المتابعة عبر Google", continue_apple: "المتابعة عبر Apple", or_email: "أو عبر البريد",
      email: "البريد الإلكتروني", password: "كلمة المرور", do_sign_in: "دخول", do_sign_up: "إنشاء حساب",
      your_plan: "خطتك:", free: "مجاني", saved_props: "عقارات محفوظة", followed_buildings: "مبانٍ متابعة",
      push_notif: "إشعارات", saved_filter: "تصفية محفوظة", clear: "مسح",
      upgrade_pro: "⭐ الترقية إلى Pro", sign_out: "تسجيل الخروج",
      pro_sub: "قم بالترقية إلى Pro لإزالة كل الحدود.", feat1: "حفظ عقارات بلا حدود",
      feat2: "متابعة مبانٍ بلا حدود", feat3: "تنبيهات فورية بالتغييرات",
      yearly: "سنوي", monthly: "شهري", save42: "وفّر 42%", upgrade_now: "الترقية الآن", maybe_later: "ربما لاحقاً",
      dl_title: "افتح في تطبيق BlockView", dl_sub: "شاهد العقار ثلاثي الأبعاد بالتجربة الكاملة.", dl_continue: "المتابعة في المتصفح",
      descr: "الوصف", my_note: "ملاحظة شخصية", note_ph: "اكتب ملاحظة لنفسك عن هذا العقار...",
      save: "♥ حفظ", share: "🔗 مشاركة", send_msg: "إرسال رسالة", language: "اللغة", for_sale: "للبيع", for_rent: "للإيجار",
    },
    fr: {
      filter: "Filtres", deal_type: "Type de transaction", all: "Tous", sale: "Vente", rent: "Location",
      prop_type: "Type de bien", flat: "Appartement", house: "Maison", city: "Ville", rooms: "Pièces",
      floor_min: "Étage (min)", any_floor: "Tout étage", price_range: "Fourchette de prix (₪)",
      no_limit: "Sans limite", building_age: "Âge du bâtiment", new: "Neuf", old: "Ancien", extras: "Options",
      furnished: "🛋️ Meublé", pets: "🐾 Animaux", parking: "🅿️ Parking", elevator: "🛗 Ascenseur",
      show: "Afficher", properties: "biens", all_cities: "Toutes les villes",
      search_ph: "Rechercher adresse, bâtiment, station...", no_results: "Aucun résultat",
      building: "Bâtiment", follow: "🔔 Suivre le bâtiment", following: "🔔 Suivi",
      no_match: "Aucun bien ne correspond au filtre dans ce bâtiment.",
      saved: "Enregistrés", my_favs: "Mes favoris", favs_sub: "Biens enregistrés pour plus tard",
      favs_empty: "Aucun bien enregistré. Touchez ♥ sur un bien pour l'enregistrer ici.",
      tracking: "Suivi", alerts_title: "Alertes et mises à jour", alerts_sub: "Changements dans les bâtiments suivis",
      alerts_empty: "Vous ne suivez aucun bâtiment. Ouvrez-en un et touchez 🔔.",
      account: "Compte", sign_in: "Connexion", sign_up: "Inscription",
      auth_sub: "Connectez-vous pour enregistrer des biens, suivre des bâtiments et ajouter des notes",
      continue_google: "Continuer avec Google", continue_apple: "Continuer avec Apple", or_email: "ou par e-mail",
      email: "E-mail", password: "Mot de passe", do_sign_in: "Se connecter", do_sign_up: "Créer un compte",
      your_plan: "Votre offre :", free: "Gratuit", saved_props: "Biens enregistrés", followed_buildings: "Bâtiments suivis",
      push_notif: "Notifications", saved_filter: "Filtre enregistré", clear: "Effacer",
      upgrade_pro: "⭐ Passer à Pro", sign_out: "Déconnexion",
      pro_sub: "Passez à Pro pour lever toutes les limites.", feat1: "Biens enregistrés illimités",
      feat2: "Bâtiments suivis illimités", feat3: "Alertes de changement instantanées",
      yearly: "Annuel", monthly: "Mensuel", save42: "-42 %", upgrade_now: "Passer à Pro", maybe_later: "Plus tard",
      dl_title: "Ouvrir dans l'app BlockView", dl_sub: "Voir le bien en 3D avec l'expérience complète.", dl_continue: "Continuer dans le navigateur",
      descr: "Description", my_note: "Note personnelle", note_ph: "Écrivez-vous une note sur ce bien...",
      save: "♥ Enregistrer", share: "🔗 Partager", send_msg: "Envoyer un message", language: "Langue", for_sale: "À vendre", for_rent: "À louer",
    },
    ru: {
      filter: "Фильтр", deal_type: "Тип сделки", all: "Все", sale: "Продажа", rent: "Аренда",
      prop_type: "Тип недвижимости", flat: "Квартира", house: "Дом", city: "Город", rooms: "Комнаты",
      floor_min: "Этаж (мин)", any_floor: "Любой этаж", price_range: "Диапазон цен (₪)",
      no_limit: "Без ограничения", building_age: "Возраст здания", new: "Новый", old: "Старый", extras: "Дополнительно",
      furnished: "🛋️ С мебелью", pets: "🐾 Питомцы", parking: "🅿️ Парковка", elevator: "🛗 Лифт",
      show: "Показать", properties: "объектов", all_cities: "Все города",
      search_ph: "Поиск: адрес, здание, станция...", no_results: "Ничего не найдено",
      building: "Здание", follow: "🔔 Следить за зданием", following: "🔔 Отслеживается",
      no_match: "Нет объектов, подходящих под фильтр в этом здании.",
      saved: "Сохранённые", my_favs: "Избранное", favs_sub: "Объекты, сохранённые на потом",
      favs_empty: "Пока нет сохранённых объектов. Нажмите ♥, чтобы сохранить.",
      tracking: "Отслеживание", alerts_title: "Оповещения и обновления", alerts_sub: "Изменения в отслеживаемых зданиях",
      alerts_empty: "Вы не следите за зданиями. Откройте здание и нажмите 🔔.",
      account: "Аккаунт", sign_in: "Вход", sign_up: "Регистрация",
      auth_sub: "Войдите, чтобы сохранять объекты, следить за зданиями и добавлять заметки",
      continue_google: "Продолжить с Google", continue_apple: "Продолжить с Apple", or_email: "или по e-mail",
      email: "E-mail", password: "Пароль", do_sign_in: "Войти", do_sign_up: "Создать аккаунт",
      your_plan: "Ваш тариф:", free: "Бесплатно", saved_props: "Сохранённые объекты", followed_buildings: "Отслеживаемые здания",
      push_notif: "Push-уведомления", saved_filter: "Сохранённый фильтр", clear: "Очистить",
      upgrade_pro: "⭐ Перейти на Pro", sign_out: "Выйти",
      pro_sub: "Перейдите на Pro, чтобы снять все лимиты.", feat1: "Безлимитные сохранения",
      feat2: "Безлимитное отслеживание зданий", feat3: "Мгновенные оповещения об изменениях",
      yearly: "Год", monthly: "Месяц", save42: "-42%", upgrade_now: "Перейти на Pro", maybe_later: "Позже",
      dl_title: "Открыть в приложении BlockView", dl_sub: "Смотрите объект в 3D с полным опытом.", dl_continue: "Продолжить в браузере",
      descr: "Описание", my_note: "Личная заметка", note_ph: "Напишите себе заметку об объекте...",
      save: "♥ Сохранить", share: "🔗 Поделиться", send_msg: "Отправить сообщение", language: "Язык", for_sale: "Продажа", for_rent: "Аренда",
    },
  };

  let lang = "he";
  try { lang = localStorage.getItem("blockview_lang") || "he"; } catch (e) {}
  if (!T[lang]) lang = "he";

  window.t = (k) => (T[lang] && T[lang][k]) || T.he[k] || k;
  window.currentLang = () => lang;

  function applyLang(code) {
    if (!T[code]) return;
    lang = code;
    try { localStorage.setItem("blockview_lang", code); } catch (e) {}
    const dir = RTL.includes(code) ? "rtl" : "ltr";
    document.documentElement.lang = code;
    document.documentElement.dir = dir;
    document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = window.t(el.dataset.i18n)));
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = window.t(el.dataset.i18nPh)));
    const lb = document.getElementById("lang-btn");
    if (lb) lb.textContent = (LANGS.find((l) => l.code === code) || {}).flag || "🌐";
    document.querySelectorAll("#lang-list .lang-opt").forEach((o) => o.classList.toggle("on", o.dataset.lang === code));
    if (window.reRender) window.reRender();
  }
  window.applyLang = applyLang;

  // build language sheet options + wire
  function init() {
    const list = document.getElementById("lang-list");
    if (list) {
      list.innerHTML = LANGS.map((l) =>
        `<button class="lang-opt" data-lang="${l.code}"><span class="lo-flag">${l.flag}</span><span>${l.name}</span></button>`).join("");
      list.addEventListener("click", (e) => {
        const opt = e.target.closest(".lang-opt");
        if (!opt) return;
        applyLang(opt.dataset.lang);
        document.getElementById("lang-sheet").classList.remove("open");
        const bd = document.getElementById("sheet-backdrop"); if (bd) bd.hidden = true;
      });
    }
    const btn = document.getElementById("lang-btn");
    if (btn) btn.addEventListener("click", () => {
      if (window.closeAllSheets) window.closeAllSheets();
      if (window.closeAuthSheets) window.closeAuthSheets();
      document.getElementById("lang-sheet").classList.add("open");
    });
    const close = document.getElementById("lang-close");
    if (close) close.addEventListener("click", () => document.getElementById("lang-sheet").classList.remove("open"));
    applyLang(lang);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
