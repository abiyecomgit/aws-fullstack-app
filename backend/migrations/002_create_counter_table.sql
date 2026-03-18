CREATE TABLE IF NOT EXISTS counter (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    value INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_counter_user_id ON counter(user_id);
