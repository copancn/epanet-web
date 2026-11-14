// Package pool runs EPANET simulations in a pool of worker subprocesses so
// that multiple simulations execute truly in parallel. The legacy EPANET DLL
// keeps global single-threaded state, so each worker process loads its own DLL
// instance and serves one simulation at a time; the pool dispatches jobs across
// workers. Communication is a newline-delimited JSON stream over stdin/stdout.
package pool

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"

	"epanet-web/epanet"
	"epanet-web/model"
	"epanet-web/msx"
)

// RunFunc executes one simulation. It is injected so that pool does not depend
// on the server package (which would create an import cycle).
type RunFunc func(*model.Network) *model.SimResult

// RunWorker is the worker-process entrypoint. It loads the DLL and serves
// requests from stdin, writing results to stdout. Diagnostics go to stderr so
// stdout stays a clean JSON stream. It returns on stdin EOF, which also happens
// when the parent process dies and its pipe closes — so workers never orphan.
func RunWorker(dllPath, msxPath string, run RunFunc) {
	serve(os.Stdin, os.Stdout, dllPath, msxPath, run)
}

func serve(in io.Reader, out io.Writer, dllPath, msxPath string, run RunFunc) {
	if err := epanet.Init(dllPath); err != nil {
		log.Printf("worker: 初始化 EPANET 失败: %v", err)
	}
	// MSX is optional: load it after EPANET (so its epanet2.dll dependency
	// resolves to the loaded module). A missing/failed MSX DLL only disables
	// multi-species runs; single-species simulations still work.
	if msxPath != "" {
		if err := msx.Init(msxPath); err != nil {
			log.Printf("worker: 初始化 EPANET-MSX 失败（多物种水质不可用）: %v", err)
		}
	}
	dec := json.NewDecoder(in)
	enc := json.NewEncoder(out)
	for {
		var net model.Network
		if err := dec.Decode(&net); err != nil {
			if err != io.EOF {
				log.Printf("worker: 读取请求失败: %v", err)
			}
			return
		}
		if err := enc.Encode(run(&net)); err != nil {
			log.Printf("worker: 写入结果失败: %v", err)
			return
		}
	}
}

// worker is one long-lived subprocess with a JSON request/response stream.
type worker struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	enc   *json.Encoder
	dec   *json.Decoder
}

func (w *worker) kill() {
	_ = w.stdin.Close()
	if w.cmd.Process != nil {
		_ = w.cmd.Process.Kill()
	}
	_ = w.cmd.Wait()
}

// Pool dispatches simulations across a fixed set of worker subprocesses.
type Pool struct {
	exePath string
	dllPath string
	msxPath string
	size    int

	idle chan *worker
	done chan struct{}

	mu     sync.Mutex // guards closed and nextID
	closed bool
	nextID int
	wg     sync.WaitGroup // in-flight Submit calls
}

// New starts size worker subprocesses. size is clamped to at least 1. msxPath
// may be empty to disable multi-species (MSX) chemistry in the workers.
func New(size int, dllPath, msxPath string) (*Pool, error) {
	if size < 1 {
		size = 1
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("解析可执行文件路径失败: %w", err)
	}
	p := &Pool{
		exePath: exe,
		dllPath: dllPath,
		msxPath: msxPath,
		size:    size,
		idle:    make(chan *worker, size),
		done:    make(chan struct{}),
	}
	for i := 0; i < size; i++ {
		w, err := p.spawn()
		if err != nil {
			p.Close()
			return nil, fmt.Errorf("启动工作进程 %d 失败: %w", i+1, err)
		}
		p.idle <- w
	}
	return p, nil
}

// spawn starts one worker. Callers hold p.mu (or are in single-threaded New).
func (p *Pool) spawn() (*worker, error) {
	p.nextID++
	cmd := exec.Command(p.exePath, "-worker", "-dll", p.dllPath, "-msxdll", p.msxPath)
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, err
	}
	return &worker{
		cmd:   cmd,
		stdin: stdin,
		enc:   json.NewEncoder(stdin),
		dec:   json.NewDecoder(stdout),
	}, nil
}

// Submit runs a simulation on an idle worker, blocking while all workers are
// busy (natural backpressure). A worker that dies mid-job is replaced and the
// caller receives an error result.
func (p *Pool) Submit(net *model.Network) *model.SimResult {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return &model.SimResult{Error: "模拟进程池已关闭"}
	}
	p.wg.Add(1)
	p.mu.Unlock()
	defer p.wg.Done()

	var w *worker
	select {
	case <-p.done:
		return &model.SimResult{Error: "模拟进程池已关闭"}
	case w = <-p.idle:
	}

	res := p.exchange(w, net)
	if res == nil {
		p.respawn()
		return &model.SimResult{Error: "模拟工作进程异常退出，已自动重启，请重试"}
	}
	select {
	case p.idle <- w:
	case <-p.done:
		w.kill()
	}
	return res
}

// exchange sends the request and reads the response. Returns nil on IO error,
// having killed the worker.
func (p *Pool) exchange(w *worker, net *model.Network) *model.SimResult {
	if err := w.enc.Encode(net); err != nil {
		w.kill()
		return nil
	}
	var res model.SimResult
	if err := w.dec.Decode(&res); err != nil {
		w.kill()
		return nil
	}
	return &res
}

// respawn replaces a dead worker, keeping the pool at its configured size.
func (p *Pool) respawn() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	w, err := p.spawn()
	if err != nil {
		log.Printf("pool: 重启工作进程失败: %v", err)
		return
	}
	select {
	case p.idle <- w:
	case <-p.done:
		w.kill()
	}
}

// Stats reports the configured worker count and how many are currently idle.
func (p *Pool) Stats() (size, idle int) {
	return p.size, len(p.idle)
}

// Close stops accepting jobs, waits for in-flight simulations to finish, then
// terminates all workers. Safe to call multiple times.
func (p *Pool) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	p.mu.Unlock()

	close(p.done)
	p.wg.Wait()
	for {
		select {
		case w := <-p.idle:
			w.kill()
		default:
			return
		}
	}
}