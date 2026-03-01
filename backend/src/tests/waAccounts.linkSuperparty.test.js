// jest + supertest for link-superparty route
const request = require('supertest');
const express = require('express');
const router = require('../routes/waAccounts');

// Mock middleware to bypass auth
jest.mock('../middleware/requireApprovedEmployee', () => ({
  requireApprovedEmployee: (req, res, next) => next(),
}));

// Mock Firestore (use in‑memory stub)
const mockDocs = {};
const mockDb = {
  collection: jest.fn(col => {
    return {
      doc: jest.fn(id => {
        const docId = id || 'auto-id';
        return {
          id: docId,
          get: async () => ({ exists: !!mockDocs[docId], data: () => mockDocs[docId] }),
          set: async data => { mockDocs[docId] = data; },
          update: async data => { Object.assign(mockDocs[docId], data); },
        };
      }),
      where: jest.fn((field, op, value) => {
        const matched = Object.entries(mockDocs).filter(([_, d]) => d[field] === value);
        return {
          get: async () => ({
            docs: matched.map(([id, data]) => ({ id, data: () => data })),
            forEach: fn => matched.forEach(([id, data]) => fn({ id, data: () => data })),
          }),
        };
      }),
    };
  }),
  FieldValue: { serverTimestamp: () => new Date().toISOString() },
};

jest.mock('../firebase', () => ({ db: mockDb, FieldValue: mockDb.FieldValue }));

// Mock sessionManager
jest.mock('../whatsapp/sessionManager', () => ({
  createSession: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/wa-accounts', router);

describe('POST /api/wa-accounts/link-superparty', () => {
  beforeEach(() => {
    // reset mock storage
    for (const k in mockDocs) delete mockDocs[k];
    jest.clearAllMocks();
  });

  test('creates a new Superparty account when none exists', async () => {
    const res = await request(app)
      .post('/api/wa-accounts/link-superparty')
      .send({ label: 'Superparty-test' });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.body.accountId).toBeDefined();
    expect(res.body.message).toBe('session creation started');
    expect(require('../whatsapp/sessionManager').createSession).toHaveBeenCalledWith(res.body.accountId);
  });

  test('returns existing account when forceCreate is false', async () => {
    // first create
    const first = await request(app)
      .post('/api/wa-accounts/link-superparty')
      .send({ label: 'Superparty-existing' });
    // second call should return same id
    const second = await request(app)
      .post('/api/wa-accounts/link-superparty')
      .send({ label: 'Superparty-existing', forceCreate: false });
    expect(second.statusCode).toBe(200);
    expect(second.body.accountId).toBe(first.body.accountId);
    expect(second.body.message).toBe('existing account returned');
  });

  test('forces creation of a new account when forceCreate is true', async () => {
    const first = await request(app)
      .post('/api/wa-accounts/link-superparty')
      .send({ label: 'Superparty-force' });
    const second = await request(app)
      .post('/api/wa-accounts/link-superparty')
      .send({ label: 'Superparty-force', forceCreate: true });
    expect(second.statusCode).toBe(201);
    expect(second.body.accountId).not.toBe(first.body.accountId);
    expect(second.body.message).toBe('session creation started');
  });
});
