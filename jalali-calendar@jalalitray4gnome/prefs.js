import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const TEXT = {
    fa: {
        panel: 'نوار بالا',
        position: 'محل نمایش',
        positionSub: 'کدام بخش نوار بالا',
        positions: ['چپ', 'وسط (کنار ساعت)', 'راست'],
        index: 'ترتیب در آن بخش',
        indexSub: '۰ یعنی اولین آیتم؛ عدد بزرگ‌تر یعنی جلوتر به سمت انتها',
        color: 'رنگ تاریخ در نوار',
        colors: ['سفید', 'مشکی', 'آبی'],
        format: 'قالب نمایش تاریخ',
        formats: ['۳۰', '۳۰ مهر', '۳۰ مهر ۱۴۰۵', 'پنجشنبه ۳۰ مهر ۱۴۰۵', '۱۴۰۵/۰۷/۳۰'],
        highlight: 'جمعه‌ها و تعطیلات قرمز باشند',
        padding: 'فاصله داخلی چپ و راست (px)',
        margin: 'حاشیه بیرونی چپ و راست (px)',
        minWidth: 'عرض ثابت برچسب (px)',
        minWidthSub: '۰ یعنی خودکار. با عرض ثابت، تغییر متن یا افزونه‌های کناری تاریخ را جابه‌جا نمی‌کنند',
        clock: 'نمایش ساعت در پنجره',
        display: 'نمایش',
        language: 'زبان',
        languageSub: 'برای اعمال در این پنجره، آن را ببندید و دوباره باز کنید',
        languages: ['فارسی', 'English'],
        gregorian: 'نمایش تاریخ میلادی',
        hijri: 'نمایش تاریخ قمری',
        hijriOffset: 'تنظیم تاریخ قمری (روز)',
        hijriOffsetSub: 'اگر تاریخ قمری با تقویم رسمی ایران یکی نیست، آن را جابه‌جا کنید',
        ntp: 'همگام‌سازی ساعت (NTP)',
        ntpServer: 'سرور NTP',
        ntpServerSub: 'هر سرور NTP در جهان؛ نام میزبان یا نشانی IP، مثلاً time.google.com',
        ntpSyncNow: 'همگام‌سازی ساعت با NTP',
        ntpReset: 'بازگشت به ساعت سیستم',
        ntpAuto: 'همگام‌سازی خودکار',
        ntpAutoSub: 'هنگام شروع و سپس هر ساعت. ساعت سیستم تغییر نمی‌کند؛ فقط ساعت و تاریخ این افزونه اصلاح می‌شود',
        updates: 'به‌روزرسانی',
        checkUpdates: 'بررسی نسخه جدید',
        checkUpdatesSub: 'روزانه از GitHub پرسیده می‌شود؛ چیزی نصب نمی‌شود و فقط پیامی در پنجره نمایش داده می‌شود',
        events: 'رویدادها',
        fetch: 'دریافت رویدادها از time.ir',
        fetchSub: 'ماهانه دریافت و در ‎~/.cache/jalali-calendar‎ ذخیره می‌شود',
        holidays: 'تعطیلات رسمی',
        religious: 'مناسبت‌های مذهبی',
        national: 'مناسبت‌های ملی',
        other: 'مناسبت‌های جهانی',
    },
    en: {
        panel: 'Top bar',
        position: 'Position',
        positionSub: 'Which area of the top bar',
        positions: ['Left', 'Center (next to the clock)', 'Right'],
        index: 'Order in that area',
        indexSub: '0 is the first item; higher numbers move it toward the end',
        color: 'Date color on the bar',
        colors: ['White', 'Black', 'Blue'],
        format: 'Label format',
        formats: ['30', '30 Mehr', '30 Mehr 1405', 'Thursday 30 Mehr 1405', '1405/07/30'],
        highlight: 'Show Fridays and holidays in red',
        padding: 'Left and right padding (px)',
        margin: 'Left and right margin (px)',
        minWidth: 'Fixed label width (px)',
        minWidthSub: '0 is automatic. A fixed width keeps the date from shifting when its text or neighbouring extensions change',
        clock: 'Show the clock in the popup',
        display: 'Display',
        language: 'Language',
        languageSub: 'Close and reopen this window to apply it here',
        languages: ['فارسی', 'English'],
        gregorian: 'Show Gregorian date',
        hijri: 'Show Hijri date',
        hijriOffset: 'Hijri adjustment (days)',
        hijriOffsetSub: 'Shift it if the Hijri date differs from Iran\'s official calendar',
        ntp: 'Clock sync (NTP)',
        ntpServer: 'NTP server',
        ntpServerSub: 'Any NTP server in the world: host name or IP address, e.g. time.google.com',
        ntpSyncNow: 'Sync clock with NTP',
        ntpReset: 'Use system clock',
        ntpAuto: 'Sync automatically',
        ntpAutoSub: 'On start and then every hour. The system clock is not changed; only this extension\'s clock and date are corrected',
        updates: 'Updates',
        checkUpdates: 'Check for a new version',
        checkUpdatesSub: 'Asks GitHub once a day; nothing is installed, a notice is just shown in the popup',
        events: 'Events',
        fetch: 'Download events from time.ir',
        fetchSub: 'Fetched monthly and cached in ~/.cache/jalali-calendar',
        holidays: 'Official holidays',
        religious: 'Religious occasions',
        national: 'National occasions',
        other: 'International occasions',
    },
};

const POSITIONS = ['left', 'center', 'right'];
const FORMATS = ['day', 'day-month', 'day-month-year', 'weekday-full', 'numeric'];
const COLORS = ['white', 'black', 'blue'];
const LANGUAGES = ['fa', 'en'];

export default class JalaliCalendarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive with the window
        const t = TEXT[settings.get_string('language')] ?? TEXT.fa;

        const page = new Adw.PreferencesPage({icon_name: 'x-office-calendar-symbolic'});
        window.add(page);

        const combo = (title, subtitle, labels, values, key) => {
            const row = new Adw.ComboRow({title, subtitle: subtitle ?? '', model: Gtk.StringList.new(labels)});
            row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
            row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));
            return row;
        };
        const toggle = (title, key, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle: subtitle ?? ''});
            settings.bind(key, row, 'active', 0);
            return row;
        };
        const spin = (title, subtitle, min, max, key) => {
            const row = Adw.SpinRow.new_with_range(min, max, 1);
            row.title = title;
            row.subtitle = subtitle;
            settings.bind(key, row, 'value', 0);
            return row;
        };

        const panel = new Adw.PreferencesGroup({title: t.panel});
        panel.add(combo(t.position, t.positionSub, t.positions, POSITIONS, 'panel-position'));
        panel.add(spin(t.index, t.indexSub, 0, 20, 'panel-index'));
        panel.add(combo(t.format, null, t.formats, FORMATS, 'label-format'));
        panel.add(combo(t.color, null, t.colors, COLORS, 'panel-color'));
        panel.add(toggle(t.highlight, 'highlight-holidays'));
        panel.add(spin(t.padding, '', 0, 60, 'panel-padding'));
        panel.add(spin(t.margin, '', 0, 60, 'panel-margin'));
        panel.add(spin(t.minWidth, t.minWidthSub, 0, 400, 'panel-min-width'));
        page.add(panel);

        const display = new Adw.PreferencesGroup({title: t.display});
        display.add(combo(t.language, t.languageSub, t.languages, LANGUAGES, 'language'));
        display.add(toggle(t.clock, 'show-clock'));
        display.add(toggle(t.gregorian, 'show-gregorian'));
        display.add(toggle(t.hijri, 'show-hijri'));
        display.add(spin(t.hijriOffset, t.hijriOffsetSub, -2, 2, 'hijri-offset'));
        page.add(display);

        const ntp = new Adw.PreferencesGroup({title: t.ntp});
        const server = new Adw.EntryRow({title: t.ntpServer, text: settings.get_string('ntp-server')});
        server.connect('changed', () => settings.set_string('ntp-server', server.text.trim()));
        ntp.add(server);
        ntp.add(toggle(t.ntpAuto, 'ntp-auto-sync', t.ntpAutoSub));
        const action = (title, label, key) => {
            const row = new Adw.ActionRow({title});
            const btn = new Gtk.Button({label, valign: Gtk.Align.CENTER});
            btn.connect('clicked', () => settings.set_int(key, settings.get_int(key) + 1));
            row.add_suffix(btn);
            row.activatable_widget = btn;
            return row;
        };
        ntp.add(action(t.ntpSyncNow, '▶', 'ntp-sync-request'));
        ntp.add(action(t.ntpReset, '↺', 'ntp-reset-request'));
        ntp.description = t.ntpServerSub;
        page.add(ntp);

        const events = new Adw.PreferencesGroup({title: t.events});
        events.add(toggle(t.fetch, 'fetch-events', t.fetchSub));
        events.add(toggle(t.holidays, 'show-holidays'));
        events.add(toggle(t.religious, 'show-religious'));
        events.add(toggle(t.national, 'show-national'));
        events.add(toggle(t.other, 'show-other'));
        page.add(events);

        const updates = new Adw.PreferencesGroup({title: t.updates});
        updates.add(toggle(t.checkUpdates, 'check-updates', t.checkUpdatesSub));
        page.add(updates);
    }
}
