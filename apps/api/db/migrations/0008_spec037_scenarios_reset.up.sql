-- SPEC-037 big-bang local reset: drop all legacy scenario payloads.
UPDATE core_integration_endpoints
SET scenarios_json = '[]';

UPDATE core_integration_endpoint_revisions
SET scenarios_json = '[]';
