import { OpenAIClient, AIClient, ModelObject, AnthropicClient } from './ai-client';
import { App, Notice, Plugin, PluginSettingTab, Setting, Editor, debounce, EditorPosition  } from 'obsidian';

interface MyPluginSettings {
	openAiApiKey: string;
	anthropicApiKey: string;
	veniceApiKey: string;
	summarizationModel: string;
	creativeModel: string;
	writingStyleFile: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	openAiApiKey: '',
	anthropicApiKey: '',
	veniceApiKey: '',
	summarizationModel: '',
	creativeModel: '',
	writingStyleFile: ''
}

class Summarizer {
	client: AIClient;
	model: string;

	constructor(client: AIClient, model: string) {
		this.client = client;
		this.model = model;
	}

	async summarize(text: string): Promise<string> {
		const systemPrompt = `# IDENTITY and PURPOSE

You are an expert content summarizer. You take content in and output a Markdown formatted summary using the format below.

Take a deep breath and think step by step about how to best accomplish this goal using the following steps.

# OUTPUT SECTIONS

- Combine all of your understanding of the content into a single, 20-word sentence in a section called ONE SENTENCE SUMMARY:.

- Output the 10 most important points of the content as a list with no more than 15 words per point into a section called MAIN POINTS:.

- Output a list of the 5 best takeaways from the content in a section called TAKEAWAYS:.

# OUTPUT INSTRUCTIONS

- Create the output using the formatting above.
- You only output human readable Markdown.
- Output numbered lists, not bullets.
- Do not output warnings or notes—just the requested sections.
- Do not repeat items in the output sections.
- Do not start items with the same opening words.

# INPUT:`

		const response = await this.client.createChatCompletion(text, this.model, systemPrompt);
		return response;
	}
}

class Creator {
	client: AIClient;
	model: string;
	writingStyle?: string;

	constructor(client: AIClient, model: string, writingStyle?: string) {
		this.client = client;
		this.model = model;
		this.writingStyle = writingStyle;

	}

	async rewordContent(text: string): Promise<string> {
		const systemPrompt = `
			Reword the following text by fixing any grammatical errors and making it more natural and engaging. Be sure to keep the mantra of show don't tell.
			${this.writingStyle ? `Here is an excerpt of my writing style: ${this.writingStyle}` : ''}
			Now reword the following text. Do not include any preamble or explanation, just include the text.
		`;
		const response = await this.client.createChatCompletion(text, this.model, systemPrompt);
		return response;
	}

	async generateParagraph(text: string): Promise<string> {
		const systemPrompt = `Generate a single paragraph based on the text I provide after INPUT:
		If the provided text is part of a story, you must continue the story with only a single paragraph.
			${this.writingStyle ? `Here is an excerpt of my writing style: ${this.writingStyle}` : ''}
		It is vital that you only output one paragraph.
		DO NOT INCLUDE ANY OTHER TEXT OR FORMATTING. JUST THE PARAGRAPH.
		INPUT:`;
		const response = await this.client.createChatCompletion(text, this.model, systemPrompt);
		return response;
	}

	async generateOutline(text: string): Promise<string> {
		const systemPrompt = `Generate an outline for the follow idea. Be sure to follow best practices for outlining a story or narrative. As helpful clarifying question to fill in if they're useful`;
		const response = await this.client.createChatCompletion(text, this.model, systemPrompt);
		return response;
	}
}

// Add these helper functions after the Creator class but before the MyPlugin class

interface LoadingState {
	editor: Editor;
	position: EditorPosition;
	marker: string;
}

class LoadingIndicator {
	private static readonly LOADING_TEXT = '%%Loading...%%';

	static add(editor: Editor): LoadingState {
		const position = editor.getCursor('to');
		editor.replaceRange(this.LOADING_TEXT, position);
		return { editor, position, marker: this.LOADING_TEXT };
	}

	static remove(state: LoadingState): void {
		const currentContent = state.editor.getValue();
		const newContent = currentContent.replace(state.marker, '');
		state.editor.setValue(newContent);
		state.editor.setCursor(state.position);
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	summarizer: Summarizer;
	creator: Creator;
	models: ModelObject[] = [];
	writingStyle?: string;
	veniceClient?: AIClient;
	anthropicClient?: AIClient;

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingsTab(this.app, this));

		if (this.settings.writingStyleFile) {
			// First try to get all files that match the path
			const files = this.app.vault.getFiles().filter(file => 
				file.path === this.settings.writingStyleFile || 
				file.name === this.settings.writingStyleFile ||
				file.basename === this.settings.writingStyleFile
			);
			
			if (files.length > 0) {
				try {
					this.writingStyle = await this.app.vault.read(files[0]);
					console.log("Successfully loaded writing style file");
				} catch (error) {
					console.error("Error reading writing style file:", error);
					new Notice("Failed to load writing style file");
				}
			} else {
				console.error("Writing style file not found:", this.settings.writingStyleFile);
				new Notice("Writing style file not found");
			}
		}	

		// Initialize Venice client
		if (this.settings.veniceApiKey) {
			this.veniceClient = new OpenAIClient(this.settings.veniceApiKey, 'https://api.venice.ai/api/v1');
			const veniceModels = await this.veniceClient.listModels();
			this.models.push(...veniceModels);
		}

		// Initialize Anthropic client
		if (this.settings.anthropicApiKey) {
			this.anthropicClient = new AnthropicClient(this.settings.anthropicApiKey, 'https://api.anthropic.com/v1');
			const anthropicModels = await this.anthropicClient.listModels();
			this.models.push(...anthropicModels);
		}


		this.summarizer = new Summarizer(this.veniceClient!, this.settings.summarizationModel);
		this.creator = new Creator(this.anthropicClient!, this.settings.creativeModel, this.writingStyle);

		this.addCommand({
			id: 'reword-selected-text',
			name: 'Reword Selected Text',
			editorCallback: async (editor: Editor) => {
				const selectedText = editor.getSelection();
				if (!selectedText) {
					new Notice('No text selected');
					return;
				}
				const response = await this.creator.rewordContent(selectedText );
				if (response) {
					const cursorPos = editor.getCursor('to');	
					editor.replaceRange(
						`\n\n########################\nReworded:\n${response}\n########################\n`,
						cursorPos
					);
				}
			}
		});

		this.addCommand({
			id: 'summarize-selected-text',
			name: 'Summarize Selected Text',
			editorCallback: async (editor: Editor) => {
				if (!this.summarizer) {
					new Notice('No Venice API key set');
					return;
				}

				const selectedText = editor.getSelection();
				if (!selectedText) {
					new Notice('No text selected');
					return;
				}

				const loadingState = LoadingIndicator.add(editor);	
				try {
					const response = await this.summarizer.summarize(selectedText);
					if (response) {
						LoadingIndicator.remove(loadingState);
						// Get the current cursor position
						const cursorPos = editor.getCursor('to');
						
						// Insert the summary with delimiter markers
						editor.replaceRange(
							`\n\n#########################\nSummary:\n${response}\n#########################\n`,
							cursorPos
						);
					}
				} catch (error) {
					console.error(error);
					new Notice('Error generating summary: ' + error.message);
				} finally {
					LoadingIndicator.remove(loadingState);
				}
			}
		});

		this.addCommand({
			id: 'generate-paragraph',
			name: 'Generate Paragraph',
			editorCallback: async (editor: Editor) => {
				const selectedText = editor.getSelection() || editor.getValue();
				if (!selectedText) {
					new Notice('No text selected');
					return;
				}
				
				const loadingState = LoadingIndicator.add(editor);
				
				try {
					const response = await this.creator.generateParagraph(selectedText);
					if (response) {
						LoadingIndicator.remove(loadingState);
						editor.replaceRange(response, loadingState.position);
					}
				} catch (error) {
					LoadingIndicator.remove(loadingState);
					new Notice('Error generating paragraph: ' + error.message);
				}
			}
		});

		this.addCommand({
			id: 'generate-outline',
			name: 'Generate Outline',
			editorCallback: async (editor: Editor) => {
				const selectedText = editor.getValue();
				if (!selectedText) {
					new Notice('No text selected');
					return;
				}
				const cursorPos = editor.getCursor('to');
				editor.replaceRange('Loading...\n', cursorPos);
				const response = await this.creator.generateOutline(selectedText);
				if (response) {
					editor.replaceRange(response, cursorPos);
				}
			}
		});	
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class SettingsTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Enter your OpenAI API key for GPT models')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openAiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openAiApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Anthropic API Key')
			.setDesc('Enter your Anthropic API key for Claude models')
			.addText(text => text
				.setPlaceholder('sk-ant-...')
				.setValue(this.plugin.settings.anthropicApiKey)
				.onChange(async (value) => {
					this.plugin.settings.anthropicApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Venice API Key')
			.setDesc('Enter your Venice API key')
			.addText(text => text
				.setPlaceholder('venice-...')
				.setValue(this.plugin.settings.veniceApiKey)
				.onChange(async (value) => {
					this.plugin.settings.veniceApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Summarization Model')
			.setDesc('Select the model to use for summarization')
			.addDropdown(dropdown => {
				dropdown.addOptions(this.plugin.models?.reduce((acc: Record<string, string>, model) => {
					acc[model.id] = model.id;
					return acc;
				}, {}) || {});
				dropdown.setValue(this.plugin.settings.summarizationModel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.summarizationModel = value;
					await this.plugin.saveSettings();
				});
			});
			
		new Setting(containerEl)
			.setName('Creative Model')
			.setDesc('Select the model to use for creative writing')
			.addDropdown(dropdown => {
				dropdown.addOptions(this.plugin.models?.reduce((acc: Record<string, string>, model) => {
					acc[model.id] = model.id;
					return acc;
				}, {}) || {});
				dropdown.setValue(this.plugin.settings.creativeModel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.creativeModel = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Writing Style File')
			.setDesc('Enter the path to a file containing your writing style')
			.addText(text => text
				.setValue(this.plugin.settings.writingStyleFile)
				.onChange(debounce(async (value: string) => {
					const files = this.plugin.app.vault.getFiles().filter(file => 
						file.path === value || 
						file.name === value
					);
					
					if (files.length === 0 && value !== '') {
						new Notice("Warning: File not found");
					}
					
					this.plugin.settings.writingStyleFile = value;
					await this.plugin.saveSettings();
				}, 500)));
	}
}
