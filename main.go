package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/sqweek/dialog"
	webview "github.com/webview/webview_go"
)

//go:embed all:frontend/dist
var distFS embed.FS

type FileNode struct {
	Path     string      `json:"path"`
	Name     string      `json:"name"`
	IsDir    bool        `json:"isDir"`
	Children []*FileNode `json:"children,omitempty"`
}

type GenerateResult struct {
	Context string  `json:"context"`
	Count   int     `json:"count"`
	SizeMB  float64 `json:"sizeMb"`
}

var defaultIgnores = []string{
	// VCS & IDEs
	".git", ".idea", ".vscode", ".vs", ".svn", ".hg", ".settings", ".project", ".classpath",
	// Java / Kotlin / Gradle / Maven
	"target", "build", ".gradle", ".m2", "out",
	// JavaScript / TypeScript / Node
	"node_modules", "dist", ".next", ".nuxt", ".turbo", ".output", ".angular", ".svelte-kit",
	// Go / C / C++
	"vendor", "bin", "obj", "cmake-build-debug", "cmake-build-release",
	// Python
	"__pycache__", ".venv", "venv", "env", ".pytest_cache", ".mypy_cache", ".tox",
	// Rust
	"target",
	// OS & Temp
	".ds_store", "thumbs.db", "tmp", "temp", ".cache",
}

func main() {
	ignoreFlag := flag.String("ignore", "", "Дополнительный или переопределяющий список игнорируемых папок/файлов через запятую")
	overrideFlag := flag.Bool("override-ignores", false, "Полностью заменить стандартный список игноров флагом -ignore вместо объединения")
	dirFlag := flag.String("dir", "", "Стартовая папка проекта")
	flag.Parse()

	// Формируем итоговый список игноров
	var activeIgnores []string
	if !*overrideFlag {
		activeIgnores = append(activeIgnores, defaultIgnores...)
	}

	if *ignoreFlag != "" {
		for _, ign := range strings.Split(*ignoreFlag, ",") {
			trimmed := strings.TrimSpace(ign)
			if trimmed != "" {
				activeIgnores = append(activeIgnores, strings.ToLower(trimmed))
			}
		}
	}

	// Определение начального каталога
	startDir := *dirFlag
	if startDir == "" {
		if cwd, err := os.Getwd(); err == nil {
			startDir = cwd
		}
	} else {
		if abs, err := filepath.Abs(startDir); err == nil {
			startDir = abs
		}
	}

	mime.AddExtensionType(".js", "text/javascript")
	mime.AddExtensionType(".css", "text/css")

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port

	sub, err := fs.Sub(distFS, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{Handler: http.FileServer(http.FS(sub))}
	go server.Serve(listener)

	w := webview.New(true)
	defer w.Destroy()
	w.SetTitle("Project Context Builder")
	w.SetSize(1200, 800, webview.HintNone)

	// Получение стартового пути из CLI
	w.Bind("goGetInitialDir", func() string {
		return startDir
	})

	w.Bind("goSelectDirectory", func(currentPath string) string {
		d := dialog.Directory().Title("Выберите папку проекта")
		if currentPath != "" {
			d.SetStartDir(currentPath)
		}
		path, _ := d.Browse()
		return path
	})

	// Построение дерева с учетом собранного списка игноров
	w.Bind("goGetTree", func(targetPath string) string {
		if targetPath == "" {
			targetPath = startDir
		}
		root := buildTree(targetPath, activeIgnores)
		data, _ := json.Marshal(root)
		return string(data)
	})

	w.Bind("goGenerateContext", func(rootDir string, files []string) string {
		var sb strings.Builder
		processed := 0
		for _, p := range files {
			if isTextFile(p) {
				rel, _ := filepath.Rel(rootDir, p)
				content, err := os.ReadFile(p)
				if err == nil {
					sb.WriteString("// ================================\n")
					sb.WriteString(fmt.Sprintf("// File: %s\n", rel))
					sb.WriteString("// ================================\n\n")
					sb.Write(content)
					sb.WriteString("\n\n")
					processed++
				}
			}
		}
		fullText := sb.String()
		sizeMB := float64(len(fullText)) / (1024 * 1024)
		res, _ := json.Marshal(GenerateResult{
			Context: fullText,
			Count:   processed,
			SizeMB:  sizeMB,
		})
		return string(res)
	})

	w.Bind("goSaveToFile", func(content string, currentDir string) bool {
		d := dialog.File().Title("Сохранить результат").Filter("Текстовые файлы (*.txt)", "txt").SetStartFile("context.txt")
		if currentDir != "" {
			d.SetStartDir(currentDir)
		}
		savePath, err := d.Save()
		if err != nil || savePath == "" {
			return false
		}
		return os.WriteFile(savePath, []byte(content), 0644) == nil
	})

	w.Navigate(fmt.Sprintf("http://127.0.0.1:%d", port))
	w.Run()
}

func buildTree(dirPath string, ignores []string) *FileNode {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil
	}
	root := &FileNode{
		Path:     dirPath,
		Name:     filepath.Base(dirPath),
		IsDir:    true,
		Children: make([]*FileNode, 0),
	}
	var dirs, files []*FileNode
	for _, entry := range entries {
		name := entry.Name()
		if isIgnored(name, ignores) {
			continue
		}
		full := filepath.Join(dirPath, name)
		if entry.IsDir() {
			if child := buildTree(full, ignores); child != nil {
				dirs = append(dirs, child)
			}
		} else {
			files = append(files, &FileNode{Path: full, Name: name, IsDir: false})
		}
	}
	sort.Slice(dirs, func(i, j int) bool { return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name) })
	sort.Slice(files, func(i, j int) bool { return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name) })
	root.Children = append(dirs, files...)
	return root
}

func isIgnored(name string, list []string) bool {
	lower := strings.ToLower(name)
	for _, ign := range list {
		if lower == ign {
			return true
		}
	}
	return false
}

func isTextFile(path string) bool {
	binaryExts := map[string]bool{
		".pdf": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
		".webp": true, ".ico": true, ".svgz": true, ".exe": true, ".dll": true,
		".so": true, ".dylib": true, ".zip": true, ".tar": true, ".gz": true,
		".7z": true, ".rar": true, ".jar": true, ".war": true, ".class": true,
		".db": true, ".sqlite": true, ".woff": true, ".woff2": true, ".ttf": true,
	}
	ext := strings.ToLower(filepath.Ext(path))
	if binaryExts[ext] {
		return false
	}

	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	buf := make([]byte, 1024)
	n, err := f.Read(buf)
	if err != nil && err.Error() != "EOF" {
		return false
	}
	if n == 0 {
		return true
	}
	buf = buf[:n]
	return bytes.IndexByte(buf, 0x00) == -1 && utf8.Valid(buf)
}