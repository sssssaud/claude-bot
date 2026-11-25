#!/usr/bin/env python3
"""Questions only KWin can answer, asked by app/main.js: where is the mouse cursor (an octo comes to
the user), and where is a session's terminal window (its octo looks at it).

Under Wayland an X11 window (our overlay) can't see the cursor or other apps' windows, and KWin has no
D-Bus call that returns them. A KWin script can, so for each question this helper loads a tiny script
that reports back to us over D-Bus, then unloads it. On demand only: nothing is tracked continuously.

Protocol, one line in -> one line out:
  "?"                 -> "x y" (cursor, screen pixels) or "none"
  "win <pid> <pid>..." -> {"x","y","w","h","min"} JSON of the first normal window owned by the first of
                         those pids that has one (the session's terminal), or "none"
Needs the system's dbus-python and PyGObject (both installed on Nobara KDE); run with system python3.
"""
import json
import os
import re
import sys
import tempfile

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

BUS_NAME = "org.claudebot.Cursor"
PLUGIN = "claudebot-query"
TIMEOUT_MS = 800
CURSOR_JS = f'callDBus("{BUS_NAME}", "/Cursor", "{BUS_NAME}", "Report", workspace.cursorPos.x, workspace.cursorPos.y);'
WINDOW_JS = """const pids = %s;
let best = null, rank = pids.length;
for (const w of workspace.windowList()) {
  const i = pids.indexOf(w.pid);
  if (i >= 0 && i < rank && w.normalWindow) { best = w; rank = i; }
}
const g = best && best.frameGeometry;
callDBus("%s", "/Cursor", "%s", "Text", best ? JSON.stringify({x: Math.round(g.x), y: Math.round(g.y),
  w: Math.round(g.width), h: Math.round(g.height), min: best.minimized,
  active: best === workspace.activeWindow}) : "none");"""
PIDS = re.compile(r"^win((?: \d{1,7}){1,8})$")


class Receiver(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, "/Cursor")
        self.answer = None
        self.loop = None

    @dbus.service.method(BUS_NAME, in_signature="ii")
    def Report(self, x, y):
        self.answer = f"{int(x)} {int(y)}"
        if self.loop:
            self.loop.quit()

    @dbus.service.method(BUS_NAME, in_signature="s")
    def Text(self, text):  # window answers come as JSON text (KWin geometry is in doubles)
        self.answer = str(text)[:200]
        if self.loop:
            self.loop.quit()


def ask(bus, receiver, script_path, script) -> str:
    scripting = dbus.Interface(bus.get_object("org.kde.KWin", "/Scripting"), "org.kde.kwin.Scripting")
    receiver.answer = None
    with open(script_path, "w") as f:  # KWin reads the file when it loads the script
        f.write(script)
    try:
        if scripting.isScriptLoaded(PLUGIN):  # left over from an earlier crash
            scripting.unloadScript(PLUGIN)
        sid = int(scripting.loadScript(script_path, PLUGIN, signature="ss"))  # KWin has a 1-arg overload too
        if sid < 0:
            print("kwin.py: KWin refused the script", file=sys.stderr)
            return "none"
        bus.get_object("org.kde.KWin", f"/Scripting/Script{sid}").run(dbus_interface="org.kde.kwin.Script")
        receiver.loop = GLib.MainLoop()
        GLib.timeout_add(TIMEOUT_MS, receiver.loop.quit)
        receiver.loop.run()  # until Report() arrives or the timeout
    except dbus.DBusException as e:
        print(f"kwin.py: {e.get_dbus_name()}: {e.get_dbus_message()}", file=sys.stderr)
        return "none"
    finally:
        try:
            scripting.unloadScript(PLUGIN)
        except dbus.DBusException:
            pass
    return receiver.answer or "none"


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    try:
        name = dbus.service.BusName(BUS_NAME, bus, do_not_queue=True)  # keep a reference: owning the name
    except dbus.exceptions.NameExistsException:
        sys.exit("kwin.py: another copy is already running")
    receiver = Receiver(bus)
    fd, path = tempfile.mkstemp(prefix="claudebot-query-", suffix=".js")
    os.close(fd)
    try:
        for line in sys.stdin:  # ends when the app exits and closes the pipe
            line = line.strip()
            m = PIDS.match(line)
            if line == "?":
                print(ask(bus, receiver, path, CURSOR_JS), flush=True)
            elif m:
                pids = [int(p) for p in m.group(1).split()]
                answer = ask(bus, receiver, path, WINDOW_JS % (json.dumps(pids), BUS_NAME, BUS_NAME))
                print(answer if answer == "none" or answer.startswith("{") else "none", flush=True)
            else:
                print("none", flush=True)  # one answer per line, always: the app matches them in order
    finally:
        os.unlink(path)
        del name


if __name__ == "__main__":
    main()
