-- New registrations are non-executable while contracts are being installed.
-- Existing ACTIVE and PAUSED rows are intentionally left unchanged.
ALTER TABLE accounts DROP CONSTRAINT accounts_status_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_status_check
  CHECK (status IN ('ACTIVE', 'PAUSED', 'PROVISIONING', 'UNSUPPORTED'));

-- Safe rollback (only after stopping writers):
-- UPDATE accounts SET status = 'PAUSED' WHERE status = 'PROVISIONING';
-- ALTER TABLE accounts DROP CONSTRAINT accounts_status_check;
-- ALTER TABLE accounts ADD CONSTRAINT accounts_status_check CHECK (status IN ('ACTIVE', 'PAUSED', 'UNSUPPORTED'));
