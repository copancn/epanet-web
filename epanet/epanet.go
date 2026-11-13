// Package epanet provides a pure-Go (no cgo) binding to the EPANET 2.x
// shared library on Windows via syscall. Only pointer/int based toolkit
// functions are used; network data is supplied through an INP file so that
// no single-precision float is ever passed by value (which the Windows x64
// syscall ABI cannot marshal correctly).
//
// The legacy EPANET API keeps global, single-threaded state. Callers MUST
// serialize an entire open->solve->read->close sequence with Lock/Unlock.
package epanet

import (
	"fmt"
	"math"
	"sync"
	"syscall"
	"unsafe"
)

// ---- enum constants (subset used by this project) ----

// Object count types.
const (
	NodeCount  = 0
	TankCount  = 1
	LinkCount  = 2
	PatCount   = 3
	CurveCount = 4
)

// Node types.
const (
	Junction  = 0
	Reservoir = 1
	Tank      = 2
)

// Link types.
const (
	CVPipe = 0
	Pipe   = 1
	Pump   = 2
	PRV    = 3
	PSV    = 4
	PBV    = 5
	FCV    = 6
	TCV    = 7
	GPV    = 8
	PCV    = 9
)

// Node properties.
const (
	NElevation  = 0
	NBaseDemand = 1
	NPattern    = 2
	NTankLevel  = 8
	NDemand     = 9
	NHead       = 10
	NPressure   = 11
	NQuality    = 12
	NInitVolume = 14
	NTankDiam   = 17
	NMinVolume  = 18
	NMinLevel   = 20
	NMaxLevel   = 21
	NTankVolume = 24
	NMaxVolume  = 25
)

// Link properties.
const (
	LDiameter   = 0
	LLength     = 1
	LRoughness  = 2
	LMinorLoss  = 3
	LInitStatus = 4
	LInitSet    = 5
	LFlow       = 8
	LVelocity   = 9
	LHeadLoss   = 10
	LStatus     = 11
	LSetting    = 12
	LEnergy     = 13
	LQuality    = 14
	LPumpState  = 16
	LPumpPower  = 18
)

// Time parameters.
const (
	TDuration    = 0
	THydStep     = 1
	TQualStep    = 2
	TPatternStep = 3
	TPatternStart = 4
	TReportStep  = 5
	TReportStart = 6
	TStatistic   = 8
	TPeriods     = 9
	TStartTime   = 10
	THTime       = 11
)

// Init flags for ENinitH.
const (
	NoSave       = 0
	Save         = 1
	InitFlow     = 10
	SaveAndInit  = 11
)

const maxID = 32
const maxMsg = 256

// ---- global state ----

var (
	mu      sync.Mutex
	dll     *syscall.LazyDLL
	procs   map[string]*syscall.LazyProc
	initErr error
	inited  bool
)

// Lock acquires the global EPANET lock. The legacy API is single threaded,
// so an entire simulation must run while holding this lock.
func Lock() { mu.Lock() }

// Unlock releases the global EPANET lock.
func Unlock() { mu.Unlock() }

var procNames = []string{
	"ENopen", "ENclose", "ENgetversion", "ENgeterror", "ENsaveinpfile", "ENgettitle",
	"ENsolveH", "ENsaveH", "ENopenH", "ENinitH", "ENrunH", "ENnextH", "ENcloseH",
	"ENsolveQ", "ENopenQ", "ENinitQ", "ENrunQ", "ENnextQ", "ENcloseQ",
	"ENgetcount", "ENgetnodeid", "ENgetlinkid", "ENgetnodetype", "ENgetlinktype",
	"ENgetnodeindex", "ENgetlinkindex", "ENgetlinknodes", "ENgetcoord",
	"ENgetnodevalue", "ENgetlinkvalue", "ENgetflowunits", "ENgettimeparam",
	"ENgetoption", "ENreport", "ENgetqualtype",
}

// Init loads the EPANET shared library from dllPath. It is safe to call once
// at startup. Subsequent calls are ignored.
func Init(dllPath string) error {
	if inited {
		return initErr
	}
	inited = true
	dll = syscall.NewLazyDLL(dllPath)
	if err := dll.Load(); err != nil {
		initErr = fmt.Errorf("load epanet dll %q: %w", dllPath, err)
		return initErr
	}
	procs = make(map[string]*syscall.LazyProc, len(procNames))
	for _, n := range procNames {
		p := dll.NewProc(n)
		if err := p.Find(); err != nil {
			initErr = fmt.Errorf("epanet export %q not found: %w", n, err)
			return initErr
		}
		procs[n] = p
	}
	return nil
}

// Ready reports whether the library was loaded successfully.
func Ready() bool { return inited && initErr == nil }

func p(name string) *syscall.LazyProc { return procs[name] }

// cstr returns a pointer to a NUL-terminated copy of s suitable for passing
// directly inside a Call expression.
func cstr(s string) uintptr {
	b := append([]byte(s), 0)
	return uintptr(unsafe.Pointer(&b[0]))
}

func goStr(b []byte) string {
	n := 0
	for n < len(b) && b[n] != 0 {
		n++
	}
	return string(b[:n])
}

// errFor converts an EPANET return code into a Go error (nil for 0).
func errFor(code int) error {
	if code == 0 {
		return nil
	}
	buf := make([]byte, maxMsg)
	p("ENgeterror").Call(uintptr(code), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	msg := goStr(buf)
	if msg == "" {
		msg = fmt.Sprintf("EPANET error code %d", code)
	}
	return fmt.Errorf("[%d] %s", code, msg)
}

func call(name string, args ...uintptr) error {
	r, _, _ := p(name).Call(args...)
	return errFor(int(r))
}

// solveCall runs a solver function, treating codes < 100 as non-fatal warnings.
func solveCall(name string, args ...uintptr) (warning string, err error) {
	r, _, _ := p(name).Call(args...)
	code := int(r)
	if code == 0 {
		return "", nil
	}
	msg := errFor(code).Error()
	if code < 100 {
		return msg, nil
	}
	return "", errFor(code)
}

// ---- project functions ----

func Open(inp, rpt, out string) error { return call("ENopen", cstr(inp), cstr(rpt), cstr(out)) }
func Close() error                    { return call("ENclose") }
func SaveInp(path string) error       { return call("ENsaveinpfile", cstr(path)) }
func Report() error                   { return call("ENreport") }

func Version() (int, error) {
	var v int32
	err := call("ENgetversion", uintptr(unsafe.Pointer(&v)))
	return int(v), err
}

func Title() (string, string, string, error) {
	a := make([]byte, maxMsg)
	b := make([]byte, maxMsg)
	c := make([]byte, maxMsg)
	err := call("ENgettitle", uintptr(unsafe.Pointer(&a[0])), uintptr(unsafe.Pointer(&b[0])), uintptr(unsafe.Pointer(&c[0])))
	return goStr(a), goStr(b), goStr(c), err
}

// ---- hydraulic functions ----

func SolveH() (string, error) { return solveCall("ENsolveH") }
func SaveH() error            { return call("ENsaveH") }
func OpenH() error            { return call("ENopenH") }
func InitH(flag int) error    { return call("ENinitH", uintptr(flag)) }
func CloseH() error           { return call("ENcloseH") }

func RunH() (int64, error) {
	var t int32
	r, _, _ := p("ENrunH").Call(uintptr(unsafe.Pointer(&t)))
	code := int(r)
	if code >= 100 {
		return int64(t), errFor(code)
	}
	return int64(t), nil
}

func NextH() (int64, error) {
	var dt int32
	err := call("ENnextH", uintptr(unsafe.Pointer(&dt)))
	return int64(dt), err
}

// ---- quality functions ----

func SolveQ() (string, error) { return solveCall("ENsolveQ") }
func OpenQ() error            { return call("ENopenQ") }
func InitQ(flag int) error    { return call("ENinitQ", uintptr(flag)) }
func CloseQ() error           { return call("ENcloseQ") }

func RunQ() (int64, error) {
	var t int32
	r, _, _ := p("ENrunQ").Call(uintptr(unsafe.Pointer(&t)))
	code := int(r)
	if code >= 100 {
		return int64(t), errFor(code)
	}
	return int64(t), nil
}

func NextQ() (int64, error) {
	var dt int32
	err := call("ENnextQ", uintptr(unsafe.Pointer(&dt)))
	return int64(dt), err
}

// ---- inventory functions ----

func Count(obj int) (int, error) {
	var n int32
	err := call("ENgetcount", uintptr(obj), uintptr(unsafe.Pointer(&n)))
	return int(n), err
}

func NodeID(idx int) (string, error) {
	buf := make([]byte, maxID)
	err := call("ENgetnodeid", uintptr(idx), uintptr(unsafe.Pointer(&buf[0])))
	return goStr(buf), err
}

func LinkID(idx int) (string, error) {
	buf := make([]byte, maxID)
	err := call("ENgetlinkid", uintptr(idx), uintptr(unsafe.Pointer(&buf[0])))
	return goStr(buf), err
}

func NodeType(idx int) (int, error) {
	var t int32
	err := call("ENgetnodetype", uintptr(idx), uintptr(unsafe.Pointer(&t)))
	return int(t), err
}

func LinkType(idx int) (int, error) {
	var t int32
	err := call("ENgetlinktype", uintptr(idx), uintptr(unsafe.Pointer(&t)))
	return int(t), err
}

func LinkNodes(idx int) (int, int, error) {
	var a, b int32
	err := call("ENgetlinknodes", uintptr(idx), uintptr(unsafe.Pointer(&a)), uintptr(unsafe.Pointer(&b)))
	return int(a), int(b), err
}

func Coord(idx int) (float64, float64, error) {
	var xb, yb uint64
	err := call("ENgetcoord", uintptr(idx), uintptr(unsafe.Pointer(&xb)), uintptr(unsafe.Pointer(&yb)))
	return math.Float64frombits(xb), math.Float64frombits(yb), err
}

func NodeValue(idx, prop int) (float64, error) {
	var fb uint32
	err := call("ENgetnodevalue", uintptr(idx), uintptr(prop), uintptr(unsafe.Pointer(&fb)))
	return float64(math.Float32frombits(fb)), err
}

func LinkValue(idx, prop int) (float64, error) {
	var fb uint32
	err := call("ENgetlinkvalue", uintptr(idx), uintptr(prop), uintptr(unsafe.Pointer(&fb)))
	return float64(math.Float32frombits(fb)), err
}

func FlowUnits() (int, error) {
	var u int32
	err := call("ENgetflowunits", uintptr(unsafe.Pointer(&u)))
	return int(u), err
}

func TimeParam(param int) (int64, error) {
	var v int32
	err := call("ENgettimeparam", uintptr(param), uintptr(unsafe.Pointer(&v)))
	return int64(v), err
}

func QualType() (int, int, error) {
	var qt, tn int32
	err := call("ENgetqualtype", uintptr(unsafe.Pointer(&qt)), uintptr(unsafe.Pointer(&tn)))
	return int(qt), int(tn), err
}