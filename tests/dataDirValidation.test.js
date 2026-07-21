import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  assertSharedRootReady,
  isDataDirConfigError,
  looksLikeUnsetOrPlaceholderDataDir,
} from '../src/logic/dataDirValidation.js';

describe('dataDirValidation', () => {
  it('detects placeholder DATA_DIR values', () => {
    assert.equal(looksLikeUnsetOrPlaceholderDataDir(''), true);
    assert.equal(
      looksLikeUnsetOrPlaceholderDataDir(
        'C:\\Users\\REPLACE_ME\\OneDrive - District\\RouteChangeTracker'
      ),
      true
    );
    assert.equal(
      looksLikeUnsetOrPlaceholderDataDir(
        'C:\\Users\\rachel\\OneDrive - District\\RouteChangeTracker'
      ),
      false
    );
  });

  it('rejects missing folders with SETUP-ONEDRIVE guidance', async () => {
    await assert.rejects(
      () =>
        assertSharedRootReady(
          path.join(os.tmpdir(), 'teamster-tracker-missing-root-' + Date.now())
        ),
      (error) => {
        assert.ok(isDataDirConfigError(error));
        assert.match(String(error.message), /SETUP-ONEDRIVE/);
        assert.match(String(error.message), /not found/i);
        return true;
      }
    );
  });

  it('accepts an existing directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'teamster-data-'));
    const ready = await assertSharedRootReady(dir, { configured: dir });
    assert.equal(ready, dir);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
