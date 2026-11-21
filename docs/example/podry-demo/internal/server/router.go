package server

import (
	"io"
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func New(files fs.FS) http.Handler {
	r := chi.NewRouter()
	r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, "pong\n")
	})
	r.Handle("/*", http.FileServer(http.FS(files)))
	return r
}
