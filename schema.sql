
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    member_code VARCHAR(30) UNIQUE NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) UNIQUE,
    email VARCHAR(150),
    password_hash TEXT,
    total_visits INTEGER NOT NULL DEFAULT 0,
    loyalty_stamps INTEGER NOT NULL DEFAULT 0,
    total_spent NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS barbers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    specialty VARCHAR(120),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reward_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    required_stamps INTEGER NOT NULL DEFAULT 10,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visits (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    service VARCHAR(100) NOT NULL,
    barber_name VARCHAR(120),
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rewards (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    reward_name VARCHAR(120) NOT NULL,
    stamps_required INTEGER NOT NULL DEFAULT 10,
    status VARCHAR(20) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'redeemed')),
    redeemed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_activation_codes (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    code VARCHAR(30) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visits_customer_id
    ON visits(customer_id);

CREATE INDEX IF NOT EXISTS idx_visits_visited_at
    ON visits(visited_at);

CREATE INDEX IF NOT EXISTS idx_customer_activation_customer_id
    ON customer_activation_codes(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_activation_code
    ON customer_activation_codes(code);