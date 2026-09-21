import json
import struct
import sys
from pathlib import Path

from PIL import Image


def align4(data: bytes, pad: bytes = b" ") -> bytes:
    return data + pad * ((4 - len(data) % 4) % 4)


def chunk(chunk_type: bytes, data: bytes) -> bytes:
    return struct.pack("<I4s", len(data), chunk_type) + data


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("Usage: make-photo-glb.py <image> <output.glb> <width_meters>")

    image_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    width_m = float(sys.argv[3])

    with Image.open(image_path) as image:
        aspect = image.height / image.width

    height_m = width_m * aspect
    depth_m = 0.035
    x0, x1 = -width_m / 2, width_m / 2
    y0, y1 = 0.0, height_m
    z0, z1 = -depth_m / 2, depth_m / 2

    # Front face carries the product photo. A real depth box makes Android AR
    # placement more reliable than a zero-thickness plane.
    front_positions = [
        x0, y0, z1,
        x1, y0, z1,
        x1, y1, z1,
        x0, y1, z1,
    ]
    front_normals = [0.0, 0.0, 1.0] * 4
    front_uvs = [0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]
    front_indices = [0, 1, 2, 0, 2, 3]

    body_positions = []
    body_normals = []
    body_indices = []

    def add_face(corners, normal):
        base = len(body_positions) // 3
        for corner in corners:
            body_positions.extend(corner)
            body_normals.extend(normal)
        body_indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    add_face([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], [0, 0, -1])
    add_face([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], [-1, 0, 0])
    add_face([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], [1, 0, 0])
    add_face([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], [0, 1, 0])
    add_face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], [0, -1, 0])

    front_position_bytes = struct.pack("<" + "f" * len(front_positions), *front_positions)
    front_normal_bytes = struct.pack("<" + "f" * len(front_normals), *front_normals)
    front_uv_bytes = struct.pack("<" + "f" * len(front_uvs), *front_uvs)
    front_index_bytes = struct.pack("<" + "H" * len(front_indices), *front_indices)
    body_position_bytes = struct.pack("<" + "f" * len(body_positions), *body_positions)
    body_normal_bytes = struct.pack("<" + "f" * len(body_normals), *body_normals)
    body_index_bytes = struct.pack("<" + "H" * len(body_indices), *body_indices)
    image_bytes = image_path.read_bytes()

    buffer_parts = []
    views = []
    offset = 0
    for data, target in [
        (front_position_bytes, 34962),
        (front_normal_bytes, 34962),
        (front_uv_bytes, 34962),
        (front_index_bytes, 34963),
        (body_position_bytes, 34962),
        (body_normal_bytes, 34962),
        (body_index_bytes, 34963),
        (image_bytes, None),
    ]:
        padded = align4(data, b"\x00")
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        buffer_parts.append(padded)
        offset += len(padded)

    bin_blob = b"".join(buffer_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "LitLayer photo AR pilot"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": image_path.stem}],
        "meshes": [{
            "primitives": [
                {
                    "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                    "indices": 3,
                    "material": 0,
                },
                {
                    "attributes": {"POSITION": 4, "NORMAL": 5},
                    "indices": 6,
                    "material": 1,
                },
            ]
        }],
        "materials": [
            {
                "name": "Product photo",
                "doubleSided": True,
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0,
                    "roughnessFactor": 0.9,
                },
                "extensions": {"KHR_materials_unlit": {}},
            },
            {
                "name": "Matte black shell",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.01, 0.01, 0.012, 1],
                    "metallicFactor": 0,
                    "roughnessFactor": 0.75,
                },
            },
        ],
        "textures": [{"source": 0}],
        "images": [{"bufferView": 7, "mimeType": "image/jpeg"}],
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": views,
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 4,
                "type": "VEC3",
                "min": [x0, y0, z1],
                "max": [x1, y1, z1],
            },
            {"bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": 4, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5123, "count": 6, "type": "SCALAR"},
            {
                "bufferView": 4,
                "componentType": 5126,
                "count": len(body_positions) // 3,
                "type": "VEC3",
                "min": [x0, y0, z0],
                "max": [x1, y1, z1],
            },
            {"bufferView": 5, "componentType": 5126, "count": len(body_normals) // 3, "type": "VEC3"},
            {"bufferView": 6, "componentType": 5123, "count": len(body_indices), "type": "SCALAR"},
        ],
    }

    json_blob = align4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    glb = (
        b"glTF"
        + struct.pack("<II", 2, 12 + 8 + len(json_blob) + 8 + len(bin_blob))
        + chunk(b"JSON", json_blob)
        + chunk(b"BIN\x00", bin_blob)
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(glb)
    print(f"Wrote {output_path} ({len(glb):,} bytes)")


if __name__ == "__main__":
    main()
