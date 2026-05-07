'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.webm'
]);

const DEFAULT_CONFIG = {
  root: '',
  durationSeconds: 7200,
  intervalSeconds: 0,
  sinkId: '',
  selectedFilePath: '',
  selectedFilePaths: [],
  volume: 1,
  playbackRate: 1,
  randomizeInterval: false,
  randomizePlayback: false
};

let mainWindow = null;
let currentConfig = { ...DEFAULT_CONFIG };
let scanRoot = getDefaultScanRoot();
let closingAfterConfigSave = false;

function getIconPath() {
  return path.join(__dirname, '..', 'icon.png');
}

function getAppIcon() {
  return nativeImage.createFromPath(getIconPath());
}

function getScanRootArg() {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const dirFlagIndex = args.indexOf('--dir');

  if (dirFlagIndex >= 0 && args[dirFlagIndex + 1]) {
    return args[dirFlagIndex + 1];
  }

  return args.find((arg) => arg && !arg.startsWith('-'));
}

function getDefaultScanRoot() {
  if (!app.isPackaged) return process.cwd();

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }

  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  }

  return path.dirname(app.getPath('exe'));
}

function resolveInitialScanRoot(config) {
  const argRoot = getScanRootArg();
  if (argRoot) return path.resolve(argRoot);

  if (config.root && !isPortableTempRoot(config.root)) {
    return path.resolve(config.root);
  }

  return getDefaultScanRoot();
}

function isPortableTempRoot(root) {
  if (!app.isPackaged || !root) return false;

  const portableExecutableDir =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    (process.env.PORTABLE_EXECUTABLE_FILE
      ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE)
      : '');

  if (!portableExecutableDir) return false;

  const normalizedRoot = path.resolve(root);
  const normalizedTemp = path.resolve(app.getPath('temp'));
  const normalizedPortableDir = path.resolve(portableExecutableDir);

  return (
    isSubPath(normalizedRoot, normalizedTemp) &&
    !isSubPath(normalizedRoot, normalizedPortableDir)
  );
}

function isSubPath(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function createWindow() {
  closingAfterConfigSave = false;
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 540,
    title: 'Annoying NBR',
    icon: getIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  mainWindow.on('close', (event) => {
    if (closingAfterConfigSave || mainWindow.webContents.isDestroyed()) {
      return;
    }

    event.preventDefault();
    mainWindow.webContents
      .executeJavaScript('window.saveConfigBeforeClose && window.saveConfigBeforeClose()')
      .catch(() => null)
      .finally(() => {
        closingAfterConfigSave = true;
        mainWindow.close();
      });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

async function loadConfig() {
  const raw = await fs.readFile(getConfigPath(), 'utf8').catch(() => null);
  if (!raw) return { ...DEFAULT_CONFIG };

  try {
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function normalizeConfig(config = {}) {
  return {
    root: typeof config.root === 'string' ? config.root : DEFAULT_CONFIG.root,
    durationSeconds: toPositiveNumber(config.durationSeconds, DEFAULT_CONFIG.durationSeconds),
    intervalSeconds: toNonNegativeNumber(config.intervalSeconds, DEFAULT_CONFIG.intervalSeconds),
    sinkId: typeof config.sinkId === 'string' ? config.sinkId : DEFAULT_CONFIG.sinkId,
    selectedFilePath:
      typeof config.selectedFilePath === 'string'
        ? config.selectedFilePath
        : DEFAULT_CONFIG.selectedFilePath,
    selectedFilePaths: normalizeSelectedFilePaths(config),
    volume: clampNumber(config.volume, 0, 1, DEFAULT_CONFIG.volume),
    playbackRate: clampNumber(config.playbackRate, 0.25, 4, DEFAULT_CONFIG.playbackRate),
    randomizeInterval:
      typeof config.randomizeInterval === 'boolean'
        ? config.randomizeInterval
        : DEFAULT_CONFIG.randomizeInterval,
    randomizePlayback:
      typeof config.randomizePlayback === 'boolean'
        ? config.randomizePlayback
        : DEFAULT_CONFIG.randomizePlayback
  };
}

function normalizeSelectedFilePaths(config) {
  if (Array.isArray(config.selectedFilePaths)) {
    return config.selectedFilePaths.filter((filePath) => typeof filePath === 'string');
  }

  if (typeof config.selectedFilePath === 'string' && config.selectedFilePath) {
    return [config.selectedFilePath];
  }

  return DEFAULT_CONFIG.selectedFilePaths;
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

async function saveConfig(config) {
  currentConfig = {
    ...currentConfig,
    ...normalizeConfig(config),
    root: scanRoot
  };

  await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(currentConfig, null, 2));
}

async function listAudioFiles(rootDir) {
  const files = [];
  await walk(rootDir, files);

  return files
    .sort((a, b) => a.localeCompare(b))
    .map((filePath) => ({
      path: filePath,
      url: pathToFileURL(filePath).href,
      name: path.basename(filePath),
      relativePath: path.relative(rootDir, filePath) || path.basename(filePath)
    }));
}

async function walk(dirPath, results) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, results);
      continue;
    }

    if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
}

ipcMain.handle('audio:get-initial-state', async () => {
  return {
    root: scanRoot,
    files: await listAudioFiles(scanRoot).catch(() => []),
    config: currentConfig
  };
});

ipcMain.handle('audio:choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频目录',
    defaultPath: scanRoot,
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  scanRoot = result.filePaths[0];
  currentConfig.root = scanRoot;
  await saveConfig(currentConfig);

  return {
    root: scanRoot,
    files: await listAudioFiles(scanRoot)
  };
});

ipcMain.handle('audio:rescan', async () => {
  return {
    root: scanRoot,
    files: await listAudioFiles(scanRoot)
  };
});

ipcMain.handle('audio:save-config', async (_event, config) => {
  await saveConfig(config);
  return currentConfig;
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(getAppIcon());
  }

  currentConfig = await loadConfig();
  scanRoot = resolveInitialScanRoot(currentConfig);
  currentConfig.root = scanRoot;
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
