import { useState } from 'react';
import { fetchDemoUsers } from './api/client';
import { useLoad } from './api/use-load';
import { Notice } from './components/notice';
import { ServerActivity } from './components/server-activity';
import { RequestWorkspace } from './features/requests/request-workspace';

const ROLE_LABELS = { MANAGER: 'Relationship manager', REVIEWER: 'Pricing reviewer', SYSTEM: 'System' };

export function App() {
  const { data: allUsers, error } = useLoad(fetchDemoUsers);
  const [actorId, setActorId] = useState('');
  // The SYSTEM identity only reads approved discounts through the API (see README).
  const users = allUsers?.filter((user) => user.role !== 'SYSTEM') ?? [];
  const actor = users.find((user) => user.id === actorId) ?? null;

  return (
    <>
      <header className="app-header">
        <h1>Mortgage pricing exceptions</h1>
        <span className="badge badge-demo">Demo · synthetic data · no real authentication</span>
        <label className="inline-field">
          Acting as
          <select value={actorId} onChange={(event) => setActorId(event.target.value)}>
            <option value="">{allUsers || error ? 'Select a demo user' : 'Loading users…'}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({ROLE_LABELS[user.role]})
              </option>
            ))}
          </select>
        </label>
        {actor && <span className="role-pill">Role: {ROLE_LABELS[actor.role]}</span>}
        <ServerActivity />
      </header>
      <main>
        {error && <Notice tone="error">Could not load demo users: {error.message}</Notice>}
        {actor ? (
          <RequestWorkspace key={actor.id} actor={actor} />
        ) : (
          <p className="muted">Select a demo user to begin.</p>
        )}
      </main>
    </>
  );
}
