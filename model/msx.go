package model

import (
	"fmt"
	"strings"
)

// MSXConfig is the multi-species (EPANET-MSX) chemistry configuration. It is
// opt-in: a nil/disabled config leaves the single-species EPANET quality path
// untouched. The whole config is rendered to a .msx file (ToMSX) which the MSX
// engine parses; node/link topology is mirrored from the open EPANET network.
type MSXConfig struct {
	Enabled   bool         `json:"enabled"`
	Title     string       `json:"title,omitempty"`
	Options   MSXOptions   `json:"options"`
	Species   []MSXSpecies `json:"species"`
	Coeffs    []MSXCoeff   `json:"coeffs,omitempty"`
	Terms     []MSXTerm    `json:"terms,omitempty"`
	PipeRate  []MSXRate    `json:"pipeRate,omitempty"`
	PipeEquil []MSXRate    `json:"pipeEquil,omitempty"`
	TankRate  []MSXRate    `json:"tankRate,omitempty"`
	TankEquil []MSXRate    `json:"tankEquil,omitempty"`
	Sources   []MSXSource  `json:"sources,omitempty"`
	Quality   []MSXQuality `json:"quality,omitempty"`
	Params    []MSXParam   `json:"params,omitempty"`
	Report    MSXReport    `json:"report,omitempty"`
}

// MSXOptions maps the .msx [OPTIONS] section. Empty/zero fields are omitted so
// the engine falls back to its defaults (and EPANET's quality timestep).
type MSXOptions struct {
	AreaUnits string  `json:"areaUnits,omitempty"` // FT2 | M2 | CM2
	RateUnits string  `json:"rateUnits,omitempty"` // DAY | HR | MIN | SEC
	Solver    string  `json:"solver,omitempty"`    // EUL | RK5 | ROS2
	TimeStep  float64 `json:"timeStep,omitempty"`  // quality timestep (sec)
	RTol      float64 `json:"rtol,omitempty"`
	ATol      float64 `json:"atol,omitempty"`
	Coupling  string  `json:"coupling,omitempty"` // FULL | NONE
}

// MSXSpecies is one chemical species ([SPECIES]).
type MSXSpecies struct {
	ID    string  `json:"id"`
	Type  string  `json:"type"`  // BULK | WALL
	Units string  `json:"units"` // MG | UG | MOLE | MMOL
	ATol  float64 `json:"atol,omitempty"`
	RTol  float64 `json:"rtol,omitempty"`
}

// MSXCoeff is a reaction parameter or constant ([COEFFICIENTS]).
type MSXCoeff struct {
	Kind  string  `json:"kind"` // PARAMETER | CONSTANT
	ID    string  `json:"id"`
	Value float64 `json:"value"`
}

// MSXTerm is a named intermediate expression ([TERMS]).
type MSXTerm struct {
	ID   string `json:"id"`
	Expr string `json:"expr"`
}

// MSXRate is a species rate/equilibrium expression for pipes or tanks.
type MSXRate struct {
	Species string `json:"species"`
	Expr    string `json:"expr"`
}

// MSXSource is a quality source at a node ([SOURCES]).
type MSXSource struct {
	Type     string  `json:"type"` // CONC | MASS | SETPOINT | FLOWPACED
	Node     string  `json:"node"`
	Species  string  `json:"species"`
	Strength float64 `json:"strength"`
	Pattern  string  `json:"pattern,omitempty"`
}

// MSXQuality is an initial quality value ([QUALITY]).
type MSXQuality struct {
	Scope   string  `json:"scope"` // GLOBAL | NODE | LINK
	ID      string  `json:"id,omitempty"`
	Species string  `json:"species"`
	Value   float64 `json:"value"`
}

// MSXParam is a per-pipe/per-tank reaction parameter value ([PARAMETERS]).
type MSXParam struct {
	Kind  string  `json:"kind"` // PIPE | TANK
	ID    string  `json:"id"`
	Param string  `json:"param"`
	Value float64 `json:"value"`
}

// MSXReport selects nodes/links/species for the optional text report ([REPORT]).
type MSXReport struct {
	Nodes   []string `json:"nodes,omitempty"`
	Links   []string `json:"links,omitempty"`
	Species []string `json:"species,omitempty"`
}

// MSXResult is the multi-species output returned to the browser. Conc is indexed
// [species][time]; Times is the reporting timeline (aligned with SimResult.Times).
type MSXResult struct {
	Species []MSXSpeciesMeta `json:"species"`
	Times   []int64          `json:"times"`
	Nodes   []MSXNodeSeries  `json:"nodes"`
	Links   []MSXLinkSeries  `json:"links"`
}

// MSXSpeciesMeta describes a species for display.
type MSXSpeciesMeta struct {
	ID    string `json:"id"`
	Type  string `json:"type"` // BULK | WALL
	Units string `json:"units"`
}

// MSXNodeSeries holds per-species concentration time series for one node.
type MSXNodeSeries struct {
	ID    string      `json:"id"`
	Index int         `json:"index"`
	Conc  [][]float64 `json:"conc"`
}

// MSXLinkSeries holds per-species concentration time series for one link.
type MSXLinkSeries struct {
	ID    string      `json:"id"`
	Index int         `json:"index"`
	Conc  [][]float64 `json:"conc"`
}

// ToMSX renders the network's MSX config to a .msx file, or "" when MSX is absent
// or disabled. Section order follows the EPANET-MSX input format.
func (n *Network) ToMSX() string {
	if n.MSX == nil || !n.MSX.Enabled {
		return ""
	}
	return n.MSX.ToMSX()
}

// ToMSX renders the config to a .msx file.
func (c *MSXConfig) ToMSX() string {
	var b strings.Builder
	w := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }

	w("[TITLE]\n%s\n", orDefault(c.Title, "EPANET Web MSX"))

	w("\n[OPTIONS]\n")
	o := c.Options
	if o.AreaUnits != "" {
		w("AREA_UNITS\t%s\n", o.AreaUnits)
	}
	if o.RateUnits != "" {
		w("RATE_UNITS\t%s\n", o.RateUnits)
	}
	if o.Solver != "" {
		w("SOLVER\t%s\n", o.Solver)
	}
	if o.TimeStep > 0 {
		w("TIMESTEP\t%s\n", num(o.TimeStep))
	}
	if o.RTol > 0 {
		w("RTOL\t%s\n", num(o.RTol))
	}
	if o.ATol > 0 {
		w("ATOL\t%s\n", num(o.ATol))
	}
	if o.Coupling != "" {
		w("COUPLING\t%s\n", o.Coupling)
	}

	w("\n[SPECIES]\n;Type\tID\tUnits\tATol\tRTol\n")
	for _, s := range c.Species {
		w("%s\t%s\t%s\t%s\t%s\n", orDefault(s.Type, "BULK"), s.ID,
			orDefault(s.Units, "MG"), num(orFloat(s.ATol, 0.01)), num(orFloat(s.RTol, 0.001)))
	}

	if len(c.Coeffs) > 0 {
		w("\n[COEFFICIENTS]\n;Kind\tID\tValue\n")
		for _, cf := range c.Coeffs {
			w("%s\t%s\t%s\n", orDefault(cf.Kind, "PARAMETER"), cf.ID, num(cf.Value))
		}
	}
	if len(c.Terms) > 0 {
		w("\n[TERMS]\n;ID\tExpression\n")
		for _, t := range c.Terms {
			w("%s\t%s\n", t.ID, t.Expr)
		}
	}

	writeRates := func(section string, rates, equils []MSXRate) {
		if len(rates) == 0 && len(equils) == 0 {
			return
		}
		w("\n[%s]\n", section)
		for _, r := range rates {
			w("RATE\t%s\t%s\n", r.Species, r.Expr)
		}
		for _, r := range equils {
			w("EQUIL\t%s\t%s\n", r.Species, r.Expr)
		}
	}
	writeRates("PIPE", c.PipeRate, c.PipeEquil)
	writeRates("TANK", c.TankRate, c.TankEquil)

	if len(c.Sources) > 0 {
		w("\n[SOURCES]\n;Type\tNode\tSpecies\tStrength\tPattern\n")
		for _, s := range c.Sources {
			w("%s\t%s\t%s\t%s", orDefault(s.Type, "CONC"), s.Node, s.Species, num(s.Strength))
			if s.Pattern != "" {
				w("\t%s", s.Pattern)
			}
			w("\n")
		}
	}
	if len(c.Quality) > 0 {
		w("\n[QUALITY]\n;Scope\tID\tSpecies\tValue\n")
		for _, q := range c.Quality {
			if strings.EqualFold(q.Scope, "GLOBAL") {
				w("GLOBAL\t%s\t%s\n", q.Species, num(q.Value))
			} else {
				w("%s\t%s\t%s\t%s\n", strings.ToUpper(q.Scope), q.ID, q.Species, num(q.Value))
			}
		}
	}
	if len(c.Params) > 0 {
		w("\n[PARAMETERS]\n;Kind\tID\tParam\tValue\n")
		for _, p := range c.Params {
			w("%s\t%s\t%s\t%s\n", strings.ToUpper(p.Kind), p.ID, p.Param, num(p.Value))
		}
	}

	if len(c.Report.Nodes) > 0 || len(c.Report.Links) > 0 || len(c.Report.Species) > 0 {
		w("\n[REPORT]\n")
		if len(c.Report.Nodes) > 0 {
			w("NODES\t%s\n", strings.Join(c.Report.Nodes, "\t"))
		}
		if len(c.Report.Links) > 0 {
			w("LINKS\t%s\n", strings.Join(c.Report.Links, "\t"))
		}
		for _, s := range c.Report.Species {
			w("SPECIE\t%s\tYES\n", s)
		}
	}
	return b.String()
}

// Validate checks section-level integrity so a malformed config cannot produce
// a broken .msx file. It returns the first problem found, or nil.
func (c *MSXConfig) Validate() error {
	if len(c.Species) == 0 {
		return fmt.Errorf("至少需要一个物种 (species)")
	}
	known := map[string]bool{}
	for _, s := range c.Species {
		if strings.TrimSpace(s.ID) == "" {
			return fmt.Errorf("物种 ID 不能为空")
		}
		if known[s.ID] {
			return fmt.Errorf("物种 ID 重复: %s", s.ID)
		}
		known[s.ID] = true
	}
	refOK := func(sp string) bool { return known[sp] }
	for _, r := range c.PipeRate {
		if !refOK(r.Species) {
			return fmt.Errorf("PIPE RATE 引用未知物种: %s", r.Species)
		}
		if strings.TrimSpace(r.Expr) == "" {
			return fmt.Errorf("PIPE RATE %s 表达式为空", r.Species)
		}
	}
	for _, r := range c.TankRate {
		if !refOK(r.Species) {
			return fmt.Errorf("TANK RATE 引用未知物种: %s", r.Species)
		}
	}
	for _, s := range c.Sources {
		if !refOK(s.Species) {
			return fmt.Errorf("SOURCES 引用未知物种: %s", s.Species)
		}
		if strings.TrimSpace(s.Node) == "" {
			return fmt.Errorf("SOURCES 节点不能为空")
		}
	}
	for _, q := range c.Quality {
		if !refOK(q.Species) {
			return fmt.Errorf("QUALITY 引用未知物种: %s", q.Species)
		}
	}
	return nil
}

// MSXChlorinePreset returns a bulk chlorine decay chemistry skeleton (bulk +
// wall demand, turbulent mass-transfer coefficient). Sources and initial quality
// are left empty for the user to fill per network. It mirrors the EPANET-MSX
// Net2-CL2 example reaction model.
func MSXChlorinePreset() *MSXConfig {
	return &MSXConfig{
		Enabled: true,
		Title:   "Chlorine decay (bulk + wall)",
		Options: MSXOptions{
			AreaUnits: "FT2", RateUnits: "DAY", Solver: "EUL",
			TimeStep: 300, RTol: 0.001, ATol: 0.001,
		},
		Species: []MSXSpecies{{ID: "CL2", Type: "BULK", Units: "MG", ATol: 0.01, RTol: 0.001}},
		Coeffs: []MSXCoeff{
			{Kind: "PARAMETER", ID: "Kb", Value: 0.3},
			{Kind: "PARAMETER", ID: "Kw", Value: 1.0},
		},
		Terms:    []MSXTerm{{ID: "Kf", Expr: "1.5826e-4 * RE^0.88 / D"}},
		PipeRate: []MSXRate{{Species: "CL2", Expr: "-Kb*CL2 - (4/D)*Kw*Kf/(Kw+Kf)*CL2"}},
		TankRate: []MSXRate{{Species: "CL2", Expr: "-Kb*CL2"}},
	}
}