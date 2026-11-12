/**
 * A minimal stand-in for the `vscode` module, so command handlers can be
 * driven under plain `node --test`. Import this before anything that imports
 * `vscode`. Dialogs are answered by the `ui` hooks a test installs.
 */
import Module from 'node:module';

type Handler = (...args: unknown[]) => unknown;

export interface FakeInputBox {
	value: string;
	accept(value: string): void;
	trigger(button: unknown): void;
	buttons: unknown[];
}

export const ui = {
	commands: new Map<string, Handler>(),
	/** Called when an input box is shown; the test drives it. */
	onInputBox: (_box: FakeInputBox): void => undefined,
	showQuickPick: async (items: unknown[]): Promise<unknown> => items[0],
	showWarningMessage: async (_message: string, ..._rest: unknown[]): Promise<string | undefined> => undefined,
	warnings: [] as string[],
	infos: [] as string[],
	reset(): void {
		this.warnings = [];
		this.infos = [];
		this.onInputBox = () => undefined;
		this.showQuickPick = async (items) => items[0];
		this.showWarningMessage = async () => undefined;
	},
};

function inputBox(): unknown {
	const listeners: Record<string, Handler[]> = {};
	const on = (event: string) => (fn: Handler) => {
		(listeners[event] ??= []).push(fn);
		return { dispose: () => undefined };
	};
	const emit = (event: string, ...args: unknown[]) => listeners[event]?.forEach((fn) => void fn(...args));
	const box = {
		value: '',
		buttons: [] as unknown[],
		onDidChangeValue: on('value'),
		onDidAccept: on('accept'),
		onDidTriggerButton: on('button'),
		onDidHide: on('hide'),
		dispose: () => undefined,
		show: () => {
			setImmediate(() =>
				ui.onInputBox({
					get value() {
						return box.value;
					},
					set value(v: string) {
						box.value = v;
					},
					buttons: box.buttons,
					accept: (v: string) => {
						box.value = v;
						emit('accept');
					},
					trigger: (button: unknown) => emit('button', button),
				}),
			);
		},
	};
	return box;
}

const noop = () => undefined;
const channel = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, show: noop, dispose: noop };

const vscode = {
	commands: {
		registerCommand: (id: string, fn: Handler) => {
			ui.commands.set(id, fn);
			return { dispose: () => ui.commands.delete(id) };
		},
		executeCommand: async () => undefined,
	},
	window: {
		createInputBox: inputBox,
		createOutputChannel: () => channel,
		showQuickPick: (items: unknown[]) => ui.showQuickPick(items),
		showWarningMessage: async (message: string, ...rest: unknown[]) => {
			ui.warnings.push(message);
			return ui.showWarningMessage(message, ...rest);
		},
		showInformationMessage: async (message: string) => {
			ui.infos.push(message);
			return undefined;
		},
		showErrorMessage: async () => undefined,
		showInputBox: async () => undefined,
	},
	workspace: {},
	ThemeIcon: class {
		constructor(readonly id: string) {}
	},
	EventEmitter: class {
		event = () => ({ dispose: noop });
		fire = noop;
		dispose = noop;
	},
	ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
	ProgressLocation: { Notification: 15 },
	QuickPickItemKind: { Separator: -1, Default: 0 },
};

const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const original = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
	return request === 'vscode' ? vscode : original.call(this, request, ...rest);
};
