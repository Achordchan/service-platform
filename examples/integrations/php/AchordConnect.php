<?php

final class AchordConnect
{
    public static function createLaunchTicket(
        string $baseUrl,
        string $clientId,
        string $clientSecret,
        array $user,
        array $context = []
    ): array {
        if (!array_key_exists('id', $user) || !is_string($user['id']) || trim($user['id']) === '') {
            throw new InvalidArgumentException('Achord Connect user.id must be a non-empty string');
        }
        $ch = curl_init(rtrim($baseUrl, '/') . '/api/v1/integrations/universal/launch-tickets');
        if ($ch === false) {
            throw new RuntimeException('Unable to initialize Achord Connect HTTP client');
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
            CURLOPT_USERPWD => $clientId . ':' . $clientSecret,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode(['user' => $user, 'context' => $context], JSON_THROW_ON_ERROR),
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        if (!is_string($body) || $status < 200 || $status >= 300) {
            throw new RuntimeException(
                $curlError !== '' ? $curlError : 'Achord Connect HTTP ' . $status
            );
        }
        $payload = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
        return $payload['data'];
    }

    public static function iframeHtml(string $launchUrl, string $title = '服务请求'): string
    {
        $parts = parse_url($launchUrl);
        $scheme = is_array($parts) ? ($parts['scheme'] ?? null) : null;
        $host = is_array($parts) ? ($parts['host'] ?? null) : null;
        if (!is_string($host) || !in_array($scheme, ['http', 'https'], true)) {
            throw new InvalidArgumentException(
                'Achord Connect launchUrl must be an absolute HTTP or HTTPS URL'
            );
        }
        $escape = static fn (string $value): string => htmlspecialchars(
            $value,
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        );
        return sprintf(
            '<iframe src="%s" title="%s" style="width:100%%;min-height:720px;border:0" allow="clipboard-write"></iframe>',
            $escape($launchUrl),
            $escape($title)
        );
    }

    public static function verifyWebhook(
        string $secret,
        string $rawBody,
        ?string $eventId,
        ?string $timestamp,
        ?string $signature,
        ?int $now = null
    ): bool {
        if (!$eventId || !$timestamp || !str_starts_with((string) $signature, 'v1=')) return false;
        if (abs(($now ?? time()) - (int) $timestamp) > 300) return false;
        $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
        return hash_equals($expected, substr((string) $signature, 3));
    }
}
