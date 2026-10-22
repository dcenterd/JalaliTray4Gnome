// Calendar events from the public time.ir API, fetched a Jalali month at a time
// (day=0 returns the whole month, no API key needed). Results are cached in
// ~/.cache/jalali-calendar, and a small bundled list is used when offline.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {toJalali, gregorianKey} from './jalali.js';

const API_BASE = 'https://api.time.ir';
const CACHE_TTL_MS = 3 * 24 * 3600 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

// Fixed-date occasions used when time.ir has not been reached yet.
// Lunar (religious) holidays move every year, so they only come from the API.
const BUNDLED_JALALI = {
    '1-1': [['جشن نوروز / آغاز سال نو', true, 'national']],
    '1-2': [['عید نوروز', true, 'national']],
    '1-3': [['عید نوروز', true, 'national']],
    '1-4': [['عید نوروز', true, 'national']],
    '1-12': [['روز جمهوری اسلامی', true, 'national']],
    '1-13': [['روز طبیعت', true, 'national']],
    '2-25': [['روز بزرگداشت فردوسی', false, 'national']],
    '3-14': [['رحلت امام خمینی', true, 'national']],
    '3-15': [['قیام ۱۵ خرداد', true, 'national']],
    '7-8': [['روز بزرگداشت مولوی', false, 'national']],
    '7-20': [['روز بزرگداشت حافظ', false, 'national']],
    '9-30': [['شب یلدا', false, 'national']],
    '11-22': [['پیروزی انقلاب اسلامی', true, 'national']],
    '12-29': [['روز ملی شدن صنعت نفت', true, 'national']],
};
const BUNDLED_GREGORIAN = {
    '1-1': [['آغاز سال نو میلادی', false, 'other']],
    '12-25': [['کریسمس', false, 'other']],
};

function bundledFor(date) {
    const j = toJalali(date);
    const list = [
        ...(BUNDLED_JALALI[`${j.month}-${j.day}`] ?? []),
        ...(BUNDLED_GREGORIAN[`${date.getMonth() + 1}-${date.getDate()}`] ?? []),
    ];
    return list.map(([title, holiday, kind]) => ({title, holiday, kind}));
}

const monthKey = (jy, jm) => `${jy}-${String(jm).padStart(2, '0')}`;

export class EventStore {
    constructor() {
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jalali-calendar']);
        this._path = GLib.build_filenamev([this._dir, 'events-v1.json']);
        this._cache = this._load();
        this._inflight = new Map();
        this._failedAt = new Map();
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 15, user_agent: 'jalali-calendar-gnome'});
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._session = null;
    }

    _load() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._path);
            if (ok)
                return JSON.parse(new TextDecoder().decode(bytes)) ?? {};
        } catch {
            // missing or corrupt cache: start empty
        }
        return {};
    }

    _save() {
        try {
            GLib.mkdir_with_parents(this._dir, 0o755);
            GLib.file_set_contents(this._path, JSON.stringify(this._cache));
        } catch (e) {
            console.warn(`[jalali-calendar] could not write cache: ${e.message}`);
        }
    }

    _monthFor(date) {
        const j = toJalali(date);
        return this._cache[monthKey(j.year, j.month)] ?? null;
    }

    /** True when this date's month came from time.ir (fresh or stale). */
    hasApiData(date) {
        return this._monthFor(date) !== null;
    }

    hasFreshMonth(jy, jm) {
        const m = this._cache[monthKey(jy, jm)];
        return !!m && Date.now() - m.fetched < CACHE_TTL_MS;
    }

    /** All events for a day (unfiltered), from cache or bundled data. */
    eventsFor(date) {
        const month = this._monthFor(date);
        if (!month)
            return bundledFor(date);
        return month.days[gregorianKey(date)] ?? [];
    }

    isHoliday(date) {
        const month = this._monthFor(date);
        if (!month)
            return bundledFor(date).some(e => e.holiday);
        return month.holidays.includes(toJalali(date).day) ||
            (month.days[gregorianKey(date)] ?? []).some(e => e.holiday);
    }

    /** Makes sure the Jalali month is cached. Resolves true if API data is available. */
    ensureMonth(jy, jm) {
        const key = monthKey(jy, jm);
        if (this.hasFreshMonth(jy, jm))
            return Promise.resolve(true);
        const failedAt = this._failedAt.get(key);
        if (failedAt && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS)
            return Promise.resolve(key in this._cache);
        if (this._inflight.has(key))
            return this._inflight.get(key);

        const p = this._fetchMonth(jy, jm).then(entry => {
            this._cache[key] = entry;
            this._failedAt.delete(key);
            this._save();
            return true;
        }).catch(e => {
            if (!this._cancellable.is_cancelled())
                console.debug(`[jalali-calendar] time.ir fetch failed for ${key}: ${e.message}`);
            this._failedAt.set(key, Date.now());
            return key in this._cache;
        }).finally(() => this._inflight.delete(key));
        this._inflight.set(key, p);
        return p;
    }

    _fetchMonth(jy, jm) {
        const url = `${API_BASE}/v1/event/fa/events/calendar?year=${jy}&month=${jm}` +
            '&day=0&base1=0&base2=1&base3=2';
        return new Promise((resolve, reject) => {
            if (!this._session) {
                reject(new Error('store destroyed'));
                return;
            }
            const msg = Soup.Message.new('GET', url);
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable,
                (session, res) => {
                    try {
                        const bytes = session.send_and_read_finish(res);
                        if (msg.get_status() !== Soup.Status.OK)
                            throw new Error(`HTTP ${msg.get_status()}`);
                        const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        resolve(parseMonth(json));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }
}

function parseMonth(json) {
    const data = json?.data;
    if (!data || !Array.isArray(data.event_list))
        throw new Error('unexpected response');

    const entry = {fetched: Date.now(), days: {}, holidays: []};
    const pad = n => String(n).padStart(2, '0');

    for (const el of data.event_list) {
        const title = String(el.title ?? '').trim();
        if (!title)
            continue;
        const key = `${el.gregorian_year}-${pad(el.gregorian_month)}-${pad(el.gregorian_day)}`;
        const holiday = el.is_holiday === true;
        // base: 0 = Jalali-calendar occasions, 2 = Hijri, others = Gregorian/international
        const kind = el.base === 0 ? 'national' : el.base === 2 ? 'religious' : 'other';
        const list = entry.days[key] ??= [];
        if (!list.some(x => x.title === title))
            list.push({title, holiday, kind});
    }

    for (const d of data.day_list ?? []) {
        if (d.enabled === true && d.is_holiday === true && Number.isInteger(d.index_in_base1))
            entry.holidays.push(d.index_in_base1);
    }
    return entry;
}
