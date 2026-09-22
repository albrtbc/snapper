"""Set/query only the X11 input shape; never clip the panel's visible artwork."""
import ctypes as c
import json
import sys
import os
import select

class Rectangle(c.Structure):
    _fields_ = [('x', c.c_short), ('y', c.c_short), ('width', c.c_ushort), ('height', c.c_ushort)]

x11 = c.CDLL('libX11.so.6')
ext = c.CDLL('libXext.so.6')
x11.XOpenDisplay.argtypes = [c.c_char_p]
x11.XOpenDisplay.restype = c.c_void_p
x11.XSync.argtypes = [c.c_void_p, c.c_int]
x11.XFree.argtypes = [c.c_void_p]
x11.XCloseDisplay.argtypes = [c.c_void_p]
x11.XConnectionNumber.argtypes = [c.c_void_p]
x11.XPending.argtypes = [c.c_void_p]
x11.XNextEvent.argtypes = [c.c_void_p, c.c_void_p]
x11.XDefaultRootWindow.argtypes = [c.c_void_p]
x11.XDefaultRootWindow.restype = c.c_ulong
x11.XInternAtom.argtypes = [c.c_void_p, c.c_char_p, c.c_int]
x11.XInternAtom.restype = c.c_ulong
x11.XGetWindowProperty.argtypes = [c.c_void_p, c.c_ulong, c.c_ulong, c.c_long,
                                  c.c_long, c.c_int, c.c_ulong, c.POINTER(c.c_ulong),
                                  c.POINTER(c.c_int), c.POINTER(c.c_ulong),
                                  c.POINTER(c.c_ulong), c.POINTER(c.c_void_p)]
ext.XShapeSelectInput.argtypes = [c.c_void_p, c.c_ulong, c.c_ulong]
class ShapeEvent(c.Structure):
    _fields_ = [('type', c.c_int), ('serial', c.c_ulong), ('send_event', c.c_int),
                ('display', c.c_void_p), ('window', c.c_ulong), ('kind', c.c_int)]
ext.XShapeCombineRectangles.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_int, c.c_int, c.POINTER(Rectangle), c.c_int, c.c_int, c.c_int]
ext.XShapeGetRectangles.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.POINTER(c.c_int), c.POINTER(c.c_int)]
ext.XShapeGetRectangles.restype = c.POINTER(Rectangle)
ext.XShapeQueryVersion.argtypes = [c.c_void_p, c.POINTER(c.c_int), c.POINTER(c.c_int)]
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError('Cannot open X11 display')
major, minor = c.c_int(), c.c_int()
if not ext.XShapeQueryVersion(display, c.byref(major), c.byref(minor)) or (major.value, minor.value) < (1, 1):
    raise RuntimeError('X Shape 1.1 required for input regions')
# Windows can close while a request is queued. Report X errors to the caller.
errors = []
@c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)
def on_error(_display, _event):
    errors.append('X11 input region request failed')
    return 0
x11.XSetErrorHandler.argtypes = [type(on_error)]
x11.XSetErrorHandler(on_error)
desired = {}
def property_value(window, name, expected_format):
    atom = x11.XInternAtom(display, name, 1)
    if not atom:
        return None
    kind, count, remaining = c.c_ulong(), c.c_ulong(), c.c_ulong()
    format_bits, data = c.c_int(), c.c_void_p()
    status = x11.XGetWindowProperty(display, window, atom, 0, 1024, 0, 0,
                                   c.byref(kind), c.byref(format_bits), c.byref(count),
                                   c.byref(remaining), c.byref(data))
    try:
        if status or not kind.value or format_bits.value != expected_format or remaining.value:
            return None
        if expected_format == 32:
            return int(c.cast(data, c.POINTER(c.c_ulong))[0]) if count.value else 0
        return c.string_at(data, count.value) if count.value else b''
    finally:
        if data:
            x11.XFree(data)

def active_window():
    root = x11.XDefaultRootWindow(display)
    window = property_value(root, b'_NET_ACTIVE_WINDOW', 32)
    if window is None:
        return None
    if not window:
        return {}
    classes = property_value(window, b'WM_CLASS', 8) or b''
    return {'window': window, 'pid': property_value(window, b'_NET_WM_PID', 32),
            'classes': classes.decode('utf-8', errors='replace').strip('\0').split('\0')}

def query(window):
    count, order = c.c_int(), c.c_int()
    result = ext.XShapeGetRectangles(display, window, 2, c.byref(count), c.byref(order))
    actual = [[r.x, r.y, r.width, r.height] for r in result[:count.value]] if result else []
    if result:
        x11.XFree(result)
    return actual

def apply(window, rectangles):
    rects = (Rectangle * len(rectangles))(*[Rectangle(*r) for r in rectangles])
    ext.XShapeCombineRectangles(display, window, 2, 0, 0, rects, len(rects), 0, 0)
    x11.XSync(display, 0)

def handle(line):
    request = {}
    try:
        request = json.loads(line)
        errors.clear()
        if request.get('action') == 'active-window':
            focus = active_window()
            x11.XSync(display, 0)
            print(json.dumps({'id': request['id'], 'focus': None if errors else focus}), flush=True)
            return
        window = int(request['window'])
        if 'rects' in request:
            ext.XShapeSelectInput(display, window, 1)
            apply(window, request['rects'])
        actual = query(window)
        if 'rects' in request:
            desired[window] = actual
        x11.XSync(display, 0)
        if errors:
            desired.pop(window, None)
            raise RuntimeError(errors[0])
        print(json.dumps({'id': request['id'], 'rects': actual}), flush=True)
    except Exception as error:
        print(json.dumps({'id': request.get('id'), 'error': str(error)}), flush=True)

buffer = b''
event = (c.c_long * 24)()
while True:
    # Chromium may reset the input shape after mapping/resizing its surface.
    # Restore it on ShapeNotify, without consulting the global cursor at all.
    while x11.XPending(display):
        x11.XNextEvent(display, c.byref(event))
        shape = c.cast(c.byref(event), c.POINTER(ShapeEvent)).contents
        window = shape.window
        if window in desired and shape.kind == 2:
            errors.clear()
            actual = query(window)
            if errors:
                desired.pop(window, None)
            elif actual != desired[window]:
                apply(window, desired[window])
    readable, _, _ = select.select([0, x11.XConnectionNumber(display)], [], [])
    if 0 in readable:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        buffer += chunk
        while b'\n' in buffer:
            line, buffer = buffer.split(b'\n', 1)
            handle(line)
x11.XCloseDisplay(display)
