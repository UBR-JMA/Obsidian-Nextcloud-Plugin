import { App, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';

interface NextcloudPluginSettings {
	serverUrl: string;
	username: string;
	password: string;
}

const DEFAULT_SETTINGS: NextcloudPluginSettings = {
	serverUrl: '',
	username: '',
	password: '',
}

export default class NextcloudPlugin extends Plugin {
	settings: NextcloudPluginSettings;

	async onload() {
		await this.loadSettings();

		// Add a ribbon icon to the left sidebar
		this.addRibbonIcon('cloud', 'Nextcloud', (_evt: MouseEvent) => {
			new Notice('Nextcloud plugin is active!');
		});

		// Add a command to test the Nextcloud connection
		this.addCommand({
			id: 'test-nextcloud-connection',
			name: 'Test Nextcloud connection',
			callback: () => {
				this.testConnection();
			}
		});

		// Add a settings tab
		this.addSettingTab(new NextcloudSettingTab(this.app, this));
	}

	onunload() {
		// Clean up plugin resources on unload
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async testConnection() {
		const { serverUrl, username, password } = this.settings;

		if (!serverUrl || !username || !password) {
			new Notice('Please configure your Nextcloud settings first.');
			return;
		}

		try {
			const url = `${serverUrl.replace(/\/$/, '')}/ocs/v1.php/cloud/capabilities?format=json`;
			const credentials = Buffer.from(`${username}:${password}`).toString('base64');

			const response = await requestUrl({
				url,
				headers: {
					'Authorization': `Basic ${credentials}`,
					'OCS-APIRequest': 'true',
				},
			});

			if (response.status === 200) {
				new Notice('Successfully connected to Nextcloud!');
			} else {
				new Notice(`Connection failed: HTTP ${response.status}`);
			}
		} catch (error) {
			new Notice(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

class NextcloudSettingTab extends PluginSettingTab {
	plugin: NextcloudPlugin;

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.addClass('nextcloud-settings');

		containerEl.createEl('h2', { text: 'Nextcloud Settings' });

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('The URL of your Nextcloud instance (e.g. https://nextcloud.example.com).')
			.addText(text => text
				.setPlaceholder('https://nextcloud.example.com')
				.setValue(this.plugin.settings.serverUrl)
				.onChange(async (value) => {
					this.plugin.settings.serverUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('Your Nextcloud username.')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.setDesc('Your Nextcloud app password (recommended) or account password. Note: credentials are stored unencrypted on disk.')
			.addText(text => {
				text
					.setPlaceholder('password')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});
	}
}
