ALTER TABLE core_integration_packs
  ADD COLUMN base_path TEXT NOT NULL DEFAULT '/';

UPDATE core_integration_packs
SET base_path = '/'
WHERE TRIM(base_path) = '';
