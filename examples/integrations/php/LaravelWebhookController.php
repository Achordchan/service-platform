<?php

final class LaravelWebhookController
{
    public function __invoke(\Illuminate\Http\Request $request): \Illuminate\Http\Response
    {
        $valid = AchordConnect::verifyWebhook(
            config('services.achord.webhook_secret'),
            $request->getContent(),
            $request->header('X-Achord-Event-Id'),
            $request->header('X-Achord-Timestamp'),
            $request->header('X-Achord-Signature'),
        );
        abort_unless($valid, 400, 'Invalid signature');
        // 用事件 ID 建唯一索引，事务提交后再返回 200。
        return response('', 200);
    }
}
