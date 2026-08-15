/* Arabic -> English, 386 entries. Shared by both views. */
/* =============================================================================
   NAME_EN — Arabic → English transliteration for the Jayyousi family tree.

   Keyed by NORMALIZED Arabic (see normalizeArabic below), so the 1:1 rule is
   structural: one Arabic name can only ever have one English rendering. Adding
   a person with an existing Arabic name needs no work here.

   Normalisation folds away the things that are the same name spelled loosely:
   tatweel padding (خليـــل), harakat, أإآ→ا, ى→ي. So spelling variants that
   differ only in those respects share a single entry. Variants that differ in
   real letters (عبدالرؤوف / عبدالرؤف / عبدالرؤؤف) get their own keys and are
   deliberately mapped to the same English.

   Transliteration style: conventional spellings as Arabic speakers write them
   in English (Mohammad, not Muḥammad). Distinctions preserved where two Arabic
   names would otherwise collide: حسن Hassan vs حسان Hassaan, طاهر Taher vs
   ظاهر Dhaher.
============================================================================= */

const NAME_EN = {
  // ---- most common ----
  "محمد": "Mohammad", "احمد": "Ahmad", "محمود": "Mahmoud", "حسن": "Hassan",
  "خالد": "Khaled", "يوسف": "Yousef", "ابراهيم": "Ibrahim", "سعيد": "Saeed",
  "عمر": "Omar", "فريد": "Farid", "عبدالكريم": "Abdulkarim", "عبدالله": "Abdullah",
  "جميل": "Jamil", "حسني": "Husni", "امين": "Amin", "بلال": "Bilal",
  "رشدي": "Rushdi", "عبدالرحمن": "Abdulrahman", "علي": "Ali", "عماد": "Imad",
  "فراس": "Firas", "كمال": "Kamal", "مصطفي": "Mustafa",

  "اسامه": "Osama", "انس": "Anas", "ايمن": "Ayman", "ايهاب": "Ihab",
  "جمال": "Jamal", "سليم": "Salim", "شاكر": "Shaker", "طارق": "Tariq",
  "عبداللطيف": "Abdullatif", "غسان": "Ghassan", "وليد": "Walid", "اشرف": "Ashraf",
  "بسام": "Bassam", "خليل": "Khalil", "زياد": "Ziad", "طاهر": "Taher",
  "عبدالفتاح": "Abdulfattah", "عدنان": "Adnan", "مهند": "Muhannad", "نضال": "Nidal",
  "امجد": "Amjad", "حسام": "Hussam", "عامر": "Amer", "علاء": "Alaa",
  "مراد": "Murad", "بهاء": "Bahaa", "زهير": "Zuhair", "زيد": "Zaid",
  "سمير": "Samir", "صدقي": "Sidqi", "عبدالرحيم": "Abdulrahim",

  "اياد": "Iyad", "تيسير": "Tayseer", "جهاد": "Jihad", "حسين": "Hussein",
  "حمزه": "Hamza", "داود": "Dawood", "رائد": "Raed", "رامي": "Rami",
  "سامر": "Samer", "شادي": "Shadi", "شريف": "Sharif", "صالح": "Saleh",
  "صبري": "Sabri", "عارف": "Aref", "فارس": "Faris", "فواز": "Fawwaz",
  "ليث": "Laith", "موسي": "Musa", "وائل": "Wael", "يزن": "Yazan",

  "اسماعيل": "Ismail", "باسل": "Basel", "باسم": "Basem", "خلدون": "Khaldoun",
  "زاهر": "Zaher", "زيدون": "Zaydoun", "سامي": "Sami", "سليمان": "Sulaiman",
  "صلاح": "Salah", "عبدالغني": "Abdulghani", "فادي": "Fadi", "ماهر": "Maher",
  "مجدي": "Majdi", "مروان": "Marwan", "هشام": "Hisham", "واكد": "Wakid",
  "يحيي": "Yahya", "يزيد": "Yazid",

  "اكرم": "Akram", "بشار": "Bashar", "ثائر": "Thaer", "جلال": "Jalal",
  "حاتم": "Hatem", "رضا": "Rida", "رفعت": "Rifat", "رفيق": "Rafiq",
  "سائد": "Saed", "عادل": "Adel", "عمار": "Ammar", "عميد": "Amid",
  "عنان": "Anan", "غيث": "Ghaith", "قاسم": "Qasem", "معن": "Maan",
  "نمر": "Nimr", "هيثم": "Haitham",

  "اسعد": "As'ad", "برهان": "Burhan", "راشد": "Rashed", "راغب": "Ragheb",
  "رافت": "Rafat", "رشيد": "Rashid", "رياض": "Riyad", "شوكت": "Shawkat",
  "صادق": "Sadeq", "ضياء": "Diaa", "طلال": "Talal", "عبدالهادي": "Abdulhadi",
  "عبدالوهاب": "Abdulwahhab", "عثمان": "Othman", "عزام": "Azzam", "عصام": "Isam",
  "عفيف": "Afif", "عوني": "Awni", "عيسي": "Issa", "فخري": "Fakhri",
  "قيس": "Qais", "ماجد": "Majed", "مازن": "Mazen", "مامون": "Mamoun",
  "مخلص": "Mukhlis", "معاذ": "Muadh", "معتصم": "Mutasim", "نادر": "Nader",
  "ناصر": "Nasser", "نبيل": "Nabil", "نعيم": "Naeem", "نورالدين": "Nouraldin",

  "اديب": "Adib", "امير": "Amir", "انور": "Anwar", "بشير": "Bashir",
  "توفيق": "Tawfiq", "حازم": "Hazem", "حسيب": "Hasib", "حكم": "Hakam",
  "حلمي": "Helmi", "رشاد": "Rashad", "رمزي": "Ramzi", "زهدي": "Zuhdi",
  "سهيل": "Suhail", "سيف": "Saif", "شكيب": "Shakib", "صبحي": "Subhi",
  "صهيب": "Suhaib", "طلعت": "Talat", "عاصم": "Asem", "عبدالحفيظ": "Abdulhafiz",
  "عبدالعزيز": "Abdulaziz", "عزات": "Izzat", "عزالدين": "Izzaldin", "عساف": "Assaf",
  "فؤاد": "Fouad", "فهمي": "Fahmi", "لؤي": "Louay", "مالك": "Malek",
  "مجد": "Majd", "منير": "Munir", "نزار": "Nizar",

  "بدر": "Badr", "تحسين": "Tahsin", "جبر": "Jabr", "جعفر": "Jafar",
  "حرب": "Harb", "حسان": "Hassaan", "زكريا": "Zakaria", "سالم": "Salem",
  "سقراط": "Socrates", "سلطان": "Sultan", "شفيق": "Shafiq", "صابر": "Saber",
  "ضرار": "Dirar", "ضرغام": "Dirgham", "ظافر": "Zafer", "عاطف": "Atef",
  "عبدالحافظ": "Abdulhafez", "عبدالحميد": "Abdulhamid", "عبدالرؤوف": "Abdulraouf",
  "عبدالرزاق": "Abdulrazzaq", "عبدالقادر": "Abdulqader", "عبدالمجيد": "Abdulmajid",
  "عدي": "Odai", "عزمي": "Azmi", "علام": "Allam", "عمرو": "Amr",
  "عوده": "Odeh", "عوض": "Awad", "فاروق": "Farouq", "فتحي": "Fathi",
  "فهد": "Fahd", "قصي": "Qusai", "كامل": "Kamel", "كريم": "Karim",
  "كفاح": "Kifah", "مؤيد": "Muayyad", "مثقال": "Mithqal", "مطيع": "Mutee",
  "معتز": "Mutaz", "مفيد": "Mufid", "منذر": "Mundher", "مهدي": "Mahdi",
  "مهيب": "Muhib", "نائل": "Nael", "نجيب": "Najib", "نعمان": "Numan",
  "نواف": "Nawaf", "هاشم": "Hashem", "هاني": "Hani", "وجدي": "Wajdi",
  "وجيه": "Wajih", "وسام": "Wisam", "وصفي": "Wasfi", "ياسر": "Yasser",
  "يعقوب": "Yaqoub",

  // ---- singletons ----
  "ادهم": "Adham", "ارسلان": "Arslan", "اسعاف": "Isaaf", "اسلام": "Islam",
  "اسيد": "Usaid", "الامين": "Al-Amin", "اميل": "Emile", "اوس": "Aws",
  "اياس": "Iyas", "ايسر": "Aysar", "ايوب": "Ayoub", "باهر": "Baher",
  "بديع": "Badie", "بكر": "Bakr", "بهجت": "Bahjat", "بهيج": "Bahij",
  "بيان": "Bayan", "تامر": "Tamer", "تقي": "Taqi", "تقيالدين": "Taqialdin",
  "جاسر": "Jasser", "جاسم": "Jasem", "جواد": "Jawad", "جودت": "Jawdat",
  "حام": "Ham", "حامد": "Hamed", "حسنين": "Hassanain", "حكمت": "Hikmat",
  "حمدالله": "Hamdallah", "حميس": "Hamis", "حيدر": "Haidar", "خضر": "Khader",
  "خيرالدين": "Khairaldin", "دارس": "Dares", "دانيال": "Danial", "درويش": "Darwish",
  "راتب": "Rateb", "راسم": "Rasem", "راضي": "Radi", "رافع": "Rafe",
  "رباح": "Rabah", "ربحت": "Rabhat", "ربحي": "Rabhi", "ربيع": "Rabie",
  "رسلان": "Raslan", "رعد": "Raad", "رنات": "Ranat", "روحي": "Rouhi",
  "زبن": "Zabn", "زكي": "Zaki", "زين": "Zain", "ساهر": "Saher",
  "سعد": "Saad", "سعدالله": "Saadallah", "سعدو": "Saado", "سعدي": "Saadi",
  "سفيان": "Sufyan", "سلام": "Salam", "سميح": "Samih", "سنان": "Sinan",
  "سيد": "Sayyed", "سيفالدين": "Saifaldin", "شكري": "Shukri", "شهاب": "Shihab",
  "شواف": "Shawwaf", "صافي": "Safi", "صايل": "Sayel", "طالب": "Taleb",
  "طريف": "Tarif", "طه": "Taha", "ظاهر": "Dhaher", "عباده": "Ubada",
  "عباس": "Abbas", "عبد": "Abd", "عبدالجبار": "Abduljabbar",
  "عبدالحكيم": "Abdulhakim", "عبدالحليم": "Abdulhalim", "عبدالمنعم": "Abdulmunim",
  "عبدالناصر": "Abdulnasser", "عبدالودود": "Abdulwadud", "عتيبه": "Utaiba",
  "عرسان": "Arsan", "عرين": "Areen", "عزت": "Izzat", "عزيز": "Aziz",
  "عصمت": "Ismat", "عمران": "Imran", "عواد": "Awwad", "عيد": "Eid",
  "غازي": "Ghazi", "فائق": "Faeq", "فلاح": "Fallah", "فوزات": "Fawzat",
  "فيصل": "Faisal", "كاظم": "Kazem", "كيان": "Kayan", "لقمان": "Luqman",
  "مؤمن": "Mumin", "محفوظ": "Mahfouz", "مختار": "Mukhtar", "مدحت": "Midhat",
  "مروح": "Marwah", "معمر": "Muammar", "معين": "Muin", "مقلد": "Muqallad",
  "منار": "Manar", "منتصر": "Muntasir", "منجد": "Munjid", "منيف": "Munif",
  "موفق": "Muwaffaq", "ناجح": "Najeh", "ناظم": "Nazem", "نافذ": "Nafez",
  "نافع": "Nafe", "ناهض": "Nahed", "نايف": "Nayef", "نديم": "Nadim",
  "نسيم": "Nasim", "نشات": "Nashat", "نظمي": "Nazmi", "نورس": "Nawras",
  "هايل": "Hayel", "هزاع": "Hazza", "همام": "Hammam", "واصف": "Wasef",
  "وحيد": "Waheed", "وضاح": "Waddah", "وهبه": "Wahba", "ياسين": "Yassin",
  "يونس": "Younes",

  // ---- spelling variants deliberately sharing one English ----
  "عبدالرؤف": "Abdulraouf", "عبدالرؤؤف": "Abdulraouf",
  "معاوية": "Muawiya", "معاويه": "Muawiya",

  // ---- compound / double names, as recorded in the source ----
  "اياد مصعب": "Iyad Musab", "توفيق عاهد": "Tawfiq Ahed",
  "شهريار شمس كريم": "Shahryar Shams Karim", "لطفي صبحي": "Lutfi Subhi",
  "مالك ليث": "Malek Laith", "محمد علي": "Mohammad Ali",
  "معتز محمود": "Mutaz Mahmoud", "منتصر بدر": "Muntasir Badr",
  "منير خليل": "Munir Khalil", "عمر رامي": "Omar Rami",

  // ---- source records an alternate/known-as name in parentheses ----
  "محمد(جودت)": "Mohammad (Jawdat)", "محمد(عمر)": "Mohammad (Omar)",
  "محمد(عيد)": "Mohammad (Eid)", "محمد(كمال)": "Mohammad (Kamal)",
  "محمود(عواد)": "Mahmoud (Awwad)", "كاظم(فواز)": "Kazem (Fawwaz)",

  // ---- already bilingual in the source ----
  "(سعيدPeter)": "Peter (Saeed)", "Yazanيزن": "Yazan",

  // ---- unnamed in the 1999 census ----
  "؟": "?", "محمد ؟": "Mohammad ?",

  // ---- probable source typos, transliterated literally rather than "fixed" ----
  "بوسف": "Bousef",          // almost certainly يوسف / Yousef
  "سفراط": "Sufrat",         // almost certainly سقراط / Socrates
  "عبدالرجيم": "Abdulrajim", // almost certainly عبدالرحيم / Abdulrahim

  // ---- not a person: a section heading the source draws in a box ----
  "ال الجيوسي في بلدة كتم": "The Jayyousi family in the town of Katm",
};

/* Fold away tatweel padding, harakat, and the أإآ/ى spelling looseness so that
   the same name written loosely resolves to one entry. Must stay in sync with
   the Python normaliser in rebuild_from_excel.py's tooling. */
function normalizeArabic(s) {
  if (!s) return '';
  return String(s)
    .replace(/ـ/g, '')                 // tatweel
    .replace(/[ً-ْ]/g, '')        // harakat
    .replace(/[أإآٱ]/g, 'ا')  // أإآٱ -> ا
    .replace(/ى/g, 'ي')           // ى -> ي
    .replace(/\s+/g, ' ')
    .trim();
}

/* English rendering of an Arabic name, or null if untranslated. */
function englishName(arabic) {
  return NAME_EN[normalizeArabic(arabic)] || null;
}

/* Single searchable haystack: Arabic (raw + normalised) plus English. */
function searchableName(arabic) {
  const en = englishName(arabic);
  return (arabic + ' ' + normalizeArabic(arabic) + (en ? ' ' + en : '')).toLowerCase();
}
