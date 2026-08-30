// Runs against a real Postgres database — set PGDATABASE to a disposable
// test database before running (see backend/test/README.md). This suite
// exercises the same behaviors that were manually verified during
// development: auth, row-locked assignment, idempotent status replay, and
// the illegal-transition guard.

const request = require('supertest');
const { pool } = require('../src/db');

let app;

beforeAll(() => {
  ({ app } = require('../src/server'));
});

afterAll(async () => {
  await pool.end();
});

function unique(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

describe('health check', () => {
  it('responds ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('auth', () => {
  const phone = unique('07');

  it('registers a new user and returns a token', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test Retailer',
      phone,
      password: 'pass1234',
      role: 'retailer',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('retailer');
  });

  it('rejects duplicate phone registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Dup',
      phone, // same phone as above
      password: 'pass1234',
      role: 'retailer',
    });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid role', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Bad Role',
      phone: unique('07'),
      password: 'pass1234',
      role: 'admin',
    });
    expect(res.status).toBe(400);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone, password: 'pass1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone, password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

describe('protected routes', () => {
  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/deliveries');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a garbage token', async () => {
    const res = await request(app).get('/api/deliveries').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('delivery lifecycle', () => {
  let retailerToken, dispatcherToken, riderToken, riderId, requestId;

  beforeAll(async () => {
    const retailerPhone = unique('07');
    const dispatcherPhone = unique('07');
    const riderPhone = unique('07');

    const r1 = await request(app).post('/api/auth/register').send({
      name: 'Retailer', phone: retailerPhone, password: 'pass1234', role: 'retailer',
    });
    retailerToken = r1.body.token;

    const r2 = await request(app).post('/api/auth/register').send({
      name: 'Dispatcher', phone: dispatcherPhone, password: 'pass1234', role: 'dispatcher',
    });
    dispatcherToken = r2.body.token;

    const r3 = await request(app).post('/api/auth/register').send({
      name: 'Rider', phone: riderPhone, password: 'pass1234', role: 'rider',
    });
    riderToken = r3.body.token;
    riderId = r3.body.user.id;
  });

  it('lets a retailer create a request', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .set('Authorization', `Bearer ${retailerToken}`)
      .send({
        customer_name: 'Test Customer',
        customer_phone: '0711111111',
        address: '123 Test St',
        item_description: 'Widget',
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REQUESTED');
    requestId = res.body.request.id;
  });

  it('rejects a rider trying to create a request (wrong role)', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ customer_name: 'x', customer_phone: 'x', address: 'x', item_description: 'x' });
    expect(res.status).toBe(403);
  });

  it('lets a dispatcher assign the request to the rider', async () => {
    const res = await request(app)
      .post('/api/assignments')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ delivery_request_id: requestId, rider_id: riderId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ASSIGNED');
  });

  it('rejects a status jump straight to DELIVERED (illegal transition)', async () => {
    const res = await request(app)
      .post(`/api/status/${requestId}`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ status: 'DELIVERED', client_event_id: unique('evt') });
    expect(res.status).toBe(409);
  });

  it('lets the rider mark PICKED_UP', async () => {
    const res = await request(app)
      .post(`/api/status/${requestId}`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ status: 'PICKED_UP', client_event_id: unique('evt') });
    expect(res.status).toBe(201);
  });

  it('dedupes a replayed client_event_id instead of double-inserting', async () => {
    const clientEventId = unique('evt-dedupe');
    const first = await request(app)
      .post(`/api/status/${requestId}`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ status: 'DELIVERED', client_event_id: clientEventId });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`/api/status/${requestId}`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ status: 'DELIVERED', client_event_id: clientEventId });
    expect(replay.status).toBe(200);
    expect(replay.body.deduped).toBe(true);
  });

  it('rejects re-assigning a DELIVERED request', async () => {
    const res = await request(app)
      .post('/api/assignments')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ delivery_request_id: requestId, rider_id: riderId });
    expect(res.status).toBe(409);
  });

  it('returns the full status history for the request', async () => {
    const res = await request(app)
      .get(`/api/deliveries/${requestId}/history`)
      .set('Authorization', `Bearer ${retailerToken}`);
    expect(res.status).toBe(200);
    const statuses = res.body.history.map((h) => h.status);
    expect(statuses).toEqual(['REQUESTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED']);
  });
});
