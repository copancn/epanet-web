// Package msx provides a pure-Go (no cgo) read-only binding to the classic
// EPANET-MSX 1.1 shared library on Windows via syscall. Only pointer/int based
// toolkit functions are used; multi-species chemistry is supplied through a
// .msx file and hydraulics through an EPANET .hyd file, so no float is ever
// passed by value (which the Windows x64 syscall ABI cannot marshal correctly).
//
// The classic MSX API keeps global state and mirrors the currently open EPANET
// network. Callers MUST hold epanet.Lock() across the entire
// open -> usehydfile -> solve -> read -> close sequence, and EPANET must already
// be open (ENopen) when Open is called. This package deliberately has no lock of
// its own: MSX and EPANET share one global network state and one critical section.
package msx

import (
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

// Object type codes (classic epanetmsx.h). Node/Link indices are EPANET's;
// MSXgetcount/MSXgetindex only cover the MSX-defined object types.
const (
	Node      = 0
	Link      = 1
	Tank      = 2
	Species   = 3
	Term      = 4
	Parameter = 5
	Constant  = 6
	Pattern   = 7
)

// Species type codes.
const (
	Bulk = 0
	Wall = 1
)

const maxID = 32
const maxMsg = 256
const maxUnits = 16

var (
	mu      sync.Mutex // guards initialization only
	dll     *syscall.LazyDLL
	procs   map[string]*syscall.LazyProc
	initErr error
	inited  bool
)

var procNames = []string{
	"MSXopen", "MSXclose", "MSXsolveH", "MSXusehydfile", "MSXsolveQ",
	"MSXinit", "MSXstep", "MSXgetcount", "MSXgetindex", "MSXgetID", "MSXgetspecies",
	"MSXgetqual", "MSXgeterror", "MSXreport", "MSXsaveoutfile",
}

// Init loads the EPANET-MSX shared library from dllPath. It is safe to call once
// at startup; subsequent calls are ignored. epanet2.dll must already be loaded
// (epanet.Init) so MSX's dependency resolves to the loaded module.
func Init(dllPath string) error {
	mu.Lock()
	defer mu.Unlock()
	if inited {
		return initErr
	}
	inited = true
	dll = syscall.NewLazyDLL(dllPath)
	if err := dll.Load(); err != nil {
		initErr = fmt.Errorf("load msx dll %q: %w", dllPath, err)
		return initErr
	}
	procs = make(map[string]*syscall.LazyProc, len(procNames))
	for _, n := range procNames {
		p := dll.NewProc(n)
		if err := p.Find(); err != nil {
			initErr = fmt.Errorf("msx export %q not found: %w", n, err)
			return initErr
		}
		procs[n] = p
	}
	return nil
}

// Ready reports whether the library was loaded successfully.
func Ready() bool { return inited && initErr == nil }

func p(name string) *syscall.LazyProc { return procs[name] }

func cstr(s string) *byte {
	b := append([]byte(s), 0)
	return &b[0]
}

func goStr(b []byte) string {
	n := 0
	for n < len(b) && b[n] != 0 {
		n++
	}
	return string(b[:n])
}

func errFor(code int) error {
	if code == 0 {
		return nil
	}
	buf := make([]byte, maxMsg)
	p("MSXgeterror").Call(uintptr(code), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	msg := goStr(buf)
	if msg == "" {
		msg = fmt.Sprintf("MSX error code %d", code)
	}
	return fmt.Errorf("[%d] %s", code, msg)
}

func call(name string, args ...uintptr) error {
	r, _, _ := p(name).Call(args...)
	return errFor(int(r))
}

// ---- project functions ----

// Open reads a .msx file and mirrors the currently open EPANET network.
func Open(msxFile string) error {
	ps := cstr(msxFile)
	err := call("MSXopen", uintptr(unsafe.Pointer(ps)))
	runtime.KeepAlive(ps)
	return err
}
func Close() error { return call("MSXclose") }

// UseHydFile registers an EPANET binary hydraulics file with MSX.
func UseHydFile(hydFile string) error {
	ps := cstr(hydFile)
	err := call("MSXusehydfile", uintptr(unsafe.Pointer(ps)))
	runtime.KeepAlive(ps)
	return err
}

// SolveH runs EPANET hydraulics internally and registers the result.
func SolveH() error { return call("MSXsolveH") }

// SolveQ runs the multi-species analysis over the whole period (init + step loop).
func SolveQ() error { return call("MSXsolveQ") }

// InitQual initializes the analysis; save=1 writes a binary output file, 0 does not.
func InitQual(save int) error { return call("MSXinit", uintptr(save)) }

// Report writes the requested results to the EPANET report file.
func Report() error { return call("MSXreport") }

// Step advances one quality timestep, returning current time and time left (sec).
func Step() (t, tleft int64, err error) {
	var a, b int32
	e := call("MSXstep", uintptr(unsafe.Pointer(&a)), uintptr(unsafe.Pointer(&b)))
	return int64(a), int64(b), e
}

// ---- inventory functions ----

// SpeciesCount returns the number of chemical species defined in the .msx file.
func SpeciesCount() (int, error) {
	var n int32
	e := call("MSXgetcount", uintptr(Species), uintptr(unsafe.Pointer(&n)))
	return int(n), e
}

// SpeciesIndex returns the base-1 index of a named species.
func SpeciesIndex(id string) (int, error) {
	ps := cstr(id)
	var n int32
	e := call("MSXgetindex", uintptr(Species), uintptr(unsafe.Pointer(ps)), uintptr(unsafe.Pointer(&n)))
	runtime.KeepAlive(ps)
	return int(n), e
}

// ID returns the name of the object at base-1 index idx (Species/Constant/
// Parameter/Pattern only — node/link IDs come from EPANET).
func ID(objType, idx int) (string, error) {
	buf := make([]byte, maxID)
	e := call("MSXgetID", uintptr(objType), uintptr(idx), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return goStr(buf), e
}

// SpeciesInfo describes one chemical species.
type SpeciesInfo struct {
	Type  int    // Bulk (0) or Wall (1)
	Units string // mass units, e.g. MG
	ATol  float64
	RTol  float64
}

// SpeciesAt reads the attributes of the species at base-1 index idx.
func SpeciesAt(idx int) (SpeciesInfo, error) {
	var t int32
	units := make([]byte, maxUnits)
	var a, r float64
	e := call("MSXgetspecies", uintptr(idx), uintptr(unsafe.Pointer(&t)),
		uintptr(unsafe.Pointer(&units[0])), uintptr(unsafe.Pointer(&a)), uintptr(unsafe.Pointer(&r)))
	return SpeciesInfo{Type: int(t), Units: goStr(units), ATol: a, RTol: r}, e
}

// Qual reads the current concentration of a species at a node (objType=Node) or
// link (objType=Link). idx is the EPANET base-1 object index; species is base-1.
func Qual(objType, idx, species int) (float64, error) {
	var v float64
	e := call("MSXgetqual", uintptr(objType), uintptr(idx), uintptr(species), uintptr(unsafe.Pointer(&v)))
	return v, e
}