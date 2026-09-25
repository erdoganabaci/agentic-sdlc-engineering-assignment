import { useCallback, useState } from 'react';
import type { Api } from '../../api/client';
import { useLoad } from '../../api/use-load';
import { Notice } from '../../components/notice';
import { RequestForm } from './request-form';
import { useIdempotentSubmit } from './use-idempotent-submit';

interface CreateRequestPanelProps {
  api: Api;
  onCreated: (requestId: string) => void;
}

export function CreateRequestPanel({ api, onCreated }: CreateRequestPanelProps) {
  const loadApplications = useCallback(() => api.applications(), [api]);
  const { data: applications, error, isLoading } = useLoad(loadApplications);
  const [applicationId, setApplicationId] = useState('');
  const submitIdempotently = useIdempotentSubmit();

  if (isLoading) return <p className="muted">Loading applications…</p>;
  if (error) return <Notice tone="error">{error.message}</Notice>;
  const available = (applications ?? []).filter((application) => !application.requestId);
  if (available.length === 0) return <Notice tone="info">All your applications already have a pricing request.</Notice>;
  const selected = available.find((application) => application.id === applicationId) ?? available[0];

  return (
    <section className="panel" aria-labelledby="create-heading">
      <h2 id="create-heading">New pricing request</h2>
      <RequestForm
        key={selected.id}
        standardRateBps={selected.standardRateBps}
        submitLabel="Submit for review"
        onSubmit={async (content) => {
          const payload = { applicationId: selected.id, ...content };
          const { requestId } = await submitIdempotently(payload, (key) => api.createRequest(payload, key));
          onCreated(requestId);
        }}
      >
        <label className="field">
          Application
          <select value={selected.id} onChange={(event) => setApplicationId(event.target.value)}>
            {available.map((application) => (
              <option key={application.id} value={application.id}>
                {application.id} · {application.customerLabel}
              </option>
            ))}
          </select>
        </label>
      </RequestForm>
    </section>
  );
}
