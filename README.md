# Power Setting Manager

A modern, production-grade Windows 11 desktop application designed to configure, backup, and automate Windows power idle timeouts. Engineered to replace legacy command-line batch scripts with a clean Windows 11 Fluent GUI and an autonomous scheduled auto-restore engine.

---

## Architecture & Security Principles

- **Framework**: Electron (latest stable) with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- **UI Architecture**: Plain HTML, Fluent CSS variables, and vanilla JavaScript. Zero React, zero frontend bundlers, zero external CDNs, and zero runtime telemetry.
- **Single Instance**: Enforced via `app.requestSingleInstanceLock()`.
- **Command Security**: System commands are executed **strictly** with `child_process.execFile` and argument arrays. Never passed through `child_process.exec` or shell strings, eliminating shell injection vulnerabilities.
- **IPC Validation**: Every GUID, timeout integer (0 to 86400 seconds), and action parameter passed across the IPC boundary is strictly validated against schemas before touching Windows system binaries.
- **Language-Independent Parser**: Parses `powercfg /query` output using regular expressions against hexadecimal tokens (`0x...`), completely immune to Windows display language differences.
- **Safe Plan Deletion**: Windows default schemes (Balanced, High Performance, Power Saver) cannot be deleted. Deleting an active custom plan automatically migrates Windows back to Balanced first before deleting.
- **Preview & Mock Mode**: In environments without Electron `window.api` (such as web browser previews), the renderer automatically activates an in-memory mock engine with realistic Windows power state, presets, and scheduled tasks.

---

## File Structure

```
├── assets/
│   └── BackupPowerPlan.pow             # Bundled power plan template for 1-click import
├── build/
│   └── icon.ico                        # 256x256 Windows application icon
├── lib/
│   ├── powercfg.js                     # Low-level powercfg.exe, powershell, and control.exe engine
│   ├── restoreTask.js                  # Scheduled task XML generator and autonomous restore.cmd
│   └── storage.js                      # Atomic JSON persistence (presets, backups, settings)
├── renderer/
│   ├── app.js                          # UI controller, event listeners, and in-memory mock engine
│   ├── index.html                      # Windows 11 Fluent application markup
│   └── styles.css                      # Windows 11 Fluent theme stylesheet (Light/Dark/Accents)
├── index.html                          # Root entry point for browser preview
├── main.js                             # Electron main process, IPC handlers, single-instance lock
├── package.json                        # Dependencies, electron-builder packaging config
├── preload.js                          # ContextBridge whitelist exposing window.api
└── README.md                           # Documentation and manual verification steps
```

---

## Installation & Packaging

### Prerequisites
- Node.js 18+ and npm
- Windows 10/11 (for running real Windows `powercfg.exe` and `schtasks.exe`)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode
To launch the real Electron desktop application:
```bash
npm start
```

To run the local browser preview (with automatic mock mode):
```bash
npm run dev
```

### 3. Build Windows Executable (.exe)
```bash
npm run dist
```
This runs `electron-builder` and generates both targets in the `/release` folder:
1. **NSIS Installer**: `release/PowerSettingManager-1.8.2-nsis.exe` (with custom install directory support and administrator elevation).
2. **Portable Executable**: `release/PowerSettingManager-1.8.2-portable.exe` (zero installation required, runs standalone with administrator elevation).

---

## Key Features

### 1. Dashboard (Plugged In vs. On Battery)
- Side-by-side cards for AC power and Battery power.
- 4 primary timeouts: **Screen off**, **System sleep**, **Hibernate**, and **Hard disk off**.
- Directly editable dropdown with standard intervals (Never, 1m, 2m, 3m, 5m, 10m, 15m, 20m, 25m, 30m, 45m, 1h, 2h, 3h, 4h, 5h) + custom numeric stepper (1 to 1440 min).
- Pending changes tracking with modified row highlights and a sticky **[Apply Changes]** / **[Discard]** bar.
- Smart validation warnings:
  - Warns if **Sleep $\le$ Screen off**
  - Warns if **Hibernate $\le$ Sleep**
- Desktop PC auto-detection: If no physical battery is reported via PowerShell `Win32_Battery`, the battery card is hidden with a friendly "Desktop PC Detected" notice.

### 2. "Never Mode" with Autonomous Auto-Restore on Restart
- **Set All to Never**: Zeroes out all 4 idle timeouts on AC and Battery.
- **Safe Snapshotting**: Saves an exact snapshot of previous times and target scheme GUID. Clicking "Never" multiple times will **never** overwrite or lose the original snapshot.
- **Windows Task Scheduler Integration**: When "Restore my previous times after restart" is ON:
  - Generates `%ProgramData%\PowerSettingManager\restore.cmd` with literal `powercfg /setacvalueindex` and `/setdcvalueindex` commands.
  - Creates task `PowerSettingManager_RestoreOnRestart` via `schtasks.exe` with a **BootTrigger (30s delay)** and a **LogonTrigger** running as SYSTEM with highest privileges.
  - Completely autonomous: **Does not require Electron or Node.js to be running or installed.**
  - **Self-cleaning**: After applying times, the script writes a completion flag and unregisters itself from Task Scheduler.
- **Restore Target Selector**: Choose whether restart restores:
  1. *My previous times (default)*
  2. *Recommended preset*
  3. *Windows 11 Default*

### 3. Presets & Legacy Migration
- Built-in presets: **Recommended** (AC: 5/15/60/5; Battery: 5/10/30/5) and **Windows 11 Default**.
- Create custom presets from current live values or duplicate existing ones.
- **Import Old Backup (.txt)**: Built-in parser compatible with the legacy batch script format:
  ```ini
  Mode=AC
  Screen=10 min
  Sleep=Never
  Hibernate=180 min
  HardDisk=20 min

  Mode=BATTERY
  Screen=5 min
  Sleep=10 min
  Hibernate=30 min
  HardDisk=5 min
  ```

### 4. Backups & Disaster Recovery
- Create timestamped, labeled snapshots.
- Restore backups with a single click (prompting confirmation dialog).
- Export and import configuration as portable JSON strings.

### 5. Hardware Buttons, Hibernation & Hybrid Sleep
- **Master Hibernation Toggle**: Turn hibernation on/off (`powercfg /hibernate on|off`) with real-time detection of `C:\hiberfil.sys`.
- **Hybrid Sleep**: Independent toggles for AC and Battery.
- **Lid & Button Actions**: Set Lid Close, Power Button, and Sleep Button actions to *Do nothing*, *Sleep*, *Hibernate*, or *Shut down*.
- **Modern Standby Detection**: Detects S0 Low Power Idle and displays informative hardware notes.

---

## Manual Verification & Test Matrix

Follow these step-by-step tests on a Windows 10/11 system:

### Test Case 1: Never Mode with Auto-Restore Enabled
1. Launch Power Setting Manager as Administrator.
2. Note your current timeouts on the Dashboard (e.g. Screen: 5 min, Sleep: 15 min).
3. Navigate to **Never & Auto-Restore**.
4. Ensure the toggle **"Restore my previous times after restart"** is **ON**.
5. Click **"Activate Never Mode"**.
6. Verify the prominent banner displays: *"Everything is set to Never. Previous times will be restored at next restart."*
7. Open Windows PowerShell or cmd as Admin and run:
   ```cmd
   schtasks /query /tn "PowerSettingManager_RestoreOnRestart"
   ```
   *Expected Result*: Task is registered with state `Ready`.
8. Check that `%ProgramData%\PowerSettingManager\restore.cmd` exists with your previous timeout values.
9. Restart your computer.
10. Upon logging in, wait 30 seconds. Run `powercfg /query` or launch Power Setting Manager.
    *Expected Result*: All previous timeouts (Screen: 5 min, Sleep: 15 min) are fully restored, and a notification toast displays: *"Your power timeouts were automatically restored after restart!"*.

### Test Case 2: Never Mode with Auto-Restore Disabled
1. Navigate to **Never & Auto-Restore**.
2. Switch the toggle **"Restore my previous times after restart"** to **OFF**.
3. Click **"Activate Never Mode"**.
4. Run `schtasks /query /tn "PowerSettingManager_RestoreOnRestart"`.
   *Expected Result*: Task is not found (error 1).
5. Restart your computer.
   *Expected Result*: All power timeouts remain set to **Never**.

### Test Case 3: Presets & Legacy Text Import
1. Navigate to **Presets & Profiles**.
2. Click **"Import Old Backup (.txt)"**.
3. Paste:
   ```ini
   Mode=AC
   Screen=15 min
   Sleep=45 min
   Hibernate=Never
   HardDisk=10 min
   Mode=BATTERY
   Screen=5 min
   Sleep=15 min
   Hibernate=60 min
   HardDisk=5 min
   ```
4. Click **"Parse and Save as Preset"**.
5. Click **"Apply Now"** on the newly created preset.
6. Verify that Dashboard timeouts reflect these new values.
