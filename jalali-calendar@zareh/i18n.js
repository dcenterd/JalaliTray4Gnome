// UI strings and number/date formatting for Persian (default) and English.

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const STRINGS = {
    fa: {
        jalaliMonths: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
            'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
        hijriMonths: ['محرم', 'صفر', 'ربیع‌الاول', 'ربیع‌الثانی', 'جمادی‌الاول', 'جمادی‌الثانی',
            'رجب', 'شعبان', 'رمضان', 'شوال', 'ذی‌القعده', 'ذی‌الحجه'],
        weekdays: ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'],
        weekdaysShort: ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'],
        today: 'امروز',
        eventsOf: 'رویدادهای',
        noEvents: 'رویدادی ثبت نشده است',
        holiday: 'تعطیل',
        sourceOnline: 'منبع: time.ir',
        sourceOffline: 'منبع: داده آفلاین (time.ir در دسترس نیست)',
        sourceLoading: 'در حال دریافت از time.ir…',
        sourceDisabled: 'دریافت رویدادها خاموش است',
        converter: 'تبدیل تاریخ',
        jalaliToGregorian: 'شمسی ← میلادی',
        gregorianToJalali: 'میلادی ← شمسی',
        year: 'سال',
        month: 'ماه',
        day: 'روز',
        invalidDate: 'تاریخ نامعتبر است',
        settings: 'تنظیمات',
        ntpSync: 'همگام‌سازی ساعت با NTP',
        ntpSyncing: 'در حال همگام‌سازی با %s…',
        ntpDone: 'همگام با %s (اختلاف %s میلی‌ثانیه)',
        ntpFailed: 'همگام‌سازی با %s ناموفق بود',
        ntpReset: 'بازگشت به ساعت سیستم',
        hijriSuffix: 'ق',
        jalaliSuffix: '',
    },
    en: {
        jalaliMonths: ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar',
            'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'],
        hijriMonths: ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Awwal',
            'Jumada al-Thani', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'],
        weekdays: ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekdaysShort: ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'],
        today: 'Today',
        eventsOf: 'Events for',
        noEvents: 'No events',
        holiday: 'Holiday',
        sourceOnline: 'Source: time.ir',
        sourceOffline: 'Source: offline data (time.ir unreachable)',
        sourceLoading: 'Loading from time.ir…',
        sourceDisabled: 'Event download is off',
        converter: 'Date converter',
        jalaliToGregorian: 'Jalali → Gregorian',
        gregorianToJalali: 'Gregorian → Jalali',
        year: 'Year',
        month: 'Month',
        day: 'Day',
        invalidDate: 'Invalid date',
        settings: 'Settings',
        ntpSync: 'Sync clock with NTP',
        ntpSyncing: 'Syncing with %s…',
        ntpDone: 'Synced with %s (offset %s ms)',
        ntpFailed: 'Could not sync with %s',
        ntpReset: 'Use system clock',
        hijriSuffix: 'AH',
        jalaliSuffix: '',
    },
};

const GREGORIAN_MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_EN_SUNDAY_FIRST = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
    'Friday', 'Saturday'];

export function strings(lang) {
    return STRINGS[lang] ?? STRINGS.fa;
}

export function num(n, lang, pad = 0) {
    let s = String(n);
    if (pad)
        s = s.padStart(pad, '0');
    return lang === 'en' ? s : s.replace(/\d/g, d => FA_DIGITS[d]);
}

/** Accepts Persian, Arabic-Indic or Latin digits. */
export function parseDigits(text) {
    const latin = String(text ?? '').trim()
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
    return /^\d+$/.test(latin) ? parseInt(latin, 10) : NaN;
}

export function formatGregorian(date) {
    return `${WEEKDAYS_EN_SUNDAY_FIRST[date.getDay()]}, ${date.getDate()} ` +
        `${GREGORIAN_MONTHS_EN[date.getMonth()]} ${date.getFullYear()}`;
}
