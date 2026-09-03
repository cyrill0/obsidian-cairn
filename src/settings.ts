/**
 * @file settings.ts
 * @description Configuration schema, default values, and the settings tab UI for Obsidian Cairn.
 *
 * This module handles user-configurable plugin settings, specifically the marker keyword
 * used to identify to-do items throughout the vault. It integrates directly into Obsidian's
 * settings window via `PluginSettingTab`.
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type TodoPlugin from './main';

/**
 * Persisted configuration options for Obsidian Cairn.
 */
export interface TodoPluginSettings {
	/**
	 * The case-sensitive word that marks a line as a to-do item (e.g. 'TODO', 'FIXME').
	 * Matches standalone words with an optional trailing colon (e.g., "TODO" or "TODO:").
	 *
	 * @default 'TODO'
	 */
	todoKeyword: string;
}

/**
 * Default configuration values applied when the plugin is first loaded
 * or when a setting is cleared by the user.
 */
export const DEFAULT_SETTINGS: TodoPluginSettings = {
	todoKeyword: 'TODO',
};

/**
 * Settings tab rendered inside Obsidian's Community Plugins settings panel.
 *
 * Provides a UI for users to customize Cairn settings. When settings are modified:
 * 1. The in-memory plugin settings object is updated.
 * 2. Settings are persisted to disk via `plugin.saveSettings()`.
 * 3. A debounced vault rescan is scheduled via `plugin.scheduleRescan()` to update the sidebar.
 */
export class TodoSettingTab extends PluginSettingTab {
	/** Reference to the main plugin instance for accessing state and methods. */
	plugin: TodoPlugin;

	/**
	 * Creates a new Cairn settings tab.
	 *
	 * @param app - The Obsidian App instance.
	 * @param plugin - The Cairn plugin instance.
	 */
	constructor(app: App, plugin: TodoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Renders the settings UI controls into the tab container element.
	 * Called by Obsidian whenever the user navigates to this settings tab.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Marker keyword')
			.setDesc('Word that marks a to-do line. The vault is rescanned and editor highlights update after changes.')
			.addText(text => text
				.setPlaceholder('TODO')
				.setValue(this.plugin.settings.todoKeyword)
				.onChange(async (value) => {
					// Fall back to default keyword if the user clears the input
					this.plugin.settings.todoKeyword = value.trim() || DEFAULT_SETTINGS.todoKeyword;
					await this.plugin.saveSettings();
					// Debounced rescan triggers loadAllTodos() to re-index all vault notes
					this.plugin.scheduleRescan();
					// Trigger an update cycle across active editor views
					this.app.workspace.updateOptions();
				}));
	}
}

