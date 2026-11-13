package model

// SimResult is the full simulation output returned to the browser.
type SimResult struct {
	OK       bool         `json:"ok"`
	Error    string       `json:"error,omitempty"`
	Warnings []string     `json:"warnings,omitempty"`
	Version  int          `json:"version"`
	Units    UnitInfo     `json:"units"`
	Times    []int64      `json:"times"`
	Nodes    []NodeSeries `json:"nodes"`
	Links    []LinkSeries `json:"links"`
	Report   string       `json:"report,omitempty"`
}

// UnitInfo carries display unit labels derived from the flow-unit system.
type UnitInfo struct {
	Flow      string `json:"flow"`
	Pressure  string `json:"pressure"`
	Head      string `json:"head"`
	Elevation string `json:"elevation"`
	Length    string `json:"length"`
	Diameter  string `json:"diameter"`
	Velocity  string `json:"velocity"`
	HeadLoss  string `json:"headloss"`
	Quality   string `json:"quality"`
	Metric    bool   `json:"metric"`
}

// NodeSeries holds per-period computed values for one node.
type NodeSeries struct {
	ID       string    `json:"id"`
	Type     string    `json:"type"`
	Index    int       `json:"index"`
	X        float64   `json:"x"`
	Y        float64   `json:"y"`
	Pressure []float64 `json:"pressure"`
	Head     []float64 `json:"head"`
	Demand   []float64 `json:"demand"`
	Quality  []float64 `json:"quality"`
}

// LinkSeries holds per-period computed values for one link.
type LinkSeries struct {
	ID       string    `json:"id"`
	Type     string    `json:"type"`
	Index    int       `json:"index"`
	From     string    `json:"from"`
	To       string    `json:"to"`
	Flow     []float64 `json:"flow"`
	Velocity []float64 `json:"velocity"`
	HeadLoss []float64 `json:"headloss"`
	Status   []float64 `json:"status"`
	Quality  []float64 `json:"quality"`
}

// UnitsFor maps an EPANET flow-unit code to display labels.
func UnitsFor(flowCode int, qualityType int, chemUnits string) UnitInfo {
	us := flowCode <= 4 // CFS..AFD are US customary
	u := UnitInfo{Metric: !us}
	switch flowCode {
	case 0:
		u.Flow = "ft³/s"
	case 1:
		u.Flow = "gal/min"
	case 2:
		u.Flow = "Mgal/day"
	case 3:
		u.Flow = "Mgal/day(Imp)"
	case 4:
		u.Flow = "acre-ft/day"
	case 5:
		u.Flow = "L/s"
	case 6:
		u.Flow = "L/min"
	case 7:
		u.Flow = "ML/day"
	case 8:
		u.Flow = "m³/h"
	case 9:
		u.Flow = "m³/day"
	case 10:
		u.Flow = "m³/s"
	default:
		u.Flow = "?"
	}
	if us {
		u.Pressure, u.Head, u.Elevation = "psi", "ft", "ft"
		u.Length, u.Diameter, u.Velocity, u.HeadLoss = "ft", "in", "ft/s", "ft"
	} else {
		u.Pressure, u.Head, u.Elevation = "m", "m", "m"
		u.Length, u.Diameter, u.Velocity, u.HeadLoss = "m", "mm", "m/s", "m"
	}
	switch qualityType {
	case 1:
		u.Quality = chemUnits
		if u.Quality == "" {
			u.Quality = "mg/L"
		}
	case 2:
		u.Quality = "h"
	case 3:
		u.Quality = "%"
	default:
		u.Quality = ""
	}
	return u
}