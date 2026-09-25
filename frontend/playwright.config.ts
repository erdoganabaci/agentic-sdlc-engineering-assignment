import { defineConfig, devices } from '@playwright/test';

const API_URL = 'http://localhost:3100';

// Uses dedicated ports and a throwaway SQLite database (backend/e2e.db), so it never touches dev data.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run serve:e2e -w backend', cwd: '..', url: `${API_URL}/health`, timeout: 120_000 },
    {
      command: 'npx vite --port 5174 --strictPort',
      env: { VITE_API_URL: API_URL },
      url: 'http://localhost:5174',
    },
  ],
});
