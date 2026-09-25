import type { RequestStatus, RequestSummary } from '../../api/types';
import { Notice } from '../../components/notice';
import { StatusBadge } from '../../components/status-badge';
import { formatDateTime, formatRate } from './rates';

interface RequestListProps {
  requests: RequestSummary[] | null;
  isLoading: boolean;
  error: Error | null;
  status: RequestStatus | '';
  onStatusChange: (status: RequestStatus | '') => void;
  selectedId: string | null;
  onSelect: (requestId: string) => void;
}

export function RequestList({
  requests,
  isLoading,
  error,
  status,
  onStatusChange,
  selectedId,
  onSelect,
}: RequestListProps) {
  return (
    <section className="panel" aria-labelledby="list-heading">
      <div className="row">
        <h2 id="list-heading">Pricing requests</h2>
        <label className="inline-field">
          Status
          <select value={status} onChange={(event) => onStatusChange(event.target.value as RequestStatus | '')}>
            <option value="">All</option>
            <option value="PENDING">Pending review</option>
            <option value="APPROVED">Approved</option>
            <option value="DECLINED">Declined</option>
          </select>
        </label>
      </div>
      {error && <Notice tone="error">{error.message}</Notice>}
      {isLoading && !requests && <p className="muted">Loading requests…</p>}
      {requests?.length === 0 && <p className="muted">No requests match.</p>}
      {requests && requests.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Application</th>
                <th scope="col">Discount</th>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} className={request.id === selectedId ? 'is-selected' : undefined}>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      aria-current={request.id === selectedId}
                      onClick={() => onSelect(request.id)}
                    >
                      {request.applicationId}
                    </button>
                  </td>
                  <td>
                    {request.discountBps} bps ({formatRate(request.discountBps)})
                  </td>
                  <td>v{request.currentVersionNumber}</td>
                  <td>
                    <StatusBadge status={request.status} />
                  </td>
                  <td>{formatDateTime(request.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
