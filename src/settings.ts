import { App, PluginSettingTab, Setting } from 'obsidian';
import type TodoPlugin from './main';

export interface TodoPluginSettings {
	todoKeyword: string;
}

export const DEFAULT_SETTINGS: TodoPluginSettings = {
	todoKeyword: 'TODO',
};

export class TodoSettingTab extends PluginSettingTab {
	plugin: TodoPlugin;

	constructor(app: App, plugin: TodoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Marker keyword')
			.setDesc('Word that marks a to-do line. The vault is rescanned after changes. Editor highlights update on the next edit.')
			.addText(text => text
				.setPlaceholder('TODO')
				.setValue(this.plugin.settings.todoKeyword)
				.onChange(async (value) => {
					this.plugin.settings.todoKeyword = value.trim() || DEFAULT_SETTINGS.todoKeyword;
					await this.plugin.saveSettings();
					this.plugin.scheduleRescan();
				}));
	}
}
