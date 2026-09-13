import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
test('Capacitor xcode UUID generation remains compatible with patched uuid', () => {
  const xcode = require('xcode');
  const project = xcode.project('test.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
