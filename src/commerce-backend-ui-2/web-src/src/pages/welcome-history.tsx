import { useEffect, useState } from 'react';
import { useHostConnection, useMassActionContext, useIms } from '@adobe/aio-commerce-lib-admin-ui/web';
import { useConfig } from '#web/hooks/use-config.ts';

type Attempt = { attempt_id: string; status: string; capture_id?: string; error_category?: string; event_time: string; completed_at?: string };

type History = { attempts: Attempt[] };

export function WelcomeHistoryPage() {
  const { data: selection, error: selectionError } = useMassActionContext();
  const { data: ims, error: imsError } = useIms();
  const { actions, error: hostError } = useHostConnection();
  const { getActionUrl } = useConfig();
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState('');
  const customerId = selection?.selectedIds?.length === 1 ? selection.selectedIds[0] : undefined;

  useEffect(() => {
    if (!customerId || !/^[1-9][0-9]{0,18}$/.test(customerId) || !ims?.imsToken || !ims.imsOrgId) return;
    const url = getActionUrl('customer-welcome/get-welcome-history');
    if (!url) { setError('History action is not configured.'); return; }
    const abort = new AbortController();
    setAttempts(null);
    setError('');
    fetch(`${url}?customer_id=${encodeURIComponent(customerId)}`, {
      headers: { authorization: `Bearer ${ims.imsToken}`, 'x-gw-ims-org-id': ims.imsOrgId },
      signal: abort.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('History request failed');
      const result: History = await response.json();
      if (!Array.isArray(result.attempts)) throw new Error('Invalid history response');
      setAttempts(result.attempts);
    }).catch((cause: unknown) => { if (!abort.signal.aborted) setError('Could not load welcome delivery history.'); });
    return () => abort.abort();
  }, [customerId, ims?.imsToken, ims?.imsOrgId, getActionUrl]);

  const invalid = selectionError || imsError || hostError || !customerId || !/^[1-9][0-9]{0,18}$/.test(customerId);
  return (
    <main style={{ padding: '1rem' }}>
      <h1>Welcome delivery history</h1>
      <button type="button" onClick={() => { if (actions) void actions.close(); }}>Close</button>
      {invalid ? <p role="alert">Select exactly one valid customer to view history.</p> : error ? <p role="alert">{error}</p> : attempts === null ? <p>Loading history…</p> : attempts.length === 0 ? <p>No attempts yet.</p> : (
        <ul>{[...attempts].sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time)).map((item) => (
          <li key={item.attempt_id}>
            <strong>{item.status}</strong> — {new Date(item.event_time).toLocaleString()}
            {item.capture_id ? <span> — Capture {item.capture_id}</span> : null}
            {item.error_category ? <span> — {item.error_category}</span> : null}
            {item.completed_at ? <span> — Completed {new Date(item.completed_at).toLocaleString()}</span> : null}
          </li>
        ))}</ul>
      )}
    </main>
  );
}
