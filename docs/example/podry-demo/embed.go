package podrydemo

import (
	"embed"
	"io/fs"
)

//go:embed all:web/dist
var webFiles embed.FS

func WebFS() fs.FS {
	files, err := fs.Sub(webFiles, "web/dist")
	if err != nil {
		panic(err)
	}
	return files
}
