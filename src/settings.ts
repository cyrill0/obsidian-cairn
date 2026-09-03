import { App, PluginSettingTab } from 'obsidian';
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
	}

	getSettingDefinitions() {
		return [];
	}
}
