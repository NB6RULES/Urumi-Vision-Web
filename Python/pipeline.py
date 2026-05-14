import argparse
import os

import cv2

from extract import load_config_frames, process_image
from utils import misc


def run_pipeline(input_path, output_svg, mode="contour", config_path="./config/config.json", dpi=None):
    print(f"=== Step 1: Extract image from ArUco frame ===")

    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"Error: could not read '{input_path}'")
        return

    config_frames = load_config_frames(config_path)

    img_out, detected_dpi = process_image(
        img, config_frames, solve_dist=True, verbose=True, dpi=dpi
    )

    # save intermediate PNG with DPI
    png_path = os.path.splitext(input_path)[0] + f"_{detected_dpi}_DPI.png"
    misc.writePNGwithdpi(png_path, img_out, dpi=(detected_dpi, detected_dpi))
    print(f"Saved extracted PNG: '{png_path}'")

    print(f"\n=== Step 2: Vectorize ({mode} mode) ===")

    if mode == "contour":
        from vectorize import png_to_svg
        png_to_svg(png_path, output_svg)
    elif mode == "skeleton":
        from skeletonify import png_to_skeleton_svg
        png_to_skeleton_svg(png_path, output_svg)
    else:
        print(f"Error: unknown mode '{mode}'. Use 'contour' or 'skeleton'.")
        return

    print(f"\n=== Done ===")


def main():
    parser = argparse.ArgumentParser(
        description="Urumi Vision: Extract image from ArUco frame and convert to SVG"
    )
    parser.add_argument("-i", "--input", type=str, required=True,
                        help="Input image (JPG/PNG photo of ArUco frame)")
    parser.add_argument("-o", "--output", type=str, default="",
                        help="Output SVG path (default: output/<name>.svg)")
    parser.add_argument("-m", "--mode", type=str, default="contour", choices=["contour", "skeleton"],
                        help="Vectorization mode: 'contour' (filled shapes) or 'skeleton' (polylines). Default: contour")
    parser.add_argument("-d", "--dpi", type=int, default=None,
                        help="Manual output DPI (default: auto-detect from frame)")
    parser.add_argument("-c", "--config", type=str, default="./config/config.json",
                        help="Frame config file (default: ./config/config.json)")
    args = parser.parse_args()

    output = args.output
    if not output:
        name = os.path.splitext(os.path.basename(args.input))[0]
        os.makedirs("output", exist_ok=True)
        output = f"output/{name}.svg"

    run_pipeline(args.input, output, mode=args.mode, config_path=args.config, dpi=args.dpi)


if __name__ == "__main__":
    main()
