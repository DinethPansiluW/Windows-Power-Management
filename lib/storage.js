/**
 * Power Setting Manager - Storage Engine
 * Atomic JSON file persistence, presets management, backup system, and old .txt backup parser.
 */

const fs = require('fs');
const path = require('path');

const DPW_PLAN_GUID = 'b2c3d4e5-6677-8899-0011-223344556677';

const FACTORY_RECOMMENDED_PRESET = {
  id: 'preset_recommended',
  name: 'DPW Plan (Recommended)',
  description: 'Default recommended plan: 5/15/60/5 min on AC, 5/10/30/5 min on Battery',
  isBuiltin: true,
  isRecommended: true,
  ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
  dc: { screen: 5, sleep: 10, hibernate: 30, disk: 5 }
};

// Default Built-in Presets
const DEFAULT_PRESETS = [
  JSON.parse(JSON.stringify(FACTORY_RECOMMENDED_PRESET)),
  {
    id: 'preset_win11_default',
    name: 'Windows 11 Default',
    description: 'Standard out-of-the-box Windows 11 power profile',
    isBuiltin: true,
    isRecommended: false,
    ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
    dc: { screen: 5, sleep: 10, hibernate: 20, disk: 5 }
  }
];

const DEFAULT_SETTINGS = {
  theme: 'system',
  accentColor: '#0078D4',
  startMinimizedToTray: false,
  autoRestoreOnRestart: true,
  restoreTarget: 'previous', // 'previous' | 'recommended' | 'win11'
  recommendedPlanGuid: DPW_PLAN_GUID,
  autoPlanSwitch: {
    enabled: false,
    acPlanGuid: DPW_PLAN_GUID,
    dcPlanGuid: 'a1841308-3541-4fab-bc81-f71556f20b4a'
  }
};

class StorageEngine {
  constructor(baseDir = null) {
    this.baseDir = baseDir || this.resolveDefaultDir();
    this.ensureDirectory(this.baseDir);

    this.presetsFile = path.join(this.baseDir, 'presets.json');
    this.backupsFile = path.join(this.baseDir, 'backups.json');
    this.settingsFile = path.join(this.baseDir, 'settings.json');
    this.snapshotFile = path.join(this.baseDir, 'pending_restore_snapshot.json');
  }

  resolveDefaultDir() {
    try {
      const electron = require('electron');
      const app = electron.app || (electron.remote && electron.remote.app);
      if (app && typeof app.getPath === 'function') {
        return path.join(app.getPath('userData'), 'Data');
      }
    } catch {
      // Running outside electron or in mock/test
    }
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(process.cwd(), '.data');
    return path.join(appData, 'PowerSettingManager');
  }

  ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Atomic file write: writes to temporary file then renames
   */
  async atomicWriteJson(filePath, data) {
    this.ensureDirectory(path.dirname(filePath));
    const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(tempFile, payload, 'utf-8');
    await fs.promises.rename(tempFile, filePath);
  }

  readJson(filePath, fallback = null) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return fallback;
    }
  }

  // --- PRESETS ---

  getPresets() {
    const list = this.readJson(this.presetsFile, null);
    if (!Array.isArray(list) || list.length === 0) {
      // Initialize with defaults
      this.savePresets(DEFAULT_PRESETS);
      return JSON.parse(JSON.stringify(DEFAULT_PRESETS));
    }
    return list;
  }

  async savePresets(presetsList) {
    await this.atomicWriteJson(this.presetsFile, presetsList);
    return presetsList;
  }

  async createOrUpdatePreset(preset) {
    const list = this.getPresets();
    const existingIndex = list.findIndex(p => p.id === preset.id);

    if (existingIndex >= 0) {
      if (list[existingIndex].isBuiltin) {
        // Built-ins cannot have their core identity modified, but times can be copied to new
        throw new Error('Built-in presets cannot be overwritten. Duplicate it to create a custom preset.');
      }
      list[existingIndex] = { ...list[existingIndex], ...preset, updatedAt: new Date().toISOString() };
    } else {
      const newPreset = {
        id: preset.id || `preset_${Date.now()}`,
        name: preset.name || 'New Custom Preset',
        description: preset.description || 'Custom power schedule',
        isBuiltin: false,
        isRecommended: false,
        ac: preset.ac || { screen: 10, sleep: 30, hibernate: 120, disk: 10 },
        dc: preset.dc || { screen: 5, sleep: 15, hibernate: 45, disk: 5 },
        createdAt: new Date().toISOString()
      };
      list.push(newPreset);
    }

    await this.savePresets(list);
    return list;
  }

  async duplicatePreset(presetId, newName = null) {
    const list = this.getPresets();
    const source = list.find(p => p.id === presetId);
    if (!source) throw new Error(`Preset with ID ${presetId} not found.`);

    const duplicate = {
      ...JSON.parse(JSON.stringify(source)),
      id: `preset_custom_${Date.now()}`,
      name: newName || `${source.name} (Copy)`,
      isBuiltin: false,
      isRecommended: false,
      createdAt: new Date().toISOString()
    };

    list.push(duplicate);
    await this.savePresets(list);
    return duplicate;
  }

  async deletePreset(presetId) {
    const list = this.getPresets();
    const target = list.find(p => p.id === presetId);
    if (!target) throw new Error('Preset not found.');
    if (target.isBuiltin) {
      throw new Error('Built-in presets cannot be deleted.');
    }

    const filtered = list.filter(p => p.id !== presetId);
    await this.savePresets(filtered);
    return filtered;
  }

  async setRecommendedPreset(presetId) {
    const list = this.getPresets();
    const exists = list.some(p => p.id === presetId);
    if (!exists) throw new Error('Preset not found.');

    const updated = list.map(p => ({
      ...p,
      isRecommended: p.id === presetId
    }));
    await this.savePresets(updated);
    return updated;
  }

  // --- BACKUPS ---

  getBackups() {
    const list = this.readJson(this.backupsFile, []);
    return Array.isArray(list) ? list : [];
  }

  async saveBackups(backupsList) {
    await this.atomicWriteJson(this.backupsFile, backupsList);
    return backupsList;
  }

  async createBackup(currentSettings, customName = '') {
    const backups = this.getBackups();
    const now = new Date();
    const name = customName.trim() || `Backup ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const backupEntry = {
      id: `backup_${Date.now()}`,
      name,
      createdAt: now.toISOString(),
      activeSchemeGuid: currentSettings.schemeGuid,
      activeSchemeName: currentSettings.schemeName || 'Power Scheme',
      ac: { ...currentSettings.ac },
      dc: { ...currentSettings.dc }
    };

    // Prepend to list
    backups.unshift(backupEntry);
    await this.saveBackups(backups);
    return backupEntry;
  }

  getPlansDir() {
    const plansDir = path.join(this.baseDir, 'plans');
    this.ensureDirectory(plansDir);
    return plansDir;
  }

  getUnifiedSavedList() {
    const presets = this.getPresets();
    const backups = this.getBackups();

    const builtins = presets.filter(p => p.isBuiltin).map(p => ({
      ...p,
      type: 'preset',
      isBuiltin: true
    }));

    const userPresets = presets.filter(p => !p.isBuiltin).map(p => ({
      ...p,
      type: 'preset',
      isBuiltin: false
    }));

    const backupItems = backups.map(b => ({
      ...b,
      type: b.powFilePath ? 'plan_backup' : 'time_backup',
      isBuiltin: false,
      isRecommended: false
    }));

    const userItems = [...userPresets, ...backupItems].sort((a, b) => {
      const dateA = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const dateB = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return dateB - dateA;
    });

    return [...builtins, ...userItems];
  }

  async savePlanBackup(name, schemeGuid, schemeName, times, powFilePath) {
    const backups = this.getBackups();
    const entry = {
      id: `plan_backup_${Date.now()}`,
      name: name.trim() || `Plan Backup ${new Date().toLocaleDateString()}`,
      createdAt: new Date().toISOString(),
      activeSchemeGuid: schemeGuid,
      activeSchemeName: schemeName || 'Power Scheme',
      powFilePath,
      ac: { ...times.ac },
      dc: { ...times.dc }
    };
    backups.unshift(entry);
    await this.saveBackups(backups);
    return entry;
  }

  async updateUnifiedPreset(id, data = {}) {
    if (!id || typeof id !== 'string') throw new Error('Invalid item ID.');
    const { name, ac, dc } = data;

    const validateMinutes = (val) => {
      const n = Number(val);
      if (isNaN(n) || n < 0 || n > 1440) throw new Error(`Invalid timeout: ${val}. Must be between 0 and 1440 minutes.`);
      return Math.round(n);
    };

    if (id === 'preset_win11_default') {
      throw new Error('Windows 11 Default is a read-only preset. Duplicate it to create an editable copy.');
    }

    if (id === 'preset_recommended') {
      const list = this.getPresets();
      const rec = list.find(p => p.id === 'preset_recommended');
      if (!rec) throw new Error('Recommended preset not found.');
      if (name && typeof name === 'string') rec.name = name.trim();
      if (ac) {
        rec.ac = {
          screen: validateMinutes(ac.screen),
          sleep: validateMinutes(ac.sleep),
          hibernate: validateMinutes(ac.hibernate),
          disk: validateMinutes(ac.disk)
        };
      }
      if (dc) {
        rec.dc = {
          screen: validateMinutes(dc.screen),
          sleep: validateMinutes(dc.sleep),
          hibernate: validateMinutes(dc.hibernate),
          disk: validateMinutes(dc.disk)
        };
      }
      rec.updatedAt = new Date().toISOString();
      rec.isCustomized = true;
      await this.savePresets(list);
      return rec;
    }

    if (id.startsWith('preset_')) {
      const list = this.getPresets();
      const target = list.find(p => p.id === id);
      if (!target) throw new Error(`Preset with ID ${id} not found.`);
      if (name && typeof name === 'string') target.name = name.trim();
      if (ac) {
        target.ac = {
          screen: validateMinutes(ac.screen),
          sleep: validateMinutes(ac.sleep),
          hibernate: validateMinutes(ac.hibernate),
          disk: validateMinutes(ac.disk)
        };
      }
      if (dc) {
        target.dc = {
          screen: validateMinutes(dc.screen),
          sleep: validateMinutes(dc.sleep),
          hibernate: validateMinutes(dc.hibernate),
          disk: validateMinutes(dc.disk)
        };
      }
      target.updatedAt = new Date().toISOString();
      await this.savePresets(list);
      return target;
    } else {
      const backups = this.getBackups();
      const target = backups.find(b => b.id === id);
      if (!target) throw new Error(`Backup with ID ${id} not found.`);
      if (name && typeof name === 'string') target.name = name.trim();
      if (target.type !== 'plan_backup' && !target.powFilePath) {
        if (ac) {
          target.ac = {
            screen: validateMinutes(ac.screen),
            sleep: validateMinutes(ac.sleep),
            hibernate: validateMinutes(ac.hibernate),
            disk: validateMinutes(ac.disk)
          };
        }
        if (dc) {
          target.dc = {
            screen: validateMinutes(dc.screen),
            sleep: validateMinutes(dc.sleep),
            hibernate: validateMinutes(dc.hibernate),
            disk: validateMinutes(dc.disk)
          };
        }
      }
      target.updatedAt = new Date().toISOString();
      await this.saveBackups(backups);
      return target;
    }
  }

  async resetRecommendedPreset() {
    const list = this.getPresets();
    const recIndex = list.findIndex(p => p.id === 'preset_recommended');
    const factory = JSON.parse(JSON.stringify(FACTORY_RECOMMENDED_PRESET));
    if (recIndex >= 0) {
      list[recIndex] = factory;
    } else {
      list.unshift(factory);
    }
    await this.savePresets(list);
    return factory;
  }

  async deleteUnifiedItem(id) {
    if (id.startsWith('preset_')) {
      return await this.deletePreset(id);
    } else {
      return await this.deleteBackup(id);
    }
  }

  async renameUnifiedItem(id, newName) {
    if (id.startsWith('preset_')) {
      const list = this.getPresets();
      const item = list.find(p => p.id === id);
      if (item) {
        item.name = newName.trim();
        await this.savePresets(list);
        return item;
      }
    } else {
      return await this.renameBackup(id, newName);
    }
  }

  async renameBackup(id, newName) {
    const backups = this.getBackups();
    const item = backups.find(b => b.id === id);
    if (!item) throw new Error('Backup not found.');
    item.name = newName.trim() || item.name;
    await this.saveBackups(backups);
    return item;
  }

  async deleteBackup(id) {
    const backups = this.getBackups();
    const filtered = backups.filter(b => b.id !== id);
    await this.saveBackups(filtered);
    return filtered;
  }

  exportBackupJson(id) {
    const backups = this.getBackups();
    const item = backups.find(b => b.id === id);
    if (!item) throw new Error('Backup not found.');
    return JSON.stringify(item, null, 2);
  }

  async importBackupJson(jsonString) {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !parsed.ac || !parsed.dc) {
      throw new Error('Invalid backup JSON format. Must contain ac and dc power settings.');
    }

    const backups = this.getBackups();
    const entry = {
      id: `backup_imported_${Date.now()}`,
      name: parsed.name ? `${parsed.name} (Imported)` : `Imported Backup ${new Date().toLocaleDateString()}`,
      createdAt: new Date().toISOString(),
      activeSchemeGuid: parsed.activeSchemeGuid || null,
      activeSchemeName: parsed.activeSchemeName || 'Imported Scheme',
      ac: {
        screen: Number(parsed.ac.screen) || 0,
        sleep: Number(parsed.ac.sleep) || 0,
        hibernate: Number(parsed.ac.hibernate) || 0,
        disk: Number(parsed.ac.disk) || 0
      },
      dc: {
        screen: Number(parsed.dc.screen) || 0,
        sleep: Number(parsed.dc.sleep) || 0,
        hibernate: Number(parsed.dc.hibernate) || 0,
        disk: Number(parsed.dc.disk) || 0
      }
    };

    backups.unshift(entry);
    await this.saveBackups(backups);
    return entry;
  }

  // --- SETTINGS ---

  getSettings() {
    const saved = this.readJson(this.settingsFile, {});
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  async saveSettings(partial) {
    const current = this.getSettings();
    const merged = { ...current, ...partial };
    await this.atomicWriteJson(this.settingsFile, merged);
    return merged;
  }

  // --- SNAPSHOT FOR AUTO-RESTORE (NEVER MODE) ---

  getPendingRestore() {
    return this.readJson(this.snapshotFile, null);
  }

  async savePendingRestore(snapshot) {
    const existing = this.getPendingRestore();
    if (existing) {
      // Guard: clicking Never twice must not lose the original times!
      return existing;
    }
    await this.atomicWriteJson(this.snapshotFile, {
      ...snapshot,
      createdAt: new Date().toISOString()
    });
    return snapshot;
  }

  async clearPendingRestore() {
    if (fs.existsSync(this.snapshotFile)) {
      try {
        await fs.promises.unlink(this.snapshotFile);
      } catch {
        // file could be missing
      }
    }
    return true;
  }

  // --- OLD BATCH TOOL BACKUP PARSER (.txt) ---

  /**
   * Parse legacy text format:
   * [Mode=AC]
   * Screen=10 min
   * Sleep=Never
   * Hibernate=180 min
   * HardDisk=20 min
   * [Mode=BATTERY]
   * Screen=5 min
   * Sleep=15 min
   * ...
   */
  parseOldBackupText(rawText) {
    const lines = rawText.split(/\r?\n/);
    let currentMode = 'AC'; // default

    const result = {
      name: 'Imported Old Backup',
      ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
      dc: { screen: 5, sleep: 10, hibernate: 20, disk: 5 }
    };

    const parseMinutes = (val) => {
      if (!val) return 0;
      const clean = val.trim().toLowerCase();
      if (clean === 'never' || clean === '0' || clean === 'disabled') return 0;
      const match = clean.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;

      if (/mode\s*=\s*ac/i.test(line) || /\[ac\]/i.test(line)) {
        currentMode = 'AC';
        continue;
      }
      if (/mode\s*=\s*(battery|dc)/i.test(line) || /\[(battery|dc)\]/i.test(line)) {
        currentMode = 'DC';
        continue;
      }

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim().toLowerCase();
      const value = line.slice(eqIndex + 1).trim();
      const minutes = parseMinutes(value);
      const target = currentMode === 'AC' ? result.ac : result.dc;

      if (key.includes('screen') || key.includes('video') || key.includes('display')) {
        target.screen = minutes;
      } else if (key.includes('sleep') || key.includes('standby')) {
        target.sleep = minutes;
      } else if (key.includes('hibernate')) {
        target.hibernate = minutes;
      } else if (key.includes('harddisk') || key.includes('disk') || key.includes('hdd')) {
        target.disk = minutes;
      }
    }

    return result;
  }
}

module.exports = {
  DPW_PLAN_GUID,
  FACTORY_RECOMMENDED_PRESET,
  DEFAULT_PRESETS,
  DEFAULT_SETTINGS,
  StorageEngine
};
