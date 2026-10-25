/**
 * Power Setting Manager - Electron Main Process
 * Compact 480x640 utility window, single instance lock, administrator elevation, secure IPC handlers.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const powercfg = require('./lib/powercfg');
const { StorageEngine, DEFAULT_PRESETS } = require('./lib/storage');
const restoreTask = require('./lib/restoreTask');
const planSwitchTask = require('./lib/planSwitchTask');

// Enforce Single Instance Lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
const storage = new StorageEngine();
const activityLog = [];
const MAX_LOG_ENTRIES = 200;

function pushLog(entry) {
  activityLog.unshift(entry);
  if (activityLog.length > MAX_LOG_ENTRIES) {
    activityLog.pop();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log:event', entry);
  }
}

// Connect logger to powercfg engine
powercfg.setLogger((event) => {
  pushLog(event);
});

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  const windowOptions = {
    width: 940,
    height: 740,
    minWidth: 780,
    minHeight: 620,
    center: true,
    resizable: true,
    maximizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1b1c20',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  };

  if (fs.existsSync(iconPath)) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    const settings = storage.getSettings();
    if (settings.startMinimizedToTray) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==========================================
// IPC HANDLERS WITH STRICT INPUT VALIDATION
// ==========================================

// Window Controls
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  }
  return false;
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// Power Settings Handlers
ipcMain.handle('power:getSettings', async (_, schemeGuid) => {
  try {
    if (schemeGuid && !powercfg.isValidGuid(schemeGuid)) {
      throw new Error(`Invalid scheme GUID provided: ${schemeGuid}`);
    }
    const settings = await powercfg.getAllSettings(schemeGuid);
    return settings;
  } catch (err) {
    pushLog({ timestamp: new Date().toISOString(), command: 'power:getSettings', success: false, details: err.message });
    return { error: err.message };
  }
});

ipcMain.handle('power:applySettings', async (_, schemeGuid, settings) => {
  try {
    if (!powercfg.isValidGuid(schemeGuid)) {
      throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
    }
    if (!settings || (!settings.ac && !settings.dc)) {
      throw new Error('Invalid settings object: missing ac or dc properties.');
    }
    await powercfg.applySettings(schemeGuid, settings);
    return { success: true };
  } catch (err) {
    pushLog({ timestamp: new Date().toISOString(), command: 'power:applySettings', success: false, details: err.message });
    return { error: err.message };
  }
});

ipcMain.handle('power:setHybridSleep', async (_, schemeGuid, acVal, dcVal) => {
  try {
    if (!powercfg.isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
    await powercfg.setHybridSleep(schemeGuid, Boolean(acVal), Boolean(dcVal));
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('power:setButtonAction', async (_, schemeGuid, buttonType, acVal, dcVal) => {
  try {
    if (!powercfg.isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
    await powercfg.setButtonAction(schemeGuid, buttonType, acVal, dcVal);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('power:getSleepAvailability', async () => {
  try {
    return await powercfg.getSleepAvailability();
  } catch (err) {
    return { s3Supported: true, modernStandby: false, hibernateSupported: true };
  }
});

ipcMain.handle('power:getHibernateState', async () => {
  try {
    return await powercfg.getHibernateState();
  } catch (err) {
    return { enabled: false, error: err.message };
  }
});

ipcMain.handle('power:setHibernateState', async (_, enabled) => {
  try {
    return await powercfg.setHibernateState(Boolean(enabled));
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('power:getBatteryPresence', async () => {
  try {
    return await powercfg.getBatteryPresence();
  } catch (err) {
    return { hasBattery: false, isDesktop: true };
  }
});

ipcMain.handle('power:openWindowsSettings', async () => {
  try {
    await powercfg.openWindowsPowerSettings();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// Power Plans Handlers
ipcMain.handle('plans:list', async () => {
  try {
    return await powercfg.listSchemes();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:activate', async (_, guid) => {
  try {
    if (!powercfg.isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
    await powercfg.setActiveScheme(guid);
    return { success: true, guid };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:importBundled', async () => {
  try {
    let bundledPath = path.join(__dirname, 'assets', 'BackupPowerPlan.pow');
    if (app.isPackaged) {
      const prodPath1 = path.join(process.resourcesPath, 'BackupPowerPlan.pow');
      const prodPath2 = path.join(process.resourcesPath, 'assets', 'BackupPowerPlan.pow');
      if (fs.existsSync(prodPath1)) bundledPath = prodPath1;
      else if (fs.existsSync(prodPath2)) bundledPath = prodPath2;
    }
    const result = await powercfg.importPowerPlan(bundledPath);
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:importCustom', async (_, filePath) => {
  try {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      throw new Error('Selected power plan file was not found.');
    }
    return await powercfg.importPowerPlan(filePath);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:delete', async (_, guid) => {
  try {
    if (!powercfg.isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
    return await powercfg.deletePowerPlan(guid);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:rename', async (_, guid, newName) => {
  try {
    if (!powercfg.isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
    return await powercfg.renamePowerPlan(guid, newName);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:duplicate', async (_, guid, newName) => {
  try {
    if (!powercfg.isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
    return await powercfg.duplicatePowerPlan(guid, newName);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:export', async (_, guid, customName) => {
  try {
    if (!powercfg.isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
    const plansDir = storage.getPlansDir();
    const sanitizedName = (customName || 'plan').replace(/[^a-zA-Z0-9_-]/g, '_');
    const targetFile = path.join(plansDir, `${sanitizedName}_${Date.now()}.pow`);
    await powercfg.exportPowerPlan(targetFile, guid);
    return { success: true, filePath: targetFile };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:setAutoSwitch', async (_, payload) => {
  try {
    const { enabled, acPlanGuid, dcPlanGuid } = payload || {};
    if (enabled) {
      if (!powercfg.isValidGuid(acPlanGuid)) throw new Error(`Invalid AC Plan GUID: ${acPlanGuid}`);
      if (!powercfg.isValidGuid(dcPlanGuid)) throw new Error(`Invalid Battery Plan GUID: ${dcPlanGuid}`);
      await planSwitchTask.enableAutoSwitch(acPlanGuid, dcPlanGuid);
    } else {
      await planSwitchTask.disableAutoSwitch();
    }

    const currentSettings = storage.getSettings();
    await storage.saveSettings({
      autoPlanSwitch: {
        enabled: Boolean(enabled),
        acPlanGuid: acPlanGuid || (currentSettings.autoPlanSwitch && currentSettings.autoPlanSwitch.acPlanGuid),
        dcPlanGuid: dcPlanGuid || (currentSettings.autoPlanSwitch && currentSettings.autoPlanSwitch.dcPlanGuid)
      }
    });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('plans:getAutoSwitchState', async () => {
  try {
    const settings = storage.getSettings();
    let isRegistered = false;
    try {
      isRegistered = await planSwitchTask.isTaskRegistered();
    } catch {
      // ignore
    }
    return {
      ...(settings.autoPlanSwitch || { enabled: false }),
      isTaskRegistered: isRegistered
    };
  } catch (err) {
    return { enabled: false, error: err.message };
  }
});

// Unified Plans & Presets Handlers
ipcMain.handle('saved:getUnifiedList', async () => {
  return storage.getUnifiedSavedList();
});

ipcMain.handle('saved:updatePreset', async (_, id, data) => {
  try {
    const updated = await storage.updateUnifiedPreset(id, data);
    return { success: true, item: updated };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('saved:resetRecommended', async () => {
  try {
    const reset = await storage.resetRecommendedPreset();
    return { success: true, item: reset };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('saved:saveAsPreset', async (_, name, description) => {
  try {
    const current = await powercfg.getAllSettings();
    await storage.createOrUpdatePreset({
      name: name.trim() || `Preset ${new Date().toLocaleDateString()}`,
      description: description || 'Custom timeout preset',
      ac: { ...current.ac },
      dc: { ...current.dc }
    });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('saved:saveAsPlan', async (_, name) => {
  try {
    const current = await powercfg.getAllSettings();
    const plansDir = storage.getPlansDir();
    const sanitizedName = (name.trim() || 'plan').replace(/[^a-zA-Z0-9_-]/g, '_');
    const powFilePath = path.join(plansDir, `${sanitizedName}_${Date.now()}.pow`);

    await powercfg.exportPowerPlan(powFilePath, current.schemeGuid);
    await storage.savePlanBackup(name, current.schemeGuid, current.schemeName, current, powFilePath);
    return { success: true, powFilePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('saved:applyPlanBackup', async (_, filePath) => {
  try {
    if (!fs.existsSync(filePath)) throw new Error(`Backup file not found: ${filePath}`);
    return await powercfg.importPowerPlan(filePath);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('saved:deleteItem', async (_, id) => {
  try {
    await storage.deleteUnifiedItem(id);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('saved:renameItem', async (_, id, newName) => {
  try {
    await storage.renameUnifiedItem(id, newName);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('presets:setRecommended', async (_, id) => {
  try {
    return await storage.setRecommendedPreset(id);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('presets:parseOldBackup', async (_, text) => {
  try {
    if (typeof text !== 'string') throw new Error('Input must be a string.');
    return storage.parseOldBackupText(text);
  } catch (err) {
    return { error: err.message };
  }
});

// Never Mode & Auto-Restore Handlers
ipcMain.handle('restore:getPending', async () => {
  return storage.getPendingRestore();
});

ipcMain.handle('restore:setNeverMode', async (_, payload) => {
  try {
    const { currentSettings, autoRestoreOnRestart, restoreTarget } = payload;
    const activeGuid = currentSettings.schemeGuid;
    if (!powercfg.isValidGuid(activeGuid)) {
      throw new Error(`Invalid scheme GUID: ${activeGuid}`);
    }

    // 1. Save pending restore snapshot IF none exists yet
    let snapshot = storage.getPendingRestore();
    if (!snapshot) {
      snapshot = await storage.savePendingRestore({
        activeSchemeGuid: activeGuid,
        activeSchemeName: currentSettings.schemeName || 'Active Scheme',
        ac: { ...currentSettings.ac },
        dc: { ...currentSettings.dc },
        restoreTarget: restoreTarget || 'previous'
      });
    }

    // 2. Set all 4 timeouts on AC and Battery to 0 (Never)
    const neverSettings = {
      ac: { screen: 0, sleep: 0, hibernate: 0, disk: 0 },
      dc: { screen: 0, sleep: 0, hibernate: 0, disk: 0 }
    };
    await powercfg.applySettings(activeGuid, neverSettings);

    // 3. Register or unregister scheduled task depending on toggle
    if (autoRestoreOnRestart) {
      let restoreValues = snapshot;
      if (restoreTarget === 'recommended') {
        const presets = storage.getPresets();
        const rec = presets.find(p => p.isRecommended) || DEFAULT_PRESETS[0];
        restoreValues = rec;
      } else if (restoreTarget === 'win11') {
        const presets = storage.getPresets();
        const w11 = presets.find(p => p.id === 'preset_win11_default') || DEFAULT_PRESETS[1];
        restoreValues = w11;
      }

      await restoreTask.registerScheduledTask(snapshot, restoreValues);
      pushLog({
        timestamp: new Date().toISOString(),
        command: 'schtasks /create',
        success: true,
        details: `Auto-restore task '${restoreTask.TASK_NAME}' registered with BootTrigger & LogonTrigger.`
      });
    } else {
      await restoreTask.unregisterScheduledTask();
    }

    return { success: true, snapshot };
  } catch (err) {
    pushLog({ timestamp: new Date().toISOString(), command: 'restore:setNeverMode', success: false, details: err.message });
    return { error: err.message };
  }
});

ipcMain.handle('restore:restoreNow', async () => {
  try {
    const snapshot = storage.getPendingRestore();
    if (!snapshot) throw new Error('No pending restore snapshot found.');

    const activeGuid = snapshot.activeSchemeGuid;
    await powercfg.applySettings(activeGuid, {
      ac: snapshot.ac,
      dc: snapshot.dc
    });

    await restoreTask.unregisterScheduledTask();
    await storage.clearPendingRestore();

    pushLog({
      timestamp: new Date().toISOString(),
      command: 'restore:restoreNow',
      success: true,
      details: 'Manual restore executed immediately.'
    });

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('restore:cancelPending', async () => {
  try {
    await restoreTask.unregisterScheduledTask();
    await storage.clearPendingRestore();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('restore:checkFlag', async () => {
  try {
    const flagInfo = await restoreTask.checkRestoredFlag();
    if (flagInfo.wasRestored) {
      await storage.clearPendingRestore();
      pushLog({
        timestamp: new Date().toISOString(),
        command: 'restore:checkFlag',
        success: true,
        details: 'System detected completed auto-restore on restart flag.'
      });
    }
    return flagInfo;
  } catch {
    return { wasRestored: false };
  }
});

// Settings Handlers
ipcMain.handle('settings:get', async () => {
  return storage.getSettings();
});

ipcMain.handle('settings:save', async (_, partial) => {
  try {
    return await storage.saveSettings(partial);
  } catch (err) {
    return { error: err.message };
  }
});

// Activity Log Handlers
ipcMain.handle('log:get', async () => {
  return activityLog;
});

ipcMain.handle('log:clear', async () => {
  activityLog.length = 0;
  return { success: true };
});

// Shell External Links Handler
ipcMain.handle('shell:openExternal', async (_, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return { success: true };
  }
  return { error: 'Invalid URL scheme' };
});
