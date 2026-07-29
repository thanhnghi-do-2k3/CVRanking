package auth

import (
	"context"
	"crypto/tls"
	"fmt"
	"html"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

type EmailSender interface {
	SendVerification(context.Context, string, string, string) error
	SendInvitation(context.Context, string, string, string, Role) error
}

type SMTPConfig struct {
	Host      string
	Port      int
	Username  string
	Password  string
	From      string
	TLS       bool
	PublicURL string
}

type SMTPEmailSender struct {
	config SMTPConfig
}

func NewSMTPEmailSender(config SMTPConfig) *SMTPEmailSender {
	return &SMTPEmailSender{config: config}
}

func (sender *SMTPEmailSender) SendVerification(ctx context.Context, recipient, displayName, token string) error {
	url := sender.config.PublicURL + "/verify-email#token=" + token
	subject := "Xác minh email TalentRank"
	body := fmt.Sprintf(
		"<p>Xin chào %s,</p><p>Hãy xác minh email để bắt đầu sử dụng TalentRank.</p><p><a href=\"%s\">Xác minh email</a></p><p>Liên kết hết hạn sau 24 giờ.</p>",
		html.EscapeString(displayName),
		html.EscapeString(url),
	)
	return sender.send(ctx, recipient, subject, body)
}

func (sender *SMTPEmailSender) SendInvitation(ctx context.Context, recipient, workspaceName, token string, role Role) error {
	url := sender.config.PublicURL + "/accept-invite#token=" + token
	subject := "Lời mời tham gia " + workspaceName
	body := fmt.Sprintf(
		"<p>Bạn được mời tham gia <strong>%s</strong> với vai trò %s.</p><p><a href=\"%s\">Chấp nhận lời mời</a></p><p>Liên kết hết hạn sau 7 ngày.</p>",
		html.EscapeString(workspaceName),
		html.EscapeString(string(role)),
		html.EscapeString(url),
	)
	return sender.send(ctx, recipient, subject, body)
}

func (sender *SMTPEmailSender) send(ctx context.Context, recipient, subject, htmlBody string) error {
	from, err := mail.ParseAddress(sender.config.From)
	if err != nil {
		return fmt.Errorf("parse SMTP sender: %w", err)
	}
	address := net.JoinHostPort(sender.config.Host, fmt.Sprint(sender.config.Port))
	dialer := net.Dialer{Timeout: 10 * time.Second}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return fmt.Errorf("connect SMTP: %w", err)
	}
	client, err := smtp.NewClient(connection, sender.config.Host)
	if err != nil {
		_ = connection.Close()
		return fmt.Errorf("create SMTP client: %w", err)
	}
	defer client.Close()

	if sender.config.TLS {
		if err := client.StartTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: sender.config.Host}); err != nil {
			return fmt.Errorf("start SMTP TLS: %w", err)
		}
	}
	if sender.config.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", sender.config.Username, sender.config.Password, sender.config.Host)); err != nil {
			return fmt.Errorf("authenticate SMTP: %w", err)
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(recipient); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("open SMTP message: %w", err)
	}
	message := strings.Join([]string{
		"From: " + sender.config.From,
		"To: " + recipient,
		"Subject: " + mime.QEncoding.Encode("UTF-8", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=UTF-8",
		"",
		htmlBody,
	}, "\r\n")
	if _, err := writer.Write([]byte(message)); err != nil {
		_ = writer.Close()
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("close SMTP message: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("quit SMTP: %w", err)
	}
	return nil
}
