-- Migration: Add created_by and stream_config to players table

-- 1. Add new columns to players table
ALTER TABLE players ADD COLUMN created_by INTEGER DEFAULT NULL;
ALTER TABLE players ADD COLUMN stream_config TEXT DEFAULT NULL;

-- Data migration (admins) moved to seed-admins.ts to avoid destructive actions in schema migration
