// Package model defines the water-network data model shared with the web UI,
// plus generation and parsing of EPANET INP files.
package model

import (
	"fmt"
	"strconv"
	"strings"
)

// Network is a complete EPANET project as edited in the browser.
type Network struct {
	Title    string    `json:"title"`
	Nodes    []Node    `json:"nodes"`
	Links    []Link    `json:"links"`
	Patterns []Pattern `json:"patterns"`
	Curves   []Curve   `json:"curves"`
	Controls []string  `json:"controls"`
	Options  Options   `json:"options"`
	Times    Times     `json:"times"`
	Quality  Quality   `json:"quality"`
}

// Node is a junction, reservoir or tank.
type Node struct {
	ID   string  `json:"id"`
	Type string  `json:"type"` // JUNCTION | RESERVOIR | TANK
	X    float64 `json:"x"`
	Y    float64 `json:"y"`

	// Junction
	Elevation float64 `json:"elevation"`
	Demand    float64 `json:"demand"`
	DemandPat string  `json:"demandPattern"`

	// Reservoir
	Head    float64 `json:"head"`
	HeadPat string  `json:"headPattern"`

	// Tank
	InitLevel float64 `json:"initLevel"`
	MinLevel  float64 `json:"minLevel"`
	MaxLevel  float64 `json:"maxLevel"`
	Diameter  float64 `json:"diameter"`
	MinVol    float64 `json:"minVol"`
	VolCurve  string  `json:"volCurve"`

	// Initial water quality (optional)
	InitQual float64 `json:"initQual"`
}

// Link is a pipe, pump or valve.
type Link struct {
	ID   string `json:"id"`
	Type string `json:"type"` // PIPE | PUMP | PRV | PSV | PBV | FCV | TCV | GPV
	From string `json:"from"`
	To   string `json:"to"`

	// Pipe
	Length    float64 `json:"length"`
	Diameter  float64 `json:"diameter"`
	Roughness float64 `json:"roughness"`
	MinorLoss float64 `json:"minorLoss"`
	Status    string  `json:"status"` // OPEN | CLOSED | CV

	// Pump
	Power     float64 `json:"power"`
	HeadCurve string  `json:"headCurve"`
	Speed     float64 `json:"speed"`
	SpeedPat  string  `json:"speedPattern"`

	// Valve
	Setting float64 `json:"setting"`

	Vertices []Point `json:"vertices"`
}

// Point is an X/Y coordinate.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Pattern is a time pattern of demand multipliers.
type Pattern struct {
	ID     string    `json:"id"`
	Values []float64 `json:"values"`
}

// Curve is a data curve (e.g. a pump head/flow curve).
type Curve struct {
	ID     string  `json:"id"`
	Type   string  `json:"type"` // PUMP | EFFICIENCY | VOLUME | HEADLOSS | GENERIC
	Points []Point `json:"points"`
}

// Options are network-wide analysis options.
type Options struct {
	FlowUnits  string  `json:"flowUnits"` // LPS | LPM | MLD | CMH | CMD | CMS | CFS | GPM | MGD | IMGD | AFD
	HeadLoss   string  `json:"headLoss"`  // H-W | D-W | C-M
	DemandMult float64 `json:"demandMult"`
	Trials     int     `json:"trials"`
	Accuracy   float64 `json:"accuracy"`
	Tolerance  float64 `json:"tolerance"`
	Unbalanced int     `json:"unbalanced"`
}

// Times holds simulation time parameters, all in seconds.
type Times struct {
	Duration     int    `json:"duration"`
	HydStep      int    `json:"hydStep"`
	QualStep     int    `json:"qualStep"`
	PatternStep  int    `json:"patternStep"`
	PatternStart int    `json:"patternStart"`
	ReportStep   int    `json:"reportStep"`
	ReportStart  int    `json:"reportStart"`
	StartClock   int    `json:"startClock"`
	Statistic    string `json:"statistic"` // NONE | AVERAGED | MINIMUM | MAXIMUM | RANGE
}

// Quality selects the water-quality analysis mode.
type Quality struct {
	Type      string `json:"type"` // NONE | CHEM | AGE | TRACE
	ChemName  string `json:"chemName"`
	ChemUnits string `json:"chemUnits"`
	TraceNode string `json:"traceNode"`
}

// DefaultOptions returns sensible metric defaults.
func DefaultOptions() Options {
	return Options{
		FlowUnits:  "LPS",
		HeadLoss:   "H-W",
		DemandMult: 1.0,
		Trials:     40,
		Accuracy:   0.001,
		Tolerance:  0.01,
		Unbalanced: 10,
	}
}

// DefaultTimes returns a 24-hour simulation with hourly steps.
func DefaultTimes() Times {
	return Times{
		Duration:    86400,
		HydStep:     3600,
		QualStep:    300,
		PatternStep: 3600,
		ReportStep:  3600,
		ReportStart: 0,
		StartClock:  0,
		Statistic:   "NONE",
	}
}

func num(f float64) string { return strconv.FormatFloat(f, 'g', -1, 64) }

func hms(sec int) string {
	if sec < 0 {
		sec = 0
	}
	return fmt.Sprintf("%d:%02d:%02d", sec/3600, (sec%3600)/60, sec%60)
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// ToINP renders the network as an EPANET INP file.
func (n *Network) ToINP() string {
	var b strings.Builder
	w := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }

	w("[TITLE]\n%s\n\n", orDefault(n.Title, "EPANET Web Network"))

	w("[JUNCTIONS]\n;ID\tElev\tDemand\tPattern\n")
	for _, nd := range n.Nodes {
		if nd.Type == "JUNCTION" {
			w("%s\t%s\t%s\t%s\n", nd.ID, num(nd.Elevation), num(nd.Demand), nd.DemandPat)
		}
	}
	w("\n[RESERVOIRS]\n;ID\tHead\tPattern\n")
	for _, nd := range n.Nodes {
		if nd.Type == "RESERVOIR" {
			w("%s\t%s\t%s\n", nd.ID, num(nd.Head), nd.HeadPat)
		}
	}
	w("\n[TANKS]\n;ID\tElev\tInitLvl\tMinLvl\tMaxLvl\tDiam\tMinVol\tVolCurve\n")
	for _, nd := range n.Nodes {
		if nd.Type == "TANK" {
			w("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", nd.ID, num(nd.Elevation),
				num(nd.InitLevel), num(nd.MinLevel), num(nd.MaxLevel),
				num(nd.Diameter), num(nd.MinVol), nd.VolCurve)
		}
	}

	w("\n[PIPES]\n;ID\tFrom\tTo\tLength\tDiam\tRoughness\tMinorLoss\tStatus\n")
	for _, lk := range n.Links {
		if lk.Type == "PIPE" {
			w("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", lk.ID, lk.From, lk.To,
				num(lk.Length), num(lk.Diameter), num(lk.Roughness), num(lk.MinorLoss),
				orDefault(lk.Status, "OPEN"))
		}
	}
	w("\n[PUMPS]\n;ID\tFrom\tTo\tParameters\n")
	for _, lk := range n.Links {
		if lk.Type == "PUMP" {
			w("%s\t%s\t%s\t", lk.ID, lk.From, lk.To)
			if lk.HeadCurve != "" {
				w("HEAD %s ", lk.HeadCurve)
			} else if lk.Power > 0 {
				w("POWER %s ", num(lk.Power))
			}
			if lk.Speed > 0 && lk.Speed != 1 {
				w("SPEED %s ", num(lk.Speed))
			}
			if lk.SpeedPat != "" {
				w("PATTERN %s", lk.SpeedPat)
			}
			w("\n")
		}
	}
	w("\n[VALVES]\n;ID\tFrom\tTo\tDiam\tType\tSetting\tMinorLoss\n")
	for _, lk := range n.Links {
		if isValve(lk.Type) {
			setting := num(lk.Setting)
			if lk.Type == "GPV" {
				setting = lk.HeadCurve // GPV setting is a headloss curve ID
			}
			w("%s\t%s\t%s\t%s\t%s\t%s\t%s\n", lk.ID, lk.From, lk.To,
				num(lk.Diameter), lk.Type, setting, num(lk.MinorLoss))
		}
	}

	if len(n.Patterns) > 0 {
		w("\n[PATTERNS]\n;ID\tMultipliers\n")
		for _, p := range n.Patterns {
			for i := 0; i < len(p.Values); i += 6 {
				end := i + 6
				if end > len(p.Values) {
					end = len(p.Values)
				}
				w("%s", p.ID)
				for _, v := range p.Values[i:end] {
					w("\t%s", num(v))
				}
				w("\n")
			}
			if len(p.Values) == 0 {
				w("%s\t1\n", p.ID)
			}
		}
	}

	if len(n.Curves) > 0 {
		w("\n[CURVES]\n;ID\tX-Value\tY-Value\n")
		for _, c := range n.Curves {
			if c.Type != "" {
				w("; %s: %s\n", curveKeyword(c.Type), c.ID)
			}
			for _, pt := range c.Points {
				w("%s\t%s\t%s\n", c.ID, num(pt.X), num(pt.Y))
			}
		}
	}

	if len(n.Controls) > 0 {
		w("\n[CONTROLS]\n")
		for _, c := range n.Controls {
			if strings.TrimSpace(c) != "" {
				w("%s\n", c)
			}
		}
	}

	w("\n[TIMES]\n")
	w(" DURATION\t%s\n", hms(n.Times.Duration))
	w(" HYDRAULIC TIMESTEP\t%s\n", hms(n.Times.HydStep))
	w(" QUALITY TIMESTEP\t%s\n", hms(n.Times.QualStep))
	w(" PATTERN TIMESTEP\t%s\n", hms(n.Times.PatternStep))
	w(" PATTERN START\t%s\n", hms(n.Times.PatternStart))
	w(" REPORT TIMESTEP\t%s\n", hms(n.Times.ReportStep))
	w(" REPORT START\t%s\n", hms(n.Times.ReportStart))
	w(" START CLOCKTIME\t%s\n", hms(n.Times.StartClock))
	w(" STATISTIC\t%s\n", orDefault(n.Times.Statistic, "NONE"))

	w("\n[REPORT]\n STATUS\tNO\n SUMMARY\tNO\n PAGE\t0\n NODES\tALL\n LINKS\tALL\n")

	o := n.Options
	w("\n[OPTIONS]\n")
	w(" UNITS\t%s\n", orDefault(o.FlowUnits, "LPS"))
	w(" HEADLOSS\t%s\n", orDefault(o.HeadLoss, "H-W"))
	w(" DEMAND MULTIPLIER\t%s\n", num(orFloat(o.DemandMult, 1)))
	w(" TRIALS\t%d\n", orInt(o.Trials, 40))
	w(" ACCURACY\t%s\n", num(orFloat(o.Accuracy, 0.001)))
	w(" TOLERANCE\t%s\n", num(orFloat(o.Tolerance, 0.01)))
	w(" UNBALANCED\tCONTINUE %d\n", orInt(o.Unbalanced, 10))
	switch strings.ToUpper(n.Quality.Type) {
	case "CHEM":
		w(" QUALITY\t%s\t%s\n", orDefault(n.Quality.ChemName, "Chemical"), orDefault(n.Quality.ChemUnits, "mg/L"))
	case "AGE":
		w(" QUALITY\tAGE\n")
	case "TRACE":
		w(" QUALITY\tTRACE\t%s\n", n.Quality.TraceNode)
	default:
		w(" QUALITY\tNONE\n")
	}

	// Initial quality section (only non-zero entries).
	hasQual := false
	for _, nd := range n.Nodes {
		if nd.InitQual != 0 {
			hasQual = true
			break
		}
	}
	if hasQual {
		w("\n[QUALITY]\n;ID\tInitQual\n")
		for _, nd := range n.Nodes {
			if nd.InitQual != 0 {
				w("%s\t%s\n", nd.ID, num(nd.InitQual))
			}
		}
	}

	w("\n[COORDINATES]\n;ID\tX-Coord\tY-Coord\n")
	for _, nd := range n.Nodes {
		w("%s\t%s\t%s\n", nd.ID, num(nd.X), num(nd.Y))
	}

	hasVert := false
	for _, lk := range n.Links {
		if len(lk.Vertices) > 0 {
			hasVert = true
			break
		}
	}
	if hasVert {
		w("\n[VERTICES]\n;ID\tX-Coord\tY-Coord\n")
		for _, lk := range n.Links {
			for _, v := range lk.Vertices {
				w("%s\t%s\t%s\n", lk.ID, num(v.X), num(v.Y))
			}
		}
	}

	w("\n[END]\n")
	return b.String()
}

func isValve(t string) bool {
	switch t {
	case "PRV", "PSV", "PBV", "FCV", "TCV", "GPV", "PCV":
		return true
	}
	return false
}

func curveKeyword(t string) string {
	switch strings.ToUpper(t) {
	case "PUMP":
		return "PUMP"
	case "EFFICIENCY":
		return "EFFICIENCY"
	case "VOLUME":
		return "VOLUME"
	case "HEADLOSS":
		return "HEADLOSS"
	default:
		return "GENERIC"
	}
}

func orFloat(f, def float64) float64 {
	if f == 0 {
		return def
	}
	return f
}

func orInt(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}