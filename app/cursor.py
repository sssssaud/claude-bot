#!/usr/bin/env python3
"""Where is the mouse cursor? Asked by app/main.js when an octo needs to come to the user.

Under Wayland an X11 window (our overlay) can't see the cursor over other apps, and KWin has no D-Bus
call that returns it. A KWin script can read `workspace.cursorPos`, so for each question this helper
loads a one-line script that reports it back to us over D-Bus, then unloads it. On demand only:
no continuous cursor tracking.

Protocol: one line "?" on stdin -> one line "x y" (screen pixels) or "none" on stdout.
Needs the system's dbus-python and PyGObject (both installed on Nobara KDE); run with system python3.
"""
import os
import sys
import tempfile

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

BUS_NAME = "org.claudebot.Cursor"
PLUGIN = "claudebot-cursor"
TIMEOUT_MS = 800
SCRIPT = f'callDBus("{BUS_NAME}", "/Cursor", "{BUS_NAME}", "Report", workspace.cursorPos.x, workspace.cursorPos.y);'


class Receiver(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, "/Cursor")
        self.answer = None
        self.loop = None

    @dbus.service.method(BUS_NAME, in_signature="ii")
    def Report(self, x, y):
        self.answer = (int(x), int(y))
        if self.loop:
            self.loop.quit()


def ask(bus, receiver, script_path) -> str:
    scripting = dbus.Interface(bus.get_object("org.kde.KWin", "/Scripting"), "org.kde.kwin.Scripting")
    receiver.answer = None
    try:
        if scripting.isScriptLoaded(PLUGIN):  # left over from an earlier crash
            scripting.unloadScript(PLUGIN)
        sid = int(scripting.loadScript(script_path, PLUGIN, signature="ss"))  # KWin has a 1-arg overload too
        if sid < 0:
            print("cursor.py: KWin refused the script", file=sys.stderr)
            return "none"
        bus.get_object("org.kde.KWin", f"/Scripting/Script{sid}").run(dbus_interface="org.kde.kwin.Script")
        receiver.loop = GLib.MainLoop()
        GLib.timeout_add(TIMEOUT_MS, receiver.loop.quit)
        receiver.loop.run()  # until Report() arrives or the timeout
    except dbus.DBusException as e:
        print(f"cursor.py: {e.get_dbus_name()}: {e.get_dbus_message()}", file=sys.stderr)
        return "none"
    finally:
        try:
            scripting.unloadScript(PLUGIN)
        except dbus.DBusException:
            pass
    return f"{receiver.answer[0]} {receiver.answer[1]}" if receiver.answer else "none"


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    try:
        name = dbus.service.BusName(BUS_NAME, bus, do_not_queue=True)  # keep a reference: owning the name
    except dbus.exceptions.NameExistsException:
        sys.exit("cursor.py: another copy is already running")
    receiver = Receiver(bus)
    fd, path = tempfile.mkstemp(prefix="claudebot-cursor-", suffix=".js")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(SCRIPT)
        for line in sys.stdin:  # ends when the app exits and closes the pipe
            if line.strip() == "?":
                print(ask(bus, receiver, path), flush=True)
    finally:
        os.unlink(path)
        del name


if __name__ == "__main__":
    main()
