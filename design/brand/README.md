# 苦力怕菜单品牌素材

品牌图以游戏内菜单道具 `resource_packs/CreeperMenu/textures/items/sm.png` 为中心图标。
该 16×16 道具纹理是只读来源；生成脚本不会覆盖、裁切或重绘它。

- `source/background-imagegen.png`：通过 ImageGen 生成的暗绿色像素背景，只用于外围装饰。
- `../../tools/build-brand-assets.py`：生成两个 256×256 包图标和 README 横幅。

重新生成：

```bash
/path/to/python-with-pillow tools/build-brand-assets.py
```

需要 Pillow，并建议安装包含中文字符的字体（macOS 可使用系统黑体，Linux 可安装 Noto Sans CJK）。
