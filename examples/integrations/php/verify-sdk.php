<?php

require __DIR__ . '/AchordConnect.php';

$source = file_get_contents(__DIR__ . '/../shared/webhook-test-vectors.json');
if (!is_string($source)) {
    throw new RuntimeException('Unable to read shared webhook vector');
}
$vector = json_decode($source, true, flags: JSON_THROW_ON_ERROR);
$valid = AchordConnect::verifyWebhook(
    $vector['secret'],
    $vector['rawBody'],
    $vector['eventId'],
    $vector['timestamp'],
    'v1=' . $vector['signature'],
    (int) $vector['timestamp']
);
if (!$valid) {
    throw new RuntimeException('Shared webhook vector was rejected');
}
if (AchordConnect::verifyWebhook(
    $vector['secret'],
    $vector['rawBody'] . ' ',
    $vector['eventId'],
    $vector['timestamp'],
    'v1=' . $vector['signature'],
    (int) $vector['timestamp']
)) {
    throw new RuntimeException('Tampered webhook body was accepted');
}

$iframe = AchordConnect::iframeHtml(
    'https://support.example.test/embed/connect/public#ticket=secret',
    '服务请求 <测试>'
);
if (str_contains($iframe, '<测试>') || !str_contains($iframe, '&lt;测试&gt;')) {
    throw new RuntimeException('Iframe title was not escaped');
}

$numericIdRejected = false;
try {
    AchordConnect::createLaunchTicket(
        'https://support.example.test',
        'client-id',
        'client-secret',
        ['id' => 9223372036854775807, 'name' => 'invalid']
    );
} catch (InvalidArgumentException) {
    $numericIdRejected = true;
}
if (!$numericIdRejected) {
    throw new RuntimeException('Numeric external user ID was accepted');
}

fwrite(STDOUT, "php sdk verification passed\n");
