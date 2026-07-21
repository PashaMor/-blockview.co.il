/* BlockView — i18n (HE · EN · AR · FR · RU). HE & AR are RTL. */
(function () {
  const RTL = ["he", "ar"];
  const LANGS = [
    { code: "he", name: "עברית", flag: "🇮🇱" },
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "es", name: "Español", flag: "🇪🇸" },
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
      publish: "פרסם נכס", who_q: "מי אתה?", who_sub: "בחר כדי להמשיך לפרסום הנכס", owner: "בעל נכס", owner_desc: "פרסם את הנכס שלך בעצמך", realtor: "מתווך / סוכן", realtor_desc: "מעבר למערכת הסוכנים", publish_title: "פרסום נכס", publish_sub: "הנכס יישלח לאישור ויופיע במפה לאחר אישור.", pub_title_lbl: "כותרת", price_lbl: "מחיר (₪)", size_lbl: "מ\"ר", floor_lbl: "קומה", photos_lbl: "תמונות", submit_listing: "שלח לאישור", login_to_publish: "התחבר כדי לפרסם נכס", pub_ok: "הנכס נשלח לאישור ✓", wa_has: "💬 המספר זמין בוואטסאפ", wa_contact: "💬 וואטסאפ", wa_none: "אין מספר וואטסאפ לנכס הזה", wa_msg: "שלום! ראיתי את הנכס \"{title}\" ב{address} דרך BlockView ואשמח לפרטים נוספים.\n{url}", contact_lbl: "פרטי יצירת קשר", contact_name: "שם איש קשר", contact_phone: "טלפון", contact_email: "אימייל (לא חובה)", contact_hint: "גולשים שאינם מחוברים יראו את הפרטים באופן חלקי בלבד. משתמשים מחוברים יראו את הפרטים המלאים.", contact_name_bad: "נא למלא שם איש קשר", contact_phone_bad: "נא למלא מספר טלפון תקין", contact_owner: "יצירת קשר", lead_title: "שליחת פנייה", lead_name: "השם שלך", lead_phone: "טלפון", lead_email: "אימייל", lead_msg: "הודעה (לא חובה)", lead_send: "📩 שלח פנייה", lead_hint: "הפנייה תישלח לבעל הנכס בלבד, יחד עם הטלפון או האימייל שהזנת.", lead_ok: "הפנייה נשלחה ✓ בעל הנכס יחזור אליך", lead_error: "שליחת הפנייה נכשלה, נסה שוב", lead_too_many: "נשלחו יותר מדי פניות לנכס הזה. נסה שוב בעוד שעה.", lead_name_bad: "נא למלא את שמך", lead_phone_bad: "מספר טלפון לא תקין", lead_reach_bad: "יש למלא טלפון או אימייל כדי שנוכל לחזור אליך", address_lbl: "כתובת הנכס", address_ph: "רחוב ומספר, עיר", address_hint: "חפש את הכתובת — הבניין ייווצר אוטומטית לפי מפת OpenStreetMap.", pick_existing: "בחירה מרשימת בניינים", address_none: "לא נמצאה כתובת. נסה ניסוח אחר.", address_checking: "מאתר את מתאר הבניין…", address_ok: "נמצא מתאר בניין אמיתי", address_nofp: "ללא מתאר מדויק, ימוקם לפי הכתובת", address_required: "נא לבחור את כתובת הנכס", address_toomany: "נוצרו יותר מדי בניינים. נסה שוב בעוד שעה.", price_bad: "נא למלא מחיר תקין", price_max: "המחיר המרבי הוא ₪99,000,000", show_contact: "התחבר לצפייה", contact_locked: "פרטי הקשר המלאים גלויים למשתמשים מחוברים בלבד.", add_contact: "＋ הוסף איש קשר", remove_contact: "הסר איש קשר", contacts_ttl: "אנשי קשר", forgot_pw: "שכחת סיסמה?", change_pw: "🔑 שינוי סיסמה",
      legal_agree: "בהמשך אתה מאשר את", terms_link: "תנאי השימוש", privacy_link: "מדיניות הפרטיות", and: "ו",
      show_all: "הצג את כל הנכסים",
      my_properties: "הנכסים שלי", edit: "עריכה", delete: "מחיקה", edit_listing: "עריכת נכס", save_changes: "שמור שינויים", edit_bounce: "הנכס מאושר. שמירת שינוי תחזיר אותו לאישור לפני שיופיע שוב במפה.", edit_bounced: "הנכס עודכן ונשלח לאישור מחדש", edit_saved: "הנכס עודכן ✓", st_approved: "מאושר — מופיע במפה", st_pending: "ממתין לאישור", st_rejected: "נדחה", st_sold: "נמכר", st_draft: "טיוטה", del_listing_warn: "למחוק את הנכס לצמיתות? התמונות והפניות שהתקבלו יימחקו גם הם.", del_listing_ok: "הנכס נמחק", del_listing_failed: "מחיקת הנכס נכשלה", photo_del_failed: "מחיקת התמונה נכשלה",
      floors_total_lbl: "מתוך כמה קומות", category_lbl: "ייעוד", residential: "מגורים", commercial: "מסחרי", penthouse: "פנטהאוז", studio: "סטודיו", office: "משרד", shop: "חנות", warehouse: "מחסן / לוגיסטיקה", other_type: "אחר",
      write_for_me: "✨ נסח לי תיאור", write_hint: "הניסוח נבנה מהפרטים שמילאת — אפשר לערוך אותו כרצונך.", write_need_fields: "מלא חדרים ושטח כדי לנסח תיאור", write_done: "נוסח תיאור — אפשר לערוך", write_replace: "להחליף את התיאור שכתבת?",
      delete_account: "מחיקת החשבון", delete_warn: "למחוק את החשבון לצמיתות? יימחקו הנכסים שפרסמת, התמונות, המועדפים וההערות שלך. הפעולה אינה הפיכה.", delete_prompt: "לאישור סופי הקלד את כתובת האימייל שלך:", delete_mismatch: "האימייל לא תואם — החשבון לא נמחק", delete_done: "החשבון נמחק", delete_failed: "מחיקת החשבון נכשלה, נסה שוב", delete_last_admin: "זהו חשבון המנהל האחרון ולכן אי אפשר למחוק אותו",
      nearby: "מה יש בסביבה", cat_education: "חינוך", cat_transit: "תחבורה", cat_errands: "קניות ושירותים", cat_leisure: "פנאי", walk_min: "דק׳ הליכה", min_short: "דק׳", meters: "מ׳", km: "ק״מ", under_100m: "פחות מ־100 מ׳", show_more: "הצג עוד", nearby_note: "מרחקים באוויר עם תוספת להליכה בפועל; זמני ההליכה משוערים.",
      agree_cb: "קראתי ואני מסכים ל", must_agree: "יש לאשר את תנאי השימוש ומדיניות הפרטיות", verify_email: "נשלח אימייל אימות — אשר אותו כדי להתחבר.",
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
      publish: "List a property", who_q: "Who are you?", who_sub: "Choose how to continue", owner: "Property owner", owner_desc: "Post your own property", realtor: "Realtor / agent", realtor_desc: "Go to the agent CRM", publish_title: "Publish a property", publish_sub: "Your listing is reviewed, then appears on the map.", pub_title_lbl: "Title", price_lbl: "Price (₪)", size_lbl: "m²", floor_lbl: "Floor", photos_lbl: "Photos", submit_listing: "Submit for approval", login_to_publish: "Sign in to publish", pub_ok: "Submitted for approval ✓", wa_has: "💬 This number is on WhatsApp", wa_contact: "💬 WhatsApp", wa_none: "No WhatsApp number for this listing", wa_msg: "Hi! I saw the property \"{title}\" at {address} on BlockView and would love more details.\n{url}", contact_lbl: "Contact details", contact_name: "Contact name", contact_phone: "Phone", contact_email: "Email (optional)", contact_hint: "Visitors who are not signed in see these details only partially; signed-in users see them in full.", contact_name_bad: "Please enter a contact name", contact_phone_bad: "Please enter a valid phone number", contact_owner: "Get in touch", lead_title: "Send an enquiry", lead_name: "Your name", lead_phone: "Phone", lead_email: "Email", lead_msg: "Message (optional)", lead_send: "📩 Send enquiry", lead_hint: "Your enquiry goes only to the property owner, with the phone or email you enter.", lead_ok: "Enquiry sent ✓ the owner will get back to you", lead_error: "Could not send the enquiry, please try again", lead_too_many: "Too many enquiries on this listing. Try again in an hour.", lead_name_bad: "Please enter your name", lead_phone_bad: "Invalid phone number", lead_reach_bad: "Enter a phone or an email so we can reply", address_lbl: "Property address", address_ph: "Street and number, city", address_hint: "Search the address — the building is created automatically from OpenStreetMap.", pick_existing: "Pick from existing buildings", address_none: "No address found. Try different wording.", address_checking: "Looking up the building outline…", address_ok: "Real building outline found", address_nofp: "No exact outline, placed by address", address_required: "Please pick the property address", address_toomany: "Too many buildings created. Try again in an hour.", price_bad: "Please enter a valid price", price_max: "The maximum price is ₪99,000,000", show_contact: "Sign in to view", contact_locked: "Full contact details are visible to signed-in users only.", add_contact: "＋ Add contact", remove_contact: "Remove contact", contacts_ttl: "Contacts", forgot_pw: "Forgot password?", change_pw: "🔑 Change password",
      legal_agree: "By continuing you accept the", terms_link: "Terms of Service", privacy_link: "Privacy Policy", and: "and ",
      show_all: "Show all properties",
      my_properties: "My properties", edit: "Edit", delete: "Delete", edit_listing: "Edit listing", save_changes: "Save changes", edit_bounce: "This listing is approved. Saving a change sends it back for approval before it reappears on the map.", edit_bounced: "Updated and sent back for approval", edit_saved: "Listing updated ✓", st_approved: "Approved — live on the map", st_pending: "Awaiting approval", st_rejected: "Rejected", st_sold: "Sold", st_draft: "Draft", del_listing_warn: "Delete this listing permanently? Its photos and enquiries go too.", del_listing_ok: "Listing deleted", del_listing_failed: "Could not delete the listing", photo_del_failed: "Could not delete the photo",
      floors_total_lbl: "Out of how many floors", category_lbl: "Use", residential: "Residential", commercial: "Commercial", penthouse: "Penthouse", studio: "Studio", office: "Office", shop: "Shop", warehouse: "Warehouse", other_type: "Other",
      write_for_me: "✨ Write it for me", write_hint: "Built from the details you filled in — edit it however you like.", write_need_fields: "Fill in rooms and size first", write_done: "Description written — feel free to edit", write_replace: "Replace the description you wrote?",
      delete_account: "Delete my account", delete_warn: "Delete your account permanently? Your listings, photos, saved properties and notes will be removed. This cannot be undone.", delete_prompt: "To confirm, type your email address:", delete_mismatch: "Email does not match — account not deleted", delete_done: "Account deleted", delete_failed: "Could not delete the account, please try again", delete_last_admin: "This is the last administrator account and cannot be deleted",
      nearby: "What’s nearby", cat_education: "Education", cat_transit: "Transit", cat_errands: "Shops & services", cat_leisure: "Leisure", walk_min: "min walk", min_short: "min", meters: "m", km: "km", under_100m: "under 100 m", show_more: "Show more", nearby_note: "Straight-line distance with a walking allowance; times are estimates.",
      agree_cb: "I have read and agree to the ", must_agree: "Please accept the Terms of Service and the Privacy Policy", verify_email: "A verification email was sent — confirm it to sign in.",
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
      publish: "أضف عقارًا", who_q: "من أنت؟", who_sub: "اختر لمتابعة النشر", owner: "مالك العقار", owner_desc: "انشر عقارك بنفسك", realtor: "وسيط عقاري", realtor_desc: "الانتقال إلى نظام الوسطاء", publish_title: "نشر عقار", publish_sub: "سيُراجع العقار ثم يظهر على الخريطة.", pub_title_lbl: "العنوان", price_lbl: "السعر (₪)", size_lbl: "م²", floor_lbl: "الطابق", photos_lbl: "الصور", submit_listing: "إرسال للموافقة", login_to_publish: "سجّل الدخول للنشر", pub_ok: "تم الإرسال للموافقة ✓", wa_has: "💬 هذا الرقم متاح على واتساب", wa_contact: "💬 واتساب", wa_none: "لا يوجد رقم واتساب لهذا العقار", wa_msg: "مرحباً! رأيت العقار \"{title}\" في {address} عبر BlockView وأود مزيداً من التفاصيل.\n{url}", forgot_pw: "نسيت كلمة المرور؟", change_pw: "🔑 تغيير كلمة المرور",
      legal_agree: "بالمتابعة فإنك توافق على", terms_link: "شروط الاستخدام", privacy_link: "سياسة الخصوصية", and: "و",
      show_all: "عرض كل العقارات",
      my_properties: "عقاراتي", edit: "تعديل", delete: "حذف", edit_listing: "تعديل العقار", save_changes: "حفظ التغييرات", edit_bounce: "العقار معتمد. حفظ أي تغيير يعيده للموافقة قبل ظهوره على الخريطة.", edit_bounced: "تم التحديث وأُرسل للموافقة من جديد", edit_saved: "تم تحديث العقار ✓", st_approved: "معتمد — يظهر على الخريطة", st_pending: "بانتظار الموافقة", st_rejected: "مرفوض", st_sold: "تم البيع", st_draft: "مسودة", del_listing_warn: "حذف العقار نهائيًا؟ ستُحذف صوره والطلبات الواردة أيضًا.", del_listing_ok: "تم حذف العقار", del_listing_failed: "تعذّر حذف العقار", photo_del_failed: "تعذّر حذف الصورة",
      floors_total_lbl: "من أصل كم طابق", category_lbl: "الاستخدام", residential: "سكني", commercial: "تجاري", penthouse: "بنتهاوس", studio: "استوديو", office: "مكتب", shop: "محل", warehouse: "مستودع", other_type: "آخر",
      write_for_me: "✨ اكتب لي الوصف", write_hint: "يُبنى النص من التفاصيل التي أدخلتها — يمكنك تعديله كما تشاء.", write_need_fields: "أدخل عدد الغرف والمساحة أولًا", write_done: "تمت كتابة الوصف — يمكنك تعديله", write_replace: "استبدال الوصف الذي كتبته؟",
      delete_account: "حذف الحساب", delete_warn: "هل تريد حذف حسابك نهائيًا؟ ستُحذف عقاراتك وصورك ومفضلاتك وملاحظاتك. لا يمكن التراجع عن هذا.", delete_prompt: "للتأكيد، اكتب عنوان بريدك الإلكتروني:", delete_mismatch: "البريد الإلكتروني غير مطابق — لم يتم الحذف", delete_done: "تم حذف الحساب", delete_failed: "تعذّر حذف الحساب، حاول مرة أخرى", delete_last_admin: "هذا آخر حساب مسؤول ولا يمكن حذفه",
      nearby: "ما يوجد في المنطقة", cat_education: "التعليم", cat_transit: "المواصلات", cat_errands: "المتاجر والخدمات", cat_leisure: "الترفيه", walk_min: "دقيقة سيرًا", min_short: "د", meters: "م", km: "كم", under_100m: "أقل من 100 م", show_more: "عرض المزيد", nearby_note: "المسافة بخط مستقيم مع هامش للمشي؛ الأوقات تقديرية.",
      agree_cb: "لقد قرأت وأوافق على ", must_agree: "يجب الموافقة على شروط الاستخدام وسياسة الخصوصية", verify_email: "تم إرسال بريد التحقق — أكّده لتسجيل الدخول.",
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
      publish: "Publier un bien", who_q: "Qui êtes-vous ?", who_sub: "Choisissez pour continuer", owner: "Propriétaire", owner_desc: "Publiez votre propre bien", realtor: "Agent immobilier", realtor_desc: "Accéder au CRM agents", publish_title: "Publier un bien", publish_sub: "Votre annonce est validée puis affichée sur la carte.", pub_title_lbl: "Titre", price_lbl: "Prix (₪)", size_lbl: "m²", floor_lbl: "Étage", photos_lbl: "Photos", submit_listing: "Envoyer pour validation", login_to_publish: "Connectez-vous pour publier", pub_ok: "Envoyé pour validation ✓", wa_has: "💬 Ce numéro est sur WhatsApp", wa_contact: "💬 WhatsApp", wa_none: "Pas de WhatsApp pour ce bien", wa_msg: "Bonjour ! J’ai vu le bien \"{title}\" à {address} sur BlockView et je souhaite plus d’informations.\n{url}", forgot_pw: "Mot de passe oublié ?", change_pw: "🔑 Changer le mot de passe",
      legal_agree: "En continuant, vous acceptez les", terms_link: "Conditions d’utilisation", privacy_link: "Politique de confidentialité", and: "et ",
      show_all: "Afficher tous les biens",
      my_properties: "Mes biens", edit: "Modifier", delete: "Supprimer", edit_listing: "Modifier l’annonce", save_changes: "Enregistrer", edit_bounce: "Cette annonce est validée. Toute modification la renvoie en validation avant de réapparaître sur la carte.", edit_bounced: "Modifiée et renvoyée en validation", edit_saved: "Annonce mise à jour ✓", st_approved: "Validée — visible sur la carte", st_pending: "En attente de validation", st_rejected: "Refusée", st_sold: "Vendue", st_draft: "Brouillon", del_listing_warn: "Supprimer définitivement cette annonce ? Ses photos et demandes seront également supprimées.", del_listing_ok: "Annonce supprimée", del_listing_failed: "Échec de la suppression", photo_del_failed: "Échec de la suppression de la photo",
      floors_total_lbl: "Sur combien d’étages", category_lbl: "Usage", residential: "Résidentiel", commercial: "Commercial", penthouse: "Penthouse", studio: "Studio", office: "Bureau", shop: "Local commercial", warehouse: "Entrepôt", other_type: "Autre",
      write_for_me: "✨ Rédiger pour moi", write_hint: "Rédigé à partir des informations saisies — modifiable à votre guise.", write_need_fields: "Renseignez d’abord les pièces et la surface", write_done: "Description rédigée — vous pouvez la modifier", write_replace: "Remplacer la description que vous avez écrite ?",
      delete_account: "Supprimer mon compte", delete_warn: "Supprimer définitivement votre compte ? Vos annonces, photos, favoris et notes seront effacés. Cette action est irréversible.", delete_prompt: "Pour confirmer, saisissez votre adresse e-mail :", delete_mismatch: "L’adresse ne correspond pas — compte non supprimé", delete_done: "Compte supprimé", delete_failed: "Échec de la suppression, veuillez réessayer", delete_last_admin: "Il s’agit du dernier compte administrateur : suppression impossible",
      nearby: "À proximité", cat_education: "Éducation", cat_transit: "Transports", cat_errands: "Commerces et services", cat_leisure: "Loisirs", walk_min: "min à pied", min_short: "min", meters: "m", km: "km", under_100m: "moins de 100 m", show_more: "Voir plus", nearby_note: "Distance à vol d’oiseau avec une marge de marche ; temps estimés.",
      agree_cb: "J’ai lu et j’accepte les ", must_agree: "Veuillez accepter les conditions d’utilisation et la politique de confidentialité", verify_email: "Un e-mail de vérification a été envoyé — confirmez-le pour vous connecter.",
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
      publish: "Разместить объект", who_q: "Кто вы?", who_sub: "Выберите, как продолжить", owner: "Собственник", owner_desc: "Разместите свой объект сами", realtor: "Риелтор / агент", realtor_desc: "Перейти в CRM для агентов", publish_title: "Размещение объекта", publish_sub: "Объявление проходит модерацию и появляется на карте.", pub_title_lbl: "Заголовок", price_lbl: "Цена (₪)", size_lbl: "м²", floor_lbl: "Этаж", photos_lbl: "Фото", submit_listing: "Отправить на модерацию", login_to_publish: "Войдите, чтобы разместить", pub_ok: "Отправлено на модерацию ✓", wa_has: "💬 Этот номер есть в WhatsApp", wa_contact: "💬 WhatsApp", wa_none: "У этого объекта нет WhatsApp", wa_msg: "Здравствуйте! Я увидел объект \"{title}\" по адресу {address} на BlockView и хотел бы узнать подробности.\n{url}", forgot_pw: "Забыли пароль?", change_pw: "🔑 Сменить пароль",
      legal_agree: "Продолжая, вы принимаете", terms_link: "Условия использования", privacy_link: "Политику конфиденциальности", and: "и ",
      show_all: "Показать все объекты",
      my_properties: "Мои объекты", edit: "Изменить", delete: "Удалить", edit_listing: "Редактирование объекта", save_changes: "Сохранить", edit_bounce: "Объект одобрен. Сохранение изменений отправит его на повторную проверку.", edit_bounced: "Обновлено и отправлено на повторную проверку", edit_saved: "Объект обновлён ✓", st_approved: "Одобрен — виден на карте", st_pending: "Ожидает одобрения", st_rejected: "Отклонён", st_sold: "Продан", st_draft: "Черновик", del_listing_warn: "Удалить объект навсегда? Фотографии и обращения тоже будут удалены.", del_listing_ok: "Объект удалён", del_listing_failed: "Не удалось удалить объект", photo_del_failed: "Не удалось удалить фото",
      floors_total_lbl: "Из скольких этажей", category_lbl: "Назначение", residential: "Жильё", commercial: "Коммерция", penthouse: "Пентхаус", studio: "Студия", office: "Офис", shop: "Магазин", warehouse: "Склад", other_type: "Другое",
      write_for_me: "✨ Написать за меня", write_hint: "Текст составлен из указанных вами данных — его можно отредактировать.", write_need_fields: "Сначала укажите комнаты и площадь", write_done: "Описание составлено — можно редактировать", write_replace: "Заменить написанное вами описание?",
      delete_account: "Удалить аккаунт", delete_warn: "Удалить аккаунт навсегда? Ваши объявления, фотографии, избранное и заметки будут удалены. Отменить это нельзя.", delete_prompt: "Для подтверждения введите свой адрес электронной почты:", delete_mismatch: "Адрес не совпадает — аккаунт не удалён", delete_done: "Аккаунт удалён", delete_failed: "Не удалось удалить аккаунт, попробуйте ещё раз", delete_last_admin: "Это последний аккаунт администратора, его нельзя удалить",
      nearby: "Что рядом", cat_education: "Образование", cat_transit: "Транспорт", cat_errands: "Магазины и услуги", cat_leisure: "Досуг", walk_min: "мин пешком", min_short: "мин", meters: "м", km: "км", under_100m: "меньше 100 м", show_more: "Показать ещё", nearby_note: "Расстояние по прямой с поправкой на пешую дорогу; время примерное.",
      agree_cb: "Я прочитал и принимаю ", must_agree: "Необходимо принять условия использования и политику конфиденциальности", verify_email: "Отправлено письмо для подтверждения — подтвердите его, чтобы войти.",
    },
    es: {
      filter: "Filtros", deal_type: "Tipo de operación", all: "Todos", sale: "Venta", rent: "Alquiler",
      prop_type: "Tipo de propiedad", flat: "Apartamento", house: "Casa", city: "Ciudad", rooms: "Habitaciones",
      floor_min: "Piso (mín)", any_floor: "Cualquier piso", price_range: "Rango de precio (₪)",
      no_limit: "Sin límite", building_age: "Antigüedad del edificio", new: "Nuevo", old: "Antiguo", extras: "Extras",
      furnished: "🛋️ Amueblado", pets: "🐾 Mascotas", parking: "🅿️ Parking", elevator: "🛗 Ascensor",
      show: "Mostrar", properties: "propiedades", all_cities: "Todas las ciudades",
      search_ph: "Buscar dirección, edificio, estación...", no_results: "Sin resultados",
      building: "Edificio", follow: "🔔 Seguir edificio", following: "🔔 Siguiendo edificio",
      no_match: "No hay propiedades que coincidan con el filtro en este edificio.",
      saved: "Guardados", my_favs: "Mis favoritos", favs_sub: "Propiedades que guardaste para después",
      favs_empty: "Aún no has guardado propiedades. Toca ♥ en una propiedad para guardarla aquí.",
      tracking: "Seguimiento", alerts_title: "Alertas y novedades", alerts_sub: "Cambios en los edificios que sigues",
      alerts_empty: "No sigues ningún edificio. Abre un edificio y toca 🔔 para recibir novedades.",
      account: "Cuenta", sign_in: "Iniciar sesión", sign_up: "Registrarse",
      auth_sub: "Inicia sesión para guardar propiedades, seguir edificios y añadir notas",
      continue_google: "Continuar con Google", continue_apple: "Continuar con Apple", or_email: "o con correo",
      email: "Correo electrónico", password: "Contraseña", do_sign_in: "Entrar", do_sign_up: "Crear cuenta",
      your_plan: "Tu plan:", free: "Gratis", saved_props: "Propiedades guardadas", followed_buildings: "Edificios seguidos",
      push_notif: "Notificaciones push", saved_filter: "Filtro guardado", clear: "Borrar",
      upgrade_pro: "⭐ Pasar a Pro", sign_out: "Cerrar sesión",
      pro_sub: "Pasa a Pro para quitar todos los límites.", feat1: "Propiedades guardadas ilimitadas",
      feat2: "Seguimiento de edificios ilimitado", feat3: "Alertas instantáneas de cambios",
      yearly: "Anual", monthly: "Mensual", save42: "Ahorra 42%", upgrade_now: "Pasar a Pro", maybe_later: "Quizás más tarde",
      dl_title: "Abrir en la app BlockView", dl_sub: "Mira la propiedad en 3D con la experiencia completa.", dl_continue: "Continuar en el navegador",
      descr: "Descripción", my_note: "Nota personal", note_ph: "Escríbete una nota sobre esta propiedad...",
      save: "♥ Guardar", share: "🔗 Compartir", send_msg: "Enviar mensaje", language: "Idioma", for_sale: "En venta", for_rent: "En alquiler",
      publish: "Publicar propiedad", who_q: "¿Quién eres?", who_sub: "Elige cómo continuar", owner: "Propietario", owner_desc: "Publica tu propia propiedad", realtor: "Agente inmobiliario", realtor_desc: "Ir al CRM de agentes", publish_title: "Publicar propiedad", publish_sub: "Tu anuncio se revisa y luego aparece en el mapa.", pub_title_lbl: "Título", price_lbl: "Precio (₪)", size_lbl: "m²", floor_lbl: "Piso", photos_lbl: "Fotos", submit_listing: "Enviar a aprobación", login_to_publish: "Inicia sesión para publicar", pub_ok: "Enviado a aprobación ✓", wa_has: "💬 Este número tiene WhatsApp", wa_contact: "💬 WhatsApp", wa_none: "Esta propiedad no tiene WhatsApp", wa_msg: "¡Hola! Vi la propiedad \"{title}\" en {address} en BlockView y me gustaría más información.\n{url}", forgot_pw: "¿Olvidaste tu contraseña?", change_pw: "🔑 Cambiar contraseña",
      legal_agree: "Al continuar aceptas los", terms_link: "Términos de servicio", privacy_link: "Política de privacidad", and: "y ",
      show_all: "Ver todas las propiedades",
      my_properties: "Mis propiedades", edit: "Editar", delete: "Eliminar", edit_listing: "Editar anuncio", save_changes: "Guardar cambios", edit_bounce: "El anuncio está aprobado. Guardar un cambio lo devuelve a revisión antes de volver al mapa.", edit_bounced: "Actualizado y enviado a revisión", edit_saved: "Anuncio actualizado ✓", st_approved: "Aprobado: visible en el mapa", st_pending: "Pendiente de aprobación", st_rejected: "Rechazado", st_sold: "Vendido", st_draft: "Borrador", del_listing_warn: "¿Eliminar el anuncio permanentemente? Sus fotos y consultas también se borran.", del_listing_ok: "Anuncio eliminado", del_listing_failed: "No se pudo eliminar el anuncio", photo_del_failed: "No se pudo eliminar la foto",
      floors_total_lbl: "De cuántas plantas", category_lbl: "Uso", residential: "Residencial", commercial: "Comercial", penthouse: "Ático", studio: "Estudio", office: "Oficina", shop: "Local", warehouse: "Almacén", other_type: "Otro",
      write_for_me: "✨ Redáctalo por mí", write_hint: "Se genera con los datos que rellenaste: puedes editarlo a tu gusto.", write_need_fields: "Rellena habitaciones y superficie primero", write_done: "Descripción redactada: puedes editarla", write_replace: "¿Reemplazar la descripción que escribiste?",
      delete_account: "Eliminar mi cuenta", delete_warn: "¿Eliminar tu cuenta de forma permanente? Se borrarán tus anuncios, fotos, favoritos y notas. Esta acción no se puede deshacer.", delete_prompt: "Para confirmar, escribe tu dirección de correo:", delete_mismatch: "El correo no coincide: la cuenta no se eliminó", delete_done: "Cuenta eliminada", delete_failed: "No se pudo eliminar la cuenta, inténtalo de nuevo", delete_last_admin: "Es la última cuenta de administrador y no se puede eliminar",
      nearby: "Qué hay cerca", cat_education: "Educación", cat_transit: "Transporte", cat_errands: "Tiendas y servicios", cat_leisure: "Ocio", walk_min: "min a pie", min_short: "min", meters: "m", km: "km", under_100m: "menos de 100 m", show_more: "Ver más", nearby_note: "Distancia en línea recta con margen peatonal; tiempos estimados.",
      agree_cb: "He leído y acepto los ", must_agree: "Debes aceptar los términos de servicio y la política de privacidad", verify_email: "Se envió un correo de verificación: confírmalo para iniciar sesión.",
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
