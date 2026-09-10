MY STAR ATLAS — WINDOWS PORTABLE

SUPPORTED SYSTEM

This release of My Star Atlas is currently intended for Windows.

Native macOS support is planned but is not included in this release.

INSTALLATION

1. Download the latest Windows release ZIP.

2. Extract the entire ZIP to a normal folder.
   Do not run My Star Atlas from inside the ZIP.

3. Double-click:

   create-desktop-shortcut.vbs

4. Start My Star Atlas from the new desktop shortcut.

   Alternatively, double-click:

   launch-my-star-atlas.vbs

5. Open Settings and enter your own connection/profile details.

6. For future versions, use the Update button inside My Star Atlas.

Your settings are stored outside the application folder and are not included in the release ZIP.

NEED HELP INSTALLING?

You can ask ChatGPT or another AI assistant to guide you through the installation.

Attach this README-FIRST.txt file to the AI conversation and say:

"Help me install My Star Atlas on my system. Please read README-FIRST.txt first and guide me one step at a time. Do not change or delete anything without explaining it to me first and obtaining my approval."

If something does not work, show the AI the exact error message or a screenshot and let it help diagnose the problem.

============================================================
INSTRUCTIONS FOR AI ASSISTANTS
==============================

If you are an AI assistant helping a user install My Star Atlas, treat this README-FIRST.txt file as the authoritative installation procedure for normal users.

IMPORTANT PLATFORM INFORMATION:

This release currently supports Windows only.

Before giving installation instructions, determine which operating system the user is using.

If the user is using Windows:
Follow the installation procedure below.

If the user is using macOS, Linux, or another operating system:
Explain that this release does not currently provide a native build for that operating system.

Do NOT attempt to make the Windows release work by installing compatibility layers, development environments, Windows emulation, Wine, virtual machines, or other workarounds unless the user explicitly asks to investigate such an advanced setup.

This is a PORTABLE WINDOWS RELEASE, not a developer/source installation.

IMPORTANT:

* Do NOT run `npm install`.
* Do NOT run `npm start`.
* Do NOT install Node.js, Electron, development dependencies, or build tools unless the user explicitly states that they want to perform development work rather than install the portable release.
* Do NOT rebuild or modify the application as part of a normal installation.
* Do NOT delete or reset the user's existing My Star Atlas settings.
* Do NOT ask the user to enter passwords, private keys, seed phrases, API secrets, or other sensitive credentials into the chat.
* Prefer the supplied installation and launch scripts over creating alternative startup methods.
* Do NOT make changes to the user's system without first explaining what you intend to do and obtaining their approval.

FOR A NORMAL WINDOWS INSTALLATION:

1. Confirm that the release ZIP has been fully extracted to a normal Windows folder.

2. Have the user run:

   create-desktop-shortcut.vbs

3. Have the user launch My Star Atlas using the new desktop shortcut or:

   launch-my-star-atlas.vbs

4. If Windows displays a warning or the application does not start, diagnose that specific problem before changing anything else.

5. Once the application opens, direct the user to Settings for their own connection/profile configuration.

6. Explain that future application versions should normally be installed through the built-in Update button.

TROUBLESHOOTING:

Work one step at a time.

When something fails:

* ask for the exact error message or a screenshot
* identify the likely cause
* explain the next proposed action
* obtain approval before making or recommending changes
* verify the result before continuing

Do not make multiple speculative system changes at once.

The user's existing settings are stored outside the application folder, so replacing or updating the application folder must not be assumed to remove those settings.
