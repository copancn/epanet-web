package model

import (
	"strconv"
	"strings"
)

// ParseINP parses an EPANET INP file into a Network. Unknown sections are
// ignored so that most real-world files import cleanly.
func ParseINP(text string) *Network {
	n := &Network{
		Options: DefaultOptions(),
		Times:   DefaultTimes(),
		Quality: Quality{Type: "NONE"},
	}
	// reset times to zero so unspecified values are not forced to defaults
	n.Times = Times{Statistic: "NONE"}

	nodeByID := map[string]*Node{}
	linkByID := map[string]*Link{}
	patOrder := []string{}
	patMap := map[string]*Pattern{}
	curveOrder := []string{}
	curveMap := map[string]*Curve{}
	pendingCurveType := ""

	addNode := func(nd Node) {
		cp := nd
		n.Nodes = append(n.Nodes, cp)
		nodeByID[nd.ID] = &n.Nodes[len(n.Nodes)-1]
	}
	addLink := func(lk Link) {
		cp := lk
		n.Links = append(n.Links, cp)
		linkByID[lk.ID] = &n.Links[len(n.Links)-1]
	}

	section := ""
	var titleLines []string
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(raw, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "[") {
			section = strings.ToUpper(strings.Trim(trimmed, "[] "))
			continue
		}
		// comment line: capture curve type hints like ";PUMP: C1"
		if strings.HasPrefix(trimmed, ";") {
			c := strings.TrimSpace(trimmed[1:])
			if idx := strings.Index(c, ":"); idx > 0 {
				kw := strings.ToUpper(strings.TrimSpace(c[:idx]))
				id := strings.TrimSpace(c[idx+1:])
				switch kw {
				case "PUMP", "EFFICIENCY", "VOLUME", "HEADLOSS", "GENERIC":
					pendingCurveType = kw
					_ = id
				}
			}
			continue
		}
		// strip inline comment
		if idx := strings.Index(line, ";"); idx >= 0 {
			line = line[:idx]
		}
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}

		switch section {
		case "TITLE":
			titleLines = append(titleLines, strings.TrimSpace(line))

		case "JUNCTIONS":
			nd := Node{ID: f[0], Type: "JUNCTION"}
			if len(f) > 1 {
				nd.Elevation = pf(f[1])
			}
			if len(f) > 2 {
				nd.Demand = pf(f[2])
			}
			if len(f) > 3 {
				nd.DemandPat = f[3]
			}
			addNode(nd)

		case "RESERVOIRS":
			nd := Node{ID: f[0], Type: "RESERVOIR"}
			if len(f) > 1 {
				nd.Head = pf(f[1])
			}
			if len(f) > 2 {
				nd.HeadPat = f[2]
			}
			addNode(nd)

		case "TANKS":
			nd := Node{ID: f[0], Type: "TANK"}
			if len(f) > 1 {
				nd.Elevation = pf(f[1])
			}
			if len(f) > 2 {
				nd.InitLevel = pf(f[2])
			}
			if len(f) > 3 {
				nd.MinLevel = pf(f[3])
			}
			if len(f) > 4 {
				nd.MaxLevel = pf(f[4])
			}
			if len(f) > 5 {
				nd.Diameter = pf(f[5])
			}
			if len(f) > 6 {
				nd.MinVol = pf(f[6])
			}
			if len(f) > 7 {
				nd.VolCurve = f[7]
			}
			addNode(nd)

		case "PIPES":
			lk := Link{ID: f[0], Type: "PIPE", Status: "OPEN"}
			if len(f) > 2 {
				lk.From, lk.To = f[1], f[2]
			}
			if len(f) > 3 {
				lk.Length = pf(f[3])
			}
			if len(f) > 4 {
				lk.Diameter = pf(f[4])
			}
			if len(f) > 5 {
				lk.Roughness = pf(f[5])
			}
			if len(f) > 6 {
				lk.MinorLoss = pf(f[6])
			}
			if len(f) > 7 {
				lk.Status = strings.ToUpper(f[7])
			}
			addLink(lk)

		case "PUMPS":
			lk := Link{ID: f[0], Type: "PUMP", Speed: 1}
			if len(f) > 2 {
				lk.From, lk.To = f[1], f[2]
			}
			for i := 3; i < len(f)-1; i++ {
				switch strings.ToUpper(f[i]) {
				case "POWER":
					lk.Power = pf(f[i+1])
					i++
				case "HEAD":
					lk.HeadCurve = f[i+1]
					i++
				case "SPEED":
					lk.Speed = pf(f[i+1])
					i++
				case "PATTERN":
					lk.SpeedPat = f[i+1]
					i++
				}
			}
			addLink(lk)

		case "VALVES":
			lk := Link{ID: f[0], Type: "PRV"}
			if len(f) > 2 {
				lk.From, lk.To = f[1], f[2]
			}
			if len(f) > 3 {
				lk.Diameter = pf(f[3])
			}
			if len(f) > 4 {
				lk.Type = strings.ToUpper(f[4])
			}
			if len(f) > 5 {
				if lk.Type == "GPV" {
					lk.HeadCurve = f[5]
				} else {
					lk.Setting = pf(f[5])
				}
			}
			if len(f) > 6 {
				lk.MinorLoss = pf(f[6])
			}
			addLink(lk)

		case "STATUS":
			if len(f) > 1 {
				if lk, ok := linkByID[f[0]]; ok {
					lk.Status = strings.ToUpper(f[1])
				}
			}

		case "PATTERNS":
			id := f[0]
			p, ok := patMap[id]
			if !ok {
				p = &Pattern{ID: id}
				patMap[id] = p
				patOrder = append(patOrder, id)
			}
			for _, v := range f[1:] {
				p.Values = append(p.Values, pf(v))
			}

		case "CURVES":
			if len(f) >= 3 {
				id := f[0]
				c, ok := curveMap[id]
				if !ok {
					c = &Curve{ID: id, Type: pendingCurveType}
					curveMap[id] = c
					curveOrder = append(curveOrder, id)
				}
				c.Points = append(c.Points, Point{X: pf(f[1]), Y: pf(f[2])})
			}
			pendingCurveType = ""

		case "CONTROLS":
			n.Controls = append(n.Controls, strings.TrimSpace(line))

		case "QUALITY":
			if len(f) > 1 {
				if nd, ok := nodeByID[f[0]]; ok {
					nd.InitQual = pf(f[1])
				}
			}

		case "COORDINATES":
			if len(f) >= 3 {
				if nd, ok := nodeByID[f[0]]; ok {
					nd.X = pf(f[1])
					nd.Y = pf(f[2])
				}
			}

		case "VERTICES":
			if len(f) >= 3 {
				if lk, ok := linkByID[f[0]]; ok {
					lk.Vertices = append(lk.Vertices, Point{X: pf(f[1]), Y: pf(f[2])})
				}
			}

		case "TIMES":
			parseTimeLine(f, &n.Times)

		case "OPTIONS":
			parseOptionLine(f, &n.Options, &n.Quality)
		}
	}

	n.Title = strings.Join(titleLines, " ")
	for _, id := range patOrder {
		n.Patterns = append(n.Patterns, *patMap[id])
	}
	for _, id := range curveOrder {
		n.Curves = append(n.Curves, *curveMap[id])
	}
	// fill option/time defaults that were absent
	if n.Options.FlowUnits == "" {
		n.Options.FlowUnits = "GPM"
	}
	if n.Options.HeadLoss == "" {
		n.Options.HeadLoss = "H-W"
	}
	if n.Options.DemandMult == 0 {
		n.Options.DemandMult = 1
	}
	if n.Times.HydStep == 0 {
		n.Times.HydStep = 3600
	}
	if n.Times.ReportStep == 0 {
		n.Times.ReportStep = n.Times.HydStep
	}
	if n.Times.PatternStep == 0 {
		n.Times.PatternStep = 3600
	}
	if n.Times.QualStep == 0 {
		n.Times.QualStep = 300
	}
	if n.Times.Statistic == "" {
		n.Times.Statistic = "NONE"
	}
	return n
}

func pf(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

func parseTimeLine(f []string, t *Times) {
	line := strings.ToUpper(strings.Join(f, " "))
	take := func(prefix string) (string, bool) {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(line[len(prefix):]), true
		}
		return "", false
	}
	if v, ok := take("DURATION"); ok {
		t.Duration = parseTime(v)
	} else if v, ok := take("HYDRAULIC TIMESTEP"); ok {
		t.HydStep = parseTime(v)
	} else if v, ok := take("QUALITY TIMESTEP"); ok {
		t.QualStep = parseTime(v)
	} else if v, ok := take("PATTERN TIMESTEP"); ok {
		t.PatternStep = parseTime(v)
	} else if v, ok := take("PATTERN START"); ok {
		t.PatternStart = parseTime(v)
	} else if v, ok := take("REPORT TIMESTEP"); ok {
		t.ReportStep = parseTime(v)
	} else if v, ok := take("REPORT START"); ok {
		t.ReportStart = parseTime(v)
	} else if v, ok := take("START CLOCKTIME"); ok {
		t.StartClock = parseTime(v)
	} else if v, ok := take("STATISTIC"); ok {
		t.Statistic = strings.ToUpper(strings.TrimSpace(v))
	}
}

func parseOptionLine(f []string, o *Options, q *Quality) {
	line := strings.ToUpper(strings.Join(f, " "))
	rest := func(prefix string) (string, bool) {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(line[len(prefix):]), true
		}
		return "", false
	}
	if v, ok := rest("UNITS"); ok {
		o.FlowUnits = strings.ToUpper(v)
	} else if v, ok := rest("HEADLOSS"); ok {
		o.HeadLoss = strings.ToUpper(v)
	} else if v, ok := rest("DEMAND MULTIPLIER"); ok {
		o.DemandMult = pf(v)
	} else if v, ok := rest("TRIALS"); ok {
		o.Trials = int(pf(v))
	} else if v, ok := rest("ACCURACY"); ok {
		o.Accuracy = pf(v)
	} else if v, ok := rest("TOLERANCE"); ok {
		o.Tolerance = pf(v)
	} else if v, ok := rest("UNBALANCED"); ok {
		ff := strings.Fields(v)
		if len(ff) >= 2 {
			o.Unbalanced = int(pf(ff[1]))
		} else if len(ff) == 1 {
			o.Unbalanced = int(pf(ff[0]))
		}
	} else if v, ok := rest("QUALITY"); ok {
		ff := strings.Fields(v)
		if len(ff) == 0 {
			return
		}
		switch ff[0] {
		case "NONE":
			q.Type = "NONE"
		case "AGE":
			q.Type = "AGE"
		case "TRACE":
			q.Type = "TRACE"
			if len(ff) > 1 {
				q.TraceNode = ff[1]
			}
		default:
			q.Type = "CHEM"
			q.ChemName = ff[0]
			if len(ff) > 1 {
				q.ChemUnits = ff[1]
			}
		}
	}
}

// parseTime converts an EPANET time string to seconds.
func parseTime(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	up := strings.ToUpper(s)
	fields := strings.Fields(s)
	mult := 0.0
	switch {
	case strings.HasSuffix(up, "SECONDS"), strings.HasSuffix(up, "SEC"):
		mult = 1
	case strings.HasSuffix(up, "MINUTES"), strings.HasSuffix(up, "MIN"):
		mult = 60
	case strings.HasSuffix(up, "HOURS"), strings.HasSuffix(up, "HOUR"), strings.HasSuffix(up, "HR"):
		mult = 3600
	case strings.HasSuffix(up, "DAYS"), strings.HasSuffix(up, "DAY"):
		mult = 86400
	}
	if mult > 0 {
		return int(pf(fields[0]) * mult)
	}
	if strings.Contains(s, ":") {
		parts := strings.Split(s, ":")
		h := int(pf(parts[0]))
		m, sec := 0, 0
		if len(parts) > 1 {
			m = int(pf(parts[1]))
		}
		if len(parts) > 2 {
			sec = int(pf(strings.Fields(parts[2])[0]))
		}
		if strings.Contains(up, "PM") && h < 12 {
			h += 12
		}
		if strings.Contains(up, "AM") && h == 12 {
			h = 0
		}
		return h*3600 + m*60 + sec
	}
	return int(pf(s) * 3600)
}