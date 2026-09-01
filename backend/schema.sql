-- Reflex schema
-- Append-only status_events remain the source of truth. delivery_request_state is backed by a trigger-maintained cache.
DROP TABLE IF EXISTS rider_ratings CASCADE;
DROP TABLE IF EXISTS delivery_confirmations CASCADE;
DROP TABLE IF EXISTS delivery_request_state_cache CASCADE;
DROP TABLE IF EXISTS status_events CASCADE;
DROP TABLE IF EXISTS assignments CASCADE;
DROP TABLE IF EXISTS delivery_requests CASCADE;
DROP TABLE IF EXISTS users CASCADE;
CREATE TYPE user_role AS ENUM ('retailer','dispatcher','rider');
CREATE TYPE delivery_status AS ENUM ('REQUESTED','ASSIGNED','PICKED_UP','DELIVERED','FAILED','CANCELLED','STUCK_IN_TRANSIT');
CREATE TABLE users(id SERIAL PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role user_role NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE delivery_requests(id SERIAL PRIMARY KEY,retailer_id INTEGER NOT NULL REFERENCES users(id),customer_name TEXT NOT NULL,customer_phone TEXT NOT NULL,address TEXT NOT NULL,item_description TEXT NOT NULL,delivery_code TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE assignments(id SERIAL PRIMARY KEY,delivery_request_id INTEGER NOT NULL REFERENCES delivery_requests(id),rider_id INTEGER NOT NULL REFERENCES users(id),assigned_by INTEGER NOT NULL REFERENCES users(id),assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(delivery_request_id,assigned_at));
CREATE TABLE status_events(id SERIAL PRIMARY KEY,delivery_request_id INTEGER NOT NULL REFERENCES delivery_requests(id),status delivery_status NOT NULL,actor_id INTEGER NOT NULL REFERENCES users(id),metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),client_event_id TEXT);
CREATE UNIQUE INDEX idx_status_events_client_event_id ON status_events(client_event_id) WHERE client_event_id IS NOT NULL;
CREATE TABLE delivery_confirmations(id SERIAL PRIMARY KEY,delivery_request_id INTEGER NOT NULL REFERENCES delivery_requests(id),qr_payload TEXT NOT NULL,scanned_by INTEGER NOT NULL REFERENCES users(id),scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(qr_payload));
CREATE TABLE rider_ratings(id SERIAL PRIMARY KEY,delivery_request_id INTEGER NOT NULL REFERENCES delivery_requests(id),rider_id INTEGER NOT NULL REFERENCES users(id),dispatcher_id INTEGER REFERENCES users(id),retailer_id INTEGER REFERENCES users(id),reviewer_role TEXT NOT NULL CHECK(reviewer_role IN ('dispatcher','retailer')),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),comment TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK((reviewer_role='dispatcher' AND dispatcher_id IS NOT NULL AND retailer_id IS NULL) OR (reviewer_role='retailer' AND retailer_id IS NOT NULL AND dispatcher_id IS NULL)));
CREATE UNIQUE INDEX idx_rider_ratings_dispatcher_once ON rider_ratings(delivery_request_id,dispatcher_id) WHERE dispatcher_id IS NOT NULL;
CREATE UNIQUE INDEX idx_rider_ratings_retailer_once ON rider_ratings(delivery_request_id,retailer_id) WHERE retailer_id IS NOT NULL;
CREATE TABLE delivery_request_state_cache(delivery_request_id INTEGER PRIMARY KEY REFERENCES delivery_requests(id) ON DELETE CASCADE,current_status delivery_status NOT NULL,status_updated_at TIMESTAMPTZ NOT NULL,rider_id INTEGER REFERENCES users(id));
CREATE INDEX idx_status_events_request ON status_events(delivery_request_id,created_at);
CREATE INDEX idx_assignments_rider ON assignments(rider_id);
CREATE INDEX idx_assignments_request ON assignments(delivery_request_id);
CREATE INDEX idx_rider_ratings_rider ON rider_ratings(rider_id,created_at DESC);
CREATE OR REPLACE FUNCTION refresh_delivery_request_state_cache() RETURNS TRIGGER AS $$
DECLARE latest_rider INTEGER;
BEGIN
 SELECT a.rider_id INTO latest_rider FROM assignments a WHERE a.delivery_request_id=NEW.delivery_request_id ORDER BY a.assigned_at DESC LIMIT 1;
 INSERT INTO delivery_request_state_cache(delivery_request_id,current_status,status_updated_at,rider_id) VALUES(NEW.delivery_request_id,NEW.status,NEW.created_at,latest_rider)
 ON CONFLICT(delivery_request_id) DO UPDATE SET current_status=EXCLUDED.current_status,status_updated_at=EXCLUDED.status_updated_at,rider_id=EXCLUDED.rider_id;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION refresh_state_cache_rider() RETURNS TRIGGER AS $$
BEGIN
 UPDATE delivery_request_state_cache SET rider_id=NEW.rider_id WHERE delivery_request_id=NEW.delivery_request_id;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_status_event_state_cache AFTER INSERT ON status_events FOR EACH ROW EXECUTE FUNCTION refresh_delivery_request_state_cache();
CREATE TRIGGER trg_assignment_state_cache AFTER INSERT ON assignments FOR EACH ROW EXECUTE FUNCTION refresh_state_cache_rider();
CREATE VIEW delivery_request_state AS
SELECT dr.id,dr.retailer_id,dr.customer_name,dr.customer_phone,dr.address,dr.item_description,dr.delivery_code,dr.created_at,c.current_status,c.status_updated_at,c.rider_id
FROM delivery_requests dr JOIN delivery_request_state_cache c ON c.delivery_request_id=dr.id;
