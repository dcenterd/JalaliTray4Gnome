// Minimal SNTP (RFC 4330) client. Works with any NTP server reachable by
// host name or IP address (IPv4 or IPv6), e.g. pool.ntp.org or time.google.com.
// It only measures the offset between this computer's clock and the server;
// it never changes the system clock.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

Gio._promisify(Gio.Resolver.prototype, 'lookup_by_name_async', 'lookup_by_name_finish');
Gio._promisify(Gio.SocketClient.prototype, 'connect_async', 'connect_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

const NTP_PORT = 123;
const NTP_UNIX_DELTA = 2208988800; // seconds between 1900-01-01 and 1970-01-01
const TIMEOUT_SECONDS = 4;
const MAX_ADDRESSES = 4;

/** Splits "host", "host:port" and "[v6]:port" into its parts. */
function parseServer(server) {
    const s = server.trim();
    const bracket = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (bracket)
        return {host: bracket[1], port: bracket[2] ? parseInt(bracket[2], 10) : NTP_PORT};
    const single = s.match(/^([^:]+):(\d+)$/);
    if (single)
        return {host: single[1], port: parseInt(single[2], 10)};
    return {host: s, port: NTP_PORT};
}

function writeTimestamp(view, offset, micros) {
    const secs = Math.floor(micros / 1e6) + NTP_UNIX_DELTA;
    const frac = Math.floor((micros % 1e6) * 4294.967296);
    view.setUint32(offset, secs >>> 0);
    view.setUint32(offset + 4, frac >>> 0);
}

/** Reads an NTP timestamp as Unix microseconds. Assumes era 1 after 2036. */
function readTimestamp(view, offset) {
    let secs = view.getUint32(offset);
    const frac = view.getUint32(offset + 4);
    if (secs === 0 && frac === 0)
        return 0;
    if (secs < 0x80000000)
        secs += 0x100000000;
    return (secs - NTP_UNIX_DELTA) * 1e6 + Math.round(frac / 4294.967296);
}

async function query(address, port, cancellable) {
    const client = new Gio.SocketClient({
        type: Gio.SocketType.DATAGRAM,
        protocol: Gio.SocketProtocol.UDP,
        enable_proxy: false,
    });
    const connection = await client.connect_async(
        new Gio.InetSocketAddress({address, port}), cancellable);
    try {
        const request = new Uint8Array(48);
        const view = new DataView(request.buffer);
        request[0] = (4 << 3) | 3; // no leap warning, version 4, client mode
        const t1 = GLib.get_real_time();
        writeTimestamp(view, 40, t1);

        await connection.get_output_stream().write_bytes_async(
            new GLib.Bytes(request), GLib.PRIORITY_DEFAULT, cancellable);
        const bytes = await connection.get_input_stream().read_bytes_async(
            128, GLib.PRIORITY_DEFAULT, cancellable);
        const t4 = GLib.get_real_time();

        const reply = bytes.get_data();
        if (!reply || reply.length < 48)
            throw new Error('Short reply from NTP server');
        const rv = new DataView(reply.buffer, reply.byteOffset, reply.byteLength);

        const leap = reply[0] >> 6;
        const mode = reply[0] & 7;
        const stratum = reply[1];
        if (mode !== 4 && mode !== 5)
            throw new Error('Not an NTP server reply');
        if (leap === 3 || stratum === 0 || stratum > 15)
            throw new Error('NTP server is not synchronized');
        // The server must echo our transmit time, or the reply is not for us.
        if (rv.getUint32(24) !== view.getUint32(40) || rv.getUint32(28) !== view.getUint32(44))
            throw new Error('Unexpected NTP reply');

        const t2 = readTimestamp(rv, 32);
        const t3 = readTimestamp(rv, 40);
        if (!t2 || !t3)
            throw new Error('NTP reply has no timestamp');

        return {
            // Positive when the local clock is behind the server.
            offsetMs: ((t2 - t1) + (t3 - t4)) / 2000,
            delayMs: ((t4 - t1) - (t3 - t2)) / 1000,
            stratum,
        };
    } finally {
        connection.close(null);
    }
}

/** Runs `fn(cancellable)` and cancels it after the timeout or when `parent` is cancelled. */
async function withTimeout(parent, fn) {
    const cancellable = new Gio.Cancellable();
    const parentId = parent?.connect(() => cancellable.cancel());
    let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TIMEOUT_SECONDS, () => {
        timeoutId = 0;
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });
    try {
        return await fn(cancellable);
    } catch (e) {
        if (cancellable.is_cancelled() && !parent?.is_cancelled())
            throw new Error('NTP server timed out');
        throw e;
    } finally {
        if (timeoutId)
            GLib.source_remove(timeoutId);
        if (parentId)
            parent.disconnect(parentId);
    }
}

/**
 * Measures the clock offset against an NTP server.
 * Resolves to {offsetMs, delayMs, stratum, address}; rejects on failure.
 */
export async function queryNtp(server, parentCancellable = null) {
    const {host, port} = parseServer(server);
    if (!host || !(port > 0 && port < 65536))
        throw new Error('Invalid NTP server');

    const addresses = await withTimeout(parentCancellable, c =>
        Gio.Resolver.get_default().lookup_by_name_async(host, c));
    let lastError = new Error(`No address for ${host}`);
    for (const address of addresses.slice(0, MAX_ADDRESSES)) {
        try {
            const result = await withTimeout(parentCancellable, c => query(address, port, c));
            return {...result, address: address.to_string()};
        } catch (e) {
            if (parentCancellable?.is_cancelled())
                throw e;
            lastError = e;
        }
    }
    throw lastError;
}
