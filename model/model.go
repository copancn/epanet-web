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
	Title       string      `json:"title"`
	Nodes       []Node      `json:"nodes"`
	Links       []Link      `json:"links"`
	Patterns    []Pattern   `json:"patterns"`
	Curves      []Curve     `json:"curves"`
	Controls    []string    `json:"controls"`
	Rules       []string    `json:"rules,omitempty"`
	Options     Options     `json:"options"`
	Times       Times       `json:"times"`
	Quality     Quality     `json:"quality"`
	Reactions   Reactions   `json:"reactions"`
	Energy      Energy      `json:"energy"`
	DemandModel DemandModel `json:"demandModel"`
	MSX         *MSXConfig  `json:"msx,omitempty"`
}

// Node is a junction, reservoir or tank.
type Node struct {
	ID   string  `json:"id"`
	Type string  `json:"type"` // JUNCTION | RESERVOIR | TANK
	X    float64 `json:"x"`
	Y    float64 `json:"y"`

	// Junction
	Elevation float64  `json:"elevation"`
	Demand    float64  `json:"demand"`
	DemandPat string   `json:"demandPattern"`
	Demands   []Demand `json:"demands,omitempty"` // extra demand categories

	// Reservoir
	Head    float64 `json:"head"`
	HeadPat string  `json:"headPattern"`

	// Tank
	InitLevel   float64 `json:"initLevel"`
	MinLevel    float64 `json:"minLevel"`
	MaxLevel    float64 `json:"maxLevel"`
	Diameter    float64 `json:"diameter"`
	MinVol      float64 `json:"minVol"`
	VolCurve    string  `json:"volCurve"`
	MixModel    string  `json:"mixModel,omitempty"`    // MIX1 | MIX2 | FIFO | LIFO
	MixFraction float64 `json:"mixFraction,omitempty"` // mixing zone fraction
	TankKBulk   float64 `json:"tankKBulk,omitempty"`   // tank bulk reaction coeff
	CanOverflow bool    `json:"canOverflow,omitempty"`

	// Water quality source / emitter
	Emitter    float64 `json:"emitter,omitempty"`    // emitter coefficient
	SourceType string  `json:"sourceType,omitempty"` // CONCEN | MASS | SETPOINT | FLOWPACED
	SourceQual float64 `json:"sourceQual,omitempty"`
	SourcePat  string  `json:"sourcePattern,omitempty"`

	// Initial water quality (optional)
	InitQual float64 `json:"initQual"`

	Tag     string `json:"tag,omitempty"`
	Comment string `json:"comment,omitempty"`
}

// Demand is one demand category on a junction.
type Demand struct {
	Base    float64 `json:"base"`
	Pattern string  `json:"pattern,omitempty"`
	Name    string  `json:"name,omitempty"`
}

// Link is a pipe, pump or valve.
type Link struct {
	ID   string `json:"id"`
	Type string `json:"type"` // PIPE | PUMP | PRV | PSV | PBV | FCV | TCV | GPV | PCV
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
	EffCurve  string  `json:"effCurve,omitempty"` // pump efficiency curve
	Price     float64 `json:"price,omitempty"`    // energy price per kWh
	PricePat  string  `json:"pricePattern,omitempty"`

	// Valve
	Setting float64 `json:"setting"`

	// Reaction coefficients (pipes)
	KBulk float64 `json:"kBulk,omitempty"`
	KWall float64 `json:"kWall,omitempty"`

	// Leakage (FAVAD)
	LeakArea  float64 `json:"leakArea,omitempty"`
	LeakExpan float64 `json:"leakExpan,omitempty"`

	Vertices []Point `json:"vertices"`

	Tag     string `json:"tag,omitempty"`
	Comment string `json:"comment,omitempty"`
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
	Type   string  `json:"type"` // PUMP | EFFICIENCY | VOLUME | HEADLOSS | GENERIC | VALVE
	Points []Point `json:"points"`
}

// Options are network-wide analysis options.
type Options struct {
	FlowUnits       string  `json:"flowUnits"` // LPS | LPM | MLD | CMH | CMD | CMS | CFS | GPM | MGD | IMGD | AFD
	HeadLoss        string  `json:"headLoss"`  // H-W | D-W | C-M
	DemandMult      float64 `json:"demandMult"`
	Trials          int     `json:"trials"`
	Accuracy        float64 `json:"accuracy"`
	Tolerance       float64 `json:"tolerance"`
	Unbalanced      int     `json:"unbalanced"`
	PressureUnits   string  `json:"pressureUnits,omitempty"` // PSI | KPA | METERS | BAR | FEET
	SpecificGravity float64 `json:"specificGravity,omitempty"`
	Viscosity       float64 `json:"viscosity,omitempty"`
	Diffusivity     float64 `json:"diffusivity,omitempty"`
	EmitterExponent float64 `json:"emitterExponent,omitempty"`
	EmitterBackflow bool    `json:"emitterBackflow,omitempty"`
	DefaultPattern  string  `json:"defaultPattern,omitempty"`
	CheckFreq       int     `json:"checkFreq,omitempty"`
	MaxCheck        int     `json:"maxCheck,omitempty"`
	DampLimit       float64 `json:"dampLimit,omitempty"`
	HeadError       float64 `json:"headError,omitempty"`
	FlowChange      float64 `json:"flowChange,omitempty"`
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
	RuleStep     int    `json:"ruleStep,omitempty"`
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

// Reactions holds water-quality reaction parameters.
type Reactions struct {
	BulkOrder   int     `json:"bulkOrder,omitempty"` // 1 | 2 (0 = engine default)
	WallOrder   int     `json:"wallOrder,omitempty"`
	TankOrder   int     `json:"tankOrder,omitempty"`
	GlobalBulk  float64 `json:"globalBulk,omitempty"`
	GlobalWall  float64 `json:"globalWall,omitempty"`
	LimitingPot float64 `json:"limitingPot,omitempty"`
	RoughCorrel float64 `json:"roughCorrel,omitempty"`
}

// Energy holds pump energy-cost parameters.
type Energy struct {
	GlobalEfficiency float64 `json:"globalEfficiency,omitempty"`
	GlobalPrice      float64 `json:"globalPrice,omitempty"`
	PricePattern     string  `json:"pricePattern,omitempty"`
	DemandCharge     float64 `json:"demandCharge,omitempty"`
}

// DemandModel selects demand-driven vs pressure-driven analysis.
type DemandModel struct {
	Type string  `json:"type,omitempty"` // DDA | PDA
	Pmin float64 `json:"pmin,omitempty"` // minimum pressure (PDA)
	Preq float64 `json:"preq,omitempty"` // required pressure (PDA)
	Pexp float64 `json:"pexp,omitempty"` // pressure exponent (PDA)
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
	w("\n[TANKS]\n;ID\tElev\tInitLvl\tMinLvl\tMaxLvl\tDiam\tMinVol\tVolCurve\tOverflow\n")
	for _, nd := range n.Nodes {
		if nd.Type == "TANK" {
			overflow := "NO"
			if nd.CanOverflow {
				overflow = "YES"
			}
			volCurve := nd.VolCurve
			if volCurve == "" {
				volCurve = "*" // engine placeholder for "no volume curve"
			}
			w("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", nd.ID, num(nd.Elevation),
				num(nd.InitLevel), num(nd.MinLevel), num(nd.MaxLevel),
				num(nd.Diameter), num(nd.MinVol), volCurve, overflow)
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
	w("\n[VALVES]\n;ID\tFrom\tTo\tDiam\tType\tSetting\tMinorLoss\tCurve\n")
	for _, lk := range n.Links {
		if isValve(lk.Type) {
			setting := num(lk.Setting)
			if lk.Type == "GPV" {
				setting = lk.HeadCurve // GPV setting is a headloss curve ID
			}
			w("%s\t%s\t%s\t%s\t%s\t%s\t%s", lk.ID, lk.From, lk.To,
				num(lk.Diameter), lk.Type, setting, num(lk.MinorLoss))
			if lk.Type == "PCV" && lk.HeadCurve != "" {
				w("\t%s", lk.HeadCurve) // PCV optional loss-coefficient curve
			}
			w("\n")
		}
	}

	// Extra demand categories beyond the primary one.
	hasDemands := false
	for _, nd := range n.Nodes {
		if len(nd.Demands) > 0 {
			hasDemands = true
			break
		}
	}
	if hasDemands {
		w("\n[DEMANDS]\n;ID\tDemand\tPattern\tCategory\n")
		for _, nd := range n.Nodes {
			if len(nd.Demands) == 0 {
				continue
			}
			// The engine treats the first [DEMANDS] entry as the primary
			// category (it overwrites [JUNCTIONS]), so emit the full list.
			w("%s\t%s\t%s\n", nd.ID, num(nd.Demand), nd.DemandPat)
			for _, d := range nd.Demands {
				w("%s\t%s\t%s", nd.ID, num(d.Base), d.Pattern)
				if d.Name != "" {
					w("\t;%s", d.Name)
				}
				w("\n")
			}
		}
	}

	// Emitters at junctions.
	hasEmitters := false
	for _, nd := range n.Nodes {
		if nd.Emitter != 0 {
			hasEmitters = true
			break
		}
	}
	if hasEmitters {
		w("\n[EMITTERS]\n;ID\tCoefficient\n")
		for _, nd := range n.Nodes {
			if nd.Emitter != 0 {
				w("%s\t%s\n", nd.ID, num(nd.Emitter))
			}
		}
	}

	// FAVAD leakage at pipes.
	hasLeak := false
	for _, lk := range n.Links {
		if lk.LeakArea != 0 {
			hasLeak = true
			break
		}
	}
	if hasLeak {
		w("\n[LEAKAGE]\n;ID\tArea\tExponent\n")
		for _, lk := range n.Links {
			if lk.LeakArea != 0 {
				w("%s\t%s\t%s\n", lk.ID, num(lk.LeakArea), num(orFloat(lk.LeakExpan, 1)))
			}
		}
	}

	// Closed pumps / valves need a [STATUS] entry (INP default is OPEN).
	hasStatus := false
	for _, lk := range n.Links {
		if strings.ToUpper(lk.Status) == "CLOSED" {
			hasStatus = true
			break
		}
	}
	if hasStatus {
		w("\n[STATUS]\n;ID\tStatus\n")
		for _, lk := range n.Links {
			if strings.ToUpper(lk.Status) == "CLOSED" {
				w("%s\tCLOSED\n", lk.ID)
			}
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
		w("\n[CURVES]\n;ID\tX-Value\tY-Value\tType\n")
		for _, c := range n.Curves {
			for i, pt := range c.Points {
				if i == 0 && c.Type != "" {
					w("%s\t%s\t%s\t%s\n", c.ID, num(pt.X), num(pt.Y), curveKeyword(c.Type))
				} else {
					w("%s\t%s\t%s\n", c.ID, num(pt.X), num(pt.Y))
				}
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

	if len(n.Rules) > 0 {
		w("\n[RULES]\n")
		for _, r := range n.Rules {
			if strings.TrimSpace(r) != "" {
				w("%s\n", r)
			}
		}
	}

	// Water-quality sources.
	hasSources := false
	for _, nd := range n.Nodes {
		if nd.SourceQual != 0 || nd.SourceType != "" {
			hasSources = true
			break
		}
	}
	if hasSources {
		w("\n[SOURCES]\n;ID\tType\tQuality\tPattern\n")
		for _, nd := range n.Nodes {
			if nd.SourceQual != 0 || nd.SourceType != "" {
				w("%s\t%s\t%s\t%s\n", nd.ID, orDefault(nd.SourceType, "CONCEN"),
					num(nd.SourceQual), nd.SourcePat)
			}
		}
	}

	// Tank mixing models.
	hasMixing := false
	for _, nd := range n.Nodes {
		if nd.Type == "TANK" && nd.MixModel != "" {
			hasMixing = true
			break
		}
	}
	if hasMixing {
		w("\n[MIXING]\n;ID\tModel\tFraction\n")
		for _, nd := range n.Nodes {
			if nd.Type == "TANK" && nd.MixModel != "" {
				w("%s\t%s\t%s\n", nd.ID, mixKeyword(nd.MixModel), num(nd.MixFraction))
			}
		}
	}

	// Reaction parameters + per-link coefficients.
	r := n.Reactions
	hasReactions := r.BulkOrder != 0 || r.WallOrder != 0 || r.TankOrder != 0 ||
		r.GlobalBulk != 0 || r.GlobalWall != 0 || r.LimitingPot != 0 || r.RoughCorrel != 0
	hasPipeReact := false
	for _, lk := range n.Links {
		if lk.KBulk != 0 || lk.KWall != 0 {
			hasPipeReact = true
			break
		}
	}
	hasTankKBulk := false
	for _, nd := range n.Nodes {
		if nd.TankKBulk != 0 {
			hasTankKBulk = true
			break
		}
	}
	if hasReactions || hasPipeReact || hasTankKBulk {
		w("\n[REACTIONS]\n")
		if r.BulkOrder != 0 {
			w(" ORDER BULK\t%d\n", r.BulkOrder)
		}
		if r.WallOrder != 0 {
			w(" ORDER WALL\t%d\n", r.WallOrder)
		}
		if r.TankOrder != 0 {
			w(" ORDER TANK\t%d\n", r.TankOrder)
		}
		if r.GlobalBulk != 0 {
			w(" GLOBAL BULK\t%s\n", num(r.GlobalBulk))
		}
		if r.GlobalWall != 0 {
			w(" GLOBAL WALL\t%s\n", num(r.GlobalWall))
		}
		if r.LimitingPot != 0 {
			w(" LIMITING POTENTIAL\t%s\n", num(r.LimitingPot))
		}
		if r.RoughCorrel != 0 {
			w(" ROUGHNESS CORRELATION\t%s\n", num(r.RoughCorrel))
		}
		for _, lk := range n.Links {
			if lk.KBulk != 0 {
				w(" BULK %s\t%s\n", lk.ID, num(lk.KBulk))
			}
			if lk.KWall != 0 {
				w(" WALL %s\t%s\n", lk.ID, num(lk.KWall))
			}
		}
		for _, nd := range n.Nodes {
			if nd.Type == "TANK" && nd.TankKBulk != 0 {
				w(" TANK %s\t%s\n", nd.ID, num(nd.TankKBulk))
			}
		}
	}

	// Energy costs.
	e := n.Energy
	hasPumpEnergy := false
	for _, lk := range n.Links {
		if lk.Type == "PUMP" && (lk.EffCurve != "" || lk.Price != 0 || lk.PricePat != "") {
			hasPumpEnergy = true
			break
		}
	}
	if e.GlobalEfficiency != 0 || e.GlobalPrice != 0 || e.PricePattern != "" ||
		e.DemandCharge != 0 || hasPumpEnergy {
		w("\n[ENERGY]\n")
		if e.GlobalEfficiency != 0 {
			w(" GLOBAL EFFIC\t%s\n", num(e.GlobalEfficiency))
		}
		if e.GlobalPrice != 0 {
			w(" GLOBAL PRICE\t%s\n", num(e.GlobalPrice))
		}
		if e.PricePattern != "" {
			w(" GLOBAL PATTERN\t%s\n", e.PricePattern)
		}
		if e.DemandCharge != 0 {
			w(" DEMAND CHARGE\t%s\n", num(e.DemandCharge))
		}
		for _, lk := range n.Links {
			if lk.Type != "PUMP" {
				continue
			}
			if lk.EffCurve != "" {
				w(" PUMP %s\tEFFIC %s\n", lk.ID, lk.EffCurve)
			}
			if lk.Price != 0 {
				w(" PUMP %s\tPRICE %s\n", lk.ID, num(lk.Price))
			}
			if lk.PricePat != "" {
				w(" PUMP %s\tPATTERN %s\n", lk.ID, lk.PricePat)
			}
		}
	}

	// Node / link tags.
	hasTags := false
	for _, nd := range n.Nodes {
		if nd.Tag != "" {
			hasTags = true
			break
		}
	}
	if !hasTags {
		for _, lk := range n.Links {
			if lk.Tag != "" {
				hasTags = true
				break
			}
		}
	}
	if hasTags {
		w("\n[TAGS]\n")
		for _, nd := range n.Nodes {
			if nd.Tag != "" {
				w(" NODE %s\t%s\n", nd.ID, nd.Tag)
			}
		}
		for _, lk := range n.Links {
			if lk.Tag != "" {
				w(" LINK %s\t%s\n", lk.ID, lk.Tag)
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
	if n.Times.RuleStep > 0 {
		w(" RULE TIMESTEP\t%s\n", hms(n.Times.RuleStep))
	}
	w(" START CLOCKTIME\t%s\n", hms(n.Times.StartClock))
	w(" STATISTIC\t%s\n", orDefault(n.Times.Statistic, "NONE"))

	w("\n[REPORT]\n STATUS\tNO\n SUMMARY\tYES\n ENERGY\tYES\n MESSAGES\tYES\n PAGE\t0\n NODES\tALL\n LINKS\tALL\n")

	o := n.Options
	w("\n[OPTIONS]\n")
	w(" UNITS\t%s\n", orDefault(o.FlowUnits, "LPS"))
	if o.PressureUnits != "" {
		w(" PRESSURE\t%s\n", o.PressureUnits)
	}
	w(" HEADLOSS\t%s\n", orDefault(o.HeadLoss, "H-W"))
	w(" DEMAND MULTIPLIER\t%s\n", num(orFloat(o.DemandMult, 1)))
	w(" TRIALS\t%d\n", orInt(o.Trials, 40))
	w(" ACCURACY\t%s\n", num(orFloat(o.Accuracy, 0.001)))
	w(" TOLERANCE\t%s\n", num(orFloat(o.Tolerance, 0.01)))
	w(" UNBALANCED\tCONTINUE %d\n", orInt(o.Unbalanced, 10))
	if o.SpecificGravity != 0 {
		w(" SPECIFIC GRAVITY\t%s\n", num(o.SpecificGravity))
	}
	if o.Viscosity != 0 {
		w(" VISCOSITY\t%s\n", num(o.Viscosity))
	}
	if o.Diffusivity != 0 {
		w(" DIFFUSIVITY\t%s\n", num(o.Diffusivity))
	}
	if o.EmitterExponent != 0 {
		w(" EMITTER EXPONENT\t%s\n", num(o.EmitterExponent))
	}
	if o.EmitterBackflow {
		w(" BACKFLOW ALLOWED\tYES\n")
	}
	if o.DefaultPattern != "" {
		w(" PATTERN\t%s\n", o.DefaultPattern)
	}
	if o.CheckFreq > 0 {
		w(" CHECKFREQ\t%d\n", o.CheckFreq)
	}
	if o.MaxCheck > 0 {
		w(" MAXCHECK\t%d\n", o.MaxCheck)
	}
	if o.DampLimit != 0 {
		w(" DAMPLIMIT\t%s\n", num(o.DampLimit))
	}
	if o.HeadError > 0 {
		w(" HEADERROR\t%s\n", num(o.HeadError))
	}
	if o.FlowChange > 0 {
		w(" FLOWCHANGE\t%s\n", num(o.FlowChange))
	}
	if strings.ToUpper(n.DemandModel.Type) == "PDA" {
		w(" DEMAND MODEL\tPDA\n")
		w(" MINIMUM PRESSURE\t%s\n", num(n.DemandModel.Pmin))
		w(" REQUIRED PRESSURE\t%s\n", num(n.DemandModel.Preq))
		w(" PRESSURE EXPONENT\t%s\n", num(orFloat(n.DemandModel.Pexp, 0.5)))
	}
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
		return "EFFIC"
	case "VOLUME":
		return "VOLUME"
	case "HEADLOSS":
		return "HEADLOSS"
	case "VALVE":
		return "VALVE"
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

// mixKeyword maps a canonical mixing model to its INP token.
func mixKeyword(m string) string {
	switch strings.ToUpper(m) {
	case "MIX2", "2COMP":
		return "2COMP"
	case "FIFO":
		return "FIFO"
	case "LIFO":
		return "LIFO"
	default:
		return "MIXED"
	}
}

func orInt(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}