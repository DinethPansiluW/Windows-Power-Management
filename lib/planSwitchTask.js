/**
 * Power Setting Manager - Automatic Plan Switch by Power Source
 * 
 * Registers a Windows Scheduled Task triggered on Kernel-Power EventID 105 (AC/Battery change),
 * plus Boot and Logon triggers, running with SYSTEM privileges.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TASK_NAME = 'PowerSettingManager_AutoPlanSwitch';
const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const DIR_PATH = path.join(PROGRAM_DATA, 'PowerSettingManager');
const SCRIPT_PATH = path.join(DIR_PATH, 'plan-switch.cmd');
const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows';
const SCHTASKS_BIN = path.join(SYSTEM_ROOT, 'System32', 'schtasks.exe');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

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

function generateScript(acGuid, dcGuid) {
  return `@echo off
setlocal enabledelayedexpansion

:: ===================================================================
:: Power Setting Manager - Automatic Plan Switch by Power Source
:: Generated at: ${new Date().toISOString()}
:: ===================================================================

set AC_PLAN=${acGuid}
set DC_PLAN=${dcGuid}

:: Determine battery status using PowerShell Win32_Battery
:: BatteryStatus: 1 = Discharging (On Battery), anything else or no battery = AC
for /f "usebackq tokens=*" %%B in (\`powershell.exe -NoProfile -NonInteractive -Command "$b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue; if ($b) { [int]$b.BatteryStatus } else { 0 }"\`) do (
    set BATT_STATUS=%%B
)

if "%BATT_STATUS%"=="1" (
    set TARGET_PLAN=%DC_PLAN%
) else (
    set TARGET_PLAN=%AC_PLAN%
)

:: Validate target plan exists before activating; skip silently if plan was deleted
powercfg /query %TARGET_PLAN% >nul 2>&1
if not errorlevel 1 (
    powercfg /setactive %TARGET_PLAN%
)
`;
}

function generateTaskXml(scriptPath) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Automatically switch Windows power scheme between AC and Battery based on power source events.</Description>
    <Author>Power Setting Manager</Author>
  </RegistrationInfo>
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="System"&gt;&lt;Select Path="System"&gt;*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and (EventID=105)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
    </EventTrigger>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT10S</Delay>
    </BootTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT5S</Delay>
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

async function enableAutoSwitch(acGuid, dcGuid) {
  ensureDir(DIR_PATH);

  // Write plan-switch.cmd
  const scriptContent = generateScript(acGuid, dcGuid);
  await fs.promises.writeFile(SCRIPT_PATH, scriptContent, 'utf-8');

  // Write temporary XML definition (UTF-16LE with BOM)
  const xmlContent = generateTaskXml(SCRIPT_PATH);
  const tempXmlPath = path.join(DIR_PATH, 'plan_switch_task.xml');
  const buffer = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(xmlContent, 'utf16le')]);
  await fs.promises.writeFile(tempXmlPath, buffer);

  try {
    await runExec(SCHTASKS_BIN, ['/create', '/xml', tempXmlPath, '/tn', TASK_NAME, '/f']);

    // Run the script immediately to apply correct plan for current power source
    try {
      await runExec('cmd.exe', ['/c', SCRIPT_PATH]);
    } catch {
      // non-fatal
    }

    return { success: true, taskName: TASK_NAME };
  } catch (err) {
    throw new Error(`Failed to create Windows scheduled task: ${err.message}. Please verify administrator privileges.`);
  } finally {
    if (fs.existsSync(tempXmlPath)) {
      try {
        await fs.promises.unlink(tempXmlPath);
      } catch {
        // ignore
      }
    }
  }
}

async function disableAutoSwitch() {
  try {
    await runExec(SCHTASKS_BIN, ['/delete', '/tn', TASK_NAME, '/f']);
    return { success: true };
  } catch (err) {
    if (err.message.includes('The system cannot find the file specified') || err.message.includes('ERROR: The specified task name')) {
      return { success: true, notFound: true };
    }
    throw new Error(`Failed to delete scheduled task: ${err.message}`);
  }
}

async function isTaskRegistered() {
  try {
    await runExec(SCHTASKS_BIN, ['/query', '/tn', TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  TASK_NAME,
  SCRIPT_PATH,
  enableAutoSwitch,
  disableAutoSwitch,
  isTaskRegistered
};
