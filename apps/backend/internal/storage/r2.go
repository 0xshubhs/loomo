package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/dittoo/backend/internal/config"
)

type R2Client struct {
	client     *s3.Client
	presigner  *s3.PresignClient
	bucket     string
	cdnURL     string
}

func NewR2Client(cfg *config.Config) (*R2Client, error) {
	resolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL: cfg.S3Endpoint,
			}, nil
		},
	)

	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(cfg.S3Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.S3AccessKey,
			cfg.S3SecretKey,
			"",
		)),
		awsconfig.WithEndpointResolverWithOptions(resolver),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.S3ForcePathStyle
	})

	return &R2Client{
		client:    client,
		presigner: s3.NewPresignClient(client),
		bucket:    cfg.S3Bucket,
		cdnURL:    cfg.CDNURL,
	}, nil
}

func (r *R2Client) GeneratePresignedPutURL(key string, contentType string, expiry time.Duration) (string, error) {
	input := &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}

	resp, err := r.presigner.PresignPutObject(context.Background(), input, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("failed to presign put: %w", err)
	}

	return resp.URL, nil
}

func (r *R2Client) GeneratePresignedGetURL(key string, expiry time.Duration) (string, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	}

	resp, err := r.presigner.PresignGetObject(context.Background(), input, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("failed to presign get: %w", err)
	}

	return resp.URL, nil
}

func (r *R2Client) DeleteObject(key string) error {
	_, err := r.client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to delete object: %w", err)
	}
	return nil
}

func VideoSourceKey(userID, videoID string) string {
	return fmt.Sprintf("videos/%s/%s/source.webm", userID, videoID)
}

func VideoHLSKey(userID, videoID string) string {
	return fmt.Sprintf("videos/%s/%s/hls/", userID, videoID)
}

func ThumbnailKey(userID, videoID string) string {
	return fmt.Sprintf("videos/%s/%s/thumbnail.jpg", userID, videoID)
}
