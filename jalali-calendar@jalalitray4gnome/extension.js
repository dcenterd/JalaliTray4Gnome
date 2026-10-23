// JalaliTray4Gnome: a GNOME Shell port of JalaliTray by Avestura (https://github.com/avestura/JalaliTray).
// Shows today's Jalali date in the top bar; the popup has a live clock,
// Jalali / Gregorian / Hijri dates, a month grid, events and a date converter.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as J from './jalali.js';
import {strings, num, parseDigits, formatGregorian} from './i18n.js';
import {EventStore} from './events.js';
import {queryNtp} from './ntp.js';
import {UpdateChecker, isNewer} from './update.js';

const FRIDAY = 6;
const NTP_RESYNC_SECONDS = 3600;
const UPDATE_CHECK_SECONDS = 24 * 3600;
const PANEL_COLORS = {white: '#ffffff', black: '#000000', blue: '#3584e4'};

// St.BoxLayout got an `orientation` property in GNOME 48 and deprecated `vertical`.
function vbox(params = {}) {
    const box = new St.BoxLayout(params);
    if (box.orientation !== undefined)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}

function wrapLabel(label, rtl) {
    const t = label.clutter_text;
    t.line_wrap = true;
    t.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    t.ellipsize = Pango.EllipsizeMode.NONE;
    // With auto-direction on, Pango mirrors LEFT/RIGHT inside an RTL paragraph
    // (LEFT = start of line); with it off they are absolute. Ask the layout
    // rather than assume, so the lines hug the right edge in Persian either way.
    const mirrored = t.get_layout().get_auto_dir();
    t.line_alignment = (rtl && !mirrored) ? Pango.Alignment.RIGHT : Pango.Alignment.LEFT;
    // Let the text span the whole label, otherwise it is as narrow as its
    // longest line and the alignment above has no room to take effect.
    t.x_expand = true;
    t.x_align = Clutter.ActorAlign.FILL;
    label.x_align = Clutter.ActorAlign.FILL;
    label.set_text_direction(rtl ? Clutter.TextDirection.RTL : Clutter.TextDirection.LTR);
    return label;
}

const JalaliIndicator = GObject.registerClass(
class JalaliIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'JalaliTray4Gnome', false);
        this._ext = ext;
        this._settings = ext.getSettings();
        this._events = ext.events;
        this._requested = new Set();
        this._today = this._now();
        this._selected = this._now();
        this._viewYear = 0;
        this._viewMonth = 0;
        this._clockId = 0;
        this._ntpTimerId = 0;
        this._ntpCancellable = new Gio.Cancellable();
        this._converterMode = 'j2g';

        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'jc-panel-label',
        });
        this.add_child(this._label);
        this.menu.box.add_style_class_name('jc-menu');

        this._menuItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._menuItem.add_style_class_name('jc-item');
        this.menu.addMenuItem(this._menuItem);

        this.menu.connect('open-state-changed', (_m, open) => this._onOpenChanged(open));

        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'panel-position' || key === 'panel-index' || key === 'ntp-auto-sync')
                return; // handled by the extension, which re-adds the indicator
            if (key === 'ntp-server')
                return; // read when a sync starts
            if (key === 'ntp-sync-request') {
                this._syncNtp(); // "Sync now" in the preferences
                return;
            }
            if (key === 'ntp-reset-request') {
                this._resetNtp(); // "Use system clock" in the preferences
                return;
            }
            this._rebuild();
            this._updatePanel();
        });

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });

        this._gotoToday();
        this._rebuild();
        this._updatePanel();

        if (this._settings.get_boolean('ntp-auto-sync')) {
            this._syncNtp();
            this._ntpTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, NTP_RESYNC_SECONDS, () => {
                this._syncNtp();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    get _lang() {
        return this._settings.get_string('language') === 'en' ? 'en' : 'fa';
    }

    get _rtl() {
        return this._lang === 'fa';
    }

    get _t() {
        return strings(this._lang);
    }

    _n(value, pad = 0) {
        return num(value, this._lang, pad);
    }

    /** Adds children in reading order: right-to-left for Persian. */
    _row(children, params = {}) {
        const box = new St.BoxLayout({x_expand: true, ...params});
        for (const c of this._rtl ? [...children].reverse() : children)
            box.add_child(c);
        return box;
    }

    _align() {
        return this._rtl ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
    }

    // ---------- time ----------

    /** Current time, corrected by the last NTP sync (if any). */
    _now() {
        return new Date(Date.now() + this._ext.clockOffsetMs);
    }

    _tick() {
        const now = this._now();
        if (!J.sameDay(now, this._today)) {
            this._today = now;
            this._requested.clear();
            if (!this.menu.isOpen)
                this._gotoToday();
            this._rebuild();
        }
        this._updatePanel();
    }

    _gotoToday() {
        this._today = this._now();
        this._selected = new Date(this._today);
        const j = J.toJalali(this._today);
        this._viewYear = j.year;
        this._viewMonth = j.month;
    }

    _onOpenChanged(open) {
        if (open) {
            this._requested.clear();
            this._gotoToday();
            this._converterVisible = false;
            this._rebuild();
            this._updateClock();
            this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._updateClock();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (this._clockId) {
            GLib.source_remove(this._clockId);
            this._clockId = 0;
        }
    }

    _updateClock() {
        if (!this._clockLabel)
            return;
        const now = this._now();
        if (!J.sameDay(now, this._today))
            this._tick();
        this._clockLabel.text = `${this._n(now.getHours(), 2)}:${this._n(now.getMinutes(), 2)}:` +
            `${this._n(now.getSeconds(), 2)}`;
    }

    // ---------- NTP ----------

    _syncNtp() {
        const server = this._settings.get_string('ntp-server').trim();
        const ext = this._ext;
        if (!server || ext.ntp.state === 'syncing')
            return;
        ext.ntp = {state: 'syncing', server};
        queryNtp(server, this._ntpCancellable).then(r => {
            ext.clockOffsetMs = r.offsetMs;
            ext.ntp = {state: 'done', server, offsetMs: r.offsetMs};
        }).catch(e => {
            if (this._ntpCancellable.is_cancelled()) {
                ext.ntp = {state: 'idle'};
                return;
            }
            console.error(`jalali-calendar: NTP sync with ${server} failed: ${e.message}`);
            ext.ntp = {state: 'failed', server};
        }).finally(() => {
            if (this._destroyed)
                return;
            this._tick();
            if (this.menu.isOpen)
                this._updateClock();
        });
    }

    _resetNtp() {
        this._ext.clockOffsetMs = 0;
        this._ext.ntp = {state: 'idle'};
        this._tick();
        this._updateClock();
    }

    // ---------- formatting ----------

    _jalaliText(date, withWeekday = true) {
        const j = J.toJalali(date);
        const t = this._t;
        const s = `${this._n(j.day)} ${t.jalaliMonths[j.month - 1]} ${this._n(j.year)}`;
        return withWeekday ? `${t.weekdays[J.persianWeekday(date)]} ${s}` : s;
    }

    _hijriText(date) {
        const h = J.toHijri(date, this._settings.get_int('hijri-offset'));
        const t = this._t;
        return `${this._n(h.day)} ${t.hijriMonths[h.month - 1]} ${this._n(h.year)} ${t.hijriSuffix}`;
    }

    _panelText(date) {
        const j = J.toJalali(date);
        const t = this._t;
        const month = t.jalaliMonths[j.month - 1];
        switch (this._settings.get_string('label-format')) {
        case 'day':
            return this._n(j.day);
        case 'day-month-year':
            return `${this._n(j.day)} ${month} ${this._n(j.year)}`;
        case 'weekday-full':
            return this._jalaliText(date, true);
        case 'numeric':
            return `${this._n(j.year)}/${this._n(j.month, 2)}/${this._n(j.day, 2)}`;
        default:
            return `${this._n(j.day)} ${month}`;
        }
    }

    _isRedDay(date) {
        if (!this._settings.get_boolean('highlight-holidays'))
            return false;
        return J.persianWeekday(date) === FRIDAY ||
            (this._settings.get_boolean('show-holidays') && this._events.isHoliday(date));
    }

    _filteredEvents(date) {
        const s = this._settings;
        return this._events.eventsFor(date).filter(e =>
            e.holiday ? s.get_boolean('show-holidays') : s.get_boolean(`show-${e.kind}`));
    }

    _applyLayout() {
        const s = this._settings;
        const pad = s.get_int('panel-padding');
        const margin = s.get_int('panel-margin');
        const minWidth = s.get_int('panel-min-width');
        this.style = `padding-left: ${pad}px; padding-right: ${pad}px; ` +
            `margin-left: ${margin}px; margin-right: ${margin}px;`;
        this._label.style = minWidth > 0 ? `min-width: ${minWidth}px; text-align: center;` : '';
    }

    _updatePanel() {
        this._applyLayout();
        const today = this._now();
        this._label.text = this._panelText(today);
        const red = this._isRedDay(today);
        this._label.style_class = red ? 'jc-panel-label jc-panel-holiday' : 'jc-panel-label';
        if (!red) {
            const color = PANEL_COLORS[this._settings.get_string('panel-color')] ?? PANEL_COLORS.white;
            this._label.style += ` color: ${color};`;
        }
        const j = J.toJalali(today);
        this._requestMonth(j.year, j.month);
    }

    // ---------- events from time.ir ----------

    _requestMonth(jy, jm) {
        if (!this._settings.get_boolean('fetch-events'))
            return;
        const key = `${jy}-${jm}`;
        if (this._events.hasFreshMonth(jy, jm) || this._requested.has(key))
            return;
        this._requested.add(key);
        this._loading = true;
        this._events.ensureMonth(jy, jm).then(() => {
            this._loading = false;
            if (this._destroyed)
                return;
            this._updatePanel();
            if (this.menu.isOpen && jy === this._viewYear && jm === this._viewMonth) {
                this._renderGrid();
                this._renderEvents();
            }
        });
    }

    // ---------- popup ----------

    _rebuild() {
        if (this._destroyed)
            return;
        this._root?.destroy();
        const rtl = this._rtl;
        const t = this._t;
        this._root = vbox({x_expand: true, style_class: 'jc-root'});
        if (rtl)
            this._root.add_style_class_name('jc-rtl');
        this._menuItem.add_child(this._root);

        // Header: clock and three dates, with converter and settings buttons.
        const dates = vbox({x_expand: true});
        this._clockLabel = new St.Label({style_class: 'jc-clock', x_align: this._align()});
        this._clockLabel.visible = this._settings.get_boolean('show-clock');
        this._jalaliLabel = new St.Label({style_class: 'jc-jalali', x_align: this._align()});
        dates.add_child(this._clockLabel);
        dates.add_child(this._jalaliLabel);
        this._gregLabel = new St.Label({style_class: 'jc-sub', x_align: this._align()});
        this._hijriLabel = new St.Label({style_class: 'jc-sub', x_align: this._align()});
        dates.add_child(this._gregLabel);
        dates.add_child(this._hijriLabel);

        const convBtn = this._iconButton('object-flip-horizontal-symbolic', t.converter, () => {
            this._converterVisible = !this._converterVisible;
            this._converter.visible = this._converterVisible;
            if (this._converterVisible)
                this._fillConverter(this._selected);
        });
        const settingsBtn = this._iconButton('emblem-system-symbolic', t.settings, () => {
            this.menu.close();
            this._ext.openPreferences();
        });
        const buttons = this._row([convBtn, settingsBtn], {x_expand: false, y_align: Clutter.ActorAlign.START});
        this._root.add_child(this._row([dates, buttons]));

        // Converter (hidden until the button is pressed).
        this._converter = this._buildConverter();
        this._converter.visible = !!this._converterVisible;
        this._root.add_child(this._converter);

        // Month navigation.
        const prev = this._iconButton(rtl ? 'go-next-symbolic' : 'go-previous-symbolic', '',
            () => this._shiftMonth(-1));
        const next = this._iconButton(rtl ? 'go-previous-symbolic' : 'go-next-symbolic', '',
            () => this._shiftMonth(1));
        this._monthTitle = new St.Label({
            style_class: 'jc-month-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const todayBtn = new St.Button({
            label: t.today,
            style_class: 'jc-today-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        todayBtn.connect('clicked', () => {
            this._gotoToday();
            this._renderGrid();
            this._renderEvents();
        });
        this._root.add_child(this._row([prev, this._monthTitle, todayBtn, next], {style_class: 'jc-nav'}));

        // Weekday header and day grid.
        const head = t.weekdaysShort.map((w, i) => new St.Label({
            text: w,
            style_class: i === FRIDAY ? 'jc-weekday jc-red' : 'jc-weekday',
        }));
        this._root.add_child(this._row(head));
        this._grid = vbox({style_class: 'jc-grid', reactive: true});
        this._grid.connect('scroll-event', (_a, event) => {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.SMOOTH) {
                // Touchpads: step one month per accumulated "notch".
                const [, dy] = event.get_scroll_delta();
                this._scrollAcc = (this._scrollAcc ?? 0) + dy;
                if (Math.abs(this._scrollAcc) >= 1) {
                    this._shiftMonth(this._scrollAcc > 0 ? 1 : -1);
                    this._scrollAcc = 0;
                }
            } else if (dir === Clutter.ScrollDirection.UP) {
                this._shiftMonth(-1);
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                this._shiftMonth(1);
            }
            return Clutter.EVENT_STOP;
        });
        this._root.add_child(this._grid);

        // Events of the selected day.
        // max-width keeps long events wrapping; anchoring the capped box to the
        // text-start edge makes Persian lines end flush with the popup's right edge.
        this._eventsBox = vbox({style_class: 'jc-events', x_expand: true, x_align: this._align()});
        this._root.add_child(this._eventsBox);

        this._updateBox = vbox({x_expand: true});
        this._root.add_child(this._updateBox);

        this._renderGrid();
        this._renderEvents();
        this._renderUpdate();
        this._updateClock();
    }

    /** Shows a link to the release page when the extension found a newer version. */
    _renderUpdate() {
        if (!this._updateBox)
            return;
        this._updateBox.destroy_all_children();
        const update = this._ext.update;
        if (!update || !this._settings.get_boolean('check-updates'))
            return;
        const btn = new St.Button({
            label: this._t.updateAvailable.replace('%s', this._n(update.version)),
            style_class: 'jc-update',
            can_focus: true,
            x_expand: true,
        });
        btn.connect('clicked', () => {
            this.menu.close();
            try {
                Gio.AppInfo.launch_default_for_uri(update.url, null);
            } catch (e) {
                console.error(`jalali-calendar: could not open ${update.url}: ${e.message}`);
            }
        });
        this._updateBox.add_child(btn);
    }

    refreshUpdate() {
        if (!this._destroyed)
            this._renderUpdate();
    }

    _iconButton(iconName, accessibleName, onClick) {
        const btn = new St.Button({
            style_class: 'jc-icon-button',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
            accessible_name: accessibleName,
        });
        btn.connect('clicked', onClick);
        return btn;
    }

    _shiftMonth(delta) {
        let m = this._viewMonth + delta;
        let y = this._viewYear;
        if (m < 1) {
            m = 12;
            y--;
        } else if (m > 12) {
            m = 1;
            y++;
        }
        this._viewYear = y;
        this._viewMonth = m;
        const day = Math.min(J.toJalali(this._selected).day, J.jalaliMonthLength(y, m));
        this._selected = J.jalaliToDate(y, m, day);
        this._renderGrid();
        this._renderEvents();
    }

    _select(date) {
        this._selected = date;
        const j = J.toJalali(date);
        this._viewYear = j.year;
        this._viewMonth = j.month;
        this._renderGrid();
        this._renderEvents();
    }

    _renderGrid() {
        const t = this._t;
        this._requestMonth(this._viewYear, this._viewMonth);

        this._jalaliLabel.text = this._jalaliText(this._today);
        this._gregLabel.text = formatGregorian(this._today);
        this._gregLabel.visible = this._settings.get_boolean('show-gregorian');
        this._hijriLabel.text = this._hijriText(this._today);
        this._hijriLabel.visible = this._settings.get_boolean('show-hijri');
        this._monthTitle.text = `${t.jalaliMonths[this._viewMonth - 1]} ${this._n(this._viewYear)}`;

        this._grid.destroy_all_children();
        const first = J.jalaliToDate(this._viewYear, this._viewMonth, 1);
        const start = J.addDays(first, -J.persianWeekday(first));
        for (let r = 0; r < 6; r++) {
            const cells = [];
            for (let c = 0; c < 7; c++) {
                const date = J.addDays(start, r * 7 + c);
                const j = J.toJalali(date);
                const btn = new St.Button({label: this._n(j.day), style_class: 'jc-day', can_focus: true});
                if (j.month !== this._viewMonth)
                    btn.add_style_class_name('jc-other-month');
                if (this._isRedDay(date))
                    btn.add_style_class_name('jc-red');
                if (this._filteredEvents(date).length > 0)
                    btn.add_style_class_name('jc-has-events');
                if (J.sameDay(date, this._today))
                    btn.add_style_class_name('jc-today');
                if (J.sameDay(date, this._selected))
                    btn.add_style_class_name('jc-selected');
                btn.connect('clicked', () => this._select(date));
                cells.push(btn);
            }
            this._grid.add_child(this._row(cells));
        }
    }

    _renderEvents() {
        const t = this._t;
        const rtl = this._rtl;
        const date = this._selected;
        this._eventsBox.destroy_all_children();

        const title = new St.Label({
            text: `${t.eventsOf} ${this._jalaliText(date, true)}`,
            style_class: 'jc-events-title',
            x_align: this._align(),
        });
        this._eventsBox.add_child(title);

        if (!J.sameDay(date, this._today)) {
            const sub = [];
            if (this._settings.get_boolean('show-gregorian'))
                sub.push(formatGregorian(date));
            if (this._settings.get_boolean('show-hijri'))
                sub.push(this._hijriText(date));
            if (sub.length)
                this._eventsBox.add_child(new St.Label({text: sub.join('  ·  '), style_class: 'jc-sub', x_align: this._align()}));
        }

        const list = this._filteredEvents(date);
        if (list.length === 0) {
            this._eventsBox.add_child(new St.Label({text: t.noEvents, style_class: 'jc-sub', x_align: this._align()}));
        }
        for (const e of list) {
            const label = wrapLabel(new St.Label({
                // RLE..PDF forces a right-to-left paragraph so the bullet sits
                // on the right and punctuation/Latin runs land in the right place.
                text: `${rtl ? '\u202B' : ''}• ${e.title}${e.holiday ? ` (${t.holiday})` : ''}${rtl ? '\u202C' : ''}`,
                style_class: e.holiday ? 'jc-event jc-red' : 'jc-event',
                x_expand: true,
            }), rtl);
            this._eventsBox.add_child(label);
        }

        let source;
        if (!this._settings.get_boolean('fetch-events'))
            source = t.sourceDisabled;
        else if (this._events.hasApiData(date))
            source = t.sourceOnline;
        else if (this._loading)
            source = t.sourceLoading;
        else
            source = t.sourceOffline;
        this._eventsBox.add_child(new St.Label({text: source, style_class: 'jc-source', x_align: this._align()}));
    }

    // ---------- converter ----------

    _buildConverter() {
        const t = this._t;
        const box = vbox({style_class: 'jc-converter', x_expand: true});

        this._modeBtn = new St.Button({style_class: 'jc-today-button', can_focus: true, x_align: this._align()});
        this._modeBtn.connect('clicked', () => {
            const current = this._readConverter();
            this._converterMode = this._converterMode === 'j2g' ? 'g2j' : 'j2g';
            // Carry the entered date over to the other calendar when it is valid.
            this._fillConverter(current ?? this._selected);
        });
        box.add_child(this._modeBtn);

        const mk = hint => {
            const e = new St.Entry({hint_text: hint, style_class: 'jc-entry', can_focus: true, x_expand: true});
            e.clutter_text.connect('text-changed', () => this._convert());
            return e;
        };
        this._yEntry = mk(t.year);
        this._mEntry = mk(t.month);
        this._dEntry = mk(t.day);
        box.add_child(this._row([this._yEntry, this._mEntry, this._dEntry], {style_class: 'jc-entry-row'}));

        this._convResult = new St.Button({style_class: 'jc-conv-result', can_focus: true, x_align: this._align()});
        this._convResult.connect('clicked', () => {
            const d = this._readConverter();
            if (d)
                this._select(d);
        });
        box.add_child(this._convResult);
        return box;
    }

    _fillConverter(date) {
        const t = this._t;
        this._modeBtn.label = this._converterMode === 'j2g' ? t.jalaliToGregorian : t.gregorianToJalali;
        if (this._converterMode === 'j2g') {
            const j = J.toJalali(date);
            this._yEntry.text = this._n(j.year);
            this._mEntry.text = this._n(j.month);
            this._dEntry.text = this._n(j.day);
        } else {
            this._yEntry.text = String(date.getFullYear());
            this._mEntry.text = String(date.getMonth() + 1);
            this._dEntry.text = String(date.getDate());
        }
        this._convert();
    }

    /** Returns the entered date as a JS Date, or null if invalid. */
    _readConverter() {
        const y = parseDigits(this._yEntry.text);
        const m = parseDigits(this._mEntry.text);
        const d = parseDigits(this._dEntry.text);
        if (![y, m, d].every(Number.isFinite) || m < 1 || m > 12 || d < 1)
            return null;
        if (this._converterMode === 'j2g') {
            if (y < 1 || y > 3000 || d > J.jalaliMonthLength(y, m))
                return null;
            return J.jalaliToDate(y, m, d);
        }
        if (y < 622 || y > 3600)
            return null;
        const date = new Date(y, m - 1, d);
        if (date.getMonth() !== m - 1)
            return null;
        date.setFullYear(y); // years < 100 would otherwise map to 19xx
        return date;
    }

    _convert() {
        if (!this._convResult)
            return;
        const date = this._readConverter();
        const result = this._convResult;
        if (!date) {
            result.label = this._t.invalidDate;
            result.add_style_class_name('jc-red');
            return;
        }
        result.remove_style_class_name('jc-red');
        if (this._converterMode === 'j2g')
            result.label = `${formatGregorian(date)}  ·  ${this._hijriText(date)}`;
        else
            result.label = `${this._jalaliText(date, true)}  ·  ${this._hijriText(date)}`;
    }

    // PanelMenu.Button connects 'destroy' to _onDestroy, so this also runs
    // when the panel itself tears the indicator down.
    _onDestroy() {
        this._destroyed = true;
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._clockId) {
            GLib.source_remove(this._clockId);
            this._clockId = 0;
        }
        this._ntpCancellable.cancel();
        if (this._ntpTimerId) {
            GLib.source_remove(this._ntpTimerId);
            this._ntpTimerId = 0;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        super._onDestroy();
    }
});

export default class JalaliCalendarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this.events = new EventStore();
        this.clockOffsetMs = 0; // local clock error measured by the last NTP sync
        this.ntp = {state: 'idle'};
        this.update = null; // {version, url} when GitHub has a newer release
        this._updates = new UpdateChecker();
        this._addIndicator();
        this._startUpdateChecks();
        this._posIds = ['changed::panel-position', 'changed::panel-index', 'changed::ntp-auto-sync'].map(sig =>
            this._settings.connect(sig, () => this._addIndicator()));
    }

    _startUpdateChecks() {
        this._checkUpdate();
        this._updateTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_CHECK_SECONDS, () => {
            this._checkUpdate();
            return GLib.SOURCE_CONTINUE;
        });
        this._updateSettingId = this._settings.connect('changed::check-updates', () => this._checkUpdate());
    }

    _checkUpdate() {
        if (!this._settings.get_boolean('check-updates')) {
            this.update = null;
            this._indicator?.refreshUpdate();
            return;
        }
        this._updates.latest().then(latest => {
            this.update = isNewer(latest.version, this.metadata['version-name']) ? latest : null;
        }).catch(e => {
            if (this._updates)
                console.debug(`[jalali-calendar] update check failed: ${e.message}`);
        }).finally(() => this._indicator?.refreshUpdate());
    }

    _addIndicator() {
        this._indicator?.destroy();
        this._indicator = new JalaliIndicator(this);
        const pos = this._settings.get_string('panel-position');
        const box = ['left', 'center', 'right'].includes(pos) ? pos : 'center';
        const index = Math.max(0, this._settings.get_int('panel-index'));
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);
    }

    disable() {
        if (this._updateTimerId) {
            GLib.source_remove(this._updateTimerId);
            this._updateTimerId = 0;
        }
        if (this._updateSettingId) {
            this._settings.disconnect(this._updateSettingId);
            this._updateSettingId = 0;
        }
        this._updates?.destroy();
        this._updates = null;
        for (const id of this._posIds ?? [])
            this._settings.disconnect(id);
        this._posIds = null;
        this._indicator?.destroy();
        this._indicator = null;
        this.events?.destroy();
        this.events = null;
        this._settings = null;
    }
}
