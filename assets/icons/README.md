# Custom Icons for the Swift extension

This folder contains custom iconography used in various sections of the Swift extension for VS Code.

All icons are compiled into a single icon font using [IcoMoon](https://icomoon.io/app). The icons must be placed at the following codes within the font file:

```
\\E001 - swift-icon
\\E002 - swift-documentation
\\E003 - swift-documentation-preview
```

Any newly added icons will need to be added to the icons contribution point in the [package.json](../../package.json) for them to be usable from within the extension.