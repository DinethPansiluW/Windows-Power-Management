/**
 * Power Setting Manager - Preload Script
 * Exposes a strictly whitelisted, secure API to the renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window Controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  close: () => ipcRenderer.invoke('window:close'),

  // Power Settings
  getPowerSettings: (schemeGuid) => ipcRenderer.invoke('power:getSettings', schemeGuid),
  applyPowerSettings: (schemeGuid, settings) => ipcRenderer.invoke('power:applySettings', schemeGuid, settings),
  setHybridSleep: (schemeGuid, acVal, dcVal) => ipcRenderer.invoke('power:setHybridSleep', schemeGuid, acVal, dcVal),
  setButtonAction: (schemeGuid, buttonType, acVal, dcVal) => ipcRenderer.invoke('power:setButtonAction', schemeGuid, buttonType, acVal, dcVal),
  getSleepAvailability: () => ipcRenderer.invoke('power:getSleepAvailability'),
  getHibernateState: () => ipcRenderer.invoke('power:getHibernateState'),
  setHibernateState: (enabled) => ipcRenderer.invoke('power:setHibernateState', enabled),
  getBatteryPresence: () => ipcRenderer.invoke('power:getBatteryPresence'),
  openWindowsPowerSettings: () => ipcRenderer.invoke('power:openWindowsSettings'),

  // Power Plans
  listPowerPlans: () => ipcRenderer.invoke('plans:list'),
  activatePowerPlan: (guid) => ipcRenderer.invoke('plans:activate', guid),
  importBundledPlan: () => ipcRenderer.invoke('plans:importBundled'),
  importCustomPlan: (filePath) => ipcRenderer.invoke('plans:importCustom', filePath),
  deletePowerPlan: (guid) => ipcRenderer.invoke('plans:delete', guid),
  renamePowerPlan: (guid, newName) => ipcRenderer.invoke('plans:rename', guid, newName),
  duplicatePowerPlan: (guid, newName) => ipcRenderer.invoke('plans:duplicate', guid, newName),
  exportPowerPlan: (guid, customName) => ipcRenderer.invoke('plans:export', guid, customName),
  setAutoSwitch: (payload) => ipcRenderer.invoke('plans:setAutoSwitch', payload),
  getAutoSwitchState: () => ipcRenderer.invoke('plans:getAutoSwitchState'),

  // Unified Plans & Presets
  getUnifiedSavedList: () => ipcRenderer.invoke('saved:getUnifiedList'),
  updateUnifiedPreset: (id, data) => ipcRenderer.invoke('saved:updatePreset', id, data),
  resetRecommendedPreset: () => ipcRenderer.invoke('saved:resetRecommended'),
  saveCurrentAsPreset: (name, description) => ipcRenderer.invoke('saved:saveAsPreset', name, description),
  saveCurrentAsPlan: (name) => ipcRenderer.invoke('saved:saveAsPlan', name),
  applyPlanBackup: (filePath) => ipcRenderer.invoke('saved:applyPlanBackup', filePath),
  deleteUnifiedItem: (id) => ipcRenderer.invoke('saved:deleteItem', id),
  renameUnifiedItem: (id, newName) => ipcRenderer.invoke('saved:renameItem', id, newName),
  setRecommendedPreset: (id) => ipcRenderer.invoke('presets:setRecommended', id),
  parseOldBackupText: (text) => ipcRenderer.invoke('presets:parseOldBackup', text),

  // Never Mode & Auto Restore
  getPendingRestore: () => ipcRenderer.invoke('restore:getPending'),
  setNeverMode: (payload) => ipcRenderer.invoke('restore:setNeverMode', payload),
  restorePendingNow: () => ipcRenderer.invoke('restore:restoreNow'),
  cancelPendingRestore: () => ipcRenderer.invoke('restore:cancelPending'),
  checkRestoredFlag: () => ipcRenderer.invoke('restore:checkFlag'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // External Links
  openExternalUrl: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Activity Log
  getActivityLog: () => ipcRenderer.invoke('log:get'),
  clearActivityLog: () => ipcRenderer.invoke('log:clear'),
  onLogEvent: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('log:event', subscription);
    return () => ipcRenderer.removeListener('log:event', subscription);
  }
});
