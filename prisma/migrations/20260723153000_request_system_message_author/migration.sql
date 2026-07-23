ALTER TABLE "RequestMessage"
  DROP CONSTRAINT "RequestMessage_author_exactly_one_check";

ALTER TABLE "RequestMessage"
  ADD CONSTRAINT "RequestMessage_author_exactly_one_check"
  CHECK (
    (
      "isSystem" = true
      AND NOT ("authorId" IS NOT NULL AND "externalAuthorId" IS NOT NULL)
    )
    OR
    (
      "isSystem" = false
      AND (("authorId" IS NOT NULL) <> ("externalAuthorId" IS NOT NULL))
    )
  );
