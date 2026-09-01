-- Reflex schema
-- Design note: delivery_requests has NO mutable status column.
-- Current status is always derived from the latest row in status_events.

DROP TABLE IF EXISTS delivery_confirmations CASCADE;
DROP TABLE IF EXISTS status_events CASCADE;
DROP TABLE IF EXISTS assignments CASCADE;
DROP TABLE IF EXISTS delivery_requests CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TYPE user_role AS ENUM ('retailer', 'dispatcher', 'rider');
CREATE TYPE delivery_status AS ENUM ('REQUESTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED', 'STUCK_IN_TRANSIT');

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_requests (
    id SERIAL PRIMARY KEY,
    retailer_id INTEGER NOT NULL REFERENCES users(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    address TEXT NOT NULL,
    item_description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assignments (
    id SERIAL PRIMARY KEY,
    delivery_request_id INTEGER NOT NULL REFERENCES delivery_requests(id),
    rider_id INTEGER NOT NULL REFERENCES users(id),
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (delivery_request_id, assigned_at)
);

CREATE TABLE status_events (
    id SERIAL PRIMARY KEY,
    delivery_request_id INTEGER NOT NULL REFERENCES delivery_requests(id),
    status delivery_status NOT NULL,
    actor_id INTEGER NOT NULL REFERENCES users(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_event_id TEXT
);

CREATE UNIQUE INDEX idx_status_events_client_event_id ON status_events (client_event_id) WHERE client_event_id IS NOT NULL;

CREATE TABLE delivery_confirmations (
    id SERIAL PRIMARY KEY,
    delivery_request_id INTEGER NOT NULL REFERENCES delivery_requests(id),
    qr_payload TEXT NOT NULL,
    scanned_by INTEGER NOT NULL REFERENCES users(id),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_events_request ON status_events (delivery_request_id, created_at);
CREATE INDEX idx_assignments_rider ON assignments (rider_id);
CREATE INDEX idx_assignments_request ON assignments (delivery_request_id);

CREATE VIEW delivery_request_state AS
SELECT dr.id, dr.retailer_id, dr.customer_name, dr.customer_phone, dr.address, dr.item_description, dr.created_at,
       latest.status AS current_status, latest.created_at AS status_updated_at, a.rider_id
FROM delivery_requests dr
LEFT JOIN LATERAL (
    SELECT status, created_at FROM status_events se
    WHERE se.delivery_request_id = dr.id ORDER BY created_at DESC LIMIT 1
) latest ON true
LEFT JOIN LATERAL (
    SELECT rider_id FROM assignments a
    WHERE a.delivery_request_id = dr.id ORDER BY assigned_at DESC LIMIT 1
) a ON true;
