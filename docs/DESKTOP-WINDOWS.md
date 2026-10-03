# Ripple Radar on Windows

The desk runs in its own window, with a taskbar icon and a Start menu entry. There is no console window. An update replaces the program and leaves your data where it is.

Your data lives in:

`C:\Users\JOSHD\AppData\Roaming\Ripple Radar`

That folder holds the local database (`pglite`), window settings, and `update-check.log`. The installer writes the program somewhere else (`AppData\Local\Programs\Ripple Radar`). Updating does not delete the Roaming folder.

The interface is light. It does not follow a dark Windows theme.

## Install on this PC

1. Open the repo on GitHub: `Neural-Energies/ripple-radar`.
2. Open **Actions** and the **Windows desktop** workflow. On a pull request, the workflow uploads `RippleRadar-Setup-….exe` as an artifact. After a published release, the same file is on the release page.
3. Download `RippleRadar-Setup-….exe`.
4. In PowerShell, from the folder that contains the file:

```powershell
Start-Process .\RippleRadar-Setup-0.2.0.exe
```

5. Windows SmartScreen will warn, because the build is not code-signed. Choose **More info**, then **Run anyway**. That prompt is once per publisher until a certificate is added.
6. The installer is one click. It does not ask for an admin password. It adds **Ripple Radar** to the Start menu and the desktop.
7. Open **Ripple Radar**. The window is the desk. **About** (in the left rail) shows the icon, the version, and **Check for updates**.

Closing the window leaves the app in the system tray so alerts can still appear. Quit from the tray icon when you want it to stop. **About** also has **Launch when Windows starts**, **Save a backup**, and **Restore a backup** for the data folder above. **Data sources** in the left rail lists each feed. **Copy book**, **Download**, and **PDF** sit on the desk and on the research pages.

## Ship an update

Installed copies only see a release that GitHub Releases hosts, with the `latest.yml` file electron-builder writes next to the installer.

From a checkout of `main`, after the change is merged:

```powershell
# the version in package.json and src/lib/desktop/version.ts must match
npm version patch
git push origin main --follow-tags
```

`npm version patch` only works on a clean `main` you are allowed to push. If you would rather not use `npm version`, edit both version strings to the same number (for example `0.2.0`), commit, then:

```powershell
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

The tag must look like `v0.2.0`. Pushing it starts **Windows desktop**. The job builds the installer on a Windows runner and publishes a GitHub Release. Installed copies, the next time they open or you press **Check for updates**, see the new version. **Update** downloads it and restarts into it. The Roaming data folder is not touched.

You can also run the workflow by hand: Actions → Windows desktop → Run workflow → check **Publish a GitHub Release**. Use that only when `package.json` is already the version you want to ship. A hand run publishes whatever version is on the branch you pick.

## What the check writes

On the PC, `update-check.log` in the Roaming folder records each check (`[check]`, then either the new version or "No published release yet"). The About page shows the same result.

Until the first `v*` tag is published, **Check for updates** reports that there is no release. That is the starting state, not a broken install.

## Code signing

The workflow does not sign the installer. SmartScreen shows the warning above. To sign later, add `CSC_LINK` and `CSC_KEY_PASSWORD` as repository secrets (a `.pfx` base64 and its password) and set `verifyUpdateCodeSignature: true` in `desktop/electron-builder.yml`. electron-builder picks the secrets up on its own. No other change to the update flow is required.

## If the window says the desk did not start

Open `server.log` in the Roaming folder. The usual cause is a half-downloaded artifact. Download the installer again from the release or the workflow artifact.
