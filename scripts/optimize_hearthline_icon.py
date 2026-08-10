from pathlib import Path
from PIL import Image

SOURCE = Path("/home/ubuntu/webdev-static-assets/hearthline-crm-icon.png")
TARGETS = [
    Path("/home/ubuntu/home-service-connection-app/assets/images/icon.png"),
    Path("/home/ubuntu/home-service-connection-app/assets/images/splash-icon.png"),
    Path("/home/ubuntu/home-service-connection-app/assets/images/favicon.png"),
    Path("/home/ubuntu/home-service-connection-app/assets/images/android-icon-foreground.png"),
]

with Image.open(SOURCE) as source:
    icon = source.convert("RGBA")
    icon.thumbnail((512, 512), Image.Resampling.LANCZOS)
    if icon.size != (512, 512):
        canvas = Image.new("RGBA", (512, 512), (7, 17, 31, 255))
        x = (512 - icon.width) // 2
        y = (512 - icon.height) // 2
        canvas.alpha_composite(icon, (x, y))
        icon = canvas
    for target in TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        icon.save(target, format="PNG", optimize=True, compress_level=9)

print("Optimized Hearthline icon assets written.")
