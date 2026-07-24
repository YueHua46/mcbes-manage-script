"""Build a deterministic aged-yellow Backrooms material family from an atlas."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "resource_packs" / "Backrooms" / "textures" / "blocks" / "backrooms"


def edge_match(image: Image.Image, border: int = 7) -> Image.Image:
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64)
    for distance in range(border):
        mix = (distance + 1) / (border + 1)
        top = pixels[distance].copy()
        bottom = pixels[-1 - distance].copy()
        average = (top + bottom) / 2
        pixels[distance] = average * (1 - mix) + top * mix
        pixels[-1 - distance] = average * (1 - mix) + bottom * mix
    for distance in range(border):
        mix = (distance + 1) / (border + 1)
        left = pixels[:, distance].copy()
        right = pixels[:, -1 - distance].copy()
        average = (left + right) / 2
        pixels[:, distance] = average * (1 - mix) + left * mix
        pixels[:, -1 - distance] = average * (1 - mix) + right * mix
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB")


def prepare(
    quadrant: Image.Image,
    seamless: bool = True,
    blur_radius: float = 0.0,
) -> Image.Image:
    # Discard the generated atlas boundary before downsampling.
    quadrant = quadrant.crop((16, 16, quadrant.width - 16, quadrant.height - 16))
    image = quadrant.resize((64, 64), Image.Resampling.LANCZOS)
    if blur_radius > 0:
        image = image.filter(ImageFilter.GaussianBlur(blur_radius))
    return edge_match(image) if seamless else image


def grade(
    image: Image.Image,
    target: tuple[float, float, float],
    contrast: float,
    maximum: int = 255,
) -> Image.Image:
    """Give each material a shared warm cast without erasing its own texture."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64)
    mean = pixels.reshape(-1, 3).mean(axis=0)
    pixels = (pixels - mean) * contrast + np.asarray(target, dtype=np.float64)
    return Image.fromarray(np.clip(pixels, 0, maximum).astype(np.uint8), "RGB")


def recenter(
    image: Image.Image,
    target: tuple[float, float, float],
    maximum: int = 255,
) -> Image.Image:
    """Restore a target mean after a deterministic pattern or speckle pass."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64)
    mean = pixels.reshape(-1, 3).mean(axis=0)
    pixels += np.asarray(target, dtype=np.float64) - mean
    return Image.fromarray(np.clip(pixels, 0, maximum).astype(np.uint8), "RGB")


def add_wallpaper_motif(image: Image.Image) -> Image.Image:
    """Add a quiet eight-pixel repeat without turning the paper into a grid."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64).copy()
    y, x = np.indices((image.height, image.width))
    repeat_x = x % 8
    repeat_y = y % 8
    dotted_column = ((repeat_x == 1) & ((repeat_y == 1) | (repeat_y == 5)))
    chevron = (
        ((repeat_y == 2) & ((repeat_x == 3) | (repeat_x == 7)))
        | ((repeat_y == 3) & ((repeat_x == 4) | (repeat_x == 6)))
        | ((repeat_y == 4) & (repeat_x == 5))
    )
    motif = dotted_column.astype(np.float64) * -12.0 + chevron.astype(np.float64) * -9.0
    # Change luminance almost equally in every channel so the motif does not
    # introduce a second wallpaper hue.
    pixels += motif[..., None]
    return recenter(Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB"), (194, 191, 145))


def add_carpet_mottle(image: Image.Image) -> Image.Image:
    """Retain broad worn variation while suppressing fiber-sized contrast."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64).copy()
    y, x = np.indices((image.height, image.width), dtype=np.float64)
    field = (
        np.sin((x + 3.0) * np.pi / 18.0) * 1.6
        + np.cos((y - 5.0) * np.pi / 23.0) * 1.4
        + np.sin((x + y) * np.pi / 31.0) * 0.9
    )
    pixels += field[..., None]
    return recenter(
        Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB"),
        (164, 155, 116),
    )


def add_ceiling_speckle(image: Image.Image) -> Image.Image:
    """Apply stable, non-directional acoustic-board flecks at pixel scale."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64).copy()
    y, x = np.indices((image.height, image.width), dtype=np.uint32)
    hashed = (x * np.uint32(374761393) + y * np.uint32(668265263) + np.uint32(2246822519))
    hashed = (hashed ^ (hashed >> np.uint32(13))) * np.uint32(1274126177)
    unit = (hashed & np.uint32(1023)).astype(np.float64) / 1023.0
    speckle = (unit - 0.5) * 7.0
    pixels += speckle[..., None]
    result = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB")
    return recenter(edge_match(result, border=4), (178, 174, 128))


def add_lamp_rolloff(image: Image.Image) -> Image.Image:
    """Keep the diffuser warm ivory with a soft center, never pure white."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.float64).copy()
    y, x = np.indices((image.height, image.width), dtype=np.float64)
    radius = np.sqrt(((x - 31.5) / 31.5) ** 2 + ((y - 31.5) / 31.5) ** 2)
    rolloff = 4.0 - np.minimum(radius, 1.4) * 8.0
    pixels += rolloff[..., None]
    return recenter(
        Image.fromarray(np.clip(pixels, 0, 244).astype(np.uint8), "RGB"),
        (232, 228, 202),
        maximum=244,
    )


def main(source: Path, output: Path = OUTPUT) -> None:
    atlas = Image.open(source).convert("RGB")
    if atlas.width != atlas.height or atlas.width < 512:
        raise ValueError("Expected a square material atlas of at least 512px")
    half = atlas.width // 2
    wall = add_wallpaper_motif(grade(
        prepare(atlas.crop((0, 0, half, half)), blur_radius=0.25),
        target=(194, 191, 145),
        contrast=0.32,
    ))
    carpet = add_carpet_mottle(grade(
        prepare(atlas.crop((half, 0, atlas.width, half)), blur_radius=2.25),
        target=(164, 155, 116),
        contrast=0.30,
    ))
    ceiling = add_ceiling_speckle(grade(
        prepare(atlas.crop((0, half, half, atlas.height)), blur_radius=0.18),
        target=(178, 174, 128),
        contrast=0.30,
    ))
    lamp = add_lamp_rolloff(grade(
        prepare(atlas.crop((half, half, atlas.width, atlas.height)), seamless=False),
        target=(232, 228, 202),
        contrast=0.20,
        maximum=244,
    ))

    output.mkdir(parents=True, exist_ok=True)
    wall.save(output / "wallpaper.png", optimize=True)
    grade(wall, target=(166, 163, 123), contrast=0.74).save(
        output / "wallpaper_stained.png", optimize=True
    )
    carpet.save(output / "carpet.png", optimize=True)
    grade(carpet, target=(137, 129, 96), contrast=0.62).filter(
        ImageFilter.GaussianBlur(0.5)
    ).save(output / "carpet_damp.png", optimize=True)
    ceiling.save(output / "ceiling_tile.png", optimize=True)
    lamp.save(output / "fluorescent_on.png", optimize=True)
    grade(lamp, target=(151, 146, 122), contrast=0.30).save(
        output / "fluorescent_dead.png", optimize=True
    )


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: process-backrooms-textures.py <atlas.png> [output-directory]")
    main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) == 3 else OUTPUT)
