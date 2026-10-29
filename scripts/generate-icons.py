"""用 Pillow 重建轻唱各平台图标：python3 scripts/generate-icons.py。"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
GREEN = '#254b41'
CREAM = '#fff6e4'
CORAL = '#ed9d8a'


def logo(background=True):
    image = Image.new('RGBA', (1024, 1024))
    draw = ImageDraw.Draw(image)
    if background:
        draw.rounded_rectangle((32, 32, 992, 992), radius=224, fill=GREEN)
    for x, height, color in [(322, 210, CREAM), (448, 390, CREAM), (574, 300, CORAL), (700, 168, CREAM)]:
        draw.rounded_rectangle((x-38, 512-height/2, x+38, 512+height/2), radius=38, fill=color)
    return image


icon = logo()
output = ROOT / 'electron' / 'icons'
output.mkdir(exist_ok=True)
icon.save(output / 'icon.png')
icon.save(output / 'icon.icns')
icon.save(output / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

resources = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
for density, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    directory = resources / f'mipmap-{density}'
    for name in ['ic_launcher', 'ic_launcher_round']:
        icon.resize((size, size), Image.Resampling.LANCZOS).save(directory / f'{name}.png')
    foreground_size = size * 108 // 48
    logo(False).resize((foreground_size, foreground_size), Image.Resampling.LANCZOS).save(directory / 'ic_launcher_foreground.png')

(resources / 'values' / 'ic_launcher_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#254b41</color></resources>\n'
)

for image_path in resources.glob('drawable*/splash.png'):
    with Image.open(image_path) as original:
        size = original.size
    splash = Image.new('RGB', size, '#f7f5f0')
    mark_size = max(48, min(size) // 4)
    mark = icon.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
    splash.paste(mark, ((size[0]-mark_size)//2, (size[1]-mark_size)//2), mark)
    splash.save(image_path)

ios_assets = ROOT / 'ios' / 'App' / 'App' / 'Assets.xcassets'
app_icon = Image.new('RGB', (1024, 1024), GREEN)
app_icon.paste(icon, mask=icon.getchannel('A'))
app_icon.save(ios_assets / 'AppIcon.appiconset' / 'AppIcon-512@2x.png')
for image_path in (ios_assets / 'Splash.imageset').glob('*.png'):
    splash = Image.new('RGB', (2732, 2732), '#f7f5f0')
    mark = icon.resize((512, 512), Image.Resampling.LANCZOS)
    splash.paste(mark, (1110, 1110), mark)
    splash.save(image_path)
