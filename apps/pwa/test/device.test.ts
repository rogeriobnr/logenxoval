import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDeviceId } from '../src/lib/device';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('generateDeviceId: gera UUID v4 válido', () => {
  assert.match(generateDeviceId(), UUID_RE);
});

test('generateDeviceId: duas chamadas não colidem', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateDeviceId()));
  assert.equal(ids.size, 100);
});