/**
 * Power Setting Manager - Automatic Restore on Restart Engine
 * Generates an autonomous, standalone Windows batch script and registers a Scheduled Task
 * with BootTrigger (30s) and LogonTrigger running with SYSTEM privileges.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TASK_NAME = 'PowerSettingManager_RestoreOnRestart';
const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const RESTORE_DIR = path.join(PROGRAM_DATA, 'PowerSettingManager');
const RESTORE_SCRIPT = path.join(RESTORE_DIR, 'restore.cmd');
const RESTORE_FLAG = path.join(RESTORE_DIR, 'restored.flag');
const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows';
const SCHTASKS_BIN = path.join(SYSTEM_ROOT, 'System32', 'schtasks.exe');

const GUIDS = {
  SUB_VIDEO: '7516b95f-f776-4464-8c53-06167f40cc99',
  SETTING_SCREEN_OFF: '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e',

  SUB_SLEEP: '238c9fa8-0aad-41ed-83f4-97be242c8f20',
  SETTING_SLEEP: '29f6c1db-86da-48c5-9fdb-f2b67b1f44da',
  SETTING_HIBERNATE: '9d7815a6-7ee4-497e-8888-515a05f02364',

  SUB_DISK: '0012ee47-9041-4b5d-9b77-535fba8b1442',
  SETTING_HARD_DISK_OFF: '6738e2c4-e8a5-4a42-b16a-e040e769756e'
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Executes a binary safely using execFile
 */
function runExec(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error((stderr || '').trim() || error.message));
      }
      resolve((stdout || '').toString());
    });
  });
}

/**
 * Generate autonomous, idempotent restore.cmd script
 * This script runs completely independently of Electron or any Node environment.
 */
function generateRestoreScript(snapshot, valuesToRestore) {
  const scheme = snapshot.activeSchemeGuid || '381b4222-f694-41f0-9685-ff5bb260df2e';
  const targetValues = valuesToRestore || snapshot;

  const acScreen = Math.max(0, Math.round((targetValues.ac.screen || 0) * 60));
  const acSleep = Math.max(0, Math.round((targetValues.ac.sleep || 0) * 60));
  const acHib = Math.max(0, Math.round((targetValues.ac.hibernate || 0) * 60));
  const acDisk = Math.max(0, Math.round((targetValues.ac.disk || 0) * 60));

  const dcScreen = Math.max(0, Math.round((targetValues.dc.screen || 0) * 60));
  const dcSleep = Math.max(0, Math.round((targetValues.dc.sleep || 0) * 60));
  const dcHib = Math.max(0, Math.round((targetValues.dc.hibernate || 0) * 60));
  const dcDisk = Math.max(0, Math.round((targetValues.dc.disk || 0) * 60));

  const content = `@echo off
setlocal enabledelayedexpansion

:: ===================================================================
:: Power Setting Manager - Autonomous Auto-Restore on System Restart
:: Generated at: ${new Date().toISOString()}
:: ===================================================================

set LOG_FILE=%ProgramData%\\PowerSettingManager\\restore.log
set FLAG_FILE=%ProgramData%\\PowerSettingManager\\restored.flag

echo ============================================================ >> "%LOG_FILE%"
echo [%DATE% %TIME%] Initiating automatic power setting restoration >> "%LOG_FILE%"

:: Determine target scheme. If original scheme does not exist, fall back to active scheme.
set TARGET_SCHEME=${scheme}
powercfg /query %TARGET_SCHEME% >nul 2>&1
if errorlevel 1 (
    echo [WARN] Original scheme %TARGET_SCHEME% not found. Falling back to current active scheme. >> "%LOG_FILE%"
    for /f "tokens=4" %%G in ('powercfg /getactivescheme') do set TARGET_SCHEME=%%G
)

echo [INFO] Restoring to power scheme: !TARGET_SCHEME! >> "%LOG_FILE%"

:: 1. Screen Off (Video Idle)
powercfg /setacvalueindex !TARGET_SCHEME! ${GUIDS.SUB_VIDEO} ${GUIDS.SETTING_SCREEN_OFF} ${acScreen} >> "%LOG_FILE%" 2>&1
powercfg /setdcvalueindex !TARGET_SCHEME! ${GUIDS.SUB_VIDEO} ${GUIDS.SETTING_SCREEN_OFF} ${dcScreen} >> "%LOG_FILE%" 2>&1

:: 2. System Sleep (Standby Idle)
powercfg /setacvalueindex !TARGET_SCHEME! ${GUIDS.SUB_SLEEP} ${GUIDS.SETTING_SLEEP} ${acSleep} >> "%LOG_FILE%" 2>&1
powercfg /setdcvalueindex !TARGET_SCHEME! ${GUIDS.SUB_SLEEP} ${GUIDS.SETTING_SLEEP} ${dcSleep} >> "%LOG_FILE%" 2>&1

:: 3. Hibernate Idle
powercfg /setacvalueindex !TARGET_SCHEME! ${GUIDS.SUB_SLEEP} ${GUIDS.SETTING_HIBERNATE} ${acHib} >> "%LOG_FILE%" 2>&1
powercfg /setdcvalueindex !TARGET_SCHEME! ${GUIDS.SUB_SLEEP} ${GUIDS.SETTING_HIBERNATE} ${dcHib} >> "%LOG_FILE%" 2>&1

:: 4. Hard Disk Off (Disk Idle)
powercfg /setacvalueindex !TARGET_SCHEME! ${GUIDS.SUB_DISK} ${GUIDS.SETTING_HARD_DISK_OFF} ${acDisk} >> "%LOG_FILE%" 2>&1
powercfg /setdcvalueindex !TARGET_SCHEME! ${GUIDS.SUB_DISK} ${GUIDS.SETTING_HARD_DISK_OFF} ${dcDisk} >> "%LOG_FILE%" 2>&1

:: Apply changes to Windows active power subsystem
powercfg /setactive !TARGET_SCHEME! >> "%LOG_FILE%" 2>&1

:: Write completion flag with details
echo {"restoredAt":"%DATE% %TIME%","scheme":"!TARGET_SCHEME!","status":"completed"} > "%FLAG_FILE%"
echo [%DATE% %TIME%] Power settings successfully restored! >> "%LOG_FILE%"

:: Unregister scheduled task so it runs only once
schtasks /delete /tn "${TASK_NAME}" /f >> "%LOG_FILE%" 2>&1
`;

  return content;
}

/**
 * Generate XML definition for Windows Task Scheduler
 * Runs as SYSTEM (S-1-5-18), HighestAvailable privileges, Hidden,
 * with BootTrigger (30s delay) + LogonTrigger (10s delay).
 */
function generateTaskXml(scriptPath) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Power Setting Manager Auto-Restore after Restart</Description>
    <Author>PowerSettingManager</Author>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT10S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/c "${scriptPath}"</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Register Windows Scheduled Task for restore on restart
 */
async function registerScheduledTask(snapshot, valuesToRestore) {
  ensureDir(RESTORE_DIR);

  // Write restore.cmd
  const scriptContent = generateRestoreScript(snapshot, valuesToRestore);
  await fs.promises.writeFile(RESTORE_SCRIPT, scriptContent, 'utf-8');

  // Write temporary XML definition encoded in UTF-16LE with BOM
  const xmlContent = generateTaskXml(RESTORE_SCRIPT);
  const tempXmlPath = path.join(RESTORE_DIR, 'task_def.xml');
  const buffer = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(xmlContent, 'utf16le')]);
  await fs.promises.writeFile(tempXmlPath, buffer);

  try {
    // Create task using schtasks.exe
    await runExec(SCHTASKS_BIN, ['/create', '/xml', tempXmlPath, '/tn', TASK_NAME, '/f']);
    return { success: true, taskName: TASK_NAME };
  } catch (err) {
    throw new Error(`Failed to create Windows scheduled task: ${err.message}. Please verify administrator privileges.`);
  } finally {
    // Clean up temporary XML
    if (fs.existsSync(tempXmlPath)) {
      try {
        await fs.promises.unlink(tempXmlPath);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Delete registered Windows Scheduled Task
 */
async function unregisterScheduledTask() {
  try {
    await runExec(SCHTASKS_BIN, ['/delete', '/tn', TASK_NAME, '/f']);
    return { success: true };
  } catch (err) {
    // If task was already deleted, ignore error
    if (err.message.includes('The system cannot find the file specified') || err.message.includes('ERROR: The specified task name')) {
      return { success: true, notFound: true };
    }
    throw new Error(`Failed to delete scheduled task: ${err.message}`);
  }
}

/**
 * Check if the scheduled task is currently registered in Windows
 */
async function isTaskRegistered() {
  try {
    await runExec(SCHTASKS_BIN, ['/query', '/tn', TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the background script successfully ran and left the restored.flag file
 */
async function checkRestoredFlag() {
  try {
    if (fs.existsSync(RESTORE_FLAG)) {
      const content = await fs.promises.readFile(RESTORE_FLAG, 'utf-8');
      let data = {};
      try {
        data = JSON.parse(content);
      } catch {
        data = { raw: content };
      }
      // Remove the flag so it only triggers once
      await fs.promises.unlink(RESTORE_FLAG);
      return { wasRestored: true, details: data };
    }
  } catch {
    // ignore
  }
  return { wasRestored: false };
}

module.exports = {
  TASK_NAME,
  RESTORE_DIR,
  RESTORE_SCRIPT,
  RESTORE_FLAG,
  registerScheduledTask,
  unregisterScheduledTask,
  isTaskRegistered,
  checkRestoredFlag
};
