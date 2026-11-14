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
	"epanet-web/msx"
	"epanet-web/pool"
	"epanet-web/server"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8770", "HTTP 监听地址")
	dllFlag := flag.String("dll", "", "epanet2.dll 路径（默认自动查找）")
	msxdllFlag := flag.String("msxdll", "", "epanetmsx.dll 路径（多物种水质，默认自动查找；缺失则禁用）")
	workers := flag.Int("workers", defaultWorkers(), "模拟工作进程数（并发模拟路数）")
	workerMode := flag.Bool("worker", false, "内部使用：以模拟工作进程模式运行")
	flag.Parse()

	dllPath := resolveDLL(*dllFlag)
	msxPath := resolveMSXDLL(*msxdllFlag)

	// Worker subprocess: serve simulations over stdin/stdout, no HTTP.
	if *workerMode {
		pool.RunWorker(dllPath, msxPath, server.RunSimulation)
		return
	}

	if err := epanet.Init(dllPath); err != nil {
		log.Fatalf("初始化 EPANET 失败: %v", err)
	}
	ver, _ := epanet.Version()
	// MSX is optional; load it after EPANET so its dependency resolves. The
	// parent also runs simulations directly when the pool is nil (/api/report).
	if msxPath != "" {
		if err := msx.Init(msxPath); err != nil {
			log.Printf("初始化 EPANET-MSX 失败（多物种水质不可用）: %v", err)
		}
	}

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("加载 web 资源失败: %v", err)
	}

	p, err := pool.New(*workers, dllPath, msxPath)
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
	if msx.Ready() {
		fmt.Printf("MSX: %s（多物种水质已启用）\n", msxPath)
	} else {
		fmt.Println("MSX: 未加载（多物种水质不可用）")
	}
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

// resolveMSXDLL finds epanetmsx.dll: explicit flag, next to the executable, in
// the working directory, then the known build location. Returns "" when absent
// so multi-species chemistry is gracefully disabled (EPANET still works).
func resolveMSXDLL(flagVal string) string {
	var candidates []string
	if flagVal != "" {
		candidates = append(candidates, flagVal)
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "epanetmsx.dll"))
	}
	candidates = append(candidates, "epanetmsx.dll", `E:\msx-main\build-mingw\epanetmsx.dll`)
	for _, c := range candidates {
		if abs, err := filepath.Abs(c); err == nil {
			if _, err := os.Stat(abs); err == nil {
				return abs
			}
		}
	}
	return ""
}