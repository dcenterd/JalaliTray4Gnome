// Checks the GitHub releases of JalaliTray4Gnome for a newer version. Only the
// version number and release page are read; nothing is downloaded or installed.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const LATEST_URL = 'https://api.github.com/repos/dcenterd/JalaliTray4Gnome/releases/latest';

const parts = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);

/** True when version `a` is newer than version `b` (e.g. "1.2.0" vs "1.1.1"). */
export function isNewer(a, b) {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0)
            return d > 0;
    }
    return false;
}

export class UpdateChecker {
    constructor() {
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 15, user_agent: 'jalali-calendar-gnome'});
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._session = null;
    }

    /** Resolves to {version, url} of the latest release; rejects on any failure. */
    latest() {
        return new Promise((resolve, reject) => {
            if (!this._session) {
                reject(new Error('checker destroyed'));
                return;
            }
            const msg = Soup.Message.new('GET', LATEST_URL);
            msg.get_request_headers().append('Accept', 'application/vnd.github+json');
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable,
                (session, res) => {
                    try {
                        const bytes = session.send_and_read_finish(res);
                        if (msg.get_status() !== Soup.Status.OK)
                            throw new Error(`HTTP ${msg.get_status()}`);
                        const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        if (typeof json?.tag_name !== 'string' || typeof json?.html_url !== 'string')
                            throw new Error('unexpected response');
                        resolve({version: json.tag_name.replace(/^v/i, ''), url: json.html_url});
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }
}
