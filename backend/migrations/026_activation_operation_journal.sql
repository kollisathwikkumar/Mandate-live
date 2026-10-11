ALTER TABLE policy_activation_plans DROP CONSTRAINT policy_activation_plans_state_check;
ALTER TABLE policy_activation_plans ADD CONSTRAINT policy_activation_plans_state_check
  CHECK (state IN ('AWAITING_SAFE_OWNER_SIGNATURES', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'SUPERSEDED', 'RECONCILIATION_REQUIRED'));

CREATE TABLE policy_activation_operations (
  plan_id uuid NOT NULL REFERENCES policy_activation_plans(id),
  operation_index integer NOT NULL CHECK (operation_index >= 0),
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  safe_tx_hash char(66) NOT NULL,
  request_fingerprint char(66) NOT NULL,
  state text NOT NULL CHECK (state IN ('PREPARED', 'SUBMITTED', 'FINAL', 'RECONCILIATION_REQUIRED', 'FAILED')),
  transaction_hash char(66),
  receipt_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, operation_index),
  UNIQUE (chain_id, transaction_hash),
  CHECK ((state = 'PREPARED' AND transaction_hash IS NULL AND receipt_json IS NULL)
      OR (state = 'SUBMITTED' AND transaction_hash IS NOT NULL AND receipt_json IS NULL)
      OR (state = 'FINAL' AND transaction_hash IS NOT NULL AND receipt_json IS NOT NULL)
      OR (state IN ('RECONCILIATION_REQUIRED', 'FAILED'))
));

CREATE INDEX policy_activation_operations_state_idx ON policy_activation_operations (state, updated_at);
