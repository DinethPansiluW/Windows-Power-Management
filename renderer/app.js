/**
 * Power Setting Manager - Windows 11 Fluent 2 Renderer Application
 * 
 * 4-Tab architecture: Dashboard, Presets, Power Plans, Buttons & Lid Manager.
 * Features instant Never mode, 8-input preset/plan editor with min/h toggle,
 * autonomous AC/Battery plan switching, and comprehensive IPC bridge with mock fallback.
 */

(function () {
  'use strict';

  const isElectron = typeof window.api !== 'undefined';

  // --- FACTORY CONSTANTS ---
  const DPW_PLAN_GUID = 'b2c3d4e5-6677-8899-0011-223344556677';

  const FACTORY_RECOMMENDED = {
    ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
    dc: { screen: 5, sleep: 10, hibernate: 30, disk: 5 }
  };

  // --- IN-MEMORY MOCK ENGINE FOR BROWSER PREVIEW ---
  class MockEngine {
    constructor() {
      this.isMaximizedState = false;

      // Realistic Windows Power Plans with DPW Plan as default recommended
      this.schemes = [
        {
          guid: DPW_PLAN_GUID,
          name: 'DPW Plan',
          isActive: true,
          isDefault: true,
          isRecommended: true,
          ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
          dc: { screen: 5, sleep: 10, hibernate: 30, disk: 5 }
        },
        {
          guid: '381b4222-f694-41f0-9685-ff5bb260df2e',
          name: 'Balanced',
          isActive: false,
          isDefault: true,
          ac: { screen: 10, sleep: 30, hibernate: 120, disk: 20 },
          dc: { screen: 5, sleep: 15, hibernate: 60, disk: 10 }
        },
        {
          guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
          name: 'High Performance',
          isActive: false,
          isDefault: true,
          ac: { screen: 20, sleep: 0, hibernate: 0, disk: 0 },
          dc: { screen: 10, sleep: 30, hibernate: 120, disk: 15 }
        },
        {
          guid: 'a1841308-3541-4fab-bc81-f71556f20b4a',
          name: 'Power Saver',
          isActive: false,
          isDefault: true,
          ac: { screen: 5, sleep: 15, hibernate: 45, disk: 5 },
          dc: { screen: 3, sleep: 10, hibernate: 20, disk: 5 }
        },
        {
          guid: 'e5a6b123-9988-44aa-bb77-112233445566',
          name: 'GameTurbo Ultra',
          isActive: false,
          isDefault: false,
          ac: { screen: 30, sleep: 0, hibernate: 0, disk: 0 },
          dc: { screen: 15, sleep: 45, hibernate: 90, disk: 20 }
        },
        {
          guid: 'f7c8d901-2233-4455-6677-8899aabbccdd',
          name: 'Dynamic Boost Performance',
          isActive: false,
          isDefault: false,
          ac: { screen: 15, sleep: 60, hibernate: 180, disk: 10 },
          dc: { screen: 5, sleep: 20, hibernate: 60, disk: 10 }
        }
      ];

      this.currentSettings = {
        schemeGuid: DPW_PLAN_GUID,
        schemeName: 'DPW Plan',
        ac: { ...this.schemes[0].ac },
        dc: { ...this.schemes[0].dc },
        hybridSleep: { ac: 1, dc: 0 },
        buttons: {
          lid: { ac: 1, dc: 1 },
          power: { ac: 3, dc: 3 },
          sleep: { ac: 1, dc: 1 }
        }
      };

      this.hasBattery = true;
      this.hibernateEnabled = true;

      this.savedItems = [
        {
          id: 'preset_recommended',
          type: 'preset',
          name: 'DPW Plan (Recommended)',
          isBuiltin: true,
          isRecommended: true,
          isCustomized: false,
          ac: { ...FACTORY_RECOMMENDED.ac },
          dc: { ...FACTORY_RECOMMENDED.dc }
        },
        {
          id: 'preset_win11_default',
          type: 'preset',
          name: 'Windows 11 Default',
          isBuiltin: true,
          isRecommended: false,
          ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
          dc: { screen: 5, sleep: 10, hibernate: 20, disk: 5 }
        },
        {
          id: 'preset_workstation',
          type: 'preset',
          name: 'Workstation Always-On',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          isBuiltin: false,
          isRecommended: false,
          ac: { screen: 30, sleep: 0, hibernate: 0, disk: 0 },
          dc: { screen: 10, sleep: 45, hibernate: 90, disk: 15 }
        }
      ];

      this.settings = {
        theme: 'system',
        accentColor: '#0078D4',
        startMinimizedToTray: false,
        autoRestoreOnRestart: true,
        restoreTarget: 'previous',
        recommendedPlanGuid: DPW_PLAN_GUID,
        autoPlanSwitch: {
          enabled: false,
          acPlanGuid: DPW_PLAN_GUID,
          dcPlanGuid: 'a1841308-3541-4fab-bc81-f71556f20b4a'
        }
      };

      this.pendingRestore = null;
      this.logs = [
        {
          timestamp: new Date().toISOString(),
          command: 'powercfg.exe /getactivescheme',
          success: true,
          details: `Active scheme: DPW Plan (${DPW_PLAN_GUID})`
        }
      ];
    }

    pushLog(command, success, details) {
      this.logs.unshift({
        timestamp: new Date().toISOString(),
        command,
        success,
        details
      });
      if (this.logs.length > 200) this.logs.pop();
    }

    async minimize() {
      this.pushLog('window:minimize', true, 'Window minimized');
      return true;
    }

    async maximize() {
      this.isMaximizedState = !this.isMaximizedState;
      this.pushLog('window:maximize', true, `Toggled maximize state to ${this.isMaximizedState}`);
      return this.isMaximizedState;
    }

    async isMaximized() {
      return this.isMaximizedState;
    }

    async close() {
      this.pushLog('window:close', true, 'Window closed');
      return true;
    }

    async getPowerSettings(guid = null) {
      if (guid && guid !== this.currentSettings.schemeGuid) {
        const plan = this.schemes.find(s => s.guid === guid);
        if (plan) {
          return {
            schemeGuid: plan.guid,
            schemeName: plan.name,
            ac: { ...plan.ac },
            dc: { ...plan.dc },
            hybridSleep: { ...this.currentSettings.hybridSleep },
            buttons: JSON.parse(JSON.stringify(this.currentSettings.buttons))
          };
        }
      }
      return JSON.parse(JSON.stringify(this.currentSettings));
    }

    async applyPowerSettings(guid, settings) {
      const targetPlan = this.schemes.find(s => s.guid === guid);
      if (targetPlan) {
        if (settings.ac) Object.assign(targetPlan.ac, settings.ac);
        if (settings.dc) Object.assign(targetPlan.dc, settings.dc);
      }
      if (guid === this.currentSettings.schemeGuid) {
        if (settings.ac) Object.assign(this.currentSettings.ac, settings.ac);
        if (settings.dc) Object.assign(this.currentSettings.dc, settings.dc);
      }
      this.pushLog(`powercfg.exe /setactive ${guid}`, true, 'Applied updated timeouts');
      return { success: true };
    }

    async listPowerPlans() {
      return JSON.parse(JSON.stringify(this.schemes));
    }

    async activatePowerPlan(guid) {
      this.schemes.forEach(s => s.isActive = (s.guid === guid));
      const target = this.schemes.find(s => s.guid === guid);
      if (target) {
        this.currentSettings.schemeGuid = target.guid;
        this.currentSettings.schemeName = target.name;
        this.currentSettings.ac = { ...target.ac };
        this.currentSettings.dc = { ...target.dc };
      }
      this.pushLog(`powercfg.exe /setactive ${guid}`, true, `Activated scheme ${target ? target.name : guid}`);
      return { success: true, guid };
    }

    async renamePowerPlan(guid, newName) {
      const target = this.schemes.find(s => s.guid === guid);
      if (!target || target.isDefault) throw new Error('Cannot rename default Windows plans.');
      target.name = newName.trim();
      if (this.currentSettings.schemeGuid === guid) {
        this.currentSettings.schemeName = target.name;
      }
      this.pushLog(`powercfg.exe /changename ${guid} "${target.name}"`, true, 'Renamed custom plan');
      return { success: true, guid, name: target.name };
    }

    async duplicatePowerPlan(guid, customName = null) {
      const source = this.schemes.find(s => s.guid === guid);
      if (!source) throw new Error('Source plan not found.');
      const newGuid = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const name = (customName && customName.trim()) || `${source.name} (Copy)`;
      const newPlan = {
        guid: newGuid,
        name,
        isActive: false,
        isDefault: false,
        ac: { ...source.ac },
        dc: { ...source.dc }
      };
      this.schemes.push(newPlan);
      this.pushLog(`powercfg.exe /duplicatescheme ${guid}`, true, `Duplicated plan to '${name}'`);
      return { success: true, newGuid, name };
    }

    async exportPowerPlan(guid, customName) {
      this.pushLog(`powercfg.exe /export ${guid}`, true, `Exported plan '${customName}'`);
      return { success: true, filePath: `C:\\Mock\\${customName}.pow` };
    }

    async importBundledPlan() {
      const newGuid = 'a5c8d234-91bf-4c7b-a241-9988ee77ff22';
      const newPlan = {
        guid: newGuid,
        name: 'Backup Power Plan (Imported)',
        isActive: true,
        isDefault: false,
        ac: { screen: 10, sleep: 30, hibernate: 90, disk: 15 },
        dc: { screen: 5, sleep: 15, hibernate: 45, disk: 10 }
      };
      this.schemes.forEach(s => s.isActive = false);
      this.schemes.push(newPlan);
      this.currentSettings.schemeGuid = newGuid;
      this.currentSettings.schemeName = newPlan.name;
      this.currentSettings.ac = { ...newPlan.ac };
      this.currentSettings.dc = { ...newPlan.dc };
      this.pushLog('powercfg.exe -import BackupPowerPlan.pow', true, 'Imported bundled plan');
      return { success: true, guid: newGuid };
    }

    async deletePowerPlan(guid) {
      const target = this.schemes.find(s => s.guid === guid);
      if (!target || target.isDefault) throw new Error('Cannot delete default plans.');
      if (target.isActive) {
        await this.activatePowerPlan('381b4222-f694-41f0-9685-ff5bb260df2e');
      }
      this.schemes = this.schemes.filter(s => s.guid !== guid);
      this.pushLog(`powercfg.exe /delete ${guid}`, true, 'Deleted custom plan');
      return { success: true, deletedGuid: guid };
    }

    async getUnifiedSavedList() {
      return JSON.parse(JSON.stringify(this.savedItems));
    }

    async updateUnifiedPreset(id, data) {
      const target = this.savedItems.find(i => i.id === id);
      if (!target) throw new Error('Item not found.');
      if (id === 'preset_win11_default') {
        throw new Error('Windows 11 Default is read-only. Duplicate it to make an editable copy.');
      }
      if (data.name && data.name.trim()) target.name = data.name.trim();
      if (data.ac) target.ac = { ...data.ac };
      if (data.dc) target.dc = { ...data.dc };
      if (id === 'preset_recommended') target.isCustomized = true;
      this.pushLog('storage:updatePreset', true, `Updated '${target.name}'`);
      return { success: true, item: target };
    }

    async resetRecommendedPreset() {
      const rec = this.savedItems.find(i => i.id === 'preset_recommended');
      if (rec) {
        rec.name = 'Recommended';
        rec.ac = { ...FACTORY_RECOMMENDED.ac };
        rec.dc = { ...FACTORY_RECOMMENDED.dc };
        rec.isCustomized = false;
      }
      this.pushLog('storage:resetRecommended', true, 'Reset Recommended preset to factory values');
      return { success: true, item: rec };
    }

    async saveCurrentAsPreset(name, description) {
      const item = {
        id: `preset_${Date.now()}`,
        type: 'preset',
        name: name.trim() || 'Custom Preset',
        description: description || '',
        createdAt: new Date().toISOString(),
        isBuiltin: false,
        isRecommended: false,
        ac: { ...this.currentSettings.ac },
        dc: { ...this.currentSettings.dc }
      };
      this.savedItems.push(item);
      this.pushLog('storage:saveAsPreset', true, `Saved preset '${item.name}'`);
      return { success: true, item };
    }

    async saveCurrentAsPlan(name) {
      const item = {
        id: `plan_backup_${Date.now()}`,
        type: 'plan_backup',
        name: name.trim() || 'Plan Backup',
        createdAt: new Date().toISOString(),
        powFilePath: `C:\\Mock\\${name}.pow`,
        activeSchemeGuid: this.currentSettings.schemeGuid,
        activeSchemeName: this.currentSettings.schemeName,
        ac: { ...this.currentSettings.ac },
        dc: { ...this.currentSettings.dc }
      };
      this.savedItems.push(item);
      this.pushLog(`powercfg.exe /export ${name}.pow`, true, 'Exported .pow plan backup');
      return { success: true, item };
    }

    async applyPlanBackup(filePath) {
      this.pushLog(`powercfg.exe -import ${filePath}`, true, 'Imported and activated plan backup');
      return { success: true };
    }

    async deleteUnifiedItem(id) {
      this.savedItems = this.savedItems.filter(i => i.id !== id);
      return { success: true };
    }

    async renameUnifiedItem(id, newName) {
      const item = this.savedItems.find(i => i.id === id);
      if (item) item.name = newName;
      return { success: true };
    }

    async setRecommendedPreset(id) {
      this.savedItems.forEach(i => {
        if (i.type === 'preset') i.isRecommended = (i.id === id);
      });
      return { success: true };
    }

    async setAutoSwitch(payload) {
      Object.assign(this.settings.autoPlanSwitch, payload);
      this.pushLog('schtasks /create AutoPlanSwitch', true, `Auto-switch configured: ${payload.enabled ? 'ON' : 'OFF'}`);
      return { success: true };
    }

    async getAutoSwitchState() {
      return { ...this.settings.autoPlanSwitch, isTaskRegistered: this.settings.autoPlanSwitch.enabled };
    }

    async parseOldBackupText(text) {
      const lines = text.split(/\r?\n/);
      let mode = 'AC';
      const result = {
        name: 'Imported Old Backup',
        ac: { screen: 10, sleep: 30, hibernate: 120, disk: 20 },
        dc: { screen: 5, sleep: 15, hibernate: 60, disk: 10 }
      };
      const parseVal = (str) => {
        if (!str) return 0;
        const low = str.trim().toLowerCase();
        if (low === 'never' || low === '0') return 0;
        const m = low.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      };
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (/mode\s*=\s*ac/i.test(line)) { mode = 'AC'; continue; }
        if (/mode\s*=\s*(battery|dc)/i.test(line)) { mode = 'DC'; continue; }
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const k = line.slice(0, eq).trim().toLowerCase();
        const v = parseVal(line.slice(eq + 1).trim());
        const tgt = mode === 'AC' ? result.ac : result.dc;
        if (k.includes('screen') || k.includes('video')) tgt.screen = v;
        else if (k.includes('sleep') || k.includes('standby')) tgt.sleep = v;
        else if (k.includes('hibernate')) tgt.hibernate = v;
        else if (k.includes('disk')) tgt.disk = v;
      }
      return result;
    }

    async setNeverMode({ currentSettings, autoRestoreOnRestart, restoreTarget }) {
      if (!this.pendingRestore) {
        this.pendingRestore = {
          activeSchemeGuid: currentSettings.schemeGuid,
          activeSchemeName: currentSettings.schemeName,
          ac: { ...currentSettings.ac },
          dc: { ...currentSettings.dc },
          restoreTarget: restoreTarget || 'previous',
          autoRestoreOnRestart: Boolean(autoRestoreOnRestart),
          createdAt: new Date().toISOString()
        };
      }
      this.currentSettings.ac = { screen: 0, sleep: 0, hibernate: 0, disk: 0 };
      this.currentSettings.dc = { screen: 0, sleep: 0, hibernate: 0, disk: 0 };
      this.pushLog('powercfg.exe Never Mode', true, 'Zeroed out all timeouts');
      return { success: true, snapshot: this.pendingRestore };
    }

    async getPendingRestore() {
      return this.pendingRestore ? JSON.parse(JSON.stringify(this.pendingRestore)) : null;
    }

    async restorePendingNow() {
      if (!this.pendingRestore) throw new Error('No pending snapshot');
      this.currentSettings.ac = { ...this.pendingRestore.ac };
      this.currentSettings.dc = { ...this.pendingRestore.dc };
      this.pendingRestore = null;
      this.pushLog('restoreNow', true, 'Restored previous timeouts');
      return { success: true };
    }

    async cancelPendingRestore() {
      this.pendingRestore = null;
      return { success: true };
    }

    async checkRestoredFlag() {
      return { wasRestored: false };
    }

    async getSettings() {
      return JSON.parse(JSON.stringify(this.settings));
    }

    async saveSettings(partial) {
      Object.assign(this.settings, partial);
      return this.settings;
    }

    async getActivityLog() {
      return JSON.parse(JSON.stringify(this.logs));
    }

    async clearActivityLog() {
      this.logs = [];
      return { success: true };
    }

    async getSleepAvailability() {
      return { s3Supported: true, modernStandby: true, hibernateSupported: true };
    }

    async getHibernateState() {
      return { enabled: this.hibernateEnabled };
    }

    async setHibernateState(enabled) {
      this.hibernateEnabled = Boolean(enabled);
      this.pushLog(`powercfg.exe /hibernate ${enabled ? 'on' : 'off'}`, true, 'Toggled hibernation');
      return { success: true, enabled: this.hibernateEnabled };
    }

    async setHybridSleep(guid, acVal, dcVal) {
      this.currentSettings.hybridSleep = { ac: acVal ? 1 : 0, dc: dcVal ? 1 : 0 };
      this.pushLog('powercfg.exe Hybrid Sleep', true, 'Updated hybrid sleep');
      return { success: true };
    }

    async setButtonAction(guid, buttonType, acVal, dcVal) {
      if (this.currentSettings.buttons[buttonType]) {
        this.currentSettings.buttons[buttonType] = { ac: Number(acVal), dc: Number(dcVal) };
      }
      this.pushLog('powercfg.exe Button Action', true, `Updated ${buttonType}`);
      return { success: true };
    }

    async getBatteryPresence() {
      return { hasBattery: this.hasBattery, isDesktop: !this.hasBattery };
    }

    async openWindowsPowerSettings() {
      this.pushLog('control.exe Microsoft.PowerOptions', true, 'Opened Control Panel');
      return { success: true };
    }

    async openExternalUrl(url) {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      this.pushLog(`shell:openExternal(${url})`, true, 'Opened external social channel');
      return { success: true };
    }
  }

  const api = isElectron ? window.api : new MockEngine();

  // --- APPLICATION STATE ---
  const state = {
    currentTab: 'dashboard', // 'dashboard' | 'presets' | 'plans' | 'buttons'
    powerSettings: null,
    stagedSettings: null,
    stagedButtons: null,
    stagedHybrid: null,
    savedItems: [],
    powerPlans: [],
    planTimesMap: {}, // planGuid -> { ac, dc }
    appSettings: {},
    autoSwitchState: { enabled: false, acPlanGuid: '', dcPlanGuid: '' },
    pendingRestore: null,
    batteryInfo: { hasBattery: true, isDesktop: false },
    hibernateState: { enabled: true },
    logs: [],
    dashboardModified: false,
    buttonsModified: false,
    showNeverMore: false,
    showPlansMore: false
  };

  // --- INITIALIZATION ---
  async function init() {
    setupTitleBar();
    setupTopTabs();

    await loadSettingsAndTheme();
    await refreshAllData();

    // Check if auto-restore occurred after reboot
    try {
      const restored = await api.checkRestoredFlag();
      if (restored && restored.wasRestored) {
        showToast('Your previous power timeouts were restored after restart!', 'success');
      }
    } catch {
      // ignore
    }

    // Auto-refresh when window gains focus
    window.addEventListener('focus', async () => {
      if (!state.dashboardModified && !state.buttonsModified) {
        await refreshAllData();
        renderActiveTab();
      }
    });

    renderActiveTab();
  }

  async function refreshAllData() {
    try {
      const [settings, savedList, plans, battery, hib, pending, logs, autoSwitch] = await Promise.all([
        api.getPowerSettings(),
        api.getUnifiedSavedList(),
        api.listPowerPlans(),
        api.getBatteryPresence(),
        api.getHibernateState(),
        api.getPendingRestore(),
        api.getActivityLog(),
        api.getAutoSwitchState ? api.getAutoSwitchState() : Promise.resolve({ enabled: false })
      ]);

      state.powerSettings = settings;
      state.stagedSettings = JSON.parse(JSON.stringify(settings));
      state.stagedButtons = JSON.parse(JSON.stringify(settings.buttons || {
        lid: { ac: 1, dc: 1 },
        power: { ac: 3, dc: 3 },
        sleep: { ac: 1, dc: 1 }
      }));
      state.stagedHybrid = JSON.parse(JSON.stringify(settings.hybridSleep || { ac: 0, dc: 0 }));
      state.savedItems = savedList || [];
      state.powerPlans = plans || [];
      state.batteryInfo = battery || { hasBattery: true, isDesktop: false };
      state.hibernateState = hib || { enabled: true };
      state.pendingRestore = pending;
      state.logs = logs || [];
      state.autoSwitchState = autoSwitch || { enabled: false };
      state.dashboardModified = false;
      state.buttonsModified = false;

      // Cache times for all power plans so plans tab can show summary line immediately
      for (const plan of state.powerPlans) {
        if (!state.planTimesMap[plan.guid]) {
          try {
            const pSet = await api.getPowerSettings(plan.guid);
            state.planTimesMap[plan.guid] = { ac: pSet.ac, dc: pSet.dc };
          } catch {
            state.planTimesMap[plan.guid] = { ac: settings.ac, dc: settings.dc };
          }
        }
      }

      updateTitleBarChip();
    } catch (err) {
      showToast(`Error refreshing: ${err.message}`, 'error');
    }
  }

  function updateTitleBarChip() {
    const chip = document.getElementById('device-type-chip');
    if (chip) {
      chip.textContent = state.batteryInfo.hasBattery ? 'Laptop' : 'Desktop';
    }
  }

  async function loadSettingsAndTheme() {
    const s = await api.getSettings();
    state.appSettings = s;
    applyTheme(s.theme);
    if (s.accentColor) {
      document.documentElement.style.setProperty('--accent-color', s.accentColor);
    }
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // --- TITLE BAR & TABS ---
  function setupTitleBar() {
    const minBtn = document.getElementById('btn-minimize');
    const maxBtn = document.getElementById('btn-maximize');
    const closeBtn = document.getElementById('btn-close');
    const settingsBtn = document.getElementById('btn-settings-gear');
    const aboutBtn = document.getElementById('btn-about');
    const brandEl = document.getElementById('titlebar-brand');

    if (aboutBtn) {
      aboutBtn.addEventListener('click', openAboutModal);
    }
    if (brandEl) {
      brandEl.addEventListener('click', openAboutModal);
    }
    if (minBtn) {
      minBtn.addEventListener('click', () => isElectron ? api.minimize() : showToast('Minimized (Mock)', 'info'));
    }
    if (maxBtn) {
      maxBtn.addEventListener('click', async () => {
        if (isElectron) {
          await api.maximize();
        } else {
          const isMax = await api.maximize();
          showToast(isMax ? 'Window Maximized (Mock)' : 'Window Restored (Mock)', 'info');
        }
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => isElectron ? api.close() : showToast('Closed (Mock)', 'info'));
    }
    if (settingsBtn) {
      settingsBtn.addEventListener('click', openSettingsModal);
    }
  }

  function setupTopTabs() {
    const tabs = document.querySelectorAll('.tab-pill[data-tab], .tab-btn[data-tab]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        switchTab(tabName);
      });
    });
  }

  function switchTab(tabName) {
    state.currentTab = tabName;
    document.querySelectorAll('.tab-pill, .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    renderActiveTab();
  }

  function renderActiveTab() {
    const viewport = document.getElementById('app-content');
    if (!viewport) return;

    if (state.currentTab === 'dashboard') {
      renderDashboard(viewport);
    } else if (state.currentTab === 'presets') {
      renderPresets(viewport);
    } else if (state.currentTab === 'plans') {
      renderPowerPlans(viewport);
    } else if (state.currentTab === 'buttons') {
      renderButtonsAndLid(viewport);
    }
  }

  function countUnsavedChanges() {
    if (!state.powerSettings || !state.stagedSettings) return 0;
    let count = 0;
    for (const key of ['screen', 'sleep', 'hibernate', 'disk']) {
      if (state.powerSettings.ac[key] !== state.stagedSettings.ac[key]) count++;
      if (state.batteryInfo.hasBattery && state.powerSettings.dc[key] !== state.stagedSettings.dc[key]) count++;
    }
    return count;
  }

  function countUnsavedButtonsChanges() {
    if (!state.powerSettings) return 0;
    let count = 0;
    const origButtons = state.powerSettings.buttons || { lid: { ac: 1, dc: 1 }, power: { ac: 3, dc: 3 }, sleep: { ac: 1, dc: 1 } };
    const origHybrid = state.powerSettings.hybridSleep || { ac: 0, dc: 0 };

    for (const type of ['lid', 'power', 'sleep']) {
      if (origButtons[type].ac !== state.stagedButtons[type].ac) count++;
      if (state.batteryInfo.hasBattery && origButtons[type].dc !== state.stagedButtons[type].dc) count++;
    }
    if (origHybrid.ac !== state.stagedHybrid.ac) count++;
    if (state.batteryInfo.hasBattery && origHybrid.dc !== state.stagedHybrid.dc) count++;
    return count;
  }

  // --- REUSABLE TIMEOUT INPUT COMPONENT WITH CLICKABLE UNIT (min <-> h) ---
  function renderTimeoutInput(mode, setting, valInMinutes, tabIndex, prefix = 'dash') {
    const displayVal = valInMinutes === 0 ? '' : valInMinutes;

    return `
      <div class="input-pill-box" data-mode="${mode}" data-setting="${setting}" data-prefix="${prefix}">
        <input type="number"
               min="0"
               max="1440"
               step="1"
               class="timeout-num-input"
               data-mode="${mode}"
               data-setting="${setting}"
               data-prefix="${prefix}"
               data-unit="min"
               value="${displayVal}"
               placeholder="Never"
               tabindex="${tabIndex}">
        <button type="button"
                tabindex="-1"
                class="unit-toggle-btn"
                title="Click to switch min / h (or press 'h' or 'm')">min</button>
      </div>
    `;
  }

  function setupTimeoutInputs(container, onValueChange) {
    const boxes = container.querySelectorAll('.input-pill-box');

    boxes.forEach((box, index) => {
      const input = box.querySelector('.timeout-num-input');
      const unitBtn = box.querySelector('.unit-toggle-btn');
      if (!input || !unitBtn) return;

      const toggleUnit = () => {
        const currentUnit = input.getAttribute('data-unit') || 'min';
        const rawMinutes = parseInt(input.getAttribute('data-real-minutes') || input.value || '0', 10) || 0;

        if (currentUnit === 'min') {
          // Switch to hours
          input.setAttribute('data-unit', 'h');
          input.setAttribute('data-real-minutes', rawMinutes);
          unitBtn.textContent = 'h';
          input.step = '0.1';
          input.max = '24';
          if (rawMinutes === 0) {
            input.value = '';
          } else {
            const hVal = Math.round((rawMinutes / 60) * 10) / 10;
            input.value = hVal;
          }
        } else {
          // Switch to minutes
          input.setAttribute('data-unit', 'min');
          unitBtn.textContent = 'min';
          input.step = '1';
          input.max = '1440';
          input.value = rawMinutes === 0 ? '' : rawMinutes;
        }
      };

      unitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleUnit();
        input.focus();
        input.select();
      });

      // Handle user numeric entry
      input.addEventListener('input', () => {
        const currentUnit = input.getAttribute('data-unit') || 'min';
        const valStr = input.value.trim();
        let minutes = 0;

        if (valStr !== '') {
          const num = parseFloat(valStr);
          if (!isNaN(num) && num > 0) {
            if (currentUnit === 'h') {
              minutes = Math.min(1440, Math.round(num * 60));
            } else {
              minutes = Math.min(1440, Math.round(num));
            }
          }
        }
        input.setAttribute('data-real-minutes', minutes);
        if (typeof onValueChange === 'function') {
          onValueChange(input, minutes);
        }
      });

      // Keyboard traversal: Tab and Enter go to next input; 'h'/'m' toggles unit
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const allInputs = container.querySelectorAll('.timeout-num-input');
          const nextIndex = (index + 1) % allInputs.length;
          allInputs[nextIndex].focus();
          allInputs[nextIndex].select();
        } else if (e.key.toLowerCase() === 'h') {
          const currentUnit = input.getAttribute('data-unit') || 'min';
          if (currentUnit !== 'h') {
            e.preventDefault();
            toggleUnit();
          }
        } else if (e.key.toLowerCase() === 'm') {
          const currentUnit = input.getAttribute('data-unit') || 'min';
          if (currentUnit !== 'min') {
            e.preventDefault();
            toggleUnit();
          }
        }
      });
    });
  }

  // ==========================================
  // TAB 1: DASHBOARD
  // ==========================================
  function renderDashboard(container) {
    if (!state.stagedSettings) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-tertiary);">Loading timeouts...</div>';
      return;
    }

    const { ac, dc } = state.stagedSettings;
    const isDesktop = !state.batteryInfo.hasBattery;
    const isAllNever = ac.screen === 0 && ac.sleep === 0 && ac.hibernate === 0 && ac.disk === 0 &&
      (!state.batteryInfo.hasBattery || (dc.screen === 0 && dc.sleep === 0 && dc.hibernate === 0 && dc.disk === 0));

    const hasPending = Boolean(state.pendingRestore);
    const autoRestoreChecked = state.appSettings.autoRestoreOnRestart !== false;
    const restoreTarget = (state.pendingRestore && state.pendingRestore.restoreTarget) || state.appSettings.restoreTarget || 'previous';
    const unsavedCount = countUnsavedChanges();
    const activePlanName = state.powerSettings.schemeName || 'Balanced';

    // Warnings calculation
    const warnings = [];
    if (ac.sleep > 0 && ac.screen > 0 && ac.sleep <= ac.screen) {
      warnings.push('Plugged In: Sleep timeout should be longer than display turn-off.');
    }
    if (ac.hibernate > 0 && ac.sleep > 0 && ac.hibernate <= ac.sleep) {
      warnings.push('Plugged In: Hibernate timeout should be longer than sleep.');
    }
    if (!isDesktop) {
      if (dc.sleep > 0 && dc.screen > 0 && dc.sleep <= dc.screen) {
        warnings.push('Battery: Sleep timeout should be longer than display turn-off.');
      }
      if (dc.hibernate > 0 && dc.sleep > 0 && dc.hibernate <= dc.sleep) {
        warnings.push('Battery: Hibernate timeout should be longer than sleep.');
      }
    }

    const items = [
      {
        key: 'screen',
        label: 'Turn off display',
        desc: 'Turns off monitor to conserve power',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`
      },
      {
        key: 'sleep',
        label: 'Sleep',
        desc: 'Puts PC in low-power standby state',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`
      },
      {
        key: 'hibernate',
        label: 'Hibernate',
        desc: 'Saves memory to disk and powers off',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`
      },
      {
        key: 'disk',
        label: 'Turn off hard disk',
        desc: 'Spins down idle mechanical HDDs',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"></line><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line></svg>`
      }
    ];

    container.innerHTML = `
      <!-- 1. Never Mode Hero Card -->
      <section class="card never-hero">
        <div class="never-hero-main">
          <div class="never-hero-left">
            <div class="never-hero-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              </svg>
            </div>
            <div>
              <div class="card-title">Never Mode</div>
              <div class="never-status-badge ${hasPending || isAllNever ? 'active' : 'off'}">
                <span>●</span>
                <span>${hasPending ? 'Active: previous times return after restart' : (isAllNever ? 'Active: all timeouts set to Never' : 'Off: normal power timeouts active')}</span>
                ${hasPending ? '<a id="link-restore-now" class="restore-now-link">[Restore now]</a>' : ''}
              </div>
            </div>
          </div>
          <label class="switch" title="Toggle Never Mode">
            <input type="checkbox" id="chk-never-all" ${isAllNever ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <div class="never-hero-sub">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" id="chk-auto-restore" ${autoRestoreChecked ? 'checked' : ''} style="cursor: pointer; accent-color: var(--accent-color);">
            <span style="font-weight: 500;">Restore my previous times after restart</span>
          </label>
          <button id="btn-toggle-never-more" class="text-link" style="font-size: 12px;">
            ${state.showNeverMore ? '▲ Fewer options' : '▼ More options'}
          </button>
        </div>

        ${state.showNeverMore ? `
          <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 10px; border-top: 1px dashed var(--border-subtle); font-size: 13px;">
            <span style="color: var(--text-secondary);">Target after restart:</span>
            <select id="sel-never-restore-target" class="select-fluent" style="min-width: 200px;">
              <option value="previous" ${restoreTarget === 'previous' ? 'selected' : ''}>My previous times (Snapshot)</option>
              <option value="recommended" ${restoreTarget === 'recommended' ? 'selected' : ''}>Recommended preset</option>
              <option value="win11" ${restoreTarget === 'win11' ? 'selected' : ''}>Windows 11 Default</option>
            </select>
          </div>
        ` : ''}
      </section>

      <!-- 2. Section Header: Timeouts & Preset Fill -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <h2 style="font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.01em;">Power Timeouts</h2>
          <span style="font-size: 11.5px; font-weight: 500; color: var(--accent-color); background-color: var(--accent-subtle); padding: 2px 8px; border-radius: var(--radius-pills); border: 1px solid rgba(0,120,212,0.25);">
            Editing plan: ${escapeHtml(activePlanName)}
          </span>
        </div>
        <select id="sel-fill-preset" class="select-fluent" style="min-width: 180px;">
          <option value="">Fill from preset...</option>
          ${state.savedItems.filter(i => i.type === 'preset').map(p => `
            <option value="${p.id}">${escapeHtml(p.name)}</option>
          `).join('')}
        </select>
      </div>

      <!-- 3. Side-by-Side Cards (AC & Battery) -->
      <div class="dashboard-timeouts-grid ${isDesktop ? 'desktop-mode' : ''}">
        <!-- Plugged In (AC) Card -->
        <section class="card">
          <div class="card-title">
            <div class="icon-tile">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
            </div>
            <span>Plugged In (AC)</span>
          </div>

          <div class="timeout-rows-container">
            ${items.map((item, idx) => {
              const val = ac[item.key];
              const orig = state.powerSettings ? state.powerSettings.ac[item.key] : val;
              const isMod = val !== orig;
              return `
                <div class="timeout-row ${isMod ? 'modified' : ''}" data-mode="ac" data-setting="${item.key}">
                  <div class="timeout-row-info">
                    <div class="icon-tile" style="width: 28px; height: 28px; border-radius: 6px;">
                      ${item.iconSvg}
                    </div>
                    <div class="timeout-texts">
                      <span class="timeout-label">${item.label}</span>
                      <span class="timeout-sub">${item.desc}</span>
                    </div>
                  </div>
                  <div class="timeout-control-pill">
                    ${renderTimeoutInput('ac', item.key, val, idx + 1, 'dash')}
                    <span class="modified-dot"></span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>

        <!-- On Battery (DC) Card (hidden if desktop) -->
        ${!isDesktop ? `
          <section class="card">
            <div class="card-title">
              <div class="icon-tile">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect>
                  <line x1="22" y1="11" x2="22" y2="13"></line>
                </svg>
              </div>
              <span>On Battery</span>
            </div>

            <div class="timeout-rows-container">
              ${items.map((item, idx) => {
                const val = dc[item.key];
                const orig = state.powerSettings ? state.powerSettings.dc[item.key] : val;
                const isMod = val !== orig;
                return `
                  <div class="timeout-row ${isMod ? 'modified' : ''}" data-mode="dc" data-setting="${item.key}">
                    <div class="timeout-row-info">
                      <div class="icon-tile" style="width: 28px; height: 28px; border-radius: 6px;">
                        ${item.iconSvg}
                      </div>
                      <div class="timeout-texts">
                        <span class="timeout-label">${item.label}</span>
                        <span class="timeout-sub">${item.desc}</span>
                      </div>
                    </div>
                    <div class="timeout-control-pill">
                      ${renderTimeoutInput('dc', item.key, val, idx + 5, 'dash')}
                      <span class="modified-dot"></span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </section>
        ` : ''}
      </div>

      ${warnings.length > 0 ? `
        <div style="background-color: var(--warning-light); border: 1px solid rgba(255, 185, 0, 0.4); border-radius: var(--radius-controls); padding: 10px 14px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-primary);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--warning-color); flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>${escapeHtml(warnings[0])}</span>
        </div>
      ` : ''}

      <!-- 4. Floating Glass Action Bar (Bottom Pinned) -->
      <footer class="floating-glass-bar">
        <div class="unsaved-count-indicator ${unsavedCount > 0 ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span id="unsaved-count-text">${unsavedCount === 0 ? 'All changes saved' : `${unsavedCount} unsaved change${unsavedCount > 1 ? 's' : ''}`}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button id="btn-discard-dash" class="text-link ${unsavedCount > 0 ? '' : 'disabled'}">Discard</button>
          <button id="btn-save-dash" class="btn btn-primary" ${unsavedCount > 0 ? '' : 'disabled'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            <span>Save Timeouts</span>
          </button>
        </div>
      </footer>
    `;

    // Setup input unit toggles and numeric behavior
    setupTimeoutInputs(container, (input, minutes) => {
      const mode = input.getAttribute('data-mode');
      const setting = input.getAttribute('data-setting');
      state.stagedSettings[mode][setting] = minutes;
      checkDashboardModified();

      const row = input.closest('.timeout-row');
      const orig = state.powerSettings[mode][setting];
      if (row) {
        row.classList.toggle('modified', minutes !== orig);
      }

      updateDashboardActionBar();
    });

    // Fill from preset dropdown
    const presetSelect = container.querySelector('#sel-fill-preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const id = e.target.value;
        if (!id) return;
        const preset = state.savedItems.find(i => i.id === id);
        if (preset) {
          state.stagedSettings.ac = { ...preset.ac };
          if (state.batteryInfo.hasBattery) {
            state.stagedSettings.dc = { ...preset.dc };
          }
          checkDashboardModified();
          renderDashboard(container);
          showToast(`Filled fields from '${preset.name}'. Click Save to apply.`, 'info');
        }
      });
    }

    // REQUIREMENT 1: NEVER SWITCH IMMEDIATELY (NO POPUP)
    const neverSwitch = container.querySelector('#chk-never-all');
    if (neverSwitch) {
      neverSwitch.addEventListener('change', async (e) => {
        const willBeNever = e.target.checked;
        if (willBeNever) {
          const autoRestore = container.querySelector('#chk-auto-restore').checked;
          const res = await api.setNeverMode({
            currentSettings: state.powerSettings,
            autoRestoreOnRestart: autoRestore,
            restoreTarget: state.appSettings.restoreTarget || 'previous'
          });
          if (res && res.snapshot) state.pendingRestore = res.snapshot;
          await refreshAllData();
          renderDashboard(container);
          showToast('All timeouts set to Never.', 'warning');
        } else {
          if (state.pendingRestore) {
            await api.restorePendingNow();
            state.pendingRestore = null;
            await refreshAllData();
            renderDashboard(container);
            showToast('Restored previous timeouts.', 'success');
          }
        }
      });
    }

    // Auto-restore checkbox
    const autoRestoreChk = container.querySelector('#chk-auto-restore');
    if (autoRestoreChk) {
      autoRestoreChk.addEventListener('change', async (e) => {
        const val = e.target.checked;
        await api.saveSettings({ autoRestoreOnRestart: val });
        state.appSettings.autoRestoreOnRestart = val;
        showToast(`Auto-restore on restart ${val ? 'enabled' : 'disabled'}.`, 'info');
      });
    }

    // Restore Now link
    const restoreNowLink = container.querySelector('#link-restore-now');
    if (restoreNowLink) {
      restoreNowLink.addEventListener('click', async () => {
        await api.restorePendingNow();
        state.pendingRestore = null;
        await refreshAllData();
        renderDashboard(container);
        showToast('Timeouts restored to previous snapshot values!', 'success');
      });
    }

    // Toggle Never More
    const toggleNeverMore = container.querySelector('#btn-toggle-never-more');
    if (toggleNeverMore) {
      toggleNeverMore.addEventListener('click', () => {
        state.showNeverMore = !state.showNeverMore;
        renderDashboard(container);
      });
    }

    // Restore Target select
    const targetSel = container.querySelector('#sel-never-restore-target');
    if (targetSel) {
      targetSel.addEventListener('change', async (e) => {
        await api.saveSettings({ restoreTarget: e.target.value });
        state.appSettings.restoreTarget = e.target.value;
      });
    }

    // Save & Discard in floating bar
    const saveBtn = container.querySelector('#btn-save-dash');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        await saveDashboardChanges();
      });
    }

    const discardBtn = container.querySelector('#btn-discard-dash');
    if (discardBtn) {
      discardBtn.addEventListener('click', () => {
        state.stagedSettings = JSON.parse(JSON.stringify(state.powerSettings));
        state.dashboardModified = false;
        renderDashboard(container);
        showToast('Changes discarded.', 'info');
      });
    }
  }

  function updateDashboardActionBar() {
    const unsavedCount = countUnsavedChanges();
    const saveBtn = document.getElementById('btn-save-dash');
    const discardBtn = document.getElementById('btn-discard-dash');
    const countIndicator = document.querySelector('.unsaved-count-indicator');
    const countText = document.getElementById('unsaved-count-text');

    if (countText) {
      countText.textContent = unsavedCount === 0 ? 'All changes saved' : `${unsavedCount} unsaved change${unsavedCount > 1 ? 's' : ''}`;
    }
    if (countIndicator) {
      countIndicator.classList.toggle('active', unsavedCount > 0);
    }
    if (saveBtn) saveBtn.disabled = unsavedCount === 0;
    if (discardBtn) discardBtn.classList.toggle('disabled', unsavedCount === 0);
  }

  function checkDashboardModified() {
    if (!state.powerSettings || !state.stagedSettings) {
      state.dashboardModified = false;
      return;
    }
    const acChanged = ['screen', 'sleep', 'hibernate', 'disk'].some(
      k => state.powerSettings.ac[k] !== state.stagedSettings.ac[k]
    );
    const dcChanged = state.batteryInfo.hasBattery && ['screen', 'sleep', 'hibernate', 'disk'].some(
      k => state.powerSettings.dc[k] !== state.stagedSettings.dc[k]
    );
    state.dashboardModified = acChanged || dcChanged;
  }

  async function saveDashboardChanges() {
    try {
      const schemeGuid = state.stagedSettings.schemeGuid;
      const res = await api.applyPowerSettings(schemeGuid, {
        ac: state.stagedSettings.ac,
        dc: state.stagedSettings.dc
      });
      if (res && res.error) {
        showToast(`Save error: ${res.error}`, 'error');
        return;
      }
      await refreshAllData();
      renderDashboard(document.getElementById('app-content'));
      showToast('Power timeouts saved successfully!', 'success');
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  // ==========================================
  // TAB 2: PRESETS (ONLY SAVED PRESETS / BACKUPS)
  // ==========================================
  function renderPresets(container) {
    container.innerHTML = `
      <section class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div>
            <div class="card-title">
              <div class="icon-tile">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <span>Saved Presets &amp; Backups</span>
            </div>
            <p style="font-size: var(--text-xs); color: var(--text-secondary); margin-top: 4px;">
              Quick timeout schedules you can apply with one click to the active power plan.
            </p>
          </div>
          <button id="btn-open-save-preset" class="btn btn-primary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            <span>Save current times as preset...</span>
          </button>
        </div>

        <div class="saved-list-box" style="margin-top: 8px;">
          ${state.savedItems.length === 0 ? `
            <div style="padding: 40px 16px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
              No saved presets found. Click "Save current times as preset..." above to create your first schedule.
            </div>
          ` : state.savedItems.map(item => renderPresetRow(item)).join('')}
        </div>
      </section>
    `;

    // Wire up Save Current button
    container.querySelector('#btn-open-save-preset').addEventListener('click', openSavePresetDialog);

    // Apply item
    container.querySelectorAll('.btn-apply-saved').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const item = state.savedItems.find(i => i.id === id);
        if (!item) return;

        if (item.type === 'plan_backup' && item.powFilePath) {
          await api.applyPlanBackup(item.powFilePath);
          await refreshAllData();
          showToast(`Power plan '${item.name}' imported and activated!`, 'success');
        } else {
          await api.applyPowerSettings(state.powerSettings.schemeGuid, { ac: item.ac, dc: item.dc });
          await refreshAllData();
          showToast(`Preset times from '${item.name}' applied to active plan!`, 'success');
        }
        renderActiveTab();
      });
    });

    // REQUIREMENT 2: EDIT PENCIL BUTTON (MODAL WITH 8 INPUTS)
    container.querySelectorAll('.btn-edit-saved').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = state.savedItems.find(i => i.id === id);
        if (item) openEditPresetModal(item);
      });
    });

    // Duplicate button (e.g. for Windows 11 Default)
    container.querySelectorAll('.btn-duplicate-saved').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const item = state.savedItems.find(i => i.id === id);
        if (!item) return;
        openPromptModal('Duplicate Preset', 'Enter name for copy:', `${item.name} (Copy)`, async (newName) => {
          const copy = {
            name: newName,
            ac: { ...item.ac },
            dc: { ...item.dc }
          };
          await api.saveCurrentAsPreset(copy.name, 'Duplicated preset');
          await refreshAllData();
          renderPresets(container);
          showToast(`Duplicated into editable preset '${newName}'!`, 'success');
        });
      });
    });

    // Reset to factory button for Recommended preset
    container.querySelectorAll('.btn-reset-factory-row').forEach(btn => {
      btn.addEventListener('click', () => {
        openConfirmModal('Reset to Factory Values', 'Reset the Recommended preset back to its factory default values (AC 5/15/60/5, Battery 5/10/30/5)?', async () => {
          await api.resetRecommendedPreset();
          await refreshAllData();
          renderPresets(container);
          showToast('Recommended preset restored to factory values.', 'success');
        });
      });
    });

    // Delete item
    container.querySelectorAll('.btn-delete-saved').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = state.savedItems.find(i => i.id === id);
        if (!item || item.isBuiltin) return;
        openConfirmModal('Delete Saved Preset', `Are you sure you want to delete '${item.name}'?`, async () => {
          await api.deleteUnifiedItem(id);
          state.savedItems = await api.getUnifiedSavedList();
          renderPresets(container);
          showToast('Deleted preset.', 'info');
        });
      });
    });

    // Star recommended
    container.querySelectorAll('.btn-star-saved').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await api.setRecommendedPreset(id);
        state.savedItems = await api.getUnifiedSavedList();
        renderPresets(container);
        showToast('Default recommended preset updated.', 'success');
      });
    });
  }

  function renderPresetRow(item) {
    const isPlan = item.type === 'plan_backup';
    const isWin11Default = item.id === 'preset_win11_default';
    const isRecommended = item.id === 'preset_recommended';
    const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';

    const formatTimesBrief = (times) => {
      if (!times || !times.ac) return '';
      return `AC ${times.ac.screen}/${times.ac.sleep}/${times.ac.hibernate}/${times.ac.disk} · Bat ${times.dc.screen}/${times.dc.sleep}/${times.dc.hibernate}/${times.dc.disk}`;
    };

    return `
      <div class="saved-item-row">
        <div class="saved-item-left">
          <div class="icon-tile" style="width: 32px; height: 32px; border-radius: 8px;">
            ${isPlan ? `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            ` : `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            `}
          </div>
          <div class="saved-item-info">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="saved-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
              ${item.isRecommended ? '<span style="color: #f1c40f; font-weight: 600; font-size: 11px;">★ Recommended</span>' : ''}
              ${item.isCustomized ? '<span style="color: var(--text-tertiary); font-size: 10.5px;">(Customized)</span>' : ''}
            </div>
            <div class="saved-item-meta">
              <span class="type-pill">${isPlan ? '.pow Plan' : 'Preset'}</span>
              ${!isPlan ? `<span style="font-variant-numeric: tabular-nums;">${formatTimesBrief(item)}</span>` : ''}
              ${dateStr ? `<span>• ${dateStr}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="saved-item-actions">
          <button class="btn btn-sm btn-apply-saved btn-primary" data-id="${item.id}">Apply</button>

          ${!isWin11Default ? `
            <button class="btn btn-sm btn-edit-saved" data-id="${item.id}" title="Edit times and name">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
            </button>
          ` : `
            <button class="btn btn-sm btn-duplicate-saved" data-id="${item.id}" title="Duplicate to make editable copy">
              Duplicate to edit
            </button>
          `}

          ${isRecommended && item.isCustomized ? `
            <button class="btn btn-sm btn-reset-factory-row" data-id="${item.id}" title="Reset to factory values (5/15/60/5)">
              Reset
            </button>
          ` : ''}

          ${!item.isBuiltin ? `
            <button class="btn btn-sm btn-danger btn-delete-saved" data-id="${item.id}" title="Delete preset">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          ` : ''}

          ${!item.isRecommended && !isWin11Default ? `
            <button class="star-btn btn-star-saved" data-id="${item.id}" title="Set as recommended preset">★</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function openSavePresetDialog() {
    openPromptModal('Save Current Times as Preset', 'Preset Name:', `Custom Preset ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`, async (name) => {
      await api.saveCurrentAsPreset(name);
      await refreshAllData();
      renderActiveTab();
      showToast(`Saved preset '${name}'!`, 'success');
    });
  }

  // REQUIREMENT 2: EDIT MODAL WITH 8 INPUTS (OR NAME ONLY FOR .pow)
  function openEditPresetModal(item) {
    const isPlan = item.type === 'plan_backup';
    const isRecommended = item.id === 'preset_recommended';
    const ac = item.ac || { screen: 10, sleep: 30, hibernate: 120, disk: 10 };
    const dc = item.dc || { screen: 5, sleep: 15, hibernate: 60, disk: 5 };

    const bodyHtml = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px;">Preset Name:</label>
          <input type="text" id="modal-edit-name" class="select-fluent" value="${escapeHtml(item.name)}" style="width: 100%;">
        </div>

        ${!isPlan ? `
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 12px; font-weight: 600;">Timeouts (0 or empty = Never):</span>
              ${isRecommended ? '<button id="modal-btn-reset-factory" class="text-link" style="font-size: 11.5px;">↺ Reset to factory values</button>' : ''}
            </div>

            <div class="edit-timeout-grid">
              <!-- AC Column -->
              <div class="edit-column-box">
                <div class="edit-column-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  <span>Plugged In (AC)</span>
                </div>
                <div class="edit-input-row">
                  <span>Display off:</span>
                  ${renderTimeoutInput('ac', 'screen', ac.screen, 1, 'edit')}
                </div>
                <div class="edit-input-row">
                  <span>Sleep:</span>
                  ${renderTimeoutInput('ac', 'sleep', ac.sleep, 2, 'edit')}
                </div>
                <div class="edit-input-row">
                  <span>Hibernate:</span>
                  ${renderTimeoutInput('ac', 'hibernate', ac.hibernate, 3, 'edit')}
                </div>
                <div class="edit-input-row">
                  <span>Hard disk:</span>
                  ${renderTimeoutInput('ac', 'disk', ac.disk, 4, 'edit')}
                </div>
              </div>

              <!-- DC Column -->
              <div class="edit-column-box">
                <div class="edit-column-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg>
                  <span>On Battery</span>
                </div>
                <div class="edit-input-row">
                  <span>Display off:</span>
                  ${renderTimeoutInput('dc', 'screen', dc.screen, 5, 'edit')}
                </div>
                <div class="edit-input-row">
                  <span>Sleep:</span>
                  ${renderTimeoutInput('dc', 'sleep', dc.sleep, 6, 'edit')}
                </div>
                <div class="edit-input-row">
                  <span>Hibernate:</span>
                  ${renderTimeoutInput('dc', 'hibernate', dc.hibernate, 7, 'edit')}
                </div>
                <div class="edit-input-row">
                  <span>Hard disk:</span>
                  ${renderTimeoutInput('dc', 'disk', dc.disk, 8, 'edit')}
                </div>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    const stagedEdit = {
      name: item.name,
      ac: { ...ac },
      dc: { ...dc }
    };

    const modal = createModal(`Edit ${isPlan ? 'Plan Backup' : 'Preset'}`, bodyHtml, 'Save Changes', async () => {
      const newName = document.getElementById('modal-edit-name').value.trim();
      if (!newName) {
        showToast('Name cannot be empty.', 'error');
        return;
      }
      stagedEdit.name = newName;

      await api.updateUnifiedPreset(item.id, stagedEdit);
      await refreshAllData();
      renderActiveTab();
      modal.close();
      showToast(`Updated '${newName}'!`, 'success');
    });

    // Wire up unit toggles and inputs in modal
    setupTimeoutInputs(document.querySelector('.modal-content'), (input, minutes) => {
      const mode = input.getAttribute('data-mode');
      const setting = input.getAttribute('data-setting');
      stagedEdit[mode][setting] = minutes;
    });

    // Factory reset action in modal
    const resetFactoryBtn = document.getElementById('modal-btn-reset-factory');
    if (resetFactoryBtn) {
      resetFactoryBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await api.resetRecommendedPreset();
        await refreshAllData();
        modal.close();
        renderActiveTab();
        showToast('Recommended preset reset to factory values!', 'success');
      });
    }
  }

  // ==========================================
  // TAB 3: POWER PLANS (NEW 4TH TAB)
  // ==========================================
  function renderPowerPlans(container) {
    const activeScheme = state.powerPlans.find(p => p.isActive) || { name: 'DPW Plan', guid: DPW_PLAN_GUID };
    const recommendedPlanGuid = state.appSettings.recommendedPlanGuid || DPW_PLAN_GUID;
    const autoSwitch = state.autoSwitchState || { enabled: false, acPlanGuid: '', dcPlanGuid: '' };

    const acSelectedPlan = autoSwitch.acPlanGuid || DPW_PLAN_GUID;
    const dcSelectedPlan = autoSwitch.dcPlanGuid || 'a1841308-3541-4fab-bc81-f71556f20b4a';

    const acPlanObj = state.powerPlans.find(p => p.guid === acSelectedPlan);
    const dcPlanObj = state.powerPlans.find(p => p.guid === dcSelectedPlan);

    container.innerHTML = `
      <!-- A) Intro Line -->
      <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; padding: 2px 4px;">
        A power plan is a full set of power settings. Only one plan is active at a time. The times on the Dashboard belong to the active plan.
      </div>

      <!-- B) Auto-Switch by Power Source Card -->
      <section class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div class="card-title">
            <div class="icon-tile">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 3 21 3 21 8"></polyline>
                <line x1="4" y1="20" x2="21" y2="3"></line>
                <polyline points="21 16 21 21 16 21"></polyline>
                <line x1="15" y1="15" x2="21" y2="21"></line>
                <line x1="4" y1="4" x2="9" y2="9"></line>
              </svg>
            </div>
            <span>Auto-switch by power source</span>
          </div>
          <label class="switch" title="Toggle Auto Plan Switching">
            <input type="checkbox" id="chk-auto-plan-switch" ${autoSwitch.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <p style="font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: 12px;">
          Automatically changes the active Windows power plan whenever you plug in or unplug your charger using a Windows scheduled task.
        </p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">When plugged in (AC) use:</label>
            <select id="sel-auto-switch-ac" class="select-fluent" style="width: 100%;">
              ${state.powerPlans.map(p => `
                <option value="${p.guid}" ${p.guid === acSelectedPlan ? 'selected' : ''}>${escapeHtml(p.name)}</option>
              `).join('')}
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">On battery use:</label>
            <select id="sel-auto-switch-dc" class="select-fluent" style="width: 100%;">
              ${state.powerPlans.map(p => `
                <option value="${p.guid}" ${p.guid === dcSelectedPlan ? 'selected' : ''}>${escapeHtml(p.name)}</option>
              `).join('')}
            </select>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
          <span style="font-size: 12px; color: ${autoSwitch.enabled ? 'var(--success-color)' : 'var(--text-tertiary)'}; font-weight: 500;">
            ${autoSwitch.enabled ? `● Active: AC uses ${acPlanObj ? acPlanObj.name : 'Selected'}, Battery uses ${dcPlanObj ? dcPlanObj.name : 'Selected'}` : '○ Auto-switch is currently disabled'}
          </span>
          <button id="btn-save-auto-switch" class="btn btn-sm btn-primary">Save Auto-Switch</button>
        </div>
      </section>

      <!-- C) List of ALL Plans -->
      <section class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div class="card-title">
            <div class="icon-tile">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </div>
            <span>All Windows Power Plans</span>
          </div>

          <button id="btn-use-recommended-plan" class="btn btn-sm btn-primary">
            ★ Use recommended plan (${escapeHtml((state.powerPlans.find(p => p.guid === recommendedPlanGuid) || { name: 'Balanced' }).name)})
          </button>
        </div>

        <div class="plan-list-box">
          ${state.powerPlans.map(plan => renderPlanRow(plan, activeScheme.guid, recommendedPlanGuid)).join('')}
        </div>

        <!-- D) Small "More" Expander -->
        <div style="margin-top: 14px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12.5px; font-weight: 600; color: var(--text-secondary);">Advanced Plan Options</span>
            <button id="btn-toggle-plans-more" class="text-link" style="font-size: 12px;">
              ${state.showPlansMore ? '▲ Hide' : '▼ More options (Import / Backup)'}
            </button>
          </div>

          ${state.showPlansMore ? `
            <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px; background-color: var(--bg-tile); padding: 12px; border-radius: var(--radius-controls); border: 1px solid var(--border-subtle);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-weight: 500; font-size: 13px;">Import Bundled Power Plan (.pow)</div>
                  <div style="font-size: 11px; color: var(--text-secondary);">assets/BackupPowerPlan.pow</div>
                </div>
                <button id="btn-import-bundled-pow" class="btn btn-sm">Import .pow Plan</button>
              </div>

              <div style="border-top: 1px dashed var(--border-subtle); padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-weight: 500; font-size: 13px;">Backup Active Plan to File</div>
                  <div style="font-size: 11px; color: var(--text-secondary);">Exports ${escapeHtml(activeScheme.name)} to userData/plans</div>
                </div>
                <button id="btn-backup-active-plan" class="btn btn-sm">Backup to File</button>
              </div>
            </div>
          ` : ''}
        </div>
      </section>
    `;

    // Auto-switch toggle & save
    container.querySelector('#btn-save-auto-switch').addEventListener('click', async () => {
      const enabled = container.querySelector('#chk-auto-plan-switch').checked;
      const acPlanGuid = container.querySelector('#sel-auto-switch-ac').value;
      const dcPlanGuid = container.querySelector('#sel-auto-switch-dc').value;

      await api.setAutoSwitch({ enabled, acPlanGuid, dcPlanGuid });
      await refreshAllData();
      renderPowerPlans(container);
      showToast(enabled ? 'Auto-switch enabled with Windows scheduled task!' : 'Auto-switch disabled.', 'success');
    });

    // "Use recommended plan" button
    container.querySelector('#btn-use-recommended-plan').addEventListener('click', async () => {
      await api.activatePowerPlan(recommendedPlanGuid);
      await refreshAllData();
      renderPowerPlans(container);
      showToast('Switched to recommended plan!', 'success');
    });

    // Activate plan
    container.querySelectorAll('.btn-activate-plan').forEach(btn => {
      btn.addEventListener('click', async () => {
        const guid = btn.getAttribute('data-guid');
        await api.activatePowerPlan(guid);
        await refreshAllData();
        renderPowerPlans(container);
        showToast('Active Windows power plan switched!', 'success');
      });
    });

    // Edit times of plan (even when not active)
    container.querySelectorAll('.btn-edit-plan-times').forEach(btn => {
      btn.addEventListener('click', async () => {
        const guid = btn.getAttribute('data-guid');
        const plan = state.powerPlans.find(p => p.guid === guid);
        if (plan) openEditPlanTimesModal(plan);
      });
    });

    // Rename custom plan
    container.querySelectorAll('.btn-rename-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        const guid = btn.getAttribute('data-guid');
        const plan = state.powerPlans.find(p => p.guid === guid);
        if (!plan) return;
        openPromptModal('Rename Power Plan', 'Enter new plan name:', plan.name, async (newName) => {
          await api.renamePowerPlan(guid, newName);
          await refreshAllData();
          renderPowerPlans(container);
          showToast(`Renamed plan to '${newName}'!`, 'success');
        });
      });
    });

    // Duplicate plan
    container.querySelectorAll('.btn-duplicate-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        const guid = btn.getAttribute('data-guid');
        const plan = state.powerPlans.find(p => p.guid === guid);
        if (!plan) return;
        openPromptModal('Duplicate Power Plan', 'Enter name for copy:', `${plan.name} (Copy)`, async (copyName) => {
          await api.duplicatePowerPlan(guid, copyName);
          await refreshAllData();
          renderPowerPlans(container);
          showToast(`Duplicated plan into '${copyName}'!`, 'success');
        });
      });
    });

    // Star recommended plan
    container.querySelectorAll('.star-plan-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const guid = btn.getAttribute('data-guid');
        await api.saveSettings({ recommendedPlanGuid: guid });
        state.appSettings.recommendedPlanGuid = guid;
        renderPowerPlans(container);
        showToast('Default recommended power plan updated.', 'success');
      });
    });

    // Delete custom plan
    container.querySelectorAll('.btn-delete-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        const guid = btn.getAttribute('data-guid');
        const plan = state.powerPlans.find(p => p.guid === guid);
        if (!plan || plan.isDefault) return;
        openConfirmModal('Delete Custom Plan', `Delete power plan '${plan.name}'? ${plan.isActive ? 'The system will switch back to Balanced first.' : ''}`, async () => {
          await api.deletePowerPlan(guid);
          await refreshAllData();
          renderPowerPlans(container);
          showToast('Custom power plan deleted.', 'info');
        });
      });
    });

    // Expander toggle
    const togglePlansMore = container.querySelector('#btn-toggle-plans-more');
    if (togglePlansMore) {
      togglePlansMore.addEventListener('click', () => {
        state.showPlansMore = !state.showPlansMore;
        renderPowerPlans(container);
      });
    }

    // Import bundled pow
    const bundledBtn = container.querySelector('#btn-import-bundled-pow');
    if (bundledBtn) {
      bundledBtn.addEventListener('click', async () => {
        await api.importBundledPlan();
        await refreshAllData();
        renderPowerPlans(container);
        showToast('Bundled BackupPowerPlan.pow imported & activated!', 'success');
      });
    }

    // Backup active plan
    const backupActiveBtn = container.querySelector('#btn-backup-active-plan');
    if (backupActiveBtn) {
      backupActiveBtn.addEventListener('click', async () => {
        await api.exportPowerPlan(activeScheme.guid, activeScheme.name);
        await api.saveCurrentAsPlan(activeScheme.name);
        await refreshAllData();
        showToast(`Exported .pow backup of '${activeScheme.name}'!`, 'success');
      });
    }
  }

  function renderPlanRow(plan, activeGuid, recommendedGuid) {
    const isActive = plan.guid === activeGuid;
    const isRecommended = plan.guid === recommendedGuid;
    const times = state.planTimesMap[plan.guid] || {
      ac: { screen: 10, sleep: 30, hibernate: 120, disk: 20 },
      dc: { screen: 5, sleep: 15, hibernate: 60, disk: 10 }
    };

    const timeSummary = `AC ${times.ac.screen}/${times.ac.sleep}/${times.ac.hibernate}/${times.ac.disk} · Battery ${times.dc.screen}/${times.dc.sleep}/${times.dc.hibernate}/${times.dc.disk}`;

    return `
      <div class="plan-card-item ${isActive ? 'active' : ''}">
        <div class="plan-card-item-left">
          <div class="icon-tile" style="width: 32px; height: 32px; border-radius: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
          </div>
          <div class="plan-card-info">
            <div class="plan-card-title-row">
              <span class="plan-card-name">${escapeHtml(plan.name)}</span>
              ${isActive ? '<span class="active-pill-badge">Active</span>' : ''}
              ${isRecommended ? '<span style="color: #f1c40f; font-weight: 600; font-size: 11px;">★ Recommended</span>' : ''}
              <span class="type-pill">${plan.isDefault ? 'Built-in' : 'Custom'}</span>
            </div>
            <div class="plan-times-summary">
              <span>${timeSummary}</span>
            </div>
          </div>
        </div>

        <div class="plan-card-actions">
          ${isActive ? `
            <span style="font-size: 12px; color: var(--success-color); font-weight: 600; padding: 4px 8px;">In use</span>
          ` : `
            <button class="btn btn-sm btn-primary btn-activate-plan" data-guid="${plan.guid}">Activate</button>
          `}

          <button class="btn btn-sm btn-edit-plan-times" data-guid="${plan.guid}" title="Edit times for this plan">
            Edit times
          </button>

          ${!plan.isDefault ? `
            <button class="btn btn-sm btn-rename-plan" data-guid="${plan.guid}" title="Rename scheme">
              Rename
            </button>
          ` : ''}

          <button class="btn btn-sm btn-duplicate-plan" data-guid="${plan.guid}" title="Duplicate plan">
            Duplicate
          </button>

          <button class="star-btn star-plan-btn ${isRecommended ? 'active' : ''}" data-guid="${plan.guid}" title="Mark as recommended plan">
            ★
          </button>

          ${!plan.isDefault ? `
            <button class="btn btn-sm btn-danger btn-delete-plan" data-guid="${plan.guid}" title="Delete custom plan">
              ✕
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function openEditPlanTimesModal(plan) {
    const isDpwOrRecommended = plan.guid === DPW_PLAN_GUID || plan.name === 'DPW Plan' || plan.guid === (state.appSettings.recommendedPlanGuid || DPW_PLAN_GUID);
    const times = state.planTimesMap[plan.guid] || (isDpwOrRecommended ? {
      ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
      dc: { screen: 5, sleep: 10, hibernate: 30, disk: 5 }
    } : {
      ac: { screen: 10, sleep: 30, hibernate: 120, disk: 10 },
      dc: { screen: 5, sleep: 15, hibernate: 60, disk: 5 }
    });

    const staged = {
      ac: { ...times.ac },
      dc: { ...times.dc }
    };

    const bodyHtml = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="font-size: 13px; color: var(--text-secondary);">
            Configure timeout values for <strong style="color: var(--text-primary);">${escapeHtml(plan.name)}</strong>. (0 or empty = Never).
          </div>
          ${isDpwOrRecommended ? '<button id="modal-btn-plan-reset-defaults" class="text-link" style="font-size: 11.5px; white-space: nowrap;">↺ Reset to default</button>' : ''}
        </div>

        <div class="edit-timeout-grid">
          <div class="edit-column-box">
            <div class="edit-column-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              <span>Plugged In (AC)</span>
            </div>
            <div class="edit-input-row">
              <span>Display off:</span>
              ${renderTimeoutInput('ac', 'screen', staged.ac.screen, 1, 'edit-plan')}
            </div>
            <div class="edit-input-row">
              <span>Sleep:</span>
              ${renderTimeoutInput('ac', 'sleep', staged.ac.sleep, 2, 'edit-plan')}
            </div>
            <div class="edit-input-row">
              <span>Hibernate:</span>
              ${renderTimeoutInput('ac', 'hibernate', staged.ac.hibernate, 3, 'edit-plan')}
            </div>
            <div class="edit-input-row">
              <span>Hard disk:</span>
              ${renderTimeoutInput('ac', 'disk', staged.ac.disk, 4, 'edit-plan')}
            </div>
          </div>

          <div class="edit-column-box">
            <div class="edit-column-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg>
              <span>On Battery</span>
            </div>
            <div class="edit-input-row">
              <span>Display off:</span>
              ${renderTimeoutInput('dc', 'screen', staged.dc.screen, 5, 'edit-plan')}
            </div>
            <div class="edit-input-row">
              <span>Sleep:</span>
              ${renderTimeoutInput('dc', 'sleep', staged.dc.sleep, 6, 'edit-plan')}
            </div>
            <div class="edit-input-row">
              <span>Hibernate:</span>
              ${renderTimeoutInput('dc', 'hibernate', staged.dc.hibernate, 7, 'edit-plan')}
            </div>
            <div class="edit-input-row">
              <span>Hard disk:</span>
              ${renderTimeoutInput('dc', 'disk', staged.dc.disk, 8, 'edit-plan')}
            </div>
          </div>
        </div>
      </div>
    `;

    const modal = createModal(`Edit Times: ${plan.name}`, bodyHtml, 'Save Times', async () => {
      await api.applyPowerSettings(plan.guid, staged);
      state.planTimesMap[plan.guid] = { ...staged };
      await refreshAllData();
      renderActiveTab();
      modal.close();
      showToast(`Updated times for '${plan.name}'!`, 'success');
    });

    setupTimeoutInputs(document.querySelector('.modal-content'), (input, minutes) => {
      const mode = input.getAttribute('data-mode');
      const setting = input.getAttribute('data-setting');
      staged[mode][setting] = minutes;
    });

    const resetPlanBtn = document.getElementById('modal-btn-plan-reset-defaults');
    if (resetPlanBtn) {
      resetPlanBtn.addEventListener('click', (e) => {
        e.preventDefault();
        staged.ac = { screen: 5, sleep: 15, hibernate: 60, disk: 5 };
        staged.dc = { screen: 5, sleep: 10, hibernate: 30, disk: 5 };
        ['ac', 'dc'].forEach(mode => {
          ['screen', 'sleep', 'hibernate', 'disk'].forEach(setting => {
            const input = document.querySelector(`.modal-content .timeout-num-input[data-mode="${mode}"][data-setting="${setting}"]`);
            if (input) {
              input.value = staged[mode][setting] || '';
              input.classList.remove('modified');
            }
          });
        });
        showToast('Reset to DPW Plan recommended defaults (5/15/60/5)!', 'info');
      });
    }
  }

  // ==========================================
  // TAB 4: BUTTONS & LID MANAGER
  // ==========================================
  function renderButtonsAndLid(container) {
    const buttons = state.stagedButtons || {
      lid: { ac: 1, dc: 1 },
      power: { ac: 3, dc: 3 },
      sleep: { ac: 1, dc: 1 }
    };
    const hybrid = state.stagedHybrid || { ac: 0, dc: 0 };
    const hibEnabled = state.hibernateState.enabled;
    const isDesktop = !state.batteryInfo.hasBattery;
    const unsavedCount = countUnsavedButtonsChanges();

    container.innerHTML = `
      <div class="buttons-grid">
        <section class="card">
          <div class="card-title">
            <div class="icon-tile">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                <line x1="12" y1="2" x2="12" y2="12"></line>
              </svg>
            </div>
            <span>Physical Buttons &amp; Lid Actions</span>
          </div>

          <table class="actions-table">
            <thead>
              <tr>
                <th style="width: 40%;">Physical Action</th>
                <th style="width: 30%;">Plugged In (AC)</th>
                ${!isDesktop ? '<th style="width: 30%;">On Battery</th>' : ''}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div style="font-weight: 500;">Closing the lid</div>
                  <div style="font-size: 11px; color: var(--text-secondary);">When notebook lid is closed</div>
                </td>
                <td>${renderActionSelect('lid', 'ac', buttons.lid.ac)}</td>
                ${!isDesktop ? `<td>${renderActionSelect('lid', 'dc', buttons.lid.dc)}</td>` : ''}
              </tr>
              <tr>
                <td>
                  <div style="font-weight: 500;">Pressing power button</div>
                  <div style="font-size: 11px; color: var(--text-secondary);">Hardware power button on chassis</div>
                </td>
                <td>${renderActionSelect('power', 'ac', buttons.power.ac)}</td>
                ${!isDesktop ? `<td>${renderActionSelect('power', 'dc', buttons.power.dc)}</td>` : ''}
              </tr>
              <tr>
                <td>
                  <div style="font-weight: 500;">Pressing sleep button</div>
                  <div style="font-size: 11px; color: var(--text-secondary);">Dedicated keyboard or PC sleep key</div>
                </td>
                <td>${renderActionSelect('sleep', 'ac', buttons.sleep.ac)}</td>
                ${!isDesktop ? `<td>${renderActionSelect('sleep', 'dc', buttons.sleep.dc)}</td>` : ''}
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <div class="card-title" style="margin-bottom: 12px;">
            <div class="icon-tile">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            </div>
            <span>System Sleep &amp; Hibernation Features</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background-color: var(--bg-tile); border-radius: var(--radius-controls); border: 1px solid var(--border-subtle);">
              <div>
                <div style="font-weight: 500; font-size: 13.5px;">Enable Windows Hibernation</div>
                <div style="font-size: 11.5px; color: var(--text-secondary);">Enables system sleep state S4 and C:\\hiberfil.sys file allocation</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="chk-toggle-hibernate" ${hibEnabled ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background-color: var(--bg-tile); border-radius: var(--radius-controls); border: 1px solid var(--border-subtle);">
              <div>
                <div style="font-weight: 500; font-size: 13.5px;">Hybrid Sleep (Plugged In)</div>
                <div style="font-size: 11.5px; color: var(--text-secondary);">Writes RAM contents to disk during standard sleep to protect against power outage</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="chk-hybrid-ac" ${hybrid.ac ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            ${!isDesktop ? `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background-color: var(--bg-tile); border-radius: var(--radius-controls); border: 1px solid var(--border-subtle);">
                <div>
                  <div style="font-weight: 500; font-size: 13.5px;">Hybrid Sleep (On Battery)</div>
                  <div style="font-size: 11.5px; color: var(--text-secondary);">Saves memory state when sleeping on portable battery power</div>
                </div>
                <label class="switch">
                  <input type="checkbox" id="chk-hybrid-dc" ${hybrid.dc ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            ` : ''}
          </div>

          <div style="display: flex; justify-content: flex-start; margin-top: 14px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
            <button id="btn-open-cpanel-fallback" class="text-link" style="display: flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              <span>Open classic Windows Control Panel Power Options</span>
            </button>
          </div>
        </section>
      </div>

      <footer class="floating-glass-bar">
        <div class="unsaved-count-indicator ${unsavedCount > 0 ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span id="unsaved-buttons-count-text">${unsavedCount === 0 ? 'No hardware button changes' : `${unsavedCount} unsaved button change${unsavedCount > 1 ? 's' : ''}`}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button id="btn-discard-buttons" class="text-link ${unsavedCount > 0 ? '' : 'disabled'}">Discard</button>
          <button id="btn-save-buttons" class="btn btn-primary" ${unsavedCount > 0 ? '' : 'disabled'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            <span>Save Actions</span>
          </button>
        </div>
      </footer>
    `;

    // Action selects
    container.querySelectorAll('.action-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const type = e.target.getAttribute('data-type');
        const mode = e.target.getAttribute('data-mode');
        state.stagedButtons[type][mode] = parseInt(e.target.value, 10);
        checkButtonsModified();
        renderButtonsAndLid(container);
      });
    });

    // Hibernate toggle
    const hibChk = container.querySelector('#chk-toggle-hibernate');
    if (hibChk) {
      hibChk.addEventListener('change', async (e) => {
        const val = e.target.checked;
        await api.setHibernateState(val);
        state.hibernateState.enabled = val;
        showToast(`Hibernation ${val ? 'enabled' : 'disabled'}.`, 'success');
      });
    }

    // Hybrid sleep toggles
    const hybridAcChk = container.querySelector('#chk-hybrid-ac');
    const hybridDcChk = container.querySelector('#chk-hybrid-dc');
    const onHybridChange = () => {
      state.stagedHybrid.ac = hybridAcChk.checked ? 1 : 0;
      if (hybridDcChk) state.stagedHybrid.dc = hybridDcChk.checked ? 1 : 0;
      checkButtonsModified();
      renderButtonsAndLid(container);
    };
    if (hybridAcChk) hybridAcChk.addEventListener('change', onHybridChange);
    if (hybridDcChk) hybridDcChk.addEventListener('change', onHybridChange);

    // Control Panel fallback
    container.querySelector('#btn-open-cpanel-fallback').addEventListener('click', () => {
      api.openWindowsPowerSettings();
      showToast('Opened Windows Power Options.', 'info');
    });

    // Save & Discard
    container.querySelector('#btn-save-buttons').addEventListener('click', async () => {
      await saveButtonsChanges();
    });

    container.querySelector('#btn-discard-buttons').addEventListener('click', () => {
      state.stagedButtons = JSON.parse(JSON.stringify(state.powerSettings.buttons));
      state.stagedHybrid = JSON.parse(JSON.stringify(state.powerSettings.hybridSleep));
      state.buttonsModified = false;
      renderButtonsAndLid(container);
      showToast('Button changes discarded.', 'info');
    });
  }

  function renderActionSelect(type, mode, currentVal) {
    const orig = state.powerSettings.buttons ? state.powerSettings.buttons[type][mode] : currentVal;
    const isModified = currentVal !== orig;
    const actions = [
      { val: 0, label: 'Do nothing' },
      { val: 1, label: 'Sleep' },
      { val: 2, label: 'Hibernate' },
      { val: 3, label: 'Shut down' }
    ];

    return `
      <select class="select-fluent action-select" data-type="${type}" data-mode="${mode}" style="${isModified ? 'border-color: var(--accent-color); background-color: var(--accent-subtle);' : ''}">
        ${actions.map(a => `
          <option value="${a.val}" ${a.val === currentVal ? 'selected' : ''}>${a.label}</option>
        `).join('')}
      </select>
    `;
  }

  function checkButtonsModified() {
    state.buttonsModified = countUnsavedButtonsChanges() > 0;
  }

  async function saveButtonsChanges() {
    try {
      const schemeGuid = state.powerSettings.schemeGuid;
      for (const type of ['lid', 'power', 'sleep']) {
        await api.setButtonAction(schemeGuid, type, state.stagedButtons[type].ac, state.stagedButtons[type].dc);
      }
      await api.setHybridSleep(schemeGuid, state.stagedHybrid.ac, state.stagedHybrid.dc);

      await refreshAllData();
      renderButtonsAndLid(document.getElementById('app-content'));
      showToast('Hardware button and sleep behaviors saved!', 'success');
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  // ==========================================
  // SETTINGS MODAL (GEAR ICON)
  // ==========================================
  function openSettingsModal() {
    const modal = createModal('Settings & Utilities', `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Theme & Accent -->
        <div>
          <label style="display: block; font-weight: 600; font-size: 12.5px; margin-bottom: 6px;">Visual Theme:</label>
          <select id="modal-sel-theme" class="select-fluent" style="width: 100%;">
            <option value="system" ${state.appSettings.theme === 'system' ? 'selected' : ''}>System Default (Sync with Windows 11)</option>
            <option value="dark" ${state.appSettings.theme === 'dark' ? 'selected' : ''}>Dark Mode</option>
            <option value="light" ${state.appSettings.theme === 'light' ? 'selected' : ''}>Light Mode</option>
          </select>
        </div>

        <!-- Import Old Backup .txt -->
        <div>
          <label style="display: block; font-weight: 600; font-size: 12.5px; margin-bottom: 6px;">Import Legacy Batch Script Backup (.txt):</label>
          <textarea id="modal-txt-old-backup" class="select-fluent" rows="4" style="font-family: monospace; font-size: 11.5px; width: 100%; resize: vertical;" placeholder="Mode=AC&#10;Screen=10 min&#10;Sleep=30 min&#10;Hibernate=120 min&#10;HardDisk=20 min"></textarea>
          <button id="modal-btn-parse-old" class="btn btn-sm" style="margin-top: 6px;">Import into Presets</button>
        </div>

        <!-- Activity Log -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="font-weight: 600; font-size: 12.5px;">Activity &amp; Command Log:</label>
            <div style="display: flex; gap: 6px;">
              <button id="modal-btn-copy-log" class="btn btn-sm" style="padding: 2px 8px; font-size: 11px;">Copy</button>
              <button id="modal-btn-clear-log" class="btn btn-sm" style="padding: 2px 8px; font-size: 11px;">Clear</button>
            </div>
          </div>
          <div id="modal-log-viewer" style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-controls); height: 100px; overflow-y: auto; padding: 8px; font-family: monospace; font-size: 11px;">
            ${state.logs.length === 0 ? '<span style="color: var(--text-tertiary);">No logs yet.</span>' : state.logs.map(l => `
              <div style="padding: 2px 0; border-bottom: 1px solid var(--border-subtle); word-break: break-all;">
                <span style="color: var(--text-tertiary);">${new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span style="color: ${l.success ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: 600;">[${l.success ? 'OK' : 'ERR'}]</span>
                <strong>${escapeHtml(l.command)}</strong>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- About Button in Settings -->
        <div style="border-top: 1px solid var(--border-subtle); padding-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${isElectron ? './icon.png' : '/icon.png'}" width="34" height="34" style="border-radius: 8px; flex-shrink: 0;" alt="App Icon">
            <div>
              <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">Power Setting Manager v1.8.2</div>
              <div style="font-size: 11.5px; color: var(--text-secondary);">By Dineth Pansilu (@DinethPansiluW)</div>
            </div>
          </div>
          <button id="modal-btn-open-about" class="btn btn-sm btn-primary">About &amp; Credits →</button>
        </div>
      </div>
    `, 'Done', () => {
      modal.close();
    });

    const openAboutBtn = document.getElementById('modal-btn-open-about');
    if (openAboutBtn) {
      openAboutBtn.addEventListener('click', () => {
        modal.close();
        openAboutModal();
      });
    }

    // Theme changer
    const themeSel = document.getElementById('modal-sel-theme');
    if (themeSel) {
      themeSel.addEventListener('change', async (e) => {
        const t = e.target.value;
        await api.saveSettings({ theme: t });
        state.appSettings.theme = t;
        applyTheme(t);
      });
    }

    // Parse old backup
    const parseBtn = document.getElementById('modal-btn-parse-old');
    if (parseBtn) {
      parseBtn.addEventListener('click', async () => {
        const text = document.getElementById('modal-txt-old-backup').value;
        if (!text.trim()) return;
        const parsed = await api.parseOldBackupText(text);
        if (parsed) {
          await api.saveCurrentAsPreset(`Imported ${new Date().toLocaleDateString()}`);
          state.savedItems = await api.getUnifiedSavedList();
          showToast('Legacy backup imported into Presets!', 'success');
          modal.close();
          renderActiveTab();
        }
      });
    }

    // Log copy & clear
    const copyLogBtn = document.getElementById('modal-btn-copy-log');
    if (copyLogBtn) {
      copyLogBtn.addEventListener('click', () => {
        const raw = state.logs.map(l => `[${l.timestamp}] [${l.success ? 'OK' : 'ERR'}] ${l.command} -> ${l.details || ''}`).join('\n');
        navigator.clipboard.writeText(raw);
        showToast('Logs copied to clipboard.', 'info');
      });
    }

    const clearLogBtn = document.getElementById('modal-btn-clear-log');
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', async () => {
        await api.clearActivityLog();
        state.logs = [];
        const viewer = document.getElementById('modal-log-viewer');
        if (viewer) viewer.innerHTML = '<span style="color: var(--text-tertiary);">No logs yet.</span>';
      });
    }
  }

  // ==========================================
  // ABOUT PAGE MODAL (MATCHING REFERENCE IMAGE)
  // ==========================================
  function openAboutModal() {
    const iconSrc = isElectron ? './icon.png' : '/icon.png';
    const bodyHtml = `
      <div class="about-modal-container">
        <!-- Header Subtitle Info -->
        <div class="about-header-box">
          <div class="about-header-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>About Power Setting Manager</span>
          </div>
          <div class="about-header-sub">
            High-performance Windows desktop power management and autonomous scheduled automation utility.
          </div>
        </div>

        <!-- Hero Card with Neon Ring & App Info -->
        <div class="about-hero-card">
          <div class="about-icon-orb">
            <img src="${iconSrc}" alt="Power Setting Manager Logo" />
          </div>
          <div class="about-hero-details">
            <div class="about-app-name">
              <span>Power Setting Manager</span>
              <span class="about-version-badge">v1.8.2</span>
            </div>
            <div class="about-app-desc">
              Official Windows desktop edition crafted by <strong>Dineth Pansilu</strong>. Powered by native <code>powercfg</code> and Windows Task Scheduler. Operates with instant Never mode, 8-timeout plan tuning with min/h unit switching, Kernel-Power EventID 105 power-source auto-switching, and reboot auto-restore.
            </div>
          </div>
        </div>

        <!-- Core Engines & Open-Source Licenses -->
        <div class="about-info-card">
          <div class="about-card-tag about-tag-blue">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <polyline points="9 12 11 14 15 10"></polyline>
            </svg>
            <span>Core Engines &amp; Open-Source Licenses</span>
          </div>
          <div class="about-info-list">
            <div>• <strong>powercfg.exe</strong>: Native Windows power configuration subsystem for deep AC/DC timeouts, hibernate flags, and hybrid standby control.</div>
            <div>• <strong>Windows Task Scheduler (schtasks)</strong>: Autonomous SYSTEM privilege event triggers (Kernel-Power EventID 105, Boot PT10S, Logon PT5S).</div>
            <div>• <strong>Electron &amp; Node.js</strong>: Modern desktop runtime engine licensed under the MIT License.</div>
          </div>
        </div>

        <!-- Developer Credits -->
        <div class="about-info-card">
          <div class="about-card-tag about-tag-pink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
            <span>Developer Credits</span>
          </div>
          <div class="about-credits-title">
            Power Setting Manager by <span class="about-credits-author">DinethPansiluW</span>
          </div>
          <div class="about-credits-desc">
            Lead author and creator of the Power Setting Manager architecture: <strong>Dineth Pansilu</strong>. Windows desktop power utility built with Electron + modern Windows 11 Fluent 2 design.
          </div>
        </div>

        <!-- Developer Connect & Social Channels (2x2 Grid) -->
        <div>
          <div class="about-social-header">Developer Connect &amp; Social Channels</div>
          <div class="about-social-grid">
            <!-- GitHub -->
            <div class="about-social-card" data-url="https://github.com/DinethPansiluW">
              <div class="about-social-left">
                <div class="about-social-icon-tile">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 18 22 12 16 6"></polyline>
                    <polyline points="8 6 2 12 8 18"></polyline>
                  </svg>
                </div>
                <div class="about-social-info">
                  <span class="about-social-name">GitHub</span>
                  <span class="about-social-handle">@DinethPansiluW</span>
                </div>
              </div>
              <div class="about-social-ext">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </div>
            </div>

            <!-- Facebook -->
            <div class="about-social-card" data-url="https://facebook.com/DinethPansiluW">
              <div class="about-social-left">
                <div class="about-social-icon-tile">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                </div>
                <div class="about-social-info">
                  <span class="about-social-name">Facebook</span>
                  <span class="about-social-handle">@DinethPansiluW</span>
                </div>
              </div>
              <div class="about-social-ext">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </div>
            </div>

            <!-- Telegram -->
            <div class="about-social-card" data-url="https://t.me/DinethPansiluW">
              <div class="about-social-left">
                <div class="about-social-icon-tile">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </div>
                <div class="about-social-info">
                  <span class="about-social-name">Telegram</span>
                  <span class="about-social-handle">@DinethPansiluW</span>
                </div>
              </div>
              <div class="about-social-ext">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </div>
            </div>

            <!-- Instagram -->
            <div class="about-social-card" data-url="https://instagram.com/DinethPansiluW">
              <div class="about-social-left">
                <div class="about-social-icon-tile">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                  </svg>
                </div>
                <div class="about-social-info">
                  <span class="about-social-name">Instagram</span>
                  <span class="about-social-handle">@DinethPansiluW</span>
                </div>
              </div>
              <div class="about-social-ext">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const modal = createModal('About Power Setting Manager', bodyHtml, 'Close', () => {
      modal.close();
    }, null, 'about-modal-wide');

    // Attach click listeners to all social channel cards
    document.querySelectorAll('.about-social-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = card.getAttribute('data-url');
        if (url) {
          if (api.openExternalUrl) {
            await api.openExternalUrl(url);
          } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
          showToast(`Opening ${url}...`, 'info');
        }
      });
    });
  }

  // ==========================================
  // UTILITIES & MODAL SYSTEM (NO prompt/alert/confirm)
  // ==========================================
  function openPromptModal(title, label, defaultValue, onConfirm) {
    const inputId = `prompt-input-${Date.now()}`;
    const bodyHtml = `
      <div>
        <label style="display: block; font-size: 12.5px; font-weight: 600; margin-bottom: 6px;">${escapeHtml(label)}</label>
        <input type="text" id="${inputId}" class="select-fluent" value="${escapeHtml(defaultValue || '')}" style="width: 100%;">
      </div>
    `;

    const modal = createModal(title, bodyHtml, 'Confirm', () => {
      const val = document.getElementById(inputId).value;
      if (val !== null && val.trim()) {
        modal.close();
        onConfirm(val.trim());
      }
    });

    const input = document.getElementById(inputId);
    if (input) {
      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = input.value;
          if (val && val.trim()) {
            modal.close();
            onConfirm(val.trim());
          }
        }
      });
    }
  }

  function openConfirmModal(title, message, onConfirm, onCancel) {
    const modal = createModal(title, `
      <div style="font-size: 13.5px; line-height: 1.5; color: var(--text-primary);">${escapeHtml(message)}</div>
    `, 'Confirm', () => {
      modal.close();
      onConfirm();
    }, onCancel);
  }

  function createModal(title, bodyHtml, confirmText, onConfirm, onCancel, customClass = '') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content ${customClass}">
        <div class="modal-header">
          <div class="modal-title">${escapeHtml(title)}</div>
          <button class="btn btn-sm btn-modal-close" style="border:none; background:transparent; font-size: 16px;">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">
          ${onCancel !== null && confirmText !== 'Close' ? '<button class="btn btn-sm btn-modal-cancel">Cancel</button>' : ''}
          <button class="btn btn-sm btn-primary btn-modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
      document.removeEventListener('keydown', handleGlobalKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    const handleGlobalKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        if (onCancel) onCancel();
      }
    };

    document.addEventListener('keydown', handleGlobalKey);

    overlay.querySelector('.btn-modal-close').addEventListener('click', () => {
      close();
      if (onCancel) onCancel();
    });
    overlay.querySelector('.btn-modal-cancel').addEventListener('click', () => {
      close();
      if (onCancel) onCancel();
    });
    overlay.querySelector('.btn-modal-confirm').addEventListener('click', onConfirm);

    // Auto-focus first input if exists
    setTimeout(() => {
      const firstInput = overlay.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstInput) {
        firstInput.focus();
        if (typeof firstInput.select === 'function') firstInput.select();
      }
    }, 50);

    return { close };
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3200);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
