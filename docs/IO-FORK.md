# Workspace Keys — iO fork (0.1.4-io-local.2)

This is an unofficial iO Digital fork. It is not an official Noser Engineering
build. Author and license (MIT, Noser Engineering AG) are kept from upstream.
The repository, homepage and bugs links point to
https://github.com/iodigital-com/workspace-keys-vsc.

The publisher (`NoserEngineering`) and the extension name (`workspace-keys`)
stay the same as upstream on purpose. Together they form the extension ID, which
SecretStorage entries and `globalState` are bound to, so keys stored by the
upstream build stay readable. Because the ID is the same, VS Code can replace
this fork with a Marketplace upstream version if auto-update is on. Turn off
auto-update for this extension, or install it from the VSIX and pin it. The fork
does not fall back to, or depend on, any Marketplace upstream version.

## Source provenance

- Base: upstream PR1 commit `ad89b80` ("allow reuse of existing keys"), on top
  of the v0.1.3 release (`696950b`).
- Local changes on that base, not committed: `src/auth/keyRegistry.ts`,
  `src/auth/keyResolver.ts`, `src/commands.ts`, `src/test/keyGuard.test.ts`,
  `src/test/keyRegistry.test.ts`, new `src/test/setKeyCommand.test.ts` and
  `src/test/vscodeMock.ts`, `package.json`, `package-lock.json`, this file.
- No change to SecretStorage names, the extension ID, the stored key values or
  the secret format. No global migration.

## What the fork supports

- Reusing a stored key when the endpoint is set explicitly. A key records the
  normalised base URL it was entered for (`baseUrl` in the index).
  - Workspace-declared providers are offered only keys whose recorded endpoint
    is exactly the current base URL. The endpoint must be approved, and a
    final modal "Copy Key" confirmation is required.
  - User-settings providers also see keys without a recorded endpoint. These
    are labelled "endpoint not recorded" and the copy stays unverified.
- Old keys: entries stored before endpoints were recorded, and adopted entries,
  have no endpoint. Nothing guesses one for them. To make such a key reusable
  for a workspace provider, enter it again in a workspace (the
  "Set or Update API Key" command). From then on it carries provenance.
- Every index write (`record`/`adopt`) sets a new, unique `revision`.
  `storedAt` is kept when an entry is re-recorded, so it cannot tell versions
  apart. The copy compares the revision of the entry the user picked.
- Destination guard (workspace, provider origin, exact base URL, endpoint
  approval for workspace providers) runs:
  - after the key/reuse dialog,
  - after the final consent dialog,
  - before the copy reads the source,
  - inside `store`, after its last await and right before `secrets.store`.

  The source entry is checked before and after the secret is read, and again
  before the write. If any check fails, nothing is stored, and a warning says
  whether the configuration changed or the stored key changed/disappeared.
  The warning contains no key values.

## Known limitations (not solved)

- SecretStorage and `globalState` are separate stores. Neither is
  transactional, and a settings read cannot be combined with a write. The
  checks make the race window smaller, down to the synchronous step right
  before `secrets.store` and the gap between `secrets.store` and the final
  index write. They do not close it.
- Several windows: each VS Code window runs its own extension host. In
  practice `globalState` is shared across windows, but this extension does not
  rely on a cross-window lock, and none exists. If another window overwrites a
  source key between this window's last check and its write, the copy can
  still go through. The pre-write provenance drop plus the revision make this
  very unlikely, but not impossible. Concurrent index writes from two windows
  are last-writer-wins on the whole index object (unchanged from upstream).
- `secrets.store` followed by a failing index write leaves a secret whose index
  entry has no provenance or has a stale revision. The result is safe: it will
  not be offered as verified.
- `plaintextKeys` migration still stores without an endpoint (unverified).

## Verification (this build)

- `npm run check` ran format:check, lint, hygiene, compile and test.
  Result: `tests 223, suites 42, pass 223, fail 0`.
- Mutation check: disabling the revision comparison in `copyFrom` makes 4
  tests fail. These are the same-millisecond re-store tests at resolver and
  command level.
- Command-level tests (`setKeyCommand.test.ts`) register the real
  `workspaceKeys.setWorkspaceKey` handler against a mocked `vscode` module.
  During the final consent they change the base URL, remove the provider,
  change the origin, revoke approval, switch the workspace or re-store/forget
  the source in the same millisecond. They assert that nothing is stored.
- Not done: Electron/native VS Code UI tests for this `.2` build. The native
  trial was run on `.1`, so `.2` still needs a manual regression trial.
