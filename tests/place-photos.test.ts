import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm, stat, access, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  preparePlacePhoto,
  placePhotoStorage,
  maxPlacePhotoBytes
} from '../src/lib/server/place-photo-files';
import { photoRows } from '../src/lib/photo-layout';

test('phone photos are oriented correctly, resized, and saved without EXIF metadata', async () => {
  const input = await sharp({
    create: { width: 3200, height: 1600, channels: 3, background: '#567b94' }
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const photo = await preparePlacePhoto(input);
  assert.equal(photo.width, 1200);
  assert.equal(photo.height, 2400);
  for (const [buffer, width, height] of [
    [photo.full, 1200, 2400],
    [photo.thumbnail, 480, 960]
  ] as const) {
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
  }
});

test('invalid, oversized and unsupported photo uploads are rejected', async () => {
  for (const input of [
    Buffer.alloc(0),
    Buffer.alloc(maxPlacePhotoBytes + 1),
    Buffer.from('not a photo'),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'
    )
  ]) {
    await assert.rejects(preparePlacePhoto(input));
  }
  const jpeg = await sharp({
    create: { width: 80, height: 40, channels: 3, background: '#345678' }
  })
    .jpeg()
    .toBuffer();
  await assert.rejects(preparePlacePhoto(jpeg.subarray(0, Math.floor(jpeg.length / 2))));
});

test('photo files stay private and a failed thumbnail write cleans up the full image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'housik-photo-'));
  try {
    const files = placePhotoStorage(directory);
    files.check();
    const input = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#345678' }
    })
      .png()
      .toBuffer();
    const photo = await preparePlacePhoto(input);
    const id = randomUUID();
    await files.put(id, photo);
    assert.deepEqual(await files.read(id), photo.full);
    assert.deepEqual(await files.read(id, true), photo.thumbnail);
    assert.equal((await stat(join(directory, 'full', id))).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, 'thumbnails'))).mode & 0o777, 0o700);
    await assert.rejects(files.put(id, photo));
    assert.deepEqual(await files.read(id), photo.full);
    await files.remove(id);
    await assert.rejects(access(join(directory, 'full', id)));
    await assert.rejects(access(join(directory, 'thumbnails', id)));
    const failedId = randomUUID();
    const occupied = join(directory, 'thumbnails', failedId);
    await writeFile(occupied, 'existing');
    await assert.rejects(files.put(failedId, photo));
    await assert.rejects(access(join(directory, 'full', failedId)));
    assert.equal(await readFile(occupied, 'utf8'), 'existing');
    await assert.rejects(files.read('../outside'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('photo rows preserve ratios and order while filling the available width', () => {
  const photos = [1.5, 0.67, 2, 1, 0.75, 1.78, 3, 0.5, 1.33, 1].map((ratio, index) => ({
    id: `${index}`,
    width: ratio * 1200,
    height: 1200
  }));
  for (const width of [280, 350, 768, 1124, 1600]) {
    const rows = photoRows(photos, width);
    assert.deepEqual(
      rows.flatMap((row) => row.photos.map((photo) => photo.id)),
      photos.map((photo) => photo.id)
    );
    for (const [index, row] of rows.entries()) {
      assert(row.height > 0 && Number.isFinite(row.height));
      assert(row.width <= width + 0.001);
      const renderedWidth =
        row.photos.reduce((sum, photo) => sum + (row.height * photo.width) / photo.height, 0) +
        (row.photos.length - 1) * 10;
      assert(Math.abs(renderedWidth - row.width) < 0.001);
      if (index < rows.length - 1) assert(Math.abs(row.width - width) < 0.001);
    }
    const portrait = photoRows([{ id: 'one', width: 600, height: 1800 }], width)[0];
    assert(portrait.height <= 300);
  }
  assert.deepEqual(photoRows([], 350), []);
  assert.deepEqual(photoRows(photos, 0), []);
  const mixed = [1.5, 2 / 3, 1, 3, 0.625].map((ratio, index) => ({
    id: `${index}`,
    width: ratio * 1200,
    height: 1200
  }));
  assert(Math.abs(photoRows(mixed, 350).at(-1)!.width - 350) < 0.001);
});
