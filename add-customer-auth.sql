
-- Add authentication support to existing customers.
-- Existing customer records remain unchanged.
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Customers must set their own password before logging in.
