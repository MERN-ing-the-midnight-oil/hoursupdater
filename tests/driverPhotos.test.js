import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { driverPhotoPaths, driverPhotoSrc } from '../office-tracker/web/driverPhotos.js';

const photoDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'office-tracker',
  'web',
  'driver-photos'
);

describe('driver photos on the PIN screen', () => {
  it('finds a portrait by the driver name', () => {
    assert.equal(driverPhotoSrc('Rhys Smoker'), 'driver-photos/rhys-smoker.jpg');
    assert.equal(driverPhotoSrc('  JOHANNA   deVries '), 'driver-photos/johanna-devries.jpg');
    assert.equal(driverPhotoSrc('Rae Anne Thon'), 'driver-photos/rae-anne-thon.jpg');
  });

  it('stays blank when the directory has no portrait', () => {
    assert.equal(driverPhotoSrc('Maxwell Read'), '');
    assert.equal(driverPhotoSrc('Ada Nobody'), '');
    assert.equal(driverPhotoSrc(''), '');
  });

  it('points every listed photo at a file on disk', () => {
    const listed = driverPhotoPaths();
    const onDisk = fs.readdirSync(photoDir).filter((name) => !name.startsWith('.'));
    assert.equal(listed.length, onDisk.length);
    for (const src of listed) {
      assert.equal(fs.existsSync(path.join(photoDir, path.basename(src))), true, src);
    }
  });
});
