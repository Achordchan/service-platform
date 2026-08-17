-- 通知邮件投递需要读取「收件人」的按类型退订偏好，而投递事务挂在发送方
-- Actor 的 RLS 会话上（普通员工/客户查不到他人偏好行，平台管理员例外），
-- 导致已退订用户仍会收到邮件。此函数以表所有者身份执行（绕过 RLS），
-- 只暴露「已明确退订」的 (userId, ruleKey)，不开放全部偏好读取。

CREATE OR REPLACE FUNCTION app_notification_email_optouts(user_ids text[])
RETURNS TABLE (user_id text, rule_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p."userId", p."ruleKey"
  FROM "UserNotificationPreference" p
  WHERE p."emailEnabled" = false
    AND p."userId" = ANY(user_ids)
$$;

REVOKE ALL ON FUNCTION app_notification_email_optouts(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_notification_email_optouts(text[])
  TO service_platform_app;
