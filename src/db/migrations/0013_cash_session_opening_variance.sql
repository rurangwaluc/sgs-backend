ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS expected_opening_balance bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_variance_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_variance_type varchar(20) NOT NULL DEFAULT 'MATCH',
  ADD COLUMN IF NOT EXISTS opening_variance_reason varchar(300),
  ADD COLUMN IF NOT EXISTS previous_session_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_sessions_previous_session_id_cash_sessions_id_fk'
  ) THEN
    ALTER TABLE public.cash_sessions
      ADD CONSTRAINT cash_sessions_previous_session_id_cash_sessions_id_fk
      FOREIGN KEY (previous_session_id)
      REFERENCES public.cash_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.cash_sessions
SET
  expected_opening_balance = COALESCE(expected_opening_balance, 0),
  opening_variance_amount = COALESCE(opening_variance_amount, 0),
  opening_variance_type = COALESCE(opening_variance_type, 'MATCH')
WHERE expected_opening_balance IS NULL
   OR opening_variance_amount IS NULL
   OR opening_variance_type IS NULL;

CREATE INDEX IF NOT EXISTS cash_sessions_location_status_idx
  ON public.cash_sessions(location_id, status, id DESC);

CREATE INDEX IF NOT EXISTS cash_sessions_previous_session_idx
  ON public.cash_sessions(previous_session_id);

CREATE INDEX IF NOT EXISTS cash_sessions_variance_type_idx
  ON public.cash_sessions(location_id, opening_variance_type, id DESC);