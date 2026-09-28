-- 请求相关、但不参与聚合的通知（带内容风控复查单、或带 sourceId）原来直接 INSERT，
-- 受 notification_access 的 WITH CHECK 约束。外部联系人会话没有 app.user_id，
-- app_can_access_project 恒为假 → 外部联系人在开启内容风控时提交服务请求直接 500。
-- 与 app_upsert_request_notification 同样的范围校验，改为 SECURITY DEFINER 插入。
CREATE OR REPLACE FUNCTION app_insert_request_notification(
  notification_id text,
  notification_type text,
  notification_title text,
  notification_body text,
  recipient_user_id text,
  target_customer_space_id text,
  target_project_id text,
  target_service_request_id text,
  target_source_type text,
  target_source_id text,
  target_email_due_at timestamp without time zone
)
RETURNS TABLE(id text, occurrence_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT app_can_access_request(target_service_request_id)
    OR NOT app_user_relevant_to_project(
      recipient_user_id,
      target_project_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM "ServiceRequest" request
      JOIN "Project" project ON project.id = request."projectId"
      WHERE request.id = target_service_request_id
        AND request."projectId" = target_project_id
        AND project."customerSpaceId" = target_customer_space_id
    )
  THEN
    RAISE EXCEPTION 'request notification scope denied';
  END IF;

  RETURN QUERY
  INSERT INTO "Notification" (
    id,
    type,
    title,
    body,
    "occurrenceCount",
    "emailDueAt",
    "userId",
    "customerSpaceId",
    "projectId",
    "serviceRequestId",
    "sourceType",
    "sourceId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    notification_id,
    notification_type::"NotificationType",
    notification_title,
    notification_body,
    1,
    target_email_due_at,
    recipient_user_id,
    target_customer_space_id,
    target_project_id,
    target_service_request_id,
    target_source_type,
    target_source_id,
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  )
  RETURNING
    "Notification".id,
    "Notification"."occurrenceCount";
END;
$$;
REVOKE ALL ON FUNCTION app_insert_request_notification(
  text, text, text, text, text, text, text, text, text, text, timestamp without time zone
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_insert_request_notification(
  text, text, text, text, text, text, text, text, text, text, timestamp without time zone
) TO service_platform_app;
