// Command epanet-web starts a local web server that lets users draw a water
// distribution network in the browser and run EPANET hydraulic simulations.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"time"

	"epanet-web/epanet"
	"epanet-web/pool"
	"epanet-web/server"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8770", "HTTP 监听地址")
	dllFlag := flag.String("dll", "", "epanet2.dll 路径（默认自动查找）")
	workers := flag.Int("workers", defaultWorkers(), "模拟工作进程数（并发模拟路数）")
	workerMode := flag.Bool("worker", false, "内部使用：以模拟工作进程模式运行")
	flag.Parse()

	dllPath := resolveDLL(*dllFlag)

	// Worker subprocess: serve simulations over stdin/stdout, no HTTP.
	if *workerMode {
		pool.RunWorker(dllPath, server.RunSimulation)
		return
	}

	if err := epanet.Init(dllPath); err != nil {
		log.Fatalf("初始化 EPANET 失败: %v", err)
	}
	ver, _ := epanet.Version()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("加载 web 资源失败: %v", err)
	}

	p, err := pool.New(*workers, dllPath)
	if err != nil {
		log.Fatalf("启动模拟进程池失败: %v", err)
	}

	srv := &http.Server{Addr: *addr, Handler: server.New(sub, p)}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务失败: %v", err)
		}
	}()

	fmt.Printf("EPANET 引擎版本: %d\n", ver)
	fmt.Printf("DLL: %s\n", dllPath)
	fmt.Printf("模拟工作进程: %d\n", *workers)
	fmt.Printf("管网水力模拟服务已启动: http://%s\n", *addr)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	<-sig
	fmt.Println("正在关闭…")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	p.Close()
}

// defaultWorkers picks a parallelism level from the CPU count, capped at 8.
func defaultWorkers() int {
	n := runtime.NumCPU()
	if n > 8 {
		n = 8
	}
	if n < 1 {
		n = 1
	}
	return n
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