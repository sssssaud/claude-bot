import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockParser } from './screenlock.js';

test('lockParser reads lock/unlock from real dbus-monitor output and ignores everything else', () => {
  // captured from dbus-monitor on this laptop (2026-11-25), plus a lock and an unlock
  const out = [
    'signal time=1795588455.760564 sender=org.freedesktop.DBus -> destination=:1.129 serial=4294967295 path=/org/freedesktop/DBus; interface=org.freedesktop.DBus; member=NameAcquired',
    '   string ":1.129"',
    'signal time=1795588456.265472 sender=:1.130 -> destination=(null destination) serial=2 path=/ScreenSaver; interface=org.freedesktop.ScreenSaver; member=ActiveChanged',
    '   boolean true',
    'signal time=1795588457.1 sender=:1.9 -> destination=(null destination) serial=3 path=/org/kde/Other; interface=org.kde.Other; member=Changed',
    '   boolean false', // someone else's boolean: not a lock change
    'signal time=1795588460.2 sender=:1.130 -> destination=(null destination) serial=4 path=/ScreenSaver; interface=org.freedesktop.ScreenSaver; member=ActiveChanged',
    '   boolean false',
  ];
  const parse = lockParser();
  assert.deepEqual(out.map(parse).filter(v => v !== null), [true, false]);
});
