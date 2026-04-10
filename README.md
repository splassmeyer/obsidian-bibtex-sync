# BibTex Sync
Obsidian plugin for automated import and creation of notes from BibTex references.

# Installation

To manually install this plugin, download the `bibtex-sync` directory and move it to the `.obsidian/plugin` directory within your vault. Community plugins must be enabled. Either refresh the installed plugins list or re-open your vault to see the BibTex Sync plugin appear. Click the toggle 'on' switch to activate.

# Setup

Designate a directory within your vault for new notes to be saved. Optionally, if you'd like to keep a log tracking the addition of all notes to your vault, specify a log filename.

This plugin runs a Python script under the hood. You must have a version of Python >=3.0 installed and indicate the execution path in settings (defaults: `/usr/bin/python3`). The script is fully native Python; no additional packages are required.

## Syncing with local .bib files

If you'd like to sync to a local .bib file, provide the path *relative to your vault*. If you'd like to sync to a .bib file saved in a Google Drive synced directory, you can create a symbolic link to that .bib file within your vault.

**If you provide a path for a local .bib file, this will supersede an .bib file specified via GitHub access.**

## Syncing with a .bib on GitHub

Specify the username, repo, branch/version, and filename for the .bib file.

If the repo is private, you will need to provide a Personal Access Token that grants content permissions for the repo. This can be added to the Obsidian keychain directory or through the plugin settings (which save it to the keychain).

Again, if a path for a local .bib file is provided, the GitHub sync will be ignored.

# Usage

As new references are added to the target .bib file, notes for these references can be generated in your vault by triggering the sync in three different ways:
1. If the 'Run on startup' setting is toggled to 'On' in the BibTex Sync plugin settings, the sync will automatically be performed each time the vault is opened.
2. The 'BibTex Sync: Sync BibTex Notes' command, which can be accessed in the command palette by pressing Cmd\Ctrl + P.
3. Clicking the BibTex Sync icon located in the ribbon along the left-hand side.

Syncing will add new notes for any references that do not already have a note in the vault with a filename matching the reference cite-key. If any reference metadata has been modified following a previous sync and note generation, these changes will not be applied to the note.
