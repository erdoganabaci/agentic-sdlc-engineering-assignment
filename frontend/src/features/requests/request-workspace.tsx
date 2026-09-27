import { useCallback, useMemo, useState } from 'react';
import { apiFor } from '../../api/client';
import type { RequestStatus, User } from '../../api/types';
import { useLoad } from '../../api/use-load';
import { CreateRequestPanel } from './create-request-panel';
import { RequestDetailPanel } from './request-detail-panel';
import { RequestList } from './request-list';

type Panel = { mode: 'create' } | { mode: 'detail'; requestId: string } | null;

/** Mounted per actor (keyed by user id), so switching users discards all actor-specific state. */
export function RequestWorkspace({ actor }: { actor: User }) {
  const api = useMemo(() => apiFor(actor.id), [actor.id]);
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [panel, setPanel] = useState<Panel>(null);
  const loadRequests = useCallback(() => api.listRequests(status || undefined), [api, status]);
  const requests = useLoad(loadRequests);
  const selectedId = panel?.mode === 'detail' ? panel.requestId : null;

  return (
    <div className="workspace">
      <div className="stack">
        {actor.role === 'MANAGER' && (
          <div>
            <button type="button" className="button-primary" onClick={() => setPanel({ mode: 'create' })}>
              New request
            </button>
          </div>
        )}
        <RequestList
          requests={requests.data?.items ?? null}
          error={requests.error}
          status={status}
          onStatusChange={setStatus}
          selectedId={selectedId}
          onSelect={(requestId) => setPanel({ mode: 'detail', requestId })}
        />
      </div>
      <div>
        {panel?.mode === 'create' && (
          <CreateRequestPanel
            api={api}
            onCreated={(requestId) => {
              requests.reload();
              setPanel({ mode: 'detail', requestId });
            }}
          />
        )}
        {panel?.mode === 'detail' && (
          <RequestDetailPanel
            key={panel.requestId}
            api={api}
            actor={actor}
            requestId={panel.requestId}
            onChanged={requests.reload}
          />
        )}
        {!panel && <p className="muted">Select a request to see its details and history.</p>}
      </div>
    </div>
  );
}
