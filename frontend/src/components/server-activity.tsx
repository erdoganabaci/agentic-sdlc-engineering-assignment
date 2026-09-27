import { useIsServerBusy } from '../api/pending-requests';

/** Single app-wide loading indicator for every server call (always mounted so screen readers announce it). */
export function ServerActivity() {
  const isBusy = useIsServerBusy();
  return (
    <span className="server-activity" role="status" aria-live="polite">
      {isBusy ? 'Loading…' : null}
    </span>
  );
}
