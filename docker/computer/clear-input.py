#!/usr/bin/env python3
"""Release all pressed X11 keys and pointer buttons after the RFB peer exits."""
import ctypes
import sys

x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
display_type = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = display_type
x11.XQueryKeymap.argtypes = [display_type, ctypes.POINTER(ctypes.c_ubyte)]
x11.XQueryKeymap.restype = ctypes.c_int
x11.XSync.argtypes = [display_type, ctypes.c_int]
x11.XCloseDisplay.argtypes = [display_type]
xtst.XTestFakeKeyEvent.argtypes = [display_type, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [display_type, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

display = x11.XOpenDisplay(None)
if not display:
    sys.exit("Unable to open the private X display")
try:
    keys = (ctypes.c_ubyte * 32)()
    if not x11.XQueryKeymap(display, keys):
        sys.exit("Unable to read the X keyboard state")
    for keycode in range(8, 256):
        if keys[keycode // 8] & (1 << (keycode % 8)):
            if not xtst.XTestFakeKeyEvent(display, keycode, 0, 0):
                sys.exit("Unable to release an X key")
    for button in range(1, 9):
        if not xtst.XTestFakeButtonEvent(display, button, 0, 0):
            sys.exit("Unable to release an X pointer button")
    x11.XSync(display, 0)
finally:
    x11.XCloseDisplay(display)
