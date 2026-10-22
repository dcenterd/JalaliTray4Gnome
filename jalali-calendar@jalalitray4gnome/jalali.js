// Date math for the Jalali (Solar Hijri) and Hijri (Lunar) calendars.
// Pure JavaScript with no GNOME imports, so it can be unit-tested with node.

const G_DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Gregorian -> Jalali. Month is 1-based. Returns [jy, jm, jd]. */
export function g2j(gy, gm, gd) {
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
        Math.floor((gy2 + 399) / 400) + gd + G_DAYS_BEFORE_MONTH[gm - 1];
    let jy = -1595 + 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
        jy += Math.floor((days - 1) / 365);
        days = (days - 1) % 365;
    }
    let jm, jd;
    if (days < 186) {
        jm = 1 + Math.floor(days / 31);
        jd = 1 + (days % 31);
    } else {
        jm = 7 + Math.floor((days - 186) / 30);
        jd = 1 + ((days - 186) % 30);
    }
    return [jy, jm, jd];
}

/** Jalali -> Gregorian. Month is 1-based. Returns [gy, gm, gd]. */
export function j2g(jy, jm, jd) {
    jy += 1595;
    let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
        (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
    let gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
        days--;
        gy += 100 * Math.floor(days / 36524);
        days %= 36524;
        if (days >= 365)
            days++;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
        gy += Math.floor((days - 1) / 365);
        days = (days - 1) % 365;
    }
    let gd = days + 1;
    const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
    const monthLen = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 0;
    while (gm < 12 && gd > monthLen[gm]) {
        gd -= monthLen[gm];
        gm++;
    }
    return [gy, gm + 1, gd];
}

/** Local-midnight Date for a Jalali date. */
export function jalaliToDate(jy, jm, jd) {
    const [gy, gm, gd] = j2g(jy, jm, jd);
    return new Date(gy, gm - 1, gd);
}

/** Jalali parts of a JS Date (local time). */
export function toJalali(date) {
    const [y, m, d] = g2j(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return {year: y, month: m, day: d};
}

export function isJalaliLeap(jy) {
    const next = jalaliToDate(jy + 1, 1, 1);
    next.setDate(next.getDate() - 1);
    return toJalali(next).day === 30;
}

export function jalaliMonthLength(jy, jm) {
    if (jm <= 6)
        return 31;
    if (jm <= 11)
        return 30;
    return isJalaliLeap(jy) ? 30 : 29;
}

/** 0 = Saturday ... 6 = Friday. */
export function persianWeekday(date) {
    return (date.getDay() + 1) % 7;
}

export function addDays(date, n) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
}

export function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

export function gregorianKey(date) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// ---- Hijri ----

let _umalqura;
function umalquraFormatter() {
    if (_umalqura === undefined) {
        try {
            const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',
                {year: 'numeric', month: 'numeric', day: 'numeric'});
            _umalqura = f.resolvedOptions().calendar === 'islamic-umalqura' ? f : null;
        } catch {
            _umalqura = null;
        }
    }
    return _umalqura;
}

/** Tabular (arithmetic) Islamic calendar, used when ICU lacks umalqura. */
function tabularHijri(date) {
    const jdn = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000) + 2440588;
    const l0 = jdn - 1948440 + 10632;
    const n = Math.floor((l0 - 1) / 10631);
    let l = l0 - 10631 * n + 354;
    const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) +
        Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
    l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
        Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    const month = Math.floor((24 * l) / 709);
    const day = l - Math.floor((709 * month) / 24);
    const year = 30 * n + j - 30;
    return {year, month, day};
}

/** Hijri date with an adjustment of -2..+2 days (Iran's moon sighting often differs). */
export function toHijri(date, offset = 0) {
    const d = addDays(date, Math.max(-2, Math.min(2, offset)));
    const f = umalquraFormatter();
    if (f) {
        try {
            const parts = {};
            for (const p of f.formatToParts(d))
                parts[p.type] = parseInt(p.value, 10);
            if (parts.year && parts.month && parts.day)
                return {year: parts.year, month: parts.month, day: parts.day};
        } catch {
            // fall through to the arithmetic calendar
        }
    }
    return tabularHijri(d);
}
