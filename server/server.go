// Package server exposes the EPANET simulation engine over HTTP and serves
// the embedded web UI.
package server

import (
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"

	"epanet-web/epanet"
	"epanet-web/model"
	"epanet-web/pool"
)

const maxBody = 16 << 20 // 16 MB request cap

// New builds the HTTP handler. static is the web UI filesystem rooted at the
// directory that contains index.html. p is the simulation worker pool; when nil,
// simulations run serially in-process.
func New(static fs.FS, p *pool.Pool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", handleHealth(p))
	mux.HandleFunc("/api/example", handleExample)
	mux.HandleFunc("/api/simulate", handleSimulate(p))
	mux.HandleFunc("/api/report", handleReport)
	mux.HandleFunc("/api/import", handleImport)
	mux.HandleFunc("/api/export", handleExport)
	mux.Handle("/", http.FileServer(http.FS(static)))
	return logRequests(mux)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && !isStatic(r.URL.Path) {
			log.Printf("%s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}

func isStatic(p string) bool {
	for _, ext := range []string{".js", ".css", ".html", ".ico", ".svg", ".png", ".map"} {
		if len(p) >= len(ext) && p[len(p)-len(ext):] == ext {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func handleHealth(p *pool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ver := 0
		if epanet.Ready() {
			ver, _ = epanet.Version()
		}
		m := map[string]any{"ready": epanet.Ready(), "version": ver}
		if p != nil {
			size, idle := p.Stats()
			m["workers"] = size
			m["idle"] = idle
		}
		writeJSON(w, m)
	}
}

func handleExample(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, model.Example())
}

func handleSimulate(p *pool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		defer recoverTo(w)
		var net model.Network
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&net); err != nil {
			writeJSON(w, &model.SimResult{Error: "请求 JSON 解析失败: " + err.Error()})
			return
		}
		if len(net.Nodes) == 0 {
			writeJSON(w, &model.SimResult{Error: "管网为空：请先添加节点"})
			return
		}
		if p == nil {
			writeJSON(w, RunSimulation(&net))
			return
		}
		writeJSON(w, p.Submit(&net))
	}
}

func handleReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	defer recoverTo(w)
	var net model.Network
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&net); err != nil {
		writeJSON(w, &model.SimResult{Error: "请求 JSON 解析失败: " + err.Error()})
		return
	}
	if len(net.Nodes) == 0 {
		writeJSON(w, &model.SimResult{Error: "管网为空：请先添加节点"})
		return
	}
	writeJSON(w, RunSimulationReport(&net))
}

func handleImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		http.Error(w, "读取失败", http.StatusBadRequest)
		return
	}
	net := model.ParseINP(string(body))
	writeJSON(w, net)
}

func handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var net model.Network
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&net); err != nil {
		http.Error(w, "JSON 解析失败: "+err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="network.inp"`)
	_, _ = io.WriteString(w, net.ToINP())
}

func recoverTo(w http.ResponseWriter) {
	if rec := recover(); rec != nil {
		log.Printf("handler panic: %v", rec)
		writeJSON(w, &model.SimResult{Error: "服务器内部错误"})
	}
}