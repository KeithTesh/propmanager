-- Add photo_urls to maintenance_requests for caretaker PWA
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';