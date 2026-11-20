#!/usr/bin/env python3
"""Set the X11 *input* shape of the overlay window, so clicks outside the octo fall through to
whatever is below. Electron can only set the bounding shape (setShape); this is the same
mechanism Electron's own setIgnoreMouseEvents uses on X11. stdlib ctypes only.

usage: xinput_shape.py <window id>   then one line per update on stdin with 0+ rectangles,
       "x y width height [x y width height ...]" (an empty line = fully click-through)
"""
import ctypes
import ctypes.util
import sys

SHAPE_SET, SHAPE_INPUT, UNSORTED = 0, 2, 0


class Rect(ctypes.Structure):
    _fields_ = [('x', ctypes.c_short), ('y', ctypes.c_short), ('width', ctypes.c_ushort), ('height', ctypes.c_ushort)]


def main():
    win = int(sys.argv[1], 0)
    x11 = ctypes.cdll.LoadLibrary(ctypes.util.find_library('X11'))
    xext = ctypes.cdll.LoadLibrary(ctypes.util.find_library('Xext'))
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XFlush.argtypes = [ctypes.c_void_p]
    xext.XShapeCombineRectangles.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                             ctypes.POINTER(Rect), ctypes.c_int, ctypes.c_int, ctypes.c_int]
    display = x11.XOpenDisplay(None)
    if not display:
        sys.exit('xinput_shape: cannot open the X display')
    for line in sys.stdin:  # ends when Electron exits and the pipe closes
        try:
            nums = [int(v) for v in line.split()]
            if len(nums) % 4:
                raise ValueError
            rects = (Rect * (len(nums) // 4))(*(Rect(*nums[i:i + 4]) for i in range(0, len(nums), 4)))
        except ValueError:
            continue  # malformed line: keep the last good region
        xext.XShapeCombineRectangles(display, win, SHAPE_INPUT, 0, 0, rects, len(rects), SHAPE_SET, UNSORTED)
        x11.XFlush(display)


if __name__ == '__main__':
    main()
