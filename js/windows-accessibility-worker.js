const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

// No network listener. Only the parent process can send requests over these pipes.
const BOOTSTRAP = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = $line | ConvertFrom-Json
        $script = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($request.script))
        $output = @(& ([ScriptBlock]::Create($script)))
        $response = @{ id = $request.id; stdout = [string]::Join([Environment]::NewLine, [string[]]$output) }
    } catch {
        $response = @{ id = $request.id; error = $_.Exception.Message }
    }
    [Console]::WriteLine(($response | ConvertTo-Json -Depth 6 -Compress))
}
`;

class WindowsAccessibilityWorker {
    constructor({ spawnProcess = spawn } = {}) {
        this.spawnProcess = spawnProcess;
        this.child = null;
        this.pending = new Map();
        this.reader = null;
        this.stderr = '';
    }

    _start() {
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const child = this.spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(BOOTSTRAP, 'utf16le').toString('base64')],
            { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        this.child = child;
        this.stderr = '';
        const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
        this.reader = reader;
        reader.on('line', line => {
            if (this.child !== child) return;
            try {
                if (line.length > 10 * 1024 * 1024) throw new Error('Accessibility helper response is too large');
                const message = JSON.parse(line);
                const pending = this.pending.get(message.id);
                if (!pending) throw new Error('Accessibility helper returned an unknown request ID');
                this.pending.delete(message.id);
                clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(`Accessibility helper: ${message.error}`));
                else if (typeof message.stdout !== 'string') pending.reject(new Error('Invalid accessibility helper response'));
                else pending.resolve({ stdout: message.stdout });
            } catch (error) {
                this._stop(error, child);
            }
        });
        child.stderr.on('data', data => { this.stderr = (this.stderr + String(data)).slice(-2000); });
        child.stdin.on('error', error => this._stop(error, child));
        child.on('error', error => this._stop(error, child));
        child.on('exit', (code, signal) => {
            reader.close();
            this._stop(new Error(`Accessibility helper exited ${code ?? signal}. Observe before retrying.`), child);
        });
    }

    run(script, { timeout = 15000 } = {}) {
        if (typeof script !== 'string' || !Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new Error('Invalid helper request'));
        if (!this.child) this._start();
        const child = this.child;
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._stop(new Error('Accessibility helper timed out. The outcome is unknown; observe before retrying.'), child);
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            child.stdin.write(JSON.stringify({ id, script: Buffer.from(script, 'utf16le').toString('base64') }) + '\n', error => {
                if (error) this._stop(error, child);
            });
        });
    }

    _stop(error, child = this.child) {
        if (this.child !== child) return;
        this.child = null;
        this.reader?.close();
        this.reader = null;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
        if (child && !child.killed) child.kill();
    }

    close() {
        this._stop(new Error('Accessibility helper closed'));
    }
}

module.exports = { WindowsAccessibilityWorker };
