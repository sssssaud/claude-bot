// Screen lock (spec 3.3): KDE announces lock/unlock on the session bus as
// org.freedesktop.ScreenSaver.ActiveChanged(bool). dbus-monitor (part of dbus itself, nothing to install)
// prints each signal as a header line, then its arguments, and flushes per message, even into a pipe.
import { spawn } from 'node:child_process';

const RULE = "type='signal',interface='org.freedesktop.ScreenSaver',member='ActiveChanged'";

// Feed it dbus-monitor's lines in order: true/false when a lock change arrives, otherwise null.
// (dbus-monitor's own NameAcquired/NameLost lines at startup carry strings, so they never match.)
export function lockParser() {
  let inSignal = false;
  return line => {
    if (line.startsWith('signal ')) {
      inSignal = line.includes('member=ActiveChanged');
      return null;
    }
    const m = inSignal && /^\s*boolean (true|false)\s*$/.exec(line);
    if (!m) return null;
    inSignal = false;
    return m[1] === 'true';
  };
}

// Calls onChange(locked) on every announcement (KDE may send the same one twice: callers compare).
// If the watcher can't start or dies, onChange(false) once: octos stay visible rather than lost.
export function watchLock(onChange) {
  const mon = spawn('dbus-monitor', ['--session', RULE], { stdio: ['ignore', 'pipe', 'inherit'] });
  const parse = lockParser();
  let buf = '';
  mon.stdout.on('data', chunk => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const locked = parse(line);
      if (locked !== null) onChange(locked);
    }
  });
  mon.on('error', err => console.error('screen-lock watch unavailable:', err.message));
  mon.on('close', () => onChange(false));
  return mon;
}
