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
    positions = [
        -width_m / 2, 0.0, 0.0,
        width_m / 2, 0.0, 0.0,
        width_m / 2, height_m, 0.0,
        -width_m / 2, height_m, 0.0,
    ]
    normals = [0.0, 0.0, 1.0] * 4
    uvs = [0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]
    indices = [0, 1, 2, 0, 2, 3]

    position_bytes = struct.pack("<" + "f" * len(positions), *positions)
    normal_bytes = struct.pack("<" + "f" * len(normals), *normals)
    uv_bytes = struct.pack("<" + "f" * len(uvs), *uvs)
    index_bytes = struct.pack("<" + "H" * len(indices), *indices)
    image_bytes = image_path.read_bytes()

    buffer_parts = []
    views = []
    offset = 0
    for data, target in [
        (position_bytes, 34962),
        (normal_bytes, 34962),
        (uv_bytes, 34962),
        (index_bytes, 34963),
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
            "primitives": [{
                "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                "indices": 3,
                "material": 0,
            }]
        }],
        "materials": [{
            "name": "Product photo",
            "doubleSided": True,
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicFactor": 0,
                "roughnessFactor": 0.9,
            },
            "extensions": {"KHR_materials_unlit": {}},
        }],
        "textures": [{"source": 0}],
        "images": [{"bufferView": 4, "mimeType": "image/jpeg"}],
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": views,
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 4,
                "type": "VEC3",
                "min": [-width_m / 2, 0, 0],
                "max": [width_m / 2, height_m, 0],
            },
            {"bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": 4, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5123, "count": 6, "type": "SCALAR"},
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
