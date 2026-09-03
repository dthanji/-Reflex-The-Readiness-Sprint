const request = require('supertest');
const { pool } = require('../src/db');
let app;

beforeAll(() => { ({ app } = require('../src/server')); });
afterAll(async () => { await pool.end(); });

function unique(prefix) { return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`; }

describe('dispatcher failed-delivery reassignment', () => {
  let retailerToken;
  let dispatcherToken;
  let firstRiderToken;
  let firstRiderId;
  let secondRiderToken;
  let secondRiderId;
  let requestId;

  beforeAll(async () => {
    const retailer = await request(app).post('/api/auth/register').send({
      name: 'Reassign Retailer', phone: unique('07'), password: 'pass1234', role: 'retailer'
    });
    retailerToken = retailer.body.token;

    const dispatcher = await request(app).post('/api/auth/register').send({
      name: 'Reassign Dispatcher', phone: unique('07'), password: 'pass1234', role: 'dispatcher'
    });
    dispatcherToken = dispatcher.body.token;

    const first = await request(app).post('/api/auth/register').send({
      name: 'First Rider', phone: unique('07'), password: 'pass1234', role: 'rider'
    });
    firstRiderToken = first.body.token;
    firstRiderId = first.body.user.id;

    const second = await request(app).post('/api/auth/register').send({
      name: 'Replacement Rider', phone: unique('07'), password: 'pass1234', role: 'rider'
    });
    secondRiderToken = second.body.token;
    secondRiderId = second.body.user.id;
  });

  it('assigns the first rider', async () => {
    const created = await request(app).post('/api/deliveries')
      .set('Authorization', `Bearer ${retailerToken}`)
      .send({ customer_name: 'Reassign Customer', customer_phone: '0712345678', address: 'Reassign Test St', item_description: 'Widget' });
    expect(created.status).toBe(201);
    requestId = created.body.request.id;

    const assigned = await request(app).post('/api/assignments')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ delivery_request_id: requestId, rider_id: firstRiderId });
    expect(assigned.status).toBe(201);
  });

  it('allows the first rider to report a delivery failure', async () => {
    const failed = await request(app).post(`/api/status/${requestId}`)
      .set('Authorization', `Bearer ${firstRiderToken}`)
      .send({ status: 'FAILED', client_event_id: unique('reassign-failed') });
    expect(failed.status).toBe(201);
  });

  it('rejects reassigning to the same rider', async () => {
    const response = await request(app).put(`/api/assignments/${requestId}/reassign`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ rider_id: firstRiderId });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/different rider/i);
  });

  it('reassigns the failed delivery to a different rider', async () => {
    const response = await request(app).put(`/api/assignments/${requestId}/reassign`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ rider_id: secondRiderId });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ASSIGNED');
    expect(Number(response.body.rider.id)).toBe(Number(secondRiderId));
    expect(Number(response.body.previous_rider_id)).toBe(Number(firstRiderId));
  });

  it('moves the replacement rider through PICKED_UP', async () => {
    const pickedUp = await request(app).post(`/api/status/${requestId}`)
      .set('Authorization', `Bearer ${secondRiderToken}`)
      .send({ status: 'PICKED_UP', client_event_id: unique('reassign-pickup') });
    expect(pickedUp.status).toBe(201);
  });

  it('prevents the previous rider from acting on the reassigned delivery', async () => {
    const response = await request(app).post(`/api/status/${requestId}`)
      .set('Authorization', `Bearer ${firstRiderToken}`)
      .send({ status: 'FAILED', client_event_id: unique('old-rider-after-reassign') });
    expect(response.status).toBe(403);
  });

  it('records the complete reassignment audit trail', async () => {
    const history = await request(app).get(`/api/deliveries/${requestId}/history`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(history.status).toBe(200);
    expect(history.body.history.map((event) => event.status)).toEqual([
      'REQUESTED', 'ASSIGNED', 'FAILED', 'ASSIGNED', 'PICKED_UP'
    ]);
    const reassignment = history.body.history.find((event, index) => index === 3);
    expect(reassignment.metadata.reassigned).toBe(true);
    expect(Number(reassignment.metadata.previous_rider_id)).toBe(Number(firstRiderId));
    expect(Number(reassignment.metadata.rider_id)).toBe(Number(secondRiderId));
  });
});
