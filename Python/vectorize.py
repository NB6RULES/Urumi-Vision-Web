import argparse
import os

import cv2
import numpy as np
import svgwrite
from PIL import Image


def png_to_svg(input_path: str, output_path: str):
    print(f"'{input_path}' -> '{output_path}'")

    with Image.open(input_path) as img:
        dpi = img.info.get("dpi", (-1, -1))[0]
        if dpi == -1:
            print("Error: DPI not found in image. Run extract.py first.")
            return
        print(f"Found DPI: {dpi}")

    mm_per_px = 25.4 / dpi

    image = cv2.imread(input_path)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    h, w = gray.shape

    # threshold
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    contours, _ = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    dwg = svgwrite.Drawing(
        output_path, size=(f"{w * mm_per_px}mm", f"{h * mm_per_px}mm")
    )
    dwg.viewbox(0, 0, w, h)

    path_data = ""

    for i, contour in enumerate(contours):
        epsilon = 0.0005 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        points = [tuple(map(float, p[0])) for p in approx]

        if len(points) < 3:
            continue

        path_segment = (
            f"M {points[0][0]},{points[0][1]} "
            + " ".join([f"L {p[0]},{p[1]}" for p in points[1:]])
            + " Z "
        )
        path_data += path_segment

    dwg.add(dwg.path(d=path_data, fill="black", stroke="none", fill_rule="evenodd"))
    dwg.save()
    print(f"Saved '{output_path}'")


def main():
    parser = argparse.ArgumentParser(description="Convert extracted PNG to SVG (contour mode)")
    parser.add_argument("-i", "--input", type=str, required=True, help="Input PNG file (with DPI embedded)")
    parser.add_argument("-o", "--output", type=str, default="", help="Output SVG file (default: <input>_contour.svg)")
    args = parser.parse_args()

    output = args.output
    if not output:
        output = os.path.splitext(args.input)[0] + "_contour.svg"

    png_to_svg(args.input, output)


if __name__ == "__main__":
    main()
