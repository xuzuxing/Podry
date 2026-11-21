package main

import (
	"log"
	"net/http"
	"time"

	podrydemo "podry-demo"
	"podry-demo/internal/server"
)

func main() {
	srv := &http.Server{
		Addr: ":8080", Handler: server.New(podrydemo.WebFS()),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Println("podry-demo listening on :8080")
	log.Fatal(srv.ListenAndServe())
}
