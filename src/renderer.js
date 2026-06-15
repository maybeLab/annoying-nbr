'use strict';

const DEFAULT_DURATION_SECONDS = 7200;
const DEFAULT_INTERVAL_SECONDS = 0;
const DEFAULT_VOLUME = 1;
const DEFAULT_PLAYBACK_RATE = 1;
const DEFAULT_RANDOMIZE_INTERVAL = false;
const DEFAULT_RANDOMIZE_PLAYBACK = false;
const RANDOM_INTERVAL_RANGE_SECONDS = 10;

const state = {
  root: '',
  files: [],
  selectedFiles: [],
  currentFile: null,
  currentFileIndex: 0,
  progressTimer: null,
  nextLoopTimer: null,
  nextLoopAt: 0,
  startedAt: 0,
  durationSeconds: DEFAULT_DURATION_SECONDS,
  intervalSeconds: DEFAULT_INTERVAL_SECONDS,
  volume: DEFAULT_VOLUME,
  playbackRate: DEFAULT_PLAYBACK_RATE,
  randomizeInterval: DEFAULT_RANDOMIZE_INTERVAL,
  randomizePlayback: DEFAULT_RANDOMIZE_PLAYBACK,
  speakerRecovery: null,
  isPlaying: false
};

let saveConfigTimer = null;

const elements = {
  audio: document.getElementById('audio'),
  chooseDirButton: document.getElementById('chooseDirButton'),
  clearStatusHistoryButton: document.getElementById('clearStatusHistoryButton'),
  deviceSelect: document.getElementById('deviceSelect'),
  durationInput: document.getElementById('durationInput'),
  fileCount: document.getElementById('fileCount'),
  fileList: document.getElementById('fileList'),
  intervalInput: document.getElementById('intervalInput'),
  openConfigFolderButton: document.getElementById('openConfigFolderButton'),
  playButton: document.getElementById('playButton'),
  progressBar: document.getElementById('progressBar'),
  randomIntervalInput: document.getElementById('randomIntervalInput'),
  randomPlaybackInput: document.getElementById('randomPlaybackInput'),
  rateButtons: document.getElementById('rateButtons'),
  rescanButton: document.getElementById('rescanButton'),
  scanRoot: document.getElementById('scanRoot'),
  selectedFileName: document.getElementById('selectedFileName'),
  statusHistoryEmpty: document.getElementById('statusHistoryEmpty'),
  statusHistoryList: document.getElementById('statusHistoryList'),
  statusText: document.getElementById('statusText'),
  stopButton: document.getElementById('stopButton'),
  tabButtons: Array.from(document.querySelectorAll('[data-tab]')),
  tabPanels: Array.from(document.querySelectorAll('[data-tab-panel]')),
  timeText: document.getElementById('timeText'),
  volumeInput: document.getElementById('volumeInput'),
  volumeValue: document.getElementById('volumeValue')
};

init().catch((error) => {
  setStatus(`启动失败: ${error.message}`);
});

window.saveConfigBeforeClose = () => saveConfigNow().then(() => true);

async function init() {
  bindEvents();
  const initialState = await window.audioApp.getInitialState();
  applyConfig(initialState.config);
  await loadDevices(initialState.config && initialState.config.sinkId);
  renderFiles(initialState);
  updateTimeText(0);
}

function bindEvents() {
  elements.chooseDirButton.addEventListener('click', async () => {
    const result = await window.audioApp.chooseDirectory();
    if (result) {
      renderFiles(result);
      saveConfigNow().catch(() => {});
    }
  });

  elements.rescanButton.addEventListener('click', async () => {
    renderFiles(await window.audioApp.rescan());
    saveConfigNow().catch(() => {});
  });

  elements.playButton.addEventListener('click', playSelectedFile);
  elements.stopButton.addEventListener('click', () => {
    cancelSpeakerRecovery();
    stopPlayback('已停止');
  });
  elements.openConfigFolderButton.addEventListener('click', async () => {
    try {
      await window.audioApp.openConfigFolder();
      setStatus('已打开配置文件夹');
    } catch (error) {
      setStatus(`打开配置文件夹失败: ${error.message}`);
    }
  });
  elements.clearStatusHistoryButton.addEventListener('click', () => {
    clearStatusHistory();
    setStatus('状态记录已清空', { record: false });
  });

  elements.deviceSelect.addEventListener('change', async () => {
    cancelSpeakerRecovery();

    try {
      await applySink();
      if (state.isPlaying) {
        setStatus('已切换扬声器');
      }
      await saveConfigNow();
    } catch (error) {
      setStatus(`切换扬声器失败: ${error.message}`);
    }
  });

  elements.durationInput.addEventListener('input', () => {
    state.durationSeconds = getDurationSeconds();
    updateTimeText(getElapsedSeconds());
    scheduleConfigSave();
  });

  elements.intervalInput.addEventListener('input', () => {
    state.intervalSeconds = getIntervalSeconds();
    scheduleConfigSave();
  });

  elements.randomIntervalInput.addEventListener('change', () => {
    state.randomizeInterval = elements.randomIntervalInput.checked;
    scheduleConfigSave();
  });

  elements.randomPlaybackInput.addEventListener('change', () => {
    state.randomizePlayback = elements.randomPlaybackInput.checked;
    scheduleConfigSave();
  });

  elements.volumeInput.addEventListener('input', () => {
    setVolume(getVolume(), { save: true });
  });

  elements.rateButtons.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-rate]');
    if (!button) return;

    setPlaybackRate(Number.parseFloat(button.dataset.rate), { save: true });
  });

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => selectTab(button.dataset.tab));
  });

  elements.audio.addEventListener('ended', () => {
    if (state.isPlaying) {
      updateCurrentFileProgress(100);
      scheduleNextLoop();
    }
  });

  elements.audio.addEventListener('timeupdate', () => {
    updateCurrentFileProgress();
  });

  elements.audio.addEventListener('loadedmetadata', applyPlaybackSettings);

  elements.audio.addEventListener('ratechange', () => {
    if (elements.audio.playbackRate !== state.playbackRate) {
      elements.audio.playbackRate = state.playbackRate;
    }
  });

  window.addEventListener('beforeunload', () => {
    saveConfigNow().catch(() => {});
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      refreshDevices().catch((error) => {
        setStatus(`更新扬声器列表失败: ${error.message}`);
      });
    });
  }
}

function applyConfig(config = {}) {
  state.durationSeconds = toPositiveNumber(config.durationSeconds, DEFAULT_DURATION_SECONDS);
  state.intervalSeconds = toNonNegativeNumber(config.intervalSeconds, DEFAULT_INTERVAL_SECONDS);
  state.randomizeInterval =
    typeof config.randomizeInterval === 'boolean'
      ? config.randomizeInterval
      : DEFAULT_RANDOMIZE_INTERVAL;
  state.randomizePlayback =
    typeof config.randomizePlayback === 'boolean'
      ? config.randomizePlayback
      : DEFAULT_RANDOMIZE_PLAYBACK;
  elements.durationInput.value = String(state.durationSeconds);
  elements.intervalInput.value = String(state.intervalSeconds);
  elements.randomIntervalInput.checked = state.randomizeInterval;
  elements.randomPlaybackInput.checked = state.randomizePlayback;
  setVolume(clampNumber(config.volume, 0, 1, DEFAULT_VOLUME), { save: false });
  setPlaybackRate(clampNumber(config.playbackRate, 0.25, 4, DEFAULT_PLAYBACK_RATE), {
    save: false
  });
}

async function loadDevices(savedSinkId = '', options = {}) {
  const keepMissingDevice = options.keepMissingDevice !== false;

  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    setStatus('当前环境不支持枚举扬声器，将使用默认输出设备。');
    return false;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((device) => device.kind === 'audiooutput');
  const hasSavedDevice = outputs.some((device) => device.deviceId === savedSinkId);

  elements.deviceSelect.replaceChildren(createOption('', '系统默认输出设备'));

  outputs
    .filter((device) => device.deviceId !== 'default')
    .forEach((device, index) => {
      const label = device.label || `扬声器 ${index + 1}`;
      elements.deviceSelect.appendChild(createOption(device.deviceId, label));
    });

  if (savedSinkId) {
    if (!hasSavedDevice && keepMissingDevice) {
      elements.deviceSelect.appendChild(createOption(savedSinkId, '上次选择的扬声器'));
    }

    elements.deviceSelect.value = hasSavedDevice || keepMissingDevice ? savedSinkId : '';
  }

  return hasSavedDevice;
}

async function refreshDevices() {
  if (state.speakerRecovery) {
    const recovery = state.speakerRecovery;
    const hasRecoveredDevice = await loadDevices(recovery.sinkId, {
      keepMissingDevice: true
    });

    if (state.speakerRecovery !== recovery) {
      return;
    }

    if (hasRecoveredDevice) {
      await resumePlaybackAfterSpeakerReconnect(recovery);
      return;
    }

    return;
  }

  const previousSinkId = elements.deviceSelect.value;
  const hasPreviousDevice = await loadDevices(previousSinkId, { keepMissingDevice: false });

  if (previousSinkId && !hasPreviousDevice) {
    if (state.isPlaying) {
      const playbackSnapshot = createPlaybackSnapshot();
      stopPlayback('当前扬声器已断开，已停止循环播放', {
        cancelSpeakerRecovery: false
      });
      keepMissingDeviceSelection(previousSinkId);
      state.speakerRecovery = {
        playbackSnapshot,
        sinkId: previousSinkId
      };
      return;
    }

    keepMissingDeviceSelection(previousSinkId);
    setStatus('上次选择的扬声器已断开，等待重新连接');
    await saveConfigNow();
    return;
  }

  setStatus('扬声器列表已更新');
}

function createPlaybackSnapshot() {
  return {
    currentFile: state.currentFile,
    currentFileIndex: state.currentFileIndex,
    currentTime: Number.isFinite(elements.audio.currentTime) ? elements.audio.currentTime : 0,
    durationSeconds: getDurationSeconds(),
    elapsedSeconds: getElapsedSeconds(),
    intervalSeconds: getIntervalSeconds()
  };
}

function keepMissingDeviceSelection(sinkId) {
  if (!sinkId) return;

  const hasOption = Array.from(elements.deviceSelect.options).some(
    (option) => option.value === sinkId
  );
  if (!hasOption) {
    elements.deviceSelect.appendChild(createOption(sinkId, '上次选择的扬声器'));
  }
  elements.deviceSelect.value = sinkId;
}

async function resumePlaybackAfterSpeakerReconnect(recovery) {
  if (!recovery) return;

  const snapshot = recovery.playbackSnapshot;
  state.speakerRecovery = null;

  if (state.selectedFiles.length === 0 || !snapshot.currentFile) {
    setStatus('扬声器已重新连接，但没有可恢复的音频');
    return;
  }

  const selectedIndex = state.selectedFiles.findIndex(
    (file) => file.path === snapshot.currentFile.path
  );
  state.currentFileIndex =
    selectedIndex >= 0
      ? selectedIndex
      : Math.min(snapshot.currentFileIndex, state.selectedFiles.length - 1);
  state.currentFile = state.selectedFiles[state.currentFileIndex];
  state.durationSeconds = snapshot.durationSeconds;
  state.intervalSeconds = snapshot.intervalSeconds;
  state.startedAt = Date.now() - snapshot.elapsedSeconds * 1000;
  state.isPlaying = true;
  state.nextLoopAt = 0;

  try {
    await applySink();
    applyPlaybackSettings();
    elements.audio.loop = false;
    elements.audio.src = state.currentFile.url;
    try {
      elements.audio.currentTime = snapshot.currentTime;
    } catch {
      elements.audio.currentTime = 0;
    }
    elements.stopButton.disabled = false;
    elements.playButton.disabled = true;
    markCurrentFile();
    updateSelectedFileSummary();
    setStatus(`扬声器已重新连接，继续播放 ${state.currentFile.relativePath}`);

    await elements.audio.play();
    tick();
    state.progressTimer = window.setInterval(tick, 250);
    scheduleConfigSave();
  } catch (error) {
    stopPlayback(`恢复播放失败: ${error.message}`);
  }
}

function cancelSpeakerRecovery() {
  state.speakerRecovery = null;
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function renderFiles({ root, files, config = {} }) {
  state.root = root;
  state.files = files;
  state.selectedFiles = [];
  state.currentFile = null;
  state.currentFileIndex = 0;

  elements.scanRoot.textContent = root;
  elements.fileCount.textContent = String(files.length);
  elements.fileList.replaceChildren();
  updateSelectedFileSummary();
  elements.playButton.disabled = true;
  stopPlayback('请选择音频后开始播放');

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '该目录下没有找到可播放的音频文件';
    elements.fileList.appendChild(empty);
    return;
  }

  files.forEach((file) => {
    const button = document.createElement('button');
    button.className = 'file-item';
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.textContent = file.relativePath;
    button.addEventListener('click', () => toggleFileSelection(file, button));
    elements.fileList.appendChild(button);
  });

  const savedPaths = getSavedSelectedFilePaths(config);
  if (savedPaths.length > 0) {
    const fileButtons = elements.fileList.querySelectorAll('.file-item');
    savedPaths.forEach((savedPath) => {
      const savedIndex = files.findIndex((file) => file.path === savedPath);
      const savedButton = fileButtons[savedIndex];
      if (savedIndex >= 0 && savedButton) {
        selectFile(files[savedIndex], savedButton, { save: false });
      }
    });

    if (state.selectedFiles.length > 0) {
      updateSelectedFileSummary();
      elements.playButton.disabled = false;
    }
  }
}

function getSavedSelectedFilePaths(config) {
  if (Array.isArray(config.selectedFilePaths)) {
    return config.selectedFilePaths.filter((filePath) => typeof filePath === 'string');
  }

  if (typeof config.selectedFilePath === 'string' && config.selectedFilePath) {
    return [config.selectedFilePath];
  }

  return [];
}

function toggleFileSelection(file, button) {
  if (state.isPlaying) return;
  cancelSpeakerRecovery();

  if (state.selectedFiles.some((selectedFile) => selectedFile.path === file.path)) {
    deselectFile(file, button);
  } else {
    selectFile(file, button);
  }
}

function selectFile(file, button, options = {}) {
  if (!state.selectedFiles.some((selectedFile) => selectedFile.path === file.path)) {
    state.selectedFiles.push(file);
  }

  elements.playButton.disabled = false;
  button.classList.add('is-selected');
  button.setAttribute('aria-pressed', 'true');
  updateSelectedFileSummary();
  setStatus(`已选择 ${state.selectedFiles.length} 个音频`);

  if (options.save !== false) {
    saveConfigNow().catch(() => {});
  }
}

function deselectFile(file, button) {
  state.selectedFiles = state.selectedFiles.filter((selectedFile) => selectedFile.path !== file.path);
  button.classList.remove('is-selected', 'is-current');
  button.setAttribute('aria-pressed', 'false');
  elements.playButton.disabled = state.selectedFiles.length === 0;
  updateSelectedFileSummary();
  setStatus(state.selectedFiles.length > 0 ? `已选择 ${state.selectedFiles.length} 个音频` : '请选择音频后开始播放');
  saveConfigNow().catch(() => {});
}

async function playSelectedFile() {
  if (state.selectedFiles.length === 0) return;
  cancelSpeakerRecovery();

  try {
    state.durationSeconds = getDurationSeconds();
    state.intervalSeconds = getIntervalSeconds();
    state.startedAt = Date.now();
    state.isPlaying = true;
    state.currentFileIndex = getInitialFileIndex();
    state.currentFile = state.selectedFiles[state.currentFileIndex];

    await applySink();
    applyPlaybackSettings();

    elements.audio.loop = false;
    elements.audio.src = state.currentFile.url;
    elements.audio.currentTime = 0;
    elements.stopButton.disabled = false;
    elements.playButton.disabled = true;
    markCurrentFile();
    updateSelectedFileSummary();
    setStatus(`正在播放 ${state.currentFile.relativePath}`);

    await elements.audio.play();
    tick();
    state.progressTimer = window.setInterval(tick, 250);
    scheduleConfigSave();
  } catch (error) {
    stopPlayback(`播放失败: ${error.message}`);
  }
}

async function applySink() {
  const sinkId = elements.deviceSelect.value;

  if (!sinkId || !elements.audio.setSinkId) return;

  await elements.audio.setSinkId(sinkId);
}

function tick() {
  const elapsed = getElapsedSeconds();
  updateTimeText(elapsed);
  updateCurrentFileProgress();
  updateNextLoopCountdown();

  const ratio = Math.min(elapsed / state.durationSeconds, 1);
  elements.progressBar.style.width = `${ratio * 100}%`;

  if (elapsed >= state.durationSeconds) {
    stopPlayback('播放完成');
  }
}

function scheduleNextLoop() {
  if (!state.isPlaying) return;

  if (getElapsedSeconds() >= state.durationSeconds) {
    stopPlayback('播放完成');
    return;
  }

  const intervalSeconds = getNextIntervalSeconds();
  if (intervalSeconds === 0) {
    playNextLoop();
    return;
  }

  state.nextLoopAt = Date.now() + intervalSeconds * 1000;
  updateNextLoopCountdown();
  state.nextLoopTimer = window.setTimeout(playNextLoop, intervalSeconds * 1000);
}

function playNextLoop() {
  if (!state.isPlaying || getElapsedSeconds() >= state.durationSeconds) {
    stopPlayback('播放完成');
    return;
  }

  state.nextLoopAt = 0;
  state.currentFileIndex = getNextFileIndex();
  state.currentFile = state.selectedFiles[state.currentFileIndex];
  elements.audio.src = state.currentFile.url;
  elements.audio.currentTime = 0;
  applyPlaybackSettings();
  markCurrentFile();
  updateCurrentFileProgress(0);
  updateSelectedFileSummary();
  setStatus(`正在播放 ${state.currentFile.relativePath}`);
  elements.audio.play().catch((error) => stopPlayback(`播放失败: ${error.message}`));
}

function stopPlayback(message, options = {}) {
  if (options.cancelSpeakerRecovery !== false) {
    cancelSpeakerRecovery();
  }

  state.isPlaying = false;

  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = null;
  }

  if (state.nextLoopTimer) {
    window.clearTimeout(state.nextLoopTimer);
    state.nextLoopTimer = null;
  }
  state.nextLoopAt = 0;

  elements.audio.pause();
  elements.audio.currentTime = 0;
  elements.playButton.disabled = state.selectedFiles.length === 0;
  elements.stopButton.disabled = true;
  elements.progressBar.style.width = '0%';
  document.querySelectorAll('.file-item.is-current').forEach((item) => {
    item.classList.remove('is-current');
    item.style.removeProperty('--play-progress');
  });
  state.currentFile = null;
  updateTimeText(0);
  updateSelectedFileSummary();
  setStatus(message);
}

function getInitialFileIndex() {
  if (elements.randomPlaybackInput.checked) {
    return getRandomFileIndex();
  }

  return 0;
}

function getNextFileIndex() {
  if (state.selectedFiles.length <= 1) return 0;
  if (elements.randomPlaybackInput.checked) return getRandomFileIndex();

  return (state.currentFileIndex + 1) % state.selectedFiles.length;
}

function getRandomFileIndex() {
  return Math.floor(Math.random() * state.selectedFiles.length);
}

function markCurrentFile() {
  document.querySelectorAll('.file-item.is-current').forEach((item) => {
    item.classList.remove('is-current');
    item.style.removeProperty('--play-progress');
  });

  if (!state.currentFile) return;

  const currentIndex = state.files.findIndex((file) => file.path === state.currentFile.path);
  const currentButton = elements.fileList.querySelectorAll('.file-item')[currentIndex];
  if (currentButton) {
    currentButton.classList.add('is-current');
    currentButton.style.setProperty('--play-progress', '0%');
  }
}

function updateCurrentFileProgress(forcedPercent) {
  if (!state.currentFile) return;

  const currentIndex = state.files.findIndex((file) => file.path === state.currentFile.path);
  const currentButton = elements.fileList.querySelectorAll('.file-item')[currentIndex];
  if (!currentButton) return;

  const percent =
    typeof forcedPercent === 'number'
      ? forcedPercent
      : getCurrentAudioProgressPercent();
  currentButton.style.setProperty('--play-progress', `${percent}%`);
}

function getCurrentAudioProgressPercent() {
  if (!Number.isFinite(elements.audio.duration) || elements.audio.duration <= 0) {
    return 0;
  }

  return Math.min(Math.max((elements.audio.currentTime / elements.audio.duration) * 100, 0), 100);
}

function updateSelectedFileSummary() {
  if (state.selectedFiles.length === 0) {
    elements.selectedFileName.textContent = '未选择音频';
    return;
  }

  if (state.currentFile) {
    elements.selectedFileName.textContent = `已选择 ${state.selectedFiles.length} 个，当前：${state.currentFile.relativePath}`;
    return;
  }

  if (state.selectedFiles.length === 1) {
    elements.selectedFileName.textContent = state.selectedFiles[0].relativePath;
    return;
  }

  elements.selectedFileName.textContent = `已选择 ${state.selectedFiles.length} 个音频`;
}

function getDurationSeconds() {
  const seconds = Number.parseFloat(elements.durationInput.value);
  return toPositiveNumber(seconds, DEFAULT_DURATION_SECONDS);
}

function getIntervalSeconds() {
  const seconds = Number.parseFloat(elements.intervalInput.value);
  return toNonNegativeNumber(seconds, DEFAULT_INTERVAL_SECONDS);
}

function getNextIntervalSeconds() {
  const baseInterval = getIntervalSeconds();
  if (!elements.randomIntervalInput.checked) return baseInterval;

  const offset =
    Math.floor(Math.random() * (RANDOM_INTERVAL_RANGE_SECONDS * 2 + 1)) -
    RANDOM_INTERVAL_RANGE_SECONDS;
  return Math.max(0, baseInterval + offset);
}

function updateNextLoopCountdown() {
  if (!state.isPlaying || !state.nextLoopAt) return;

  const remainingSeconds = Math.max(0, Math.ceil((state.nextLoopAt - Date.now()) / 1000));
  setStatus(`等待 ${remainingSeconds}s 后继续播放`, { record: false });
}

function getElapsedSeconds() {
  if (!state.isPlaying) return 0;
  return (Date.now() - state.startedAt) / 1000;
}

function getVolume() {
  const percent = Number.parseFloat(elements.volumeInput.value);
  return clampNumber(percent / 100, 0, 1, DEFAULT_VOLUME);
}

function setVolume(volume, options = {}) {
  state.volume = clampNumber(volume, 0, 1, DEFAULT_VOLUME);
  elements.audio.volume = state.volume;
  elements.volumeInput.value = String(Math.round(state.volume * 100));
  elements.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;

  if (options.save) {
    scheduleConfigSave();
  }
}

function setPlaybackRate(rate, options = {}) {
  state.playbackRate = clampNumber(rate, 0.25, 4, DEFAULT_PLAYBACK_RATE);
  elements.audio.defaultPlaybackRate = state.playbackRate;
  elements.audio.playbackRate = state.playbackRate;

  elements.rateButtons.querySelectorAll('button[data-rate]').forEach((button) => {
    const buttonRate = Number.parseFloat(button.dataset.rate);
    button.classList.toggle('is-selected', buttonRate === state.playbackRate);
  });

  if (options.save) {
    setStatus(`倍速已切换为 ${state.playbackRate}x`);
    scheduleConfigSave();
  }
}

function applyPlaybackSettings() {
  elements.audio.volume = state.volume;
  elements.audio.defaultPlaybackRate = state.playbackRate;
  elements.audio.playbackRate = state.playbackRate;
}

function updateTimeText(elapsed) {
  elements.timeText.textContent = `${Math.floor(elapsed)}s / ${getDurationSeconds()}s`;
}

function setStatus(message, options = {}) {
  elements.statusText.textContent = message;
  if (options.record === false) return;

  appendStatusHistory(message);
}

function clearStatusHistory() {
  elements.statusHistoryList.replaceChildren();
  elements.statusHistoryEmpty.hidden = false;
}

function appendStatusHistory(message) {
  const timestamp = new Date();
  const item = document.createElement('li');
  const time = document.createElement('time');
  const text = document.createElement('span');

  time.dateTime = timestamp.toISOString();
  time.textContent = formatStatusTime(timestamp);
  text.textContent = message;

  item.append(time, text);
  elements.statusHistoryList.prepend(item);
  elements.statusHistoryEmpty.hidden = true;
}

function formatStatusTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function selectTab(tabName) {
  elements.tabButtons.forEach((button) => {
    const isSelected = button.dataset.tab === tabName;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-selected', String(isSelected));
  });

  elements.tabPanels.forEach((panel) => {
    const isSelected = panel.dataset.tabPanel === tabName;
    panel.classList.toggle('is-selected', isSelected);
    panel.hidden = !isSelected;
  });
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

function getConfigSnapshot() {
  return {
    root: state.root,
    durationSeconds: getDurationSeconds(),
    intervalSeconds: getIntervalSeconds(),
    sinkId: elements.deviceSelect.value,
    selectedFilePath: state.selectedFiles[0] ? state.selectedFiles[0].path : '',
    selectedFilePaths: state.selectedFiles.map((file) => file.path),
    volume: state.volume,
    playbackRate: state.playbackRate,
    randomizeInterval: elements.randomIntervalInput.checked,
    randomizePlayback: elements.randomPlaybackInput.checked
  };
}

function scheduleConfigSave() {
  if (saveConfigTimer) {
    window.clearTimeout(saveConfigTimer);
  }

  saveConfigTimer = window.setTimeout(() => {
    saveConfigTimer = null;
    saveConfigNow().catch(() => {});
  }, 300);
}

async function saveConfigNow() {
  if (saveConfigTimer) {
    window.clearTimeout(saveConfigTimer);
    saveConfigTimer = null;
  }

  await window.audioApp.saveConfig(getConfigSnapshot());
}
