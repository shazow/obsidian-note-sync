import {App, Notice, PluginSettingTab, Setting} from "obsidian";
import NoteSyncPlugin from "./main";

export interface NoteSyncSettings {
	githubToken: string;
}

export const DEFAULT_SETTINGS: NoteSyncSettings = {
	githubToken: "",
};

export class NoteSyncSettingTab extends PluginSettingTab {
	plugin: NoteSyncPlugin;

	constructor(app: App, plugin: NoteSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("GitHub")
			.setHeading();

		new Setting(containerEl)
				.setName("GitHub auth token")
				.setDesc("Used to read and write issues. Stored locally in Obsidian.")
				.addText((text) => text
					.setPlaceholder("Enter token")
					.setValue(this.plugin.settings.githubToken)
					.onChange(async (value) => {
						this.plugin.settings.githubToken = value.trim();
						await this.plugin.saveSettings();
					}));

		const ghSetting = new Setting(containerEl)
			.setName("Fetch token from gh")
			.setDesc("Fetch with `gh auth token` when available.");

		ghSetting.addButton((btn) => {
			btn.setButtonText("Checking...");
			btn.setDisabled(true);

			const refreshButtonState = async () => {
				if (this.plugin.settings.githubToken) {
					btn.setDisabled(true);
					btn.setButtonText("Token already set");
					return;
				}

				const available = await this.plugin.isGhAvailable();
				if (!available) {
					btn.setDisabled(true);
					btn.setButtonText("Gh not available");
					return;
				}

				btn.setDisabled(false);
				btn.setCta();
				btn.setButtonText("Fetch from gh");
			};

			btn.onClick(async () => {
				btn.setDisabled(true);
				btn.setButtonText("Fetching...");
				const token = await this.plugin.fetchTokenFromGh();
				if (token) {
					this.plugin.settings.githubToken = token;
					await this.plugin.saveSettings();
					new Notice("Saved token from gh.");
				} else {
					new Notice("Could not fetch token from gh.");
				}
				await refreshButtonState();
			});

			void refreshButtonState();
		});
	}
}
