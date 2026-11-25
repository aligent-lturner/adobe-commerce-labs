const REQUEST_TIMEOUT_MS = 10000;

export class CaptureError extends Error {
  constructor(phase, reason) {
    super(reason);
    this.name = 'CaptureError';
    this.phase = phase;
  }
}

function customerDomain(email) {
  return email.split('@').at(-1).toLowerCase();
}

/** Create a capture and send the event's creation timestamp to its update URL. */
export async function sendWelcomeNotification({ baseUrl, email, created_at }, { http = fetch, logger = console } = {}) {
  let captureId;
  const domain = customerDomain(email);
  let base;
  try {
    base = new URL(baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password) {
      throw new Error('An HTTPS base URL without credentials is required');
    }
    const response = await http(base.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new CaptureError('create_session', 'Capture session request failed');
    const session = await response.json();
    if (typeof session?.capture_id !== 'string' || !session.capture_id || typeof session?.update_url !== 'string') {
      throw new CaptureError('create_session', 'Invalid capture session response');
    }
    captureId = session.capture_id;
    const updateUrl = new URL(session.update_url);
    if (updateUrl.protocol !== 'https:' || updateUrl.origin !== base.origin || updateUrl.username || updateUrl.password) {
      throw new CaptureError('create_session', 'Invalid capture update URL');
    }
    try {
      const update = await http(updateUrl.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, created_at }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!update.ok) throw new CaptureError('update_capture', 'Capture update request failed');
    } catch (error) {
      logger.error({ operation: 'update_capture', capture_id: captureId, email_domain: domain, errorType: error?.name ?? 'Error' });
      throw new CaptureError('update_capture', 'Capture update failed');
    }
    return captureId;
  } catch (error) {
    if (error?.phase === 'update_capture') throw error;
    logger.error({ operation: 'create_session', email_domain: domain, errorType: error?.name ?? 'Error' });
    throw new CaptureError('create_session', 'Capture session failed');
  }
}
