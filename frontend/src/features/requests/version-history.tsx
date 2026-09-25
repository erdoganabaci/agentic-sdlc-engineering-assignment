import type { RequestVersion } from '../../api/types';
import { StatusBadge } from '../../components/status-badge';
import { formatDateTime } from './rates';

function versionStatus(version: RequestVersion) {
  if (!version.isCurrent && !version.decision) return 'SUPERSEDED';
  return version.decision?.outcome ?? 'PENDING';
}

export function VersionHistory({ versions }: { versions: RequestVersion[] }) {
  return (
    <div className="table-scroll">
      <table>
        <caption>History: every submitted version and decision</caption>
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Discount</th>
            <th scope="col">Reason</th>
            <th scope="col">Submitted</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {[...versions].reverse().map((version) => (
            <tr key={version.id}>
              <td>
                v{version.versionNumber} {version.isCurrent ? '(current)' : <StatusBadge status="SUPERSEDED" />}
              </td>
              <td>{version.discountBps} bps</td>
              <td className="wrap">{version.reason}</td>
              <td>
                {version.createdBy.name}
                <br />
                <span className="muted">{formatDateTime(version.createdAt)}</span>
              </td>
              <td className="wrap">
                <StatusBadge status={versionStatus(version)} />
                {version.decision && (
                  <>
                    <br />
                    {version.decision.reviewer.name} ·{' '}
                    <span className="muted">{formatDateTime(version.decision.decidedAt)}</span>
                    {version.decision.comment && <p className="muted">“{version.decision.comment}”</p>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
