DROP INDEX research_runs_active_team;
CREATE UNIQUE INDEX research_runs_active_team ON research_runs(team_id)
WHERE status IN ('queued','collecting','ranking','drafting') AND mode <> 'replay';
