# Annoying NBR

一个 macOS / Windows 通用的 Node.js 桌面循环播放器，基于 Electron。

运行后会依次完成：

1. 选择一个扬声器，不选择则使用系统默认输出设备。
2. 扫描指定目录下的音频文件，并让用户选择一个或多个。
3. 输入循环播放总时长，默认 `7200s`，即 2 小时。
4. 输入每轮循环之间的间隔，默认 `0s`。
5. 可勾选“增加随机间隔”，每轮间隔会额外增加 `-10s` 到 `+10s` 的随机偏移。
6. 在播放器下方调整音量和倍速。
7. 默认按选中的顺序逐个播放，播完一轮后继续循环。
8. 可勾选“随机循环播放”，每次下一首从已选音频里随机选择。
9. 按选择的设备、时长、间隔、音量和倍速循环播放音频。

播放过程中如果当前使用的扬声器断开，应用会停止循环播放；非播放状态下断开扬声器时会回退到系统默认输出设备。

## 环境要求

- Node.js 18+
- macOS 或 Windows

本项目使用：

- `navigator.mediaDevices.enumerateDevices()` 枚举扬声器。
- `HTMLMediaElement.setSinkId()` 将播放输出到用户选择的扬声器。
- 音频播放由 Chromium 内置媒体能力处理，不需要系统预装 ffmpeg。

## 安装

```bash
pnpm install
```

## 运行

扫描当前目录并打开播放器：

```bash
pnpm start
```

扫描指定目录并打开播放器：

```bash
pnpm start -- --dir /path/to/audio-directory
```

## 打包

生成当前平台的安装包：

```bash
pnpm dist
```

仅打包 macOS：

```bash
pnpm dist:mac
```

仅打包 Windows：

```bash
pnpm dist:win
```

仅打包 Linux：

```bash
pnpm dist:linux
```

同时配置 macOS、Windows 和 Linux 目标：

```bash
pnpm dist:all
```

快速生成未压缩应用目录，用于验证打包配置：

```bash
pnpm run pack
```

打包产物输出到 `dist/`。macOS 目标包含 `dmg` 和 `zip`，Windows 目标包含 `nsis` 安装包和 `portable` 版本，Linux 目标包含 `AppImage` 和 `deb`。跨平台打包可能需要当前系统具备对应平台打包工具链；例如在 macOS 上生成 Windows 或 Linux 安装包时，`electron-builder` 可能需要下载额外工具。

## 配置保存

应用会保存上次使用的目录、扬声器、已选音频文件、循环播放总时长、循环间隔、随机间隔开关、随机循环播放开关、音量和倍速。下次启动时会自动恢复这些配置。

Windows portable 版本首次启动时会默认扫描 portable `.exe` 所在目录，而不是自解压运行时使用的临时目录。如果历史配置指向 portable 临时解压目录，应用会自动回退到 portable `.exe` 所在目录。

## 支持的音频格式

默认扫描：

- `.mp3`
- `.wav`
- `.flac`
- `.aac`
- `.m4a`
- `.ogg`
- `.opus`
- `.wma`
- `.aiff`
- `.aif`
- `.webm`

实际能否播放取决于 Electron / Chromium 当前平台支持的媒体解码能力。常见的 `.mp3`、`.wav`、`.m4a`、`.ogg`、`.flac` 通常可用。
