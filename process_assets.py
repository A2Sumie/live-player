import math
import xml.etree.ElementTree as ET
import os
import traceback

import cairosvg

# --- Configuration (from khwA.py) ---
WIDTH = 4096 # High res for quality
HEIGHT = 4096
CENTER_X = float(WIDTH // 2)
CENTER_Y = float(HEIGHT // 2)
TILT_ANGLE_DEGREES = -7.0
TILT_SLOPE = math.tan(math.radians(TILT_ANGLE_DEGREES))
SCALE_FACTOR = 0.8
OVERLAP_OFFSET = 1.5 * (WIDTH / 2000.0) # Adjust for higher res

# Colors (Style 6)
COLOR_DARK_BLUE = "#000050"
COLOR_RED = "#FF1111"
COLOR_WHITE = "#FFFFFF"
COLOR_LAKE_BLUE = "#008bd3"
COLOR_CYAN_BLUE = "#00aacc"

v6_colors = {
    'c_west': COLOR_DARK_BLUE,
    'c_east': COLOR_RED,
    'c_n_left': COLOR_LAKE_BLUE,
    'c_s_left': COLOR_CYAN_BLUE,
    'c_ns_right': COLOR_WHITE
}

# Geometry Base Sizes (Scaled to 4096)
BASE_SCALE = WIDTH / 2000.0
RAW_NS_BASE_WIDTH = 280.0 * BASE_SCALE
RAW_TIP_N_Y = 950.0 * BASE_SCALE
RAW_TIP_S_Y = -950.0 * BASE_SCALE
RAW_TIP_W_X = -1000.0 * BASE_SCALE
RAW_TIP_E_X = 1100.0 * BASE_SCALE
RAW_BASE_NW_Y = 150.0 * BASE_SCALE
RAW_BASE_SW_Y = -150.0 * BASE_SCALE
RAW_BASE_NE_Y = 120.0 * BASE_SCALE
RAW_BASE_SE_Y = -120.0 * BASE_SCALE

# Division ratios
NS_DIVISION_RATIO = 6.0 / 7.0

def transform_point(x, y, slope=TILT_SLOPE, offset_x=CENTER_X, offset_y=CENTER_Y):
    raw_x, raw_y = float(x), float(y)
    y_sheared = raw_y + slope * raw_x
    tpx = raw_x + offset_x
    tpy = y_sheared + offset_y
    return (tpx, tpy)

# Calculate Geometry
tip_n = (0.0, RAW_TIP_N_Y * SCALE_FACTOR)
tip_s = (0.0, RAW_TIP_S_Y * SCALE_FACTOR)
tip_w = (RAW_TIP_W_X * SCALE_FACTOR, 0.0)
tip_e = (RAW_TIP_E_X * SCALE_FACTOR, 0.0)
base_nw_vis = (0.0, RAW_BASE_NW_Y * SCALE_FACTOR)
base_sw_vis = (0.0, RAW_BASE_SW_Y * SCALE_FACTOR)
base_ne_vis = (0.0, RAW_BASE_NE_Y * SCALE_FACTOR)
base_se_vis = (0.0, RAW_BASE_SE_Y * SCALE_FACTOR)
scaled_ns_base_width = RAW_NS_BASE_WIDTH * SCALE_FACTOR
base_ns_west = (-scaled_ns_base_width / 2.0, 0.0)
base_ns_east = (scaled_ns_base_width / 2.0, 0.0)
ns_split_base_x = base_ns_west[0] + (base_ns_east[0] - base_ns_west[0]) * NS_DIVISION_RATIO
ns_split_base_y = 0.0
ns_split_base = (ns_split_base_x, ns_split_base_y)
ns_split_base_overlap = (ns_split_base_x - OVERLAP_OFFSET, ns_split_base_y)

raw_points = {
    "tip_n": tip_n, "tip_s": tip_s, "tip_w": tip_w, "tip_e": tip_e,
    "base_nw_vis": base_nw_vis, "base_sw_vis": base_sw_vis,
    "base_ne_vis": base_ne_vis, "base_se_vis": base_se_vis,
    "base_ns_west": base_ns_west, "base_ns_east": base_ns_east,
    "ns_split_base": ns_split_base,
    "ns_split_base_overlap": ns_split_base_overlap,
}

layer1_polygons = { "west_base": {"keys": ["base_nw_vis", "base_sw_vis", "tip_w"], "color_var": "c_west"}, "east_base": {"keys": ["base_ne_vis", "base_se_vis", "tip_e"], "color_var": "c_east"}, }
layer2_polygons = { "north_left": {"keys": ["tip_n", "base_ns_west", "ns_split_base"], "color_var": "c_n_left"}, "south_left": {"keys": ["tip_s", "ns_split_base", "base_ns_west"], "color_var": "c_s_left"}, }
layer3_polygons = { "north_right": {"keys": ["tip_n", "ns_split_base_overlap", "base_ns_east"], "color_var": "c_ns_right"}, "south_right": {"keys": ["tip_s", "base_ns_east", "ns_split_base_overlap"], "color_var": "c_ns_right"}, }

def create_svg_content():
    svg_ns = "http://www.w3.org/2000/svg"
    ET.register_namespace('', svg_ns)
    root = ET.Element(f"{{{svg_ns}}}svg", attrib={
         "width": str(WIDTH), "height": str(HEIGHT), "viewBox": f"0 0 {WIDTH} {HEIGHT}",
         "shape-rendering": "geometricPrecision",
    })

    def draw_poly(definition, colors):
        point_keys = definition["keys"]
        color_var = definition["color_var"]
        fill_color = colors[color_var]
        points_list_str = []
        for p_key in point_keys:
            raw_x, raw_y = raw_points[p_key]
            tp_x, tp_y = transform_point(raw_x, raw_y)
            points_list_str.append(f"{tp_x:.4f},{tp_y:.4f}")

        final_points_attr = " ".join(points_list_str)
        ET.SubElement(root, f"{{{svg_ns}}}polygon", attrib={"points": final_points_attr, "fill": fill_color, "stroke": "none"})

    for definition in layer1_polygons.values(): draw_poly(definition, v6_colors)
    for definition in layer2_polygons.values(): draw_poly(definition, v6_colors)
    for definition in layer3_polygons.values(): draw_poly(definition, v6_colors)

    return ET.tostring(root, encoding='unicode', method='xml')

def main():
    png_logo_path = "public/logo.png"

    # 1. Generate SVG Content
    svg_content = create_svg_content()

    # 2. Render to High-Res PNG
    try:
        cairosvg.svg2png(bytestring=svg_content.encode('utf-8'), write_to=png_logo_path, output_width=4096, output_height=4096)
        print(f"Generated {png_logo_path} using Style 6 (Direct CairoSVG Render)")
    except Exception as e:
        print(f"Error generating PNG: {e}")

if __name__ == "__main__":
    main()
