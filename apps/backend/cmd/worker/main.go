package main

import (
	"fmt"
	"log"

	"github.com/dittoo/backend/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// TODO: Initialize River workers for transcode, thumbnail, transcribe
	fmt.Printf("Worker starting with environment: %s\n", cfg.Environment)
	fmt.Println("Worker not yet implemented — will process video jobs")

	select {} // Block forever
}
