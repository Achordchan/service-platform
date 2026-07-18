package achordconnect

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	BaseURL      string
	ClientID     string
	ClientSecret string
	HTTP         *http.Client
}

type User struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Email      *string        `json:"email,omitempty"`
	Username   *string        `json:"username,omitempty"`
	AvatarURL  *string        `json:"avatarUrl,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

type LaunchContext struct {
	Theme        string `json:"theme,omitempty"`
	Locale       string `json:"locale,omitempty"`
	ReturnOrigin string `json:"returnOrigin,omitempty"`
}

type LaunchResponse struct {
	LaunchURL string `json:"launchUrl"`
	ExpiresAt string `json:"expiresAt"`
}

func (c Client) CreateLaunchTicket(
	ctx context.Context,
	user User,
	launchContext LaunchContext,
) (LaunchResponse, error) {
	if strings.TrimSpace(user.ID) == "" {
		return LaunchResponse{}, errors.New("achord connect user ID must be a non-empty string")
	}
	endpoint, err := url.JoinPath(c.BaseURL, "/api/v1/integrations/universal/launch-tickets")
	if err != nil {
		return LaunchResponse{}, err
	}
	body, err := json.Marshal(map[string]any{
		"user":    user,
		"context": launchContext,
	})
	if err != nil {
		return LaunchResponse{}, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return LaunchResponse{}, err
	}
	req.SetBasicAuth(c.ClientID, c.ClientSecret)
	req.Header.Set("Content-Type", "application/json")
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return LaunchResponse{}, err
	}
	defer res.Body.Close()
	limited, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return LaunchResponse{}, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return LaunchResponse{}, fmt.Errorf("achord connect HTTP %d", res.StatusCode)
	}
	var envelope struct {
		Data LaunchResponse `json:"data"`
	}
	if err := json.Unmarshal(limited, &envelope); err != nil {
		return LaunchResponse{}, err
	}
	return envelope.Data, nil
}

func IframeHTML(launchURL string, title string) (string, error) {
	parsed, err := url.Parse(launchURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return "", errors.New("achord connect launch URL must be an absolute HTTP or HTTPS URL")
	}
	if title == "" {
		title = "服务请求"
	}
	return fmt.Sprintf(
		`<iframe src="%s" title="%s" style="width:100%%;min-height:720px;border:0" allow="clipboard-write"></iframe>`,
		html.EscapeString(parsed.String()),
		html.EscapeString(title),
	), nil
}

func VerifyWebhook(
	secret string,
	rawBody []byte,
	eventID string,
	timestamp string,
	signature string,
	now time.Time,
) error {
	if eventID == "" || !strings.HasPrefix(signature, "v1=") {
		return errors.New("missing webhook headers")
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || abs(now.Unix()-ts) > 300 {
		return errors.New("expired webhook")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(rawBody)
	expected := mac.Sum(nil)
	actual, err := hex.DecodeString(strings.TrimPrefix(signature, "v1="))
	if err != nil || !hmac.Equal(expected, actual) {
		return errors.New("invalid webhook signature")
	}
	return nil
}

func abs(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
