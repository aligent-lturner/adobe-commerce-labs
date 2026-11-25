import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWelcomeNotification, CaptureError } from '../webhook-capture-client.js';

const baseUrl = 'https://aisenseapi.com/services/v1/webhook_capture';
const details = { baseUrl, email: 'person@example.com', created_at: '2026-01-01 12:00:00' };
const calls = [];
const errors = [];
const logger = { error: (entry) => errors.push(entry) };
test.beforeEach(() => { calls.length = 0; errors.length = 0; });

test('creates a capture with empty body, updates with event timestamp, and returns ID', async () => {
  const http = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? { ok: true, json: async () => ({ capture_id: '123', update_url: 'https://aisenseapi.com/services/v1/webhook_capture/123' }) } : { ok: true };
  };
  assert.equal(await sendWelcomeNotification(details, { http, logger }), '123');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, baseUrl);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, '');
  assert.equal(calls[1].url, `${baseUrl}/123`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: details.email, created_at: details.created_at });
});

test('failed session creation logs and stops without retrying', async () => {
  const http = async () => { calls.push(1); return { ok: false, status: 503 }; };
  await assert.rejects(sendWelcomeNotification(details, { http, logger }), CaptureError);
  assert.equal(calls.length, 1);
  assert.equal(errors[0].operation, 'create_session');
  assert.equal(errors[0].email_domain, 'example.com');
  assert.ok(!JSON.stringify(errors).includes(details.email));
});

test('failed update logs capture ID and stops without retrying', async () => {
  const http = async () => {
    calls.push(1);
    return calls.length === 1 ? { ok: true, json: async () => ({ capture_id: '123', update_url: `${baseUrl}/123` }) } : { ok: false, status: 503 };
  };
  await assert.rejects(sendWelcomeNotification(details, { http, logger }), { phase: 'update_capture' });
  assert.equal(calls.length, 2);
  assert.equal(errors[0].capture_id, '123');
  assert.equal(errors[0].operation, 'update_capture');
});

test('rejects a capture response that redirects notification to another host', async () => {
  const http = async () => {
    calls.push(1);
    return { ok: true, json: async () => ({ capture_id: '123', update_url: 'https://evil.example/capture' }) };
  };
  await assert.rejects(sendWelcomeNotification(details, { http, logger }), { phase: 'create_session' });
  assert.equal(calls.length, 1);
});
