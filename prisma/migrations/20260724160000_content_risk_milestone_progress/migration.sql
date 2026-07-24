CREATE OR REPLACE FUNCTION app_project_milestone_progress(
  target_project_id text
)
RETURNS TABLE(
  total integer,
  not_started integer,
  in_progress integer,
  completed integer,
  percentage integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Project" project
    WHERE project.id = target_project_id
      AND app_can_access_project(project.id)
      AND (app_is_staff() OR project."showProgress" = true)
  ) THEN
    RAISE EXCEPTION 'project progress scope denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::integer AS total,
    COUNT(*) FILTER (WHERE milestone.status = 'NOT_STARTED')::integer
      AS not_started,
    COUNT(*) FILTER (WHERE milestone.status = 'IN_PROGRESS')::integer
      AS in_progress,
    COUNT(*) FILTER (WHERE milestone.status = 'COMPLETED')::integer
      AS completed,
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
        COUNT(*) FILTER (WHERE milestone.status = 'COMPLETED')::numeric
        * 100
        / COUNT(*)
      )::integer
    END AS percentage
  FROM "Milestone" milestone
  LEFT JOIN "ContentRiskState" risk_state
    ON risk_state."targetType" = 'MILESTONE'
   AND risk_state."targetId" = milestone.id
  WHERE milestone."projectId" = target_project_id
    AND COALESCE(risk_state."displayState" <> 'REVOKED', true);
END;
$$;

REVOKE ALL ON FUNCTION app_project_milestone_progress(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_project_milestone_progress(text)
  TO service_platform_app;
