package achordconnect

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

type webhookVector struct {
	Secret    string `json:"secret"`
	Timestamp string `json:"timestamp"`
	EventID   string `json:"eventId"`
	RawBody   string `json:"rawBody"`
	Signature string `json:"signature"`
}

func TestVerifyWebhookSharedVector(t *testing.T) {
	source, err := os.ReadFile("../../shared/webhook-test-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector webhookVector
	if err := json.Unmarshal(source, &vector); err != nil {
		t.Fatal(err)
	}
	timestamp, err := strconv.ParseInt(vector.Timestamp, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyWebhook(
		vector.Secret,
		[]byte(vector.RawBody),
		vector.EventID,
		vector.Timestamp,
		"v1="+vector.Signature,
		time.Unix(timestamp, 0),
	); err != nil {
		t.Fatalf("shared vector rejected: %v", err)
	}
	if err := VerifyWebhook(
		vector.Secret,
		[]byte(vector.RawBody+" "),
		vector.EventID,
		vector.Timestamp,
		"v1="+vector.Signature,
		time.Unix(timestamp, 0),
	); err == nil {
		t.Fatal("tampered webhook body was accepted")
	}
}

func TestIframeHTMLAndStringUserID(t *testing.T) {
	markup, err := IframeHTML(
		"https://support.example.test/embed/connect/public#ticket=secret",
		`服务请求 <测试>`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(markup, "<测试>") || !strings.Contains(markup, "&lt;测试&gt;") {
		t.Fatalf("iframe title was not escaped: %s", markup)
	}
	client := Client{BaseURL: "https://support.example.test"}
	if _, err := client.CreateLaunchTicket(
		t.Context(),
		User{ID: "", Name: "invalid"},
		LaunchContext{},
	); err == nil {
		t.Fatal("empty external user ID was accepted")
	}
	encoded, err := json.Marshal(User{ID: "9223372036854775807", Name: "user"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"id":"9223372036854775807"`) {
		t.Fatalf("external user ID was not encoded as a string: %s", encoded)
	}
}
