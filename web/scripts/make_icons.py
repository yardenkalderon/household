"""Draws the app icon (white house on teal) as PNGs, no image libraries needed."""
import struct, sys, zlib

BG, FG = (15, 110, 86), (255, 255, 255)

def inside_house(x, y):
    # roof: triangle, body: rectangle, door: cut-out
    if 0.22 <= y <= 0.50 and abs(x - 0.5) <= (y - 0.22) / 0.28 * 0.30:
        return True
    if 0.48 <= y <= 0.78 and 0.28 <= x <= 0.72:
        return not (0.44 <= x <= 0.56 and y >= 0.60)
    return False

def pixel(x, y, rounded):
    if rounded:
        r = 0.18
        cx, cy = min(max(x, r), 1 - r), min(max(y, r), 1 - r)
        if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
            return (0, 0, 0, 0)
    return (*FG, 255) if inside_house(x, y) else (*BG, 255)

def png(size, path, rounded):
    ss = 3  # supersampling for smooth edges
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    p = pixel((px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size, rounded)
                    for i in range(4):
                        acc[i] += p[i]
            row += bytes(round(a / ss ** 2) for a in acc)
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

out = sys.argv[1]
png(192, f'{out}/icon-192.png', False)
png(512, f'{out}/icon-512.png', False)
png(180, f'{out}/apple-touch-icon.png', False)
png(64, f'{out}/favicon.png', True)
