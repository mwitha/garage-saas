-- Add an 'internal' plan for workshops that run without a trial or
-- subscription (e.g. the platform owner's own business).
ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'internal';
