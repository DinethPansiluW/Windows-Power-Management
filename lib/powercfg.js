/**
 * Power Setting Manager - Windows powercfg.exe execution engine
 * Language-independent parsing, strict input validation, safe execFile execution.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// Default Windows Power Plan GUIDs
const DEFAULT_PLANS = {
  DPW_PLAN: 'b2c3d4e5-6677-8899-0011-223344556677',
  BALANCED: '381b4222-f694-41f0-9685-ff5bb260df2e',
  HIGH_PERFORMANCE: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  POWER_SAVER: 'a1841308-3541-4fab-bc81-f71556f20b4a'
};

// Subgroups and Settings GUIDs
const GUIDS = {
  SUB_VIDEO: '7516b95f-f776-4464-8c53-06167f40cc99',
  SETTING_SCREEN_OFF: '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e',

  SUB_SLEEP: '238c9fa8-0aad-41ed-83f4-97be242c8f20',
  SETTING_SLEEP: '29f6c1db-86da-48c5-9fdb-f2b67b1f44da',
  SETTING_HIBERNATE: '9d7815a6-7ee4-497e-8888-515a05f02364',
  SETTING_HYBRID_SLEEP: '94ac6d29-73ce-41a6-809f-6363ba21b47e',

  SUB_DISK: '0012ee47-9041-4b5d-9b77-535fba8b1442',
  SETTING_HARD_DISK_OFF: '6738e2c4-e8a5-4a42-b16a-e040e769756e',

  SUB_BUTTONS: '4f971e89-e93b-455e-8842-ab8125119436',
  SETTING_LID_ACTION: '5ca83367-6e45-459f-a27b-476b1d01c936',
  SETTING_POWER_BUTTON: '7648e718-e014-4767-8067-9dae28663b31',
  SETTING_SLEEP_BUTTON: '9699642b-aca3-4290-a5d1-60087a82331d'
};

// Paths to Windows system binaries
const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows';
const POWERCFG_BIN = path.join(SYSTEM_ROOT, 'System32', 'powercfg.exe');
const POWERSHELL_BIN = path.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const CONTROL_BIN = path.join(SYSTEM_ROOT, 'System32', 'control.exe');

// Logging callback for activity monitor
let logCallback = null;

function setLogger(cb) {
  logCallback = cb;
}

function logEvent(command, args, success, details, durationMs = 0) {
  if (typeof logCallback === 'function') {
    logCallback({
      timestamp: new Date().toISOString(),
      command: `${path.basename(command)} ${args.join(' ')}`,
      success,
      details,
      durationMs
    });
  }
}

/**
 * Strict GUID validation (32 hex digits with 4 hyphens)
 */
function isValidGuid(guid) {
  if (typeof guid !== 'string') return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(guid.trim());
}

/**
 * Validate non-negative integer seconds (0 to 86400, where 0 = Never)
 */
function isValidSeconds(val) {
  const num = Number(val);
  return Number.isInteger(num) && num >= 0 && num <= 86400;
}

/**
 * Executes a binary safely using execFile (no shell interpolation)
 */
function runExecFile(bin, args, options = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      const duration = Date.now() - start;
      const outStr = (stdout || '').toString();
      const errStr = (stderr || '').toString();
      if (error) {
        logEvent(bin, args, false, errStr || error.message, duration);
        return reject(new Error(errStr.trim() || error.message));
      }
      logEvent(bin, args, true, outStr.trim().slice(0, 300), duration);
      resolve(outStr);
    });
  });
}

/**
 * Get active power scheme GUID and name
 */
async function getActiveScheme() {
  const stdout = await runExecFile(POWERCFG_BIN, ['/getactivescheme']);
  const guidMatch = stdout.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (!guidMatch) {
    throw new Error('Could not identify active power scheme GUID from powercfg output.');
  }
  const guid = guidMatch[0].toLowerCase();

  // Extract name within parentheses if available
  let name = 'Active Power Scheme';
  const nameMatch = stdout.match(/\(([^)]+)\)/);
  if (nameMatch && nameMatch[1]) {
    name = nameMatch[1].trim();
  }

  return { guid, name };
}

/**
 * List all registered power schemes on the system
 */
async function listSchemes() {
  const stdout = await runExecFile(POWERCFG_BIN, ['/list']);
  const lines = stdout.split(/\r?\n/);
  const schemes = [];

  for (const line of lines) {
    const guidMatch = line.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i);
    if (guidMatch) {
      const guid = guidMatch[1].toLowerCase();
      const isActive = line.includes('*');
      let name = 'Custom Scheme';
      const nameMatch = line.match(/\(([^)]+)\)/);
      if (nameMatch && nameMatch[1]) {
        name = nameMatch[1].trim();
      }

      const isDefault = Object.values(DEFAULT_PLANS).map(g => g.toLowerCase()).includes(guid);

      schemes.push({
        guid,
        name,
        isActive,
        isDefault
      });
    }
  }

  const hasDpw = schemes.some(s => s.guid === DEFAULT_PLANS.DPW_PLAN || /dpw\s*plan/i.test(s.name));
  if (!hasDpw) {
    schemes.unshift({
      guid: DEFAULT_PLANS.DPW_PLAN,
      name: 'DPW Plan',
      isActive: false,
      isDefault: true
    });
  }

  return schemes;
}

/**
 * Activate a power scheme by GUID
 */
async function setActiveScheme(schemeGuid) {
  if (!isValidGuid(schemeGuid)) {
    throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
  }

  try {
    await runExecFile(POWERCFG_BIN, ['/setactive', schemeGuid]);
    return { success: true, schemeGuid };
  } catch (err) {
    if (schemeGuid === DEFAULT_PLANS.DPW_PLAN) {
      // DPW Plan might not yet exist in Windows registry - create/duplicate and apply recommended timeouts
      const all = await listSchemes();
      const existing = all.find(s => /dpw\s*plan/i.test(s.name) && s.guid !== DEFAULT_PLANS.DPW_PLAN);
      if (existing) {
        await runExecFile(POWERCFG_BIN, ['/setactive', existing.guid]);
        return { success: true, schemeGuid: existing.guid };
      }
      const dup = await duplicatePowerPlan(DEFAULT_PLANS.BALANCED, 'DPW Plan');
      await applySettings(dup.newGuid, {
        ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
        dc: { screen: 5, sleep: 10, hibernate: 30, disk: 5 }
      });
      await runExecFile(POWERCFG_BIN, ['/setactive', dup.newGuid]);
      return { success: true, schemeGuid: dup.newGuid };
    }
    throw err;
  }
}

/**
 * Query AC and DC power setting index language-independently
 * Finds all 0x... hex values in output; the last two are AC and DC.
 */
async function getPowerSetting(schemeGuid, subGuid, settingGuid) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
  if (!isValidGuid(subGuid)) throw new Error(`Invalid sub GUID: ${subGuid}`);
  if (!isValidGuid(settingGuid)) throw new Error(`Invalid setting GUID: ${settingGuid}`);

  const stdout = await runExecFile(POWERCFG_BIN, ['/query', schemeGuid, subGuid, settingGuid]);
  
  // Extract all hex matches (0x00000000)
  const hexMatches = stdout.match(/0x[0-9a-fA-F]+/g);
  if (!hexMatches || hexMatches.length < 2) {
    throw new Error(`Unable to parse hex setting values for ${settingGuid}`);
  }

  // Language independent: last 2 hex numbers are AC then DC
  const acHex = hexMatches[hexMatches.length - 2];
  const dcHex = hexMatches[hexMatches.length - 1];

  const acSeconds = parseInt(acHex, 16);
  const dcSeconds = parseInt(dcHex, 16);

  return {
    acSeconds,
    dcSeconds,
    acMinutes: Math.round(acSeconds / 60),
    dcMinutes: Math.round(dcSeconds / 60)
  };
}

/**
 * Query Hybrid Sleep (0 = Disabled, 1 = Enabled)
 */
async function getHybridSleep(schemeGuid) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
  try {
    const stdout = await runExecFile(POWERCFG_BIN, ['/query', schemeGuid, GUIDS.SUB_SLEEP, GUIDS.SETTING_HYBRID_SLEEP]);
    const hexMatches = stdout.match(/0x[0-9a-fA-F]+/g);
    if (!hexMatches || hexMatches.length < 2) return { ac: 0, dc: 0 };
    const ac = parseInt(hexMatches[hexMatches.length - 2], 16) === 1 ? 1 : 0;
    const dc = parseInt(hexMatches[hexMatches.length - 1], 16) === 1 ? 1 : 0;
    return { ac, dc };
  } catch {
    return { ac: 0, dc: 0 };
  }
}

/**
 * Query Button Actions (0 Do nothing, 1 Sleep, 2 Hibernate, 3 Shut down)
 */
async function getButtonActions(schemeGuid) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
  const actions = {
    lid: { ac: 1, dc: 1 },
    power: { ac: 3, dc: 3 },
    sleep: { ac: 1, dc: 1 }
  };

  try {
    const querySetting = async (settingGuid) => {
      const stdout = await runExecFile(POWERCFG_BIN, ['/query', schemeGuid, GUIDS.SUB_BUTTONS, settingGuid]);
      const hexMatches = stdout.match(/0x[0-9a-fA-F]+/g);
      if (!hexMatches || hexMatches.length < 2) return { ac: 1, dc: 1 };
      return {
        ac: parseInt(hexMatches[hexMatches.length - 2], 16),
        dc: parseInt(hexMatches[hexMatches.length - 1], 16)
      };
    };

    actions.lid = await querySetting(GUIDS.SETTING_LID_ACTION);
    actions.power = await querySetting(GUIDS.SETTING_POWER_BUTTON);
    actions.sleep = await querySetting(GUIDS.SETTING_SLEEP_BUTTON);
  } catch (err) {
    // Non-critical if button actions aren't exposed on hardware
  }

  return actions;
}

/**
 * Retrieve all core power timeout settings for the given or active scheme
 */
async function getAllSettings(schemeGuid = null) {
  let targetGuid = schemeGuid;
  let schemeName = 'Active Plan';

  if (!targetGuid) {
    const active = await getActiveScheme();
    targetGuid = active.guid;
    schemeName = active.name;
  }

  if (targetGuid === DEFAULT_PLANS.DPW_PLAN) {
    try {
      const [screen, sleep, hibernate, disk, hybridSleep, buttons] = await Promise.all([
        getPowerSetting(targetGuid, GUIDS.SUB_VIDEO, GUIDS.SETTING_SCREEN_OFF),
        getPowerSetting(targetGuid, GUIDS.SUB_SLEEP, GUIDS.SETTING_SLEEP),
        getPowerSetting(targetGuid, GUIDS.SUB_SLEEP, GUIDS.SETTING_HIBERNATE),
        getPowerSetting(targetGuid, GUIDS.SUB_DISK, GUIDS.SETTING_HARD_DISK_OFF),
        getHybridSleep(targetGuid),
        getButtonActions(targetGuid)
      ]);
      return {
        schemeGuid: targetGuid,
        schemeName: 'DPW Plan',
        ac: { screen: screen.acMinutes, sleep: sleep.acMinutes, hibernate: hibernate.acMinutes, disk: disk.acMinutes },
        dc: { screen: screen.dcMinutes, sleep: sleep.dcMinutes, hibernate: hibernate.dcMinutes, disk: disk.dcMinutes },
        rawSeconds: {
          ac: { screen: screen.acSeconds, sleep: sleep.acSeconds, hibernate: hibernate.acSeconds, disk: disk.acSeconds },
          dc: { screen: screen.dcSeconds, sleep: sleep.dcSeconds, hibernate: hibernate.dcSeconds, disk: disk.dcSeconds }
        },
        hybridSleep,
        buttons
      };
    } catch {
      return {
        schemeGuid: DEFAULT_PLANS.DPW_PLAN,
        schemeName: 'DPW Plan',
        ac: { screen: 5, sleep: 15, hibernate: 60, disk: 5 },
        dc: { screen: 5, sleep: 10, hibernate: 30, disk: 5 },
        rawSeconds: {
          ac: { screen: 300, sleep: 900, hibernate: 3600, disk: 300 },
          dc: { screen: 300, sleep: 600, hibernate: 1800, disk: 300 }
        },
        hybridSleep: { ac: 1, dc: 0 },
        buttons: { lid: { ac: 1, dc: 1 }, power: { ac: 3, dc: 3 }, sleep: { ac: 1, dc: 1 } }
      };
    }
  }

  const [screen, sleep, hibernate, disk, hybridSleep, buttons] = await Promise.all([
    getPowerSetting(targetGuid, GUIDS.SUB_VIDEO, GUIDS.SETTING_SCREEN_OFF),
    getPowerSetting(targetGuid, GUIDS.SUB_SLEEP, GUIDS.SETTING_SLEEP),
    getPowerSetting(targetGuid, GUIDS.SUB_SLEEP, GUIDS.SETTING_HIBERNATE),
    getPowerSetting(targetGuid, GUIDS.SUB_DISK, GUIDS.SETTING_HARD_DISK_OFF),
    getHybridSleep(targetGuid),
    getButtonActions(targetGuid)
  ]);

  return {
    schemeGuid: targetGuid,
    schemeName,
    ac: {
      screen: screen.acMinutes,
      sleep: sleep.acMinutes,
      hibernate: hibernate.acMinutes,
      disk: disk.acMinutes
    },
    dc: {
      screen: screen.dcMinutes,
      sleep: sleep.dcMinutes,
      hibernate: hibernate.dcMinutes,
      disk: disk.dcMinutes
    },
    rawSeconds: {
      ac: { screen: screen.acSeconds, sleep: sleep.acSeconds, hibernate: hibernate.acSeconds, disk: disk.acSeconds },
      dc: { screen: screen.dcSeconds, sleep: sleep.dcSeconds, hibernate: hibernate.dcSeconds, disk: disk.dcSeconds }
    },
    hybridSleep,
    buttons
  };
}

/**
 * Set an individual setting value in seconds for AC or DC
 */
async function setPowerSettingValue(schemeGuid, subGuid, settingGuid, seconds, isAc = true) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
  if (!isValidGuid(subGuid)) throw new Error(`Invalid sub GUID: ${subGuid}`);
  if (!isValidGuid(settingGuid)) throw new Error(`Invalid setting GUID: ${settingGuid}`);
  if (!isValidSeconds(seconds)) throw new Error(`Invalid seconds value: ${seconds}`);

  const switchFlag = isAc ? '/setacvalueindex' : '/setdcvalueindex';
  await runExecFile(POWERCFG_BIN, [switchFlag, schemeGuid, subGuid, settingGuid, seconds.toString()]);
}

/**
 * Apply a batch of timeout settings (in minutes) to a power scheme
 */
async function applySettings(schemeGuid, settings) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);

  const { ac, dc } = settings;

  // Map settings keys to GUIDs
  const settingMap = {
    screen: { sub: GUIDS.SUB_VIDEO, setting: GUIDS.SETTING_SCREEN_OFF },
    sleep: { sub: GUIDS.SUB_SLEEP, setting: GUIDS.SETTING_SLEEP },
    hibernate: { sub: GUIDS.SUB_SLEEP, setting: GUIDS.SETTING_HIBERNATE },
    disk: { sub: GUIDS.SUB_DISK, setting: GUIDS.SETTING_HARD_DISK_OFF }
  };

  // Set AC values
  if (ac) {
    for (const [key, minutes] of Object.entries(ac)) {
      if (settingMap[key] !== undefined && typeof minutes === 'number') {
        const seconds = Math.max(0, Math.min(86400, Math.round(minutes * 60)));
        await setPowerSettingValue(schemeGuid, settingMap[key].sub, settingMap[key].setting, seconds, true);
      }
    }
  }

  // Set DC (Battery) values
  if (dc) {
    for (const [key, minutes] of Object.entries(dc)) {
      if (settingMap[key] !== undefined && typeof minutes === 'number') {
        const seconds = Math.max(0, Math.min(86400, Math.round(minutes * 60)));
        await setPowerSettingValue(schemeGuid, settingMap[key].sub, settingMap[key].setting, seconds, false);
      }
    }
  }

  // Immediately apply changes to active scheme
  await runExecFile(POWERCFG_BIN, ['/setactive', schemeGuid]);
  return { success: true };
}

/**
 * Set Hybrid Sleep (0 = off, 1 = on)
 */
async function setHybridSleep(schemeGuid, acValue, dcValue) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
  const ac = acValue ? '1' : '0';
  const dc = dcValue ? '1' : '0';

  await runExecFile(POWERCFG_BIN, ['/setacvalueindex', schemeGuid, GUIDS.SUB_SLEEP, GUIDS.SETTING_HYBRID_SLEEP, ac]);
  await runExecFile(POWERCFG_BIN, ['/setdcvalueindex', schemeGuid, GUIDS.SUB_SLEEP, GUIDS.SETTING_HYBRID_SLEEP, dc]);
  await runExecFile(POWERCFG_BIN, ['/setactive', schemeGuid]);
  return { success: true };
}

/**
 * Set Button / Lid action (0: Do nothing, 1: Sleep, 2: Hibernate, 3: Shut down)
 */
async function setButtonAction(schemeGuid, buttonType, acVal, dcVal) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid scheme GUID: ${schemeGuid}`);
  const map = {
    lid: GUIDS.SETTING_LID_ACTION,
    power: GUIDS.SETTING_POWER_BUTTON,
    sleep: GUIDS.SETTING_SLEEP_BUTTON
  };
  const settingGuid = map[buttonType];
  if (!settingGuid) throw new Error(`Unknown button type: ${buttonType}`);

  const vAc = Math.max(0, Math.min(3, parseInt(acVal, 10) || 0)).toString();
  const vDc = Math.max(0, Math.min(3, parseInt(dcVal, 10) || 0)).toString();

  await runExecFile(POWERCFG_BIN, ['/setacvalueindex', schemeGuid, GUIDS.SUB_BUTTONS, settingGuid, vAc]);
  await runExecFile(POWERCFG_BIN, ['/setdcvalueindex', schemeGuid, GUIDS.SUB_BUTTONS, settingGuid, vDc]);
  await runExecFile(POWERCFG_BIN, ['/setactive', schemeGuid]);
  return { success: true };
}

/**
 * Check if a physical battery exists via PowerShell Get-CimInstance Win32_Battery
 */
async function getBatteryPresence() {
  try {
    const stdout = await runExecFile(POWERSHELL_BIN, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Battery | Select-Object -Property DeviceID, EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json'
    ]);
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === 'null') {
      return { hasBattery: false, isDesktop: true };
    }
    const parsed = JSON.parse(trimmed);
    const hasBattery = Boolean(parsed && (Array.isArray(parsed) ? parsed.length > 0 : parsed.DeviceID));
    return { hasBattery, isDesktop: !hasBattery, batteryDetails: parsed };
  } catch {
    return { hasBattery: false, isDesktop: true };
  }
}

/**
 * Detect sleep and modern standby availability via powercfg /a
 */
async function getSleepAvailability() {
  try {
    const stdout = await runExecFile(POWERCFG_BIN, ['/a']);
    const lower = stdout.toLowerCase();

    // S3 Standby check
    const hasS3 = lower.includes('standby (s3)') && !lower.includes('standby (s3) is not supported');
    // Modern Standby (S0 Low Power Idle) check
    const hasModernStandby = lower.includes('standby (s0 low power idle)') || lower.includes('s0 low power idle');
    // Hibernate check
    const hasHibernate = lower.includes('hibernate') && !lower.includes('hibernation has not been enabled');

    return {
      s3Supported: hasS3,
      modernStandby: hasModernStandby,
      hibernateSupported: hasHibernate,
      rawOutput: stdout
    };
  } catch {
    return {
      s3Supported: true,
      modernStandby: false,
      hibernateSupported: true,
      rawOutput: ''
    };
  }
}

/**
 * Detect whether hibernation is currently enabled
 */
async function getHibernateState() {
  try {
    // Check if C:\hiberfil.sys exists or query powercfg /a
    const hiberfilExists = fs.existsSync('C:\\hiberfil.sys');
    const stdout = await runExecFile(POWERCFG_BIN, ['/a']);
    const enabled = hiberfilExists || (stdout.includes('Hibernate') && !stdout.includes('hibernation has not been enabled'));
    return { enabled };
  } catch {
    return { enabled: false };
  }
}

/**
 * Turn hibernation on or off
 */
async function setHibernateState(enabled) {
  const flag = enabled ? '/hibernate' : '/hibernate';
  const val = enabled ? 'on' : 'off';
  await runExecFile(POWERCFG_BIN, [flag, val]);
  return { success: true, enabled: Boolean(enabled) };
}

/**
 * Import a bundled or custom .pow power plan and activate it
 */
async function importPowerPlan(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Power plan file not found: ${filePath}`);
  }
  const stdout = await runExecFile(POWERCFG_BIN, ['-import', filePath]);
  const guidMatch = stdout.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (!guidMatch) {
    throw new Error('Power plan imported, but could not detect new scheme GUID from output.');
  }
  const newGuid = guidMatch[0].toLowerCase();
  await setActiveScheme(newGuid);
  return { success: true, guid: newGuid };
}

/**
 * Delete a custom power plan
 * Guard: NEVER delete the 3 default GUIDs.
 * If deleting the active plan, switches to Balanced first.
 */
async function deletePowerPlan(guid) {
  if (!isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
  const normalized = guid.toLowerCase();

  const isDefault = Object.values(DEFAULT_PLANS).some(g => g.toLowerCase() === normalized);
  if (isDefault) {
    throw new Error('Default Windows power plans (Balanced, High Performance, Power Saver) cannot be deleted.');
  }

  // Check if active
  const active = await getActiveScheme();
  if (active.guid.toLowerCase() === normalized) {
    // Switch to Balanced first
    await setActiveScheme(DEFAULT_PLANS.BALANCED);
  }

  await runExecFile(POWERCFG_BIN, ['/delete', normalized]);
  return { success: true, deletedGuid: normalized };
}

/**
 * Export a power scheme to a .pow file
 */
async function exportPowerPlan(filePath, schemeGuid) {
  if (!isValidGuid(schemeGuid)) throw new Error(`Invalid GUID: ${schemeGuid}`);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await runExecFile(POWERCFG_BIN, ['/export', filePath, schemeGuid]);
  return { success: true, filePath, schemeGuid };
}

/**
 * Rename a custom power plan
 * Runs: powercfg /changename <guid> "<name>"
 */
async function renamePowerPlan(guid, newName) {
  if (!isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
  const normalized = guid.toLowerCase();
  const isDefault = Object.values(DEFAULT_PLANS).some(g => g.toLowerCase() === normalized);
  if (isDefault) {
    throw new Error('Default Windows power plans cannot be renamed.');
  }
  const name = (newName || '').trim();
  if (!name) throw new Error('Power plan name cannot be empty.');
  await runExecFile(POWERCFG_BIN, ['/changename', normalized, name]);
  return { success: true, guid: normalized, name };
}

/**
 * Duplicate an existing power scheme
 * Runs: powercfg /duplicatescheme <guid>
 */
async function duplicatePowerPlan(guid, customName = null) {
  if (!isValidGuid(guid)) throw new Error(`Invalid GUID: ${guid}`);
  const normalized = guid.toLowerCase();
  const stdout = await runExecFile(POWERCFG_BIN, ['/duplicatescheme', normalized]);
  const guidMatch = stdout.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (!guidMatch) {
    throw new Error('Scheme duplicated, but could not detect new GUID.');
  }
  const newGuid = guidMatch[0].toLowerCase();
  if (customName && customName.trim()) {
    try {
      await runExecFile(POWERCFG_BIN, ['/changename', newGuid, customName.trim()]);
    } catch {
      // non-fatal
    }
  }
  return { success: true, originalGuid: normalized, newGuid, name: customName || 'Duplicated Scheme' };
}

/**
 * Open classic Windows Power Options Control Panel page
 */
async function openWindowsPowerSettings() {
  await runExecFile(CONTROL_BIN, ['/name', 'Microsoft.PowerOptions', '/page', 'pageGlobalSettings']);
  return { success: true };
}

module.exports = {
  DEFAULT_PLANS,
  GUIDS,
  isValidGuid,
  isValidSeconds,
  setLogger,
  getActiveScheme,
  listSchemes,
  setActiveScheme,
  getPowerSetting,
  getAllSettings,
  setPowerSettingValue,
  applySettings,
  setHybridSleep,
  setButtonAction,
  getBatteryPresence,
  getSleepAvailability,
  getHibernateState,
  setHibernateState,
  importPowerPlan,
  exportPowerPlan,
  deletePowerPlan,
  renamePowerPlan,
  duplicatePowerPlan,
  openWindowsPowerSettings
};

