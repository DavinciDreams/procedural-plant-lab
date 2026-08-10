import os
import struct
import sys
import zipfile

from pxr import Sdf, Usd, UsdGeom, UsdShade


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def validate_stage(path):
    layer = Sdf.Layer.FindOrOpen(path)
    require(layer is not None, f"OpenUSD could not parse layer: {path}")
    stage = Usd.Stage.Open(path)
    require(stage is not None, f"OpenUSD could not compose stage: {path}")
    require(stage.GetDefaultPrim(), f"stage has no defaultPrim: {path}")
    meshes = [prim for prim in stage.Traverse() if prim.IsA(UsdGeom.Mesh)]
    require(meshes, f"stage has no composed mesh: {path}")
    for mesh in meshes:
        primvars = UsdGeom.PrimvarsAPI(mesh).GetPrimvar("st")
        require(primvars and primvars.GetInterpolation() == UsdGeom.Tokens.vertex, f"mesh lacks vertex st: {mesh.GetPath()}")
        material, relationship = UsdShade.MaterialBindingAPI(mesh).ComputeBoundMaterial()
        require(material and relationship, f"mesh lacks resolved material binding: {mesh.GetPath()}")
        surface = material.ComputeSurfaceSource()
        require(surface and surface[0], f"material lacks surface source: {material.GetPath()}")
        shader = UsdShade.Shader(surface[0])
        require(shader.GetIdAttr().Get() == "UsdPreviewSurface", f"wrong surface shader: {shader.GetPath()}")
    texture_shaders = []
    for prim in stage.Traverse():
        if not prim.IsA(UsdShade.Shader):
            continue
        shader = UsdShade.Shader(prim)
        if shader.GetIdAttr().Get() == "UsdUVTexture":
            texture_shaders.append(shader)
            asset = shader.GetInput("file").Get()
            require(asset and asset.path.startswith("textures/"), f"unsafe or absent texture asset: {prim.GetPath()}")
            require(asset.resolvedPath, f"OpenUSD could not resolve texture dependency: {asset.path} in {path}")
            require(shader.GetInput("sourceColorSpace").Get() in ("sRGB", "raw"), f"missing color space: {prim.GetPath()}")
    require(len(texture_shaders) == 4, f"expected four PBR texture shaders in {path}")


def validate_package(path):
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(infos and infos[0].filename.endswith(".usda"), f"USDZ default layer is not first: {path}")
        require(len(infos) == 5, f"USDZ should contain one layer and four textures: {path}")
        for info in infos:
            require(info.compress_type == zipfile.ZIP_STORED, f"USDZ entry is compressed: {info.filename}")
            require(not (info.flag_bits & 1), f"USDZ entry is encrypted: {info.filename}")
            require(info.filename.endswith((".usda", ".png")), f"USDZ entry type unsupported: {info.filename}")
            with open(path, "rb") as stream:
                stream.seek(info.header_offset)
                header = stream.read(30)
            require(struct.unpack_from("<I", header)[0] == 0x04034B50, f"invalid local header: {info.filename}")
            name_length, extra_length = struct.unpack_from("<HH", header, 26)
            data_offset = info.header_offset + 30 + name_length + extra_length
            require(data_offset % 64 == 0, f"USDZ payload is not 64-byte aligned: {info.filename}")
            require(archive.testzip() is None, f"USDZ CRC failure: {path}")
    validate_stage(path)


def main(directory):
    files = sorted(os.listdir(directory))
    usda = [os.path.join(directory, name) for name in files if name.endswith(".usda")]
    usdz = [os.path.join(directory, name) for name in files if name.endswith(".usdz")]
    require(len(usda) == 15 and len(usdz) == 15, "expected every all/single LOD and collision selection")
    for path in usda:
        validate_stage(path)
    for path in usdz:
        validate_package(path)
    print("OpenUSD 26.8 parsed/composed 15 USDA layers and 15 stored, aligned USDZ packages")


if __name__ == "__main__":
    require(len(sys.argv) == 2, "usage: procplant-openusd-validation.py <fixture-directory>")
    main(sys.argv[1])
