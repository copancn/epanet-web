package model

import "strings"

// Msg is a localizable status message returned to the web UI. The backend emits
// a stable Code (plus optional interpolation Args and a raw technical Detail);
// the frontend maps Code to the active language through i18n. No display
// language is baked into Go — the web layer owns all localization.
type Msg struct {
	Code   string   `json:"code"`
	Args   []string `json:"args,omitempty"`
	Detail string   `json:"detail,omitempty"`
}

// NewMsg builds a message from a code and optional interpolation arguments.
func NewMsg(code string, args ...string) *Msg { return &Msg{Code: code, Args: args} }

// WithDetail attaches raw technical detail (engine / OS error text) that is
// shown verbatim rather than translated.
func (m *Msg) WithDetail(detail string) *Msg { m.Detail = detail; return m }

// ErrMsg builds a message whose detail is err's text (nil-safe).
func ErrMsg(code string, err error) *Msg {
	m := NewMsg(code)
	if err != nil {
		m.Detail = err.Error()
	}
	return m
}

// String renders a compact, language-neutral form for logs and tests.
func (m *Msg) String() string {
	if m == nil {
		return "<nil>"
	}
	var b strings.Builder
	b.WriteString(m.Code)
	if len(m.Args) > 0 {
		b.WriteString("[" + strings.Join(m.Args, ",") + "]")
	}
	if m.Detail != "" {
		b.WriteString(": " + m.Detail)
	}
	return b.String()
}

// Status codes emitted to the web UI. The frontend i18n dictionary must define a
// zh and en string for each code.
const (
	// Fatal simulation / request errors (SimResult.Error or HTTP error body).
	ErrEngineNotLoaded = "err.engineNotLoaded"
	ErrTempDir         = "err.tempDir"
	ErrWriteInp        = "err.writeInp"
	ErrOpenNet         = "err.openNet"
	ErrInventory       = "err.inventory"
	ErrSolveH          = "err.solveH"
	ErrSaveH           = "err.saveH"
	ErrReadSeries      = "err.readSeries"
	ErrBadJSON         = "err.badJson"
	ErrEmptyNet        = "err.emptyNet"
	ErrInternal        = "err.internal"
	ErrPostRequired    = "err.postRequired"
	ErrReadBody        = "err.readBody"
	ErrPoolClosed      = "err.poolClosed"
	ErrWorkerRestarted = "err.workerRestarted"

	// Non-fatal warnings (SimResult.Warnings).
	WarnHydraulic      = "warn.hydraulic"
	WarnQuality        = "warn.quality"
	WarnReport         = "warn.report"
	WarnMSXWrite       = "warn.msxWrite"
	WarnMSXSaveHyd     = "warn.msxSaveHyd"
	WarnMSXNotLoaded   = "warn.msxNotLoaded"
	WarnMSXOpen        = "warn.msxOpen"
	WarnMSXUseHyd      = "warn.msxUseHyd"
	WarnMSXSpeciesCnt  = "warn.msxSpeciesCount"
	WarnMSXNoSpecies   = "warn.msxNoSpecies"
	WarnMSXSpeciesAttr = "warn.msxSpeciesAttr"
	WarnMSXInit        = "warn.msxInit"
	WarnMSXStep        = "warn.msxStep"

	// MSX configuration validation (surfaced as warnings).
	MSXErrNoSpecies       = "msx.errNoSpecies"
	MSXErrSpeciesIDEmpty  = "msx.errSpeciesIdEmpty"
	MSXErrSpeciesIDDup    = "msx.errSpeciesIdDup"
	MSXErrPipeRateSpecies = "msx.errPipeRateSpecies"
	MSXErrPipeRateEmpty   = "msx.errPipeRateEmpty"
	MSXErrTankRateSpecies = "msx.errTankRateSpecies"
	MSXErrSourceSpecies   = "msx.errSourceSpecies"
	MSXErrSourceNodeEmpty = "msx.errSourceNodeEmpty"
	MSXErrQualitySpecies  = "msx.errQualitySpecies"

	// Example network title (localized by the frontend when the example loads).
	ExampleTitle = "example.title"
)