import os, subprocess
from PIL import Image, ImageDraw

out_dir = os.path.abspath("src-tauri/icons")
os.makedirs(out_dir, exist_ok=True)

size = 512
img = Image.new("RGBA", (size, size), (0, 0, 170, 255))
draw = ImageDraw.Draw(img)

# NC double cyan frame
draw.rectangle([10, 10, size - 10, size - 10], outline=(0, 170, 170, 255), width=8)
draw.rectangle([22, 22, size - 22, size - 22], outline=(85, 255, 255, 255), width=4)

# Midline
draw.line([size // 2, 26, size // 2, size - 26], fill=(0, 170, 170, 255), width=4)

# Top header bar
draw.rectangle([26, 26, size - 26, 60], fill=(0, 170, 170, 255))

# Bottom banner
draw.rectangle([30, 310, size - 30, 470], fill=(0, 170, 170, 255), outline=(255, 255, 85, 255), width=6)

# Retro text block N
nx = 90
draw.rectangle([nx, 335, nx + 25, 445], fill=(255, 255, 85, 255))
draw.rectangle([nx + 75, 335, nx + 100, 445], fill=(255, 255, 85, 255))
for i in range(25):
    draw.rectangle([nx + 25 + int(i * 2.0), 335 + int(i * 4.4), nx + 45 + int(i * 2.0), 355 + int(i * 4.4)], fill=(255, 255, 85, 255))

# Retro text block C
cx = 320
draw.rectangle([cx, 335, cx + 25, 445], fill=(255, 255, 85, 255))
draw.rectangle([cx, 335, cx + 90, 360], fill=(255, 255, 85, 255))
draw.rectangle([cx, 420, cx + 90, 445], fill=(255, 255, 85, 255))

img.save(os.path.join(out_dir, "icon.png"))
img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(out_dir, "32x32.png"))
img.resize((128, 128), Image.Resampling.LANCZOS).save(os.path.join(out_dir, "128x128.png"))
img.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(out_dir, "128x128@2x.png"))
img.resize((64, 64), Image.Resampling.LANCZOS).save(os.path.join(out_dir, "icon.ico"))

iconset_dir = os.path.join(out_dir, "NortonMac.iconset")
os.makedirs(iconset_dir, exist_ok=True)
for s, name in [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
]:
    img.resize((s, s), Image.Resampling.LANCZOS).save(os.path.join(iconset_dir, name))

subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", os.path.join(out_dir, "icon.icns")], check=True)
print("Icons successfully created in", out_dir)
