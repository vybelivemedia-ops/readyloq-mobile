ALTER TABLE reports
  ADD COLUMN approved_by_user_id integer REFERENCES users(id),
  ADD COLUMN approved_at timestamp;