// system-status.js - OS status and control helpers for the computer agent.
//
// Battery, brightness, Wi-Fi, Bluetooth, Do Not Disturb / Focus and process
// management. Each OS exposes these differently and many only through CLI
// tools, so every method returns `{ status: 'error', error }` with a clear
// reason instead of throwing when a machine cannot answer.
//
// Commands always run through execFile / an encoded PowerShell script with
// argument arrays. No value from the model is placed into a shell string.

const path = require('path');

const SUCCESS = 'success';

function ok(payload) {
    return { status: SUCCESS, ...payload };
}

function fail(error, extra = {}) {
    return { status: 'error', error, ...extra };
}

function toPowerShellLiteral(value) {
    // Single-quoted PowerShell strings only need ' doubled.
    return `'${String(value).replace(/'/g, "''")}'`;
}

// --- parsers (pure, exported for tests) -----------------------------------

function parseWindowsBattery(json) {
    if (!json || json === 'null') return null;
    const data = JSON.parse(json);
    if (!data) return null;
    const statusCode = Number(data.BatteryStatus);
    const charging = [6, 7, 8, 9].includes(statusCode);
    const onAc = statusCode !== 1;
    let state = 'discharging';
    if (statusCode === 3) state = 'full';
    else if (charging) state = 'charging';
    else if (onAc) state = 'plugged-in';
    const runtime = Number(data.EstimatedRunTime);
    return {
        percent: Number.isFinite(Number(data.EstimatedChargeRemaining)) ? Number(data.EstimatedChargeRemaining) : null,
        state,
        // 71582788 is WMI's "unknown / on AC" sentinel.
        minutes_remaining: Number.isFinite(runtime) && runtime > 0 && runtime < 71582788 ? runtime : null,
    };
}

function parseMacBattery(stdout) {
    const match = /(\d+)%;\s*([^;\n]+);?\s*([^\n]*)/.exec(String(stdout || ''));
    if (!match) return null;
    const rawState = match[2].trim().toLowerCase();
    const remaining = /(\d+):(\d+)\s+remaining/.exec(match[3]);
    let state = rawState;
    if (rawState.startsWith('charging')) state = 'charging';
    else if (rawState === 'charged' || rawState === 'finishing charge') state = 'full';
    else if (rawState === 'ac attached') state = 'plugged-in';
    return {
        percent: Number(match[1]),
        state,
        minutes_remaining: remaining ? Number(remaining[1]) * 60 + Number(remaining[2]) : null,
    };
}

function parseBrightnessctl(stdout) {
    // "intel_backlight,backlight,12000,50%,24000"
    const line = String(stdout || '').trim().split(/\r?\n/)[0] || '';
    const parts = line.split(',');
    if (parts.length < 5) return null;
    const percent = Number.parseInt(parts[3], 10);
    return Number.isFinite(percent) ? { device: parts[0], percent } : null;
}

function parseNetshWlan(stdout) {
    const fields = {};
    for (const line of String(stdout || '').split(/\r?\n/)) {
        const match = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
        if (match && !(match[1] in fields)) fields[match[1].trim().toLowerCase()] = match[2].trim();
    }
    if (!Object.keys(fields).length) return null;
    const signal = Number.parseInt(fields.signal, 10);
    return {
        state: fields.state || null,
        connected: fields.state ? fields.state.toLowerCase() === 'connected' : null,
        ssid: fields.ssid || null,
        signal_percent: Number.isFinite(signal) ? signal : null,
        radio: fields['radio type'] || null,
    };
}

/** nmcli -t escapes ':' and '\' with a backslash. */
function splitNmcliLine(line) {
    const fields = [];
    let current = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '\\' && i + 1 < line.length) {
            current += line[++i];
        } else if (char === ':') {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
}

function parseNmcliWifi(stdout) {
    for (const line of String(stdout || '').split(/\r?\n/)) {
        if (!line) continue;
        const [active, ssid, signal] = splitNmcliLine(line);
        if (active === 'yes') {
            const value = Number.parseInt(signal, 10);
            return { connected: true, ssid: ssid || null, signal_percent: Number.isFinite(value) ? value : null };
        }
    }
    return { connected: false, ssid: null, signal_percent: null };
}

function parsePsOutput(stdout) {
    const processes = [];
    for (const line of String(stdout || '').split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
        if (!match) continue;
        const command = match[4].trim();
        processes.push({
            pid: Number(match[1]),
            name: path.posix.basename(command),
            cpu_percent: Number(match[2]),
            memory_mb: Math.round((Number(match[3]) / 1024) * 10) / 10,
        });
    }
    return processes;
}

function parseBluetoothctlShow(stdout) {
    const text = String(stdout || '');
    if (!text.trim() || /no default controller/i.test(text)) return { available: false, powered: null };
    const powered = /Powered:\s*(yes|no)/i.exec(text);
    return { available: true, powered: powered ? powered[1].toLowerCase() === 'yes' : null };
}

// --- service ----------------------------------------------------------------

class SystemStatus {
    constructor({ platform, execFile, runPowerShell, fsPromises, powerMonitor, net, homeDir, ownPid = process.pid, parentPid = process.ppid }) {
        this.platform = platform;
        this.execFile = execFile;
        this.runPowerShell = runPowerShell;
        this.fs = fsPromises;
        this.powerMonitor = powerMonitor;
        this.net = net;
        this.homeDir = homeDir;
        this.ownPid = ownPid;
        this.parentPid = parentPid;
    }

    async _run(command, args, timeout = 10000) {
        const { stdout } = await this.execFile(command, args, { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
        return String(stdout || '');
    }

    _onBattery() {
        try {
            return typeof this.powerMonitor?.isOnBatteryPower === 'function' ? this.powerMonitor.isOnBatteryPower() : null;
        } catch {
            return null;
        }
    }

    // --- battery ---

    async getBatteryStatus() {
        const on_battery_power = this._onBattery();
        try {
            let battery = null;
            if (this.platform === 'win32') {
                const { stdout } = await this.runPowerShell(
                    '$b = Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime; if ($b) { $b | ConvertTo-Json -Compress } else { "null" }'
                );
                battery = parseWindowsBattery(String(stdout).trim());
            } else if (this.platform === 'darwin') {
                battery = parseMacBattery(await this._run('pmset', ['-g', 'batt']));
            } else {
                battery = await this._readLinuxBattery();
            }
            if (!battery) return ok({ has_battery: false, on_battery_power });
            return ok({ has_battery: true, on_battery_power, ...battery });
        } catch (error) {
            return fail(`Could not read battery status: ${error.message}`, { on_battery_power });
        }
    }

    async _readLinuxBattery() {
        const root = '/sys/class/power_supply';
        let entries = [];
        try {
            entries = await this.fs.readdir(root);
        } catch {
            return null;
        }
        for (const entry of entries) {
            const dir = path.posix.join(root, entry);
            const type = await this.fs.readFile(path.posix.join(dir, 'type'), 'utf8').catch(() => '');
            if (type.trim() !== 'Battery') continue;
            const capacity = await this.fs.readFile(path.posix.join(dir, 'capacity'), 'utf8').catch(() => '');
            const status = await this.fs.readFile(path.posix.join(dir, 'status'), 'utf8').catch(() => '');
            const percent = Number.parseInt(capacity, 10);
            const raw = status.trim().toLowerCase();
            return {
                percent: Number.isFinite(percent) ? percent : null,
                state: raw === 'not charging' ? 'plugged-in' : (raw || null),
                minutes_remaining: null,
            };
        }
        return null;
    }

    // --- brightness ---

    async getBrightness() {
        try {
            if (this.platform === 'win32') {
                const { stdout } = await this.runPowerShell(
                    '(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness'
                );
                const percent = Number.parseInt(String(stdout).trim(), 10);
                if (!Number.isFinite(percent)) return fail('This display does not report brightness (external monitors usually do not).');
                return ok({ percent });
            }
            if (this.platform === 'darwin') {
                const stdout = await this._run('brightness', ['-l']);
                const match = /brightness\s+([\d.]+)/.exec(stdout);
                if (!match) return fail('Could not read display brightness.');
                return ok({ percent: Math.round(Number(match[1]) * 100) });
            }
            const parsed = parseBrightnessctl(await this._run('brightnessctl', ['-m']));
            if (!parsed) return fail('Could not read display brightness.');
            return ok(parsed);
        } catch (error) {
            return fail(this._brightnessError(error));
        }
    }

    async setBrightness(level) {
        const percent = Math.round(Number(level));
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
            return fail('Brightness must be a number from 0 to 100.');
        }
        try {
            if (this.platform === 'win32') {
                await this.runPowerShell(
                    `$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]${percent} } | Out-Null`
                );
            } else if (this.platform === 'darwin') {
                await this._run('brightness', [(percent / 100).toFixed(2)]);
            } else {
                await this._run('brightnessctl', ['set', `${percent}%`]);
            }
            return ok({ percent, message: `Brightness set to ${percent}%` });
        } catch (error) {
            return fail(this._brightnessError(error));
        }
    }

    _brightnessError(error) {
        if (error.code === 'ENOENT') {
            return this.platform === 'darwin'
                ? 'Brightness control on macOS needs the "brightness" tool (brew install brightness).'
                : 'Brightness control on Linux needs brightnessctl (for example: sudo apt install brightnessctl).';
        }
        if (this.platform === 'win32') {
            return 'This display does not support brightness control from Windows (external monitors usually do not).';
        }
        return `Brightness control failed: ${error.message}`;
    }

    // --- network ---

    async getNetworkStatus() {
        let online = null;
        try {
            online = typeof this.net?.isOnline === 'function' ? this.net.isOnline() : null;
        } catch {
            online = null;
        }
        try {
            if (this.platform === 'win32') {
                const wifi = parseNetshWlan(await this._run('netsh', ['wlan', 'show', 'interfaces']));
                return ok({ online, wifi: wifi || { connected: false, ssid: null, signal_percent: null } });
            }
            if (this.platform === 'darwin') {
                return ok({ online, wifi: await this._readMacWifi() });
            }
            const radio = (await this._run('nmcli', ['-t', '-f', 'WIFI', 'radio'])).trim();
            const wifi = parseNmcliWifi(await this._run('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'dev', 'wifi']));
            return ok({ online, wifi: { radio_enabled: radio === 'enabled', ...wifi } });
        } catch (error) {
            const hint = error.code === 'ENOENT' && this.platform === 'linux'
                ? ' Wi-Fi details on Linux need NetworkManager (nmcli).'
                : '';
            return ok({ online, wifi: null, wifi_error: `${error.message}.${hint}`.trim() });
        }
    }

    async _readMacWifi() {
        const ports = await this._run('networksetup', ['-listallhardwareports']);
        const match = /Hardware Port:\s*(Wi-Fi|AirPort)\s*\nDevice:\s*(\S+)/.exec(ports);
        if (!match) return { available: false };
        const device = match[2];
        const power = await this._run('networksetup', ['-getairportpower', device]);
        const network = await this._run('networksetup', ['-getairportnetwork', device]);
        const ssid = /Current Wi-Fi Network:\s*(.+)/.exec(network);
        return {
            available: true,
            device,
            radio_enabled: /:\s*On\b/i.test(power),
            connected: Boolean(ssid),
            // macOS 14.4+ hides the network name from apps without Location access.
            ssid: ssid ? ssid[1].trim() : null,
        };
    }

    // --- bluetooth ---

    async getBluetoothStatus() {
        try {
            if (this.platform === 'win32') {
                const { stdout } = await this.runPowerShell(
                    '$d = @(Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue | Select-Object FriendlyName, Status); $d | ConvertTo-Json -Compress'
                );
                const text = String(stdout).trim();
                const parsed = text ? JSON.parse(text) : [];
                const devices = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean)
                    .map((device) => ({ name: device.FriendlyName, status: device.Status }));
                return ok({
                    available: devices.length > 0,
                    // Windows only reports whether each Bluetooth device works,
                    // not the radio switch itself.
                    working: devices.some((device) => device.status === 'OK'),
                    devices,
                });
            }
            if (this.platform === 'darwin') {
                const data = JSON.parse(await this._run('system_profiler', ['SPBluetoothDataType', '-json'], 20000));
                const info = (data.SPBluetoothDataType || [])[0] || {};
                const controller = info.controller_properties || {};
                const connected = (info.device_connected || []).map((entry) => Object.keys(entry)[0]);
                return ok({
                    available: Object.keys(controller).length > 0,
                    powered: controller.controller_state ? controller.controller_state === 'attrib_on' : null,
                    connected_devices: connected,
                });
            }
            const show = parseBluetoothctlShow(await this._run('bluetoothctl', ['show']));
            let connected = [];
            if (show.available) {
                const devices = await this._run('bluetoothctl', ['devices', 'Connected']).catch(() => '');
                connected = devices.split(/\r?\n/)
                    .map((line) => /^Device\s+\S+\s+(.+)$/.exec(line.trim()))
                    .filter(Boolean)
                    .map((match) => match[1]);
            }
            return ok({ ...show, connected_devices: connected });
        } catch (error) {
            const hint = error.code === 'ENOENT' && this.platform === 'linux' ? ' Bluetooth status on Linux needs bluetoothctl (BlueZ).' : '';
            return fail(`Could not read Bluetooth status: ${error.message}.${hint}`);
        }
    }

    // --- do not disturb / focus ---

    async getFocusStatus() {
        try {
            if (this.platform === 'win32') {
                let value = null;
                try {
                    const stdout = await this._run('reg', [
                        'query',
                        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings',
                        '/v', 'NOC_GLOBAL_SETTING_TOASTS_ENABLED',
                    ]);
                    const match = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout);
                    value = match ? Number.parseInt(match[1], 16) : null;
                } catch {
                    value = null; // value absent: notifications on
                }
                return ok({ do_not_disturb: value === 0, source: 'Windows notification settings' });
            }
            if (this.platform === 'darwin') {
                const file = path.posix.join(this.homeDir, 'Library', 'DoNotDisturb', 'DB', 'Assertions.json');
                try {
                    const data = JSON.parse(await this.fs.readFile(file, 'utf8'));
                    const records = ((data.data || [])[0] || {}).storeAssertionRecords || [];
                    return ok({ do_not_disturb: records.length > 0, source: 'macOS Focus' });
                } catch (error) {
                    return ok({
                        do_not_disturb: null,
                        source: 'macOS Focus',
                        note: error.code === 'EPERM' || error.code === 'EACCES'
                            ? 'macOS only shares Focus state with apps that have Full Disk Access.'
                            : 'Focus state is not available on this macOS version.',
                    });
                }
            }
            try {
                const value = (await this._run('gsettings', ['get', 'org.gnome.desktop.notifications', 'show-banners'])).trim();
                return ok({ do_not_disturb: value === 'false', source: 'GNOME notifications' });
            } catch {
                return ok({ do_not_disturb: null, source: null, note: 'Do Not Disturb state is only readable on GNOME desktops.' });
            }
        } catch (error) {
            return fail(`Could not read Do Not Disturb state: ${error.message}`);
        }
    }

    // --- processes ---

    async listProcesses({ name, limit = 25 } = {}) {
        const max = Math.min(Math.max(Math.round(Number(limit)) || 25, 1), 200);
        const filter = typeof name === 'string' ? name.trim() : '';
        try {
            let processes;
            if (this.platform === 'win32') {
                const source = filter
                    ? `Get-Process -Name ${toPowerShellLiteral(`*${filter.replace(/[*?[\]]/g, '')}*`)} -ErrorAction SilentlyContinue`
                    : 'Get-Process';
                const { stdout } = await this.runPowerShell(
                    `@(${source} | Sort-Object WorkingSet64 -Descending | Select-Object -First ${max} `
                    + "Id, ProcessName, @{n='MemoryMB';e={[math]::Round($_.WorkingSet64 / 1MB, 1)}}, "
                    + "@{n='CpuSeconds';e={[math]::Round($_.CPU, 1)}}, MainWindowTitle) | ConvertTo-Json -Compress"
                );
                const text = String(stdout).trim();
                const parsed = text ? JSON.parse(text) : [];
                processes = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map((entry) => ({
                    pid: entry.Id,
                    name: entry.ProcessName,
                    memory_mb: entry.MemoryMB,
                    cpu_seconds: entry.CpuSeconds,
                    window_title: entry.MainWindowTitle || null,
                }));
            } else {
                processes = parsePsOutput(await this._run('ps', ['-axo', 'pid=,pcpu=,rss=,comm=']))
                    .filter((entry) => !filter || entry.name.toLowerCase().includes(filter.toLowerCase()))
                    .sort((a, b) => b.memory_mb - a.memory_mb)
                    .slice(0, max);
            }
            return ok({ processes, count: processes.length, sorted_by: 'memory' });
        } catch (error) {
            return fail(`Could not list processes: ${error.message}`);
        }
    }

    _protectedPid(pid) {
        if (pid === this.ownPid || pid === this.parentPid) return 'Refusing to stop Aetheria ai itself.';
        if (pid <= 4) return 'Refusing to stop a core operating system process.';
        return null;
    }

    /**
     * Stops a process. Without `force` it asks politely (WM_CLOSE on
     * Windows, SIGTERM elsewhere) so the app can save its work.
     */
    async killProcess({ pid, force = false } = {}) {
        const target = Number(pid);
        if (!Number.isSafeInteger(target) || target <= 0) return fail('A valid process ID is required.');
        const blocked = this._protectedPid(target);
        if (blocked) return fail(blocked);
        try {
            if (this.platform === 'win32') {
                await this._run('taskkill', force ? ['/PID', String(target), '/T', '/F'] : ['/PID', String(target)]);
            } else {
                process.kill(target, force ? 'SIGKILL' : 'SIGTERM');
            }
            return ok({ pid: target, forced: Boolean(force), message: `${force ? 'Killed' : 'Asked to close'} process ${target}` });
        } catch (error) {
            if (error.code === 'ESRCH') return fail(`No process with ID ${target}.`);
            if (error.code === 'EPERM') return fail(`Not allowed to stop process ${target}.`);
            return fail(`Could not stop process ${target}: ${String(error.stderr || error.message).trim()}`);
        }
    }
}

module.exports = {
    SystemStatus,
    parseWindowsBattery,
    parseMacBattery,
    parseBrightnessctl,
    parseNetshWlan,
    splitNmcliLine,
    parseNmcliWifi,
    parsePsOutput,
    parseBluetoothctlShow,
};
