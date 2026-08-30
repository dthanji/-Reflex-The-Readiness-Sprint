# Running the test suite

These tests hit a real Postgres database and real HTTP routes via supertest
— no mocking of the database layer, since the things worth testing here
(row locking, transition guards, idempotent replay) are exactly the
behaviors that only show up against a real database.

## Setup

```bash
createdb reflex_test
psql -d reflex_test -f ../schema.sql
```

## Run

```bash
cd backend
PGDATABASE=reflex_test JWT_SECRET=test-secret npm test
```

Each test run creates fresh users with randomized phone numbers, so the
suite can be re-run against the same test database without manual cleanup
in between — but periodically dropping and recreating `reflex_test` is
still a good idea to keep it small.
