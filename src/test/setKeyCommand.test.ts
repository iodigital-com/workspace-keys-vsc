import './vscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ui, type FakeInputBox } from './vscodeMock';
import { KeyRegistry, type RegistryStore } from '../auth/keyRegistry';
import { KeyResolver } from '../auth/keyResolver';
import { registerCommands, type CommandDeps } from '../commands';
import type { ProviderConfig } from '../types';

/**
 * Drives the registered `workspaceKeys.setWorkspaceKey` command through mocked
 * dialogs and changes the destination while the final consent is open.
 * Fake values only; no real keys.
 */

class FakeStore implements RegistryStore {
	private values = new Map<string, unknown>();
	get<T>(key: string, defaultValue: T): T {
		return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
	}
	async update(key: string, value: unknown): Promise<void> {
		this.values.set(key, structuredClone(value));
	}
}

class FakeSecrets {
	readonly entries = new Map<string, string>();
	async get(key: string): Promise<string | undefined> {
		return this.entries.get(key);
	}
	async store(key: string, value: string): Promise<void> {
		this.entries.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.entries.delete(key);
	}
	readonly onDidChange = () => ({ dispose: () => undefined });
}

const URL_A = 'https://api.example.com/v1';
const URL_B = 'https://evil.example.net/v1';
const HERE = 'file:///c%3A/ws/kunde-a/portal';
const OTHER = 'file:///c%3A/ws/kunde-b/shop';
const FIXED_NOW = 1_700_000_000_000;

let secrets: FakeSecrets;
let registry: KeyRegistry;
let keys: KeyResolver;
let providers: ProviderConfig[];
let origin: 'user' | 'workspace';
let workspaceKey: string;
let approved: Set<string>;
let deps: CommandDeps;

function setup(): void {
	ui.reset();
	secrets = new FakeSecrets();
	// Frozen clock: every write lands in the same millisecond, so storedAt alone cannot tell versions apart.
	registry = new KeyRegistry(new FakeStore(), () => FIXED_NOW);
	keys = new KeyResolver(secrets as never, registry, {}, async () => undefined);
	providers = [{ id: 'openai', baseUrl: URL_A }];
	origin = 'workspace';
	workspaceKey = HERE;
	approved = new Set([URL_A]);
	deps = {
		config: {
			currentScope: () => ({ folder: undefined, workspaceKey, identityUri: undefined }),
			readProviders: () => ({ providers: providers.map((p) => ({ ...p })), origin, problems: [], plaintextInWorkspace: [] }),
			allowInsecureLoopback: () => false,
		},
		consent: { isApproved: (url: string, o: string) => o === 'user' || approved.has(url), approve: async () => undefined },
		provider: { refresh: () => undefined },
		keys,
	} as unknown as CommandDeps;
	ui.commands.clear();
	registerCommands(deps);
}

const run = () => ui.commands.get('workspaceKeys.setWorkspaceKey')!() as Promise<void>;
const own = () => keys.secretNameFor('openai', HERE);

/** Opens the reuse list from the key input box and picks the first entry. */
function pickReuse(): void {
	ui.onInputBox = (box: FakeInputBox) => box.trigger(box.buttons[0]);
}

/** Answers the final "Copy Key" consent after running `during`. */
function onFinalConsent(during: () => Promise<void> | void): void {
	ui.showWarningMessage = async (message) => {
		if (message.startsWith('Copy the key')) {
			await during();
			return 'Copy Key';
		}
		return undefined;
	};
}

describe('setWorkspaceKey command: reuse with final consent', () => {
	beforeEach(async () => {
		setup();
		await keys.store('openai', OTHER, 'sk-fake-source', undefined, URL_A);
	});

	test('baseline: copies after consent when nothing changed', async () => {
		pickReuse();
		onFinalConsent(() => undefined);
		await run();
		assert.equal(secrets.entries.get(own()), 'sk-fake-source');
		assert.equal(registry.get(own())?.baseUrl, URL_A);
	});

	test('base URL changed during final consent: nothing copied', async () => {
		pickReuse();
		onFinalConsent(() => {
			providers = [{ id: 'openai', baseUrl: URL_B }];
		});
		await run();
		assert.equal(secrets.entries.has(own()), false);
		assert.ok(ui.warnings.some((w) => w.includes('configuration changed')));
	});

	test('provider removed during final consent: nothing copied', async () => {
		pickReuse();
		onFinalConsent(() => {
			providers = [];
		});
		await run();
		assert.equal(secrets.entries.has(own()), false);
	});

	test('origin changed during final consent: nothing copied', async () => {
		pickReuse();
		onFinalConsent(() => {
			origin = 'user';
		});
		await run();
		assert.equal(secrets.entries.has(own()), false);
	});

	test('approval revoked during final consent: nothing copied', async () => {
		pickReuse();
		onFinalConsent(() => {
			approved.clear();
		});
		await run();
		assert.equal(secrets.entries.has(own()), false);
	});

	test('workspace switched during final consent: nothing copied anywhere', async () => {
		pickReuse();
		onFinalConsent(() => {
			workspaceKey = 'file:///c%3A/ws/kunde-c/app';
		});
		await run();
		assert.equal(secrets.entries.has(own()), false);
		assert.equal(secrets.entries.has(keys.secretNameFor('openai', 'file:///c%3A/ws/kunde-c/app')), false);
		assert.equal(secrets.entries.size, 1);
	});

	test('source re-stored in the same millisecond, same endpoint: offered copy is invalidated', async () => {
		const before = registry.get(keys.secretNameFor('openai', OTHER))!;
		pickReuse();
		onFinalConsent(async () => {
			await keys.store('openai', OTHER, 'sk-fake-replaced', undefined, URL_A);
			const after = registry.get(keys.secretNameFor('openai', OTHER))!;
			assert.equal(after.storedAt, before.storedAt, 'storedAt is the same, so it cannot be the revision');
			assert.notEqual(after.revision, before.revision);
		});
		await run();
		assert.equal(secrets.entries.has(own()), false, 'neither the old nor the replaced value is copied');
		assert.ok(ui.warnings.some((w) => w.includes('stored key changed')));
	});

	test('source forgotten during final consent: nothing copied', async () => {
		pickReuse();
		onFinalConsent(() => keys.forget([keys.secretNameFor('openai', OTHER)]));
		await run();
		assert.equal(secrets.entries.has(own()), false);
	});

	test('declined final consent: nothing copied', async () => {
		pickReuse();
		ui.showWarningMessage = async () => undefined;
		await run();
		assert.equal(secrets.entries.has(own()), false);
	});

	test('destination changes while the source secret is being read: nothing written', async () => {
		pickReuse();
		onFinalConsent(() => undefined);
		const original = secrets.get.bind(secrets);
		secrets.get = async (key: string) => {
			providers = [{ id: 'openai', baseUrl: URL_B }];
			return original(key);
		};
		await run();
		assert.equal(secrets.entries.has(own()), false);
		assert.ok(ui.warnings.some((w) => w.includes('configuration changed')));
	});
});

describe('setWorkspaceKey command: new key', () => {
	beforeEach(setup);

	test('stores with provenance when nothing changed', async () => {
		ui.onInputBox = (box) => box.accept('sk-fake-new');
		await run();
		assert.equal(secrets.entries.get(own()), 'sk-fake-new');
		assert.equal(registry.get(own())?.baseUrl, URL_A);
	});

	test('base URL changed before the write: nothing stored', async () => {
		ui.onInputBox = (box) => {
			providers = [{ id: 'openai', baseUrl: URL_B }];
			box.accept('sk-fake-new');
		};
		await run();
		assert.equal(secrets.entries.has(own()), false);
	});

	test('a workspace provider with an unrecorded-endpoint key elsewhere is offered no reuse', async () => {
		await keys.store('openai', OTHER, 'sk-fake-legacy', undefined);
		let buttons = -1;
		ui.onInputBox = (box) => {
			buttons = box.buttons.length;
			box.accept('sk-fake-new');
		};
		await run();
		assert.equal(buttons, 0);
	});
});
