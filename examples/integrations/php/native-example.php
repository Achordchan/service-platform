<?php
require __DIR__ . '/AchordConnect.php';

$rawBody = file_get_contents('php://input');
$valid = AchordConnect::verifyWebhook(
    getenv('ACHORD_WEBHOOK_SECRET'),
    $rawBody,
    $_SERVER['HTTP_X_ACHORD_EVENT_ID'] ?? null,
    $_SERVER['HTTP_X_ACHORD_TIMESTAMP'] ?? null,
    $_SERVER['HTTP_X_ACHORD_SIGNATURE'] ?? null,
);
http_response_code($valid ? 200 : 400);
