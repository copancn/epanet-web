// Command epanet-web starts a local web server that lets users draw a water
// distribution network in the browser and run EPANET hydraulic simulations.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"epanet-web/epanet"
	"epanet-web/server"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8770", "HTTP 监听地址")
	dllFlag := flag.String("dll", "", "epanet2.dll 路径（默认自动查找）")
	flag.Parse()

	dllPath := resolveDLL(*dllFlag)
	if err := epanet.Init(dllPath); err != nil {
		log.Fatalf("初始化 EPANET 失败: %v", err)
	}
	ver, _ := epanet.Version()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("加载 web 资源失败: %v", err)
	}

	fmt.Printf("EPANET 引擎版本: %d\n", ver)
	fmt.Printf("DLL: %s\n", dllPath)
	fmt.Printf("管网水力模拟服务已启动: http://%s\n", *addr)

	srv := &http.Server{Addr: *addr, Handler: server.New(sub)}
	log.Fatal(srv.ListenAndServe())
}

// resolveDLL finds epanet2.dll: explicit flag, next to the executable, in the
// working directory, then the known SDK location.
func resolveDLL(flagVal string) string {
	var candidates []string
	if flagVal != "" {
		candidates = append(candidates, flagVal)
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "epanet2.dll"))
	}
	candidates = append(candidates, "epanet2.dll", `G:\epanet\64bit\epanet2.dll`)
	for _, c := range candidates {
		if abs, err := filepath.Abs(c); err == nil {
			if _, err := os.Stat(abs); err == nil {
				return abs
			}
		}
	}
	return "epanet2.dll"
}