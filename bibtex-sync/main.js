const { Plugin, Notice, PluginSettingTab, Setting, SecretComponent, addIcon } = require('obsidian');
const { exec } = require('child_process');
const path = require('path');

const DEFAULT_SETTINGS = {
  pythonPath: "/usr/bin/python3",
  runOnStartup: false,

  localBibFilePath: "",

  githubUser: "",
  githubRepo: "",
  githubBranch: "main",
  bibFileName: "",
  githubTokenSecret: "",
  tokenRequired: false,

  outputDir: "",
  logFile: ""
};

module.exports = class BibTexSyncPlugin extends Plugin {

  async onload() {
    console.log("BibTex Sync plugin loading...");

    // Load saved settings
    await this.loadSettings();

    // Add command to command palette
    this.addCommand({
      id: 'run-bibtex-sync',
      name: 'Sync BibTex Notes',
      callback: () => this.runScript()
    });

    // Register custom icon
    addIcon('bibtex-sync', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect width="8" height="18" x="3" y="3" rx="1"/>
      <path d="M7 3v18"/>
      <path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>
      </svg>`);

    // Optional: add ribbon icon (left sidebar button)
    this.addRibbonIcon('bibtex-sync', 'Sync BibTex Notes', () => {
      this.runScript();
    });

    // Add settings tab
    this.addSettingTab(new BibTexSettingTab(this.app, this));

    // Run on startup if enabled
    if (this.settings.runOnStartup) {
      console.log("Running BibTex sync on startup...");
      this.runScript();
    }
  }

  onunload() {
    console.log("BibTex Sync plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async getToken() {
    try {
      if (this.settings.githubTokenSecret) {
        return await this.app.secretStorage.getSecret(this.settings.githubTokenSecret) || "";
      }
      return "";
    } catch (err) {
      console.error("Failed to retrieve token from SecretStorage:", err);
      return "";
    }
  }

  async validateToken(token, githubUser) {
    try {
      const url = `https://api.github.com/users/${encodeURIComponent(githubUser)}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `token ${token}`
        }
      });
      
      if (response.status === 200) {
        const data = await response.json();
        return { valid: true, user: data.login };
      } else if (response.status === 401) {
        return { valid: false, error: "Unauthorized (invalid token)" };
      } else {
        return { valid: false, error: `HTTP ${response.status}` };
      }
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  async checkRepositoryAccess(githubUser, githubRepo) {
    /**
     * Check if a repository is publicly accessible without authentication.
     * Returns { isPublic: boolean, exists: boolean, error?: string }
     */
    if (!githubUser || !githubRepo) {
      return { isPublic: null, exists: false, error: "Username and repository are required" };
    }

    try {
      const url = `https://api.github.com/repos/${encodeURIComponent(githubUser)}/${encodeURIComponent(githubRepo)}`;
      
      // Try without token first
      const publicResponse = await fetch(url);
      
      if (publicResponse.status === 200) {
        // Repository is publicly accessible
        const data = await publicResponse.json();
        return { isPublic: true, exists: true, private: data.private };
      } else if (publicResponse.status === 404) {
        // Could be private (needs token) or doesn't exist
        // Try with token to determine
        const token = await this.getToken();
        if (token) {
          const privateResponse = await fetch(url, {
            headers: {
              Authorization: `token ${token}`
            }
          });
          
          if (privateResponse.status === 200) {
            // Found with token - it's private
            const data = await privateResponse.json();
            return { isPublic: false, exists: true, private: data.private };
          } else if (privateResponse.status === 401) {
            return { isPublic: false, exists: null, error: "Invalid token" };
          } else {
            return { isPublic: false, exists: false, error: "Repository not found" };
          }
        } else {
          // No token and 404 - likely private
          return { isPublic: false, exists: null, error: "Repository may be private (token required)" };
        }
      } else if (publicResponse.status === 401 || publicResponse.status === 403) {
        return { isPublic: false, exists: null, error: "Repository requires authentication (token needed)" };
      } else {
        return { isPublic: null, exists: false, error: `HTTP ${publicResponse.status}` };
      }
    } catch (err) {
      return { isPublic: null, exists: false, error: err.message };
    }
  }

  getVaultPath(relativePath) {
    if (!relativePath || relativePath.trim() === "") return "";
    return path.join(this.app.vault.adapter.basePath, relativePath);
  }

  runScript = async () => {
    
    const token = await this.getToken();

    const {
      pythonPath,
      githubUser,
      githubRepo,
      githubBranch,
      bibFileName,
      localBibFilePath
    } = this.settings;

    // Check if using local file
    const absLocalBibPath = localBibFilePath ? this.getVaultPath(localBibFilePath) : "";
    const useLocalFile = absLocalBibPath && absLocalBibPath.trim() !== "";

    // Validate configuration
    if (!useLocalFile && !token) {
      new Notice("GitHub token not set. Please configure it in settings.");
      return;
    }

    if (!useLocalFile && (!githubUser || !githubRepo || !bibFileName)) {
      new Notice("Missing GitHub configuration or local .bib file path.");
      return;
    }

    if (useLocalFile) {
      // Check if local file exists
      const fs = require('fs');
      if (!fs.existsSync(absLocalBibPath)) {
        new Notice(`Local .bib file not found: ${absLocalBibPath}`);
        return;
      }
    }

    const absOutputDir = this.getVaultPath(this.settings.outputDir);
    const absLogFile = this.getVaultPath(this.settings.logFile);

    const scriptPath = path.join(this.app.vault.adapter.basePath, '.obsidian', 'plugins', 'bibtex-sync', 'bibtex_sync.py');

    const command = `"${pythonPath}" "${scriptPath}"`;

    console.log("Executing:", command);
    const statusMsg = useLocalFile ? `Running BibTex sync from local file...` : `Running BibTex sync from GitHub...`;
    new Notice(statusMsg);

    const env = {
      ...process.env,
      OUTPUT_DIR: absOutputDir,
      LOG_FILE: absLogFile
    };

    // Add GitHub config if using GitHub source
    if (!useLocalFile) {
      env.GITHUB_TOKEN = token;
      env.GITHUB_USER = githubUser;
      env.GITHUB_REPO = githubRepo;
      env.GITHUB_BRANCH = githubBranch;
      env.BIB_FILE = bibFileName;
    } else {
      // Add local file path if using local source
      env.LOCAL_BIB_FILE = absLocalBibPath;
    }

    exec(command, { env }, (error, stdout, stderr) => {
      if (error) {
        console.error("Execution error:", error);
        new Notice("BibTex sync failed ❌");
        return;
      }

      if (stderr) {
        console.warn("stderr:", stderr);
      }

      console.log("stdout:", stdout);
      new Notice("BibTex sync complete ✅");

      // Optional: trigger vault refresh (usually not necessary)
      // this.app.workspace.requestSaveLayout();
    });
  }
}

/* =========================
   Settings Tab UI
========================= */

class BibTexSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tokenStatusElement = null;
    this.repoStatusElement = null;
  }

  async updateTokenRequirement() {
    /**
     * Check if repository requires a token and update UI accordingly
     */
    if (!this.repoStatusElement) return;

    const { githubUser, githubRepo } = this.plugin.settings;
    
    if (!githubUser || !githubRepo) {
      this.repoStatusElement.innerHTML = '<em style="color: var(--text-muted);">Fill in username and repository to check</em>';
      this.plugin.settings.tokenRequired = false;
      await this.plugin.saveSettings();
      return;
    }

    this.repoStatusElement.innerHTML = '<em style="color: var(--text-muted);">Checking repository access...</em>';

    const result = await this.plugin.checkRepositoryAccess(githubUser, githubRepo);
    
    let statusHtml = '';
    if (result.isPublic === true) {
      statusHtml = '<span style="color: var(--color-green);">Public repository - no token required ✅</span>';
      this.plugin.settings.tokenRequired = false;
    } else if (result.isPublic === false) {
      statusHtml = '<span style="color: var(--color-orange);">Private repository - token required ⚠️</span>';
      this.plugin.settings.tokenRequired = true;
      
      // Check if token is available
      const token = await this.plugin.getToken();
      if (token) {
        statusHtml += '<br/><span style="color: var(--color-green); font-size: 0.9em;">Token is configured ✅</span>';
      } else {
        statusHtml += '<br/><span style="color: var(--color-red); font-size: 0.9em;">Token is missing ❌</span>';
      }
    } else {
      statusHtml = `<span style="color: var(--color-red);">Error: ${result.error} ❌</span>`;
      this.plugin.settings.tokenRequired = false;
    }

    this.repoStatusElement.innerHTML = statusHtml;
    await this.plugin.saveSettings();
  }

  displayRepositoryStatus() {
    /**
     * Display cached repository status without making API calls
     */
    if (!this.repoStatusElement) return;

    const { githubUser, githubRepo, tokenRequired } = this.plugin.settings;
    
    if (!githubUser || !githubRepo) {
      this.repoStatusElement.innerHTML = '<em style="color: var(--text-muted);">Fill in username and repository to check</em>';
      return;
    }

    let statusHtml = '';
    if (tokenRequired) {
      statusHtml = '<span style="color: var(--color-orange);">Private repository - token required ⚠️</span>';
      
      this.plugin.getToken().then(token => {
        if (token) {
          this.repoStatusElement.innerHTML = statusHtml + '<br/><span style="color: var(--color-green); font-size: 0.9em;">Token is configured ✅</span>';
        } else {
          this.repoStatusElement.innerHTML = statusHtml + '<br/><span style="color: var(--color-red); font-size: 0.9em;">Token is missing ❌</span>';
        }
      });
    } else if (githubUser && githubRepo) {
      statusHtml = '<span style="color: var(--color-green);">Public repository - no token required ✅</span>';
      this.repoStatusElement.innerHTML = statusHtml;
    }
  }

  displaySourceStatus() {
    /**
     * Display which source (local file or GitHub) will be used
     */
    if (!this.sourceStatusElement) return;

    const { localBibFilePath } = this.plugin.settings;
    
    if (localBibFilePath && localBibFilePath.trim() !== "") {
      // Have a local file, check if it exists
      const absPath = this.plugin.getVaultPath(localBibFilePath);
      const fs = require('fs');
      
      if (fs.existsSync(absPath)) {
        this.sourceStatusElement.innerHTML = '<span style="color: var(--color-green);">Using local .bib file ✅</span>';
      } else {
        this.sourceStatusElement.innerHTML = `<span style="color: var(--color-red);">Local file not found: ${localBibFilePath} ❌</span>`;
      }
    } else {
      this.sourceStatusElement.innerHTML = '<span style="color: var(--color-orange);">Using GitHub repository</span>';
    }
  }

  async display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'BibTex Sync Settings' });

    new Setting(containerEl).setName('Vault Settings').setHeading();

    // Load token status asynchronously
    this.plugin.getToken().then(token => {
      const statusSetting = containerEl.querySelector('[data-token-status]');
      if (statusSetting) {
        statusSetting.textContent = token ? 'Token is saved ✅' : 'No token stored ❌';
      }
    }).catch(err => {
      console.error("Error loading token status:", err);
    });

    new Setting(containerEl)
      .setName('Output directory')
      .setDesc('Relative to vault root (e.g. notes/papers)')
      .addText(text => text
        .setValue(this.plugin.settings.outputDir)
        .onChange(async (value) => {
          this.plugin.settings.outputDir = value.trim();
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Log file path')
      .setDesc('Relative to vault (e.g. logs/bibsync.log)')
      .addText(text => text
        .setValue(this.plugin.settings.logFile)
        .onChange(async (value) => {
          this.plugin.settings.logFile = value.trim();
          await this.plugin.saveSettings();
        }));

    /* ================================
       GITHUB CONFIGURATION SECTION
    ================================ */

    new Setting(containerEl).setName('BibTex Source').setHeading();

    new Setting(containerEl)
      .setName('Local .bib File Path')
      .setDesc('Relative to vault root (e.g. references.bib or data/refs.bib). If set, this takes precedence over GitHub.')
      .addText(text => text
        .setValue(this.plugin.settings.localBibFilePath)
        .onChange(async (value) => {
          this.plugin.settings.localBibFilePath = value.trim();
          await this.plugin.saveSettings();
          this.displaySourceStatus();
        }));

    new Setting(containerEl).setName('GitHub Configuration').setHeading();

    new Setting(containerEl)
      .setName('GitHub Username')
      .addText(text => text
        .setValue(this.plugin.settings.githubUser)
        .onChange(async (value) => {
          this.plugin.settings.githubUser = value.trim();
          await this.plugin.saveSettings();
          await this.updateTokenRequirement();
        }));
    
    new Setting(containerEl)
      .setName('Repository')
      .setDesc('e.g. my-repo')
      .addText(text => text
        .setValue(this.plugin.settings.githubRepo)
        .onChange(async (value) => {
          this.plugin.settings.githubRepo = value.trim();
          await this.plugin.saveSettings();
          await this.updateTokenRequirement();
        }));
    
    new Setting(containerEl)
      .setName('Branch / Version')
      .setDesc('e.g. main, dev, or tag')
      .addText(text => text
        .setValue(this.plugin.settings.githubBranch)
        .onChange(async (value) => {
          this.plugin.settings.githubBranch = value.trim();
          await this.plugin.saveSettings();
          await this.updateTokenRequirement();
        }));
    
    new Setting(containerEl)
      .setName('.bib File Name')
      .setDesc('e.g. references.bib')
      .addText(text => text
        .setValue(this.plugin.settings.bibFileName)
        .onChange(async (value) => {
          this.plugin.settings.bibFileName = value.trim();
          await this.plugin.saveSettings();
        }));

    // Repository status display
    const repoStatusSetting = new Setting(containerEl)
      .setName('Repository Status');
    
    this.repoStatusElement = repoStatusSetting.descEl;
    this.displayRepositoryStatus();

    // Source status display
    const sourceStatusSetting = new Setting(containerEl)
      .setName('Active Source');
    
    this.sourceStatusElement = sourceStatusSetting.descEl;
    this.displaySourceStatus();

    new Setting(containerEl).setName('GitHub Authentication').setHeading();

    new Setting(containerEl)
      .setName('GitHub Token Status')
      .setDesc('Checking...')
      .settingEl.setAttribute('data-token-status', 'true');
    
    // Get the actual status setting element
    const statusSettings = containerEl.querySelectorAll('.setting-item');
    const statusSetting = statusSettings[statusSettings.length - 1]?.querySelector('.setting-item-info .setting-item-description');
    
    this.plugin.getToken().then(token => {
      if (statusSetting) {
        statusSetting.textContent = token ? 'Token is available ✅' : 'No token configured ❌';
      }
    });

    new Setting(containerEl)
      .setName('GitHub Personal Access Token')
      .setDesc('Select a secret from SecretStorage')
      .addComponent(el => new SecretComponent(this.app, el)
        .setValue(this.plugin.settings.githubTokenSecret)
        .onChange(async (value) => {
          this.plugin.settings.githubTokenSecret = value;
          await this.plugin.saveSettings();
          await this.updateTokenRequirement();
          this.display(); // refresh UI
        }));

    new Setting(containerEl)
      .setName('Test GitHub Connection')
      .setDesc('Verify that your token works')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          const token = await this.plugin.getToken();

          if (!token) {
            new Notice("No token stored ❌");
            return;
          }

          new Notice("Testing connection...");

          const result = await this.plugin.validateToken(token, this.plugin.settings.githubUser);

          if (result.valid) {
            new Notice(`Connected as ${result.user} ✅`);
          } else {
            new Notice(`Connection failed: ${result.error} ❌`);
          }
        }));

    /* ================================
       PYTHON & EXECUTION SETTINGS
    ================================ */

    new Setting(containerEl).setName('Python & Execution').setHeading();

    new Setting(containerEl)
      .setName('Python path')
      .addText(text => text
        .setValue(this.plugin.settings.pythonPath)
        .onChange(async (value) => {
          this.plugin.settings.pythonPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Run on startup')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.runOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.runOnStartup = value;
          await this.plugin.saveSettings();
        }));

    /* ------------------------
       MANUAL RUN BUTTON
    ------------------------ */
    new Setting(containerEl)
      .setName('Run now')
      .addButton(button => button
        .setButtonText('Run')
        .setCta()
        .onClick(() => this.plugin.runScript()));
  }
}