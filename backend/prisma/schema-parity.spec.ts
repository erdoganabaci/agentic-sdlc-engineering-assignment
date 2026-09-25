import { readFileSync } from 'node:fs';

const modelsOnly = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/^\/\/.*$/m, '')
    .replace(/provider = "\w+"/, '');

it('keeps SQLite and Postgres schemas identical apart from the provider', () => {
  expect(modelsOnly('prisma/sqlite/schema.prisma')).toBe(modelsOnly('prisma/postgres/schema.prisma'));
});
