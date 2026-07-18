package main

import (
	"io"
	"net/http"
	"os"
	"time"

	"example.com/achord-connect-example/achordconnect"
)

func achordWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	err = achordconnect.VerifyWebhook(
		os.Getenv("ACHORD_WEBHOOK_SECRET"), body,
		r.Header.Get("X-Achord-Event-Id"),
		r.Header.Get("X-Achord-Timestamp"),
		r.Header.Get("X-Achord-Signature"), time.Now(),
	)
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}
	// 将事件 ID 写入唯一索引后再处理业务，重复事件仍返回 200。
	w.WriteHeader(http.StatusOK)
}
