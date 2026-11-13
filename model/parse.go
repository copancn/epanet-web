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

	nodeByID := map[string]int{}
	linkByID := map[string]int{}
	patOrder := []string{}
	patMap := map[string]*Pattern{}
	curveOrder := []string{}
	curveMap := map[string]*Curve{}
	pendingCurveType := ""
	demandEntries := map[string][]Demand{}
	var ruleBlocks []string
	var curRule []string
	flushRule := func() {
		if len(curRule) > 0 {
			ruleBlocks = append(ruleBlocks, strings.Join(curRule, "\n"))
			curRule = nil
		}
	}

	addNode := func(nd Node) {
		n.Nodes = append(n.Nodes, nd)
		nodeByID[nd.ID] = len(n.Nodes) - 1
	}
	addLink := func(lk Link) {
		n.Links = append(n.Links, lk)
		linkByID[lk.ID] = len(n.Links) - 1
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
				case "PUMP", "EFFICIENCY", "EFFIC", "VOLUME", "HEADLOSS", "HLOSS", "GENERIC", "VALVE":
					pendingCurveType = kw
					_ = id
				}
			}
			continue
		}
		// strip inline comment, keeping it for category names
		comment := ""
		if idx := strings.Index(line, ";"); idx >= 0 {
			comment = strings.TrimSpace(line[idx+1:])
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
				if f[7] != "*" {
					nd.VolCurve = f[7]
				}
			}
			if len(f) > 8 {
				nd.CanOverflow = strings.EqualFold(f[8], "YES")
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
			if len(f) > 7 && lk.Type == "PCV" {
				lk.HeadCurve = f[7] // PCV loss-coefficient curve
			}
			addLink(lk)

		case "STATUS":
			if len(f) > 1 {
				if i, ok := linkByID[f[0]]; ok {
					n.Links[i].Status = strings.ToUpper(f[1])
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
				ctype := pendingCurveType
				if len(f) > 3 {
					ctype = f[3]
				}
				ctype = normalizeCurveType(ctype)
				c, ok := curveMap[id]
				if !ok {
					c = &Curve{ID: id, Type: ctype}
					curveMap[id] = c
					curveOrder = append(curveOrder, id)
				} else if ctype != "" {
					c.Type = ctype
				}
				c.Points = append(c.Points, Point{X: pf(f[1]), Y: pf(f[2])})
			}
			pendingCurveType = ""

		case "CONTROLS":
			n.Controls = append(n.Controls, strings.TrimSpace(line))

		case "RULES":
			tl := strings.TrimSpace(line)
			if strings.HasPrefix(strings.ToUpper(tl), "RULE") {
				flushRule()
				curRule = []string{tl}
			} else {
				curRule = append(curRule, tl)
			}

		case "DEMANDS":
			if len(f) >= 2 {
				d := Demand{Base: pf(f[1])}
				if len(f) > 2 {
					d.Pattern = f[2]
				}
				if len(f) > 3 {
					d.Name = f[3]
				} else if comment != "" {
					d.Name = comment
				}
				demandEntries[f[0]] = append(demandEntries[f[0]], d)
			}

		case "EMITTERS":
			if len(f) >= 2 {
				if i, ok := nodeByID[f[0]]; ok {
					n.Nodes[i].Emitter = pf(f[1])
				}
			}

		case "LEAKAGE":
			if len(f) >= 2 {
				if i, ok := linkByID[f[0]]; ok {
					n.Links[i].LeakArea = pf(f[1])
					if len(f) > 2 {
						n.Links[i].LeakExpan = pf(f[2])
					}
				}
			}

		case "SOURCES":
			if len(f) >= 3 {
				if i, ok := nodeByID[f[0]]; ok {
					n.Nodes[i].SourceType = strings.ToUpper(f[1])
					n.Nodes[i].SourceQual = pf(f[2])
					if len(f) > 3 {
						n.Nodes[i].SourcePat = f[3]
					}
				}
			}

		case "MIXING":
			if len(f) >= 2 {
				if i, ok := nodeByID[f[0]]; ok {
					n.Nodes[i].MixModel = normalizeMixModel(f[1])
					if len(f) > 2 {
						n.Nodes[i].MixFraction = pf(f[2])
					}
				}
			}

		case "REACTIONS":
			parseReactionLine(f, n, linkByID, nodeByID)

		case "ENERGY":
			parseEnergyLine(f, n, linkByID)

		case "TAGS":
			if len(f) >= 3 {
				id := f[1]
				tag := strings.Join(f[2:], " ")
				switch strings.ToUpper(f[0]) {
				case "NODE":
					if i, ok := nodeByID[id]; ok {
						n.Nodes[i].Tag = tag
					}
				case "LINK":
					if i, ok := linkByID[id]; ok {
						n.Links[i].Tag = tag
					}
				}
			}

		case "QUALITY":
			if len(f) > 1 {
				if i, ok := nodeByID[f[0]]; ok {
					n.Nodes[i].InitQual = pf(f[1])
				}
			}

		case "COORDINATES":
			if len(f) >= 3 {
				if i, ok := nodeByID[f[0]]; ok {
					n.Nodes[i].X = pf(f[1])
					n.Nodes[i].Y = pf(f[2])
				}
			}

		case "VERTICES":
			if len(f) >= 3 {
				if i, ok := linkByID[f[0]]; ok {
					n.Links[i].Vertices = append(n.Links[i].Vertices, Point{X: pf(f[1]), Y: pf(f[2])})
				}
			}

		case "TIMES":
			parseTimeLine(f, &n.Times)

		case "OPTIONS":
			parseOptionLine(f, &n.Options, &n.Quality, &n.DemandModel)
		}
	}

	n.Title = strings.Join(titleLines, " ")
	for _, id := range patOrder {
		n.Patterns = append(n.Patterns, *patMap[id])
	}
	for _, id := range curveOrder {
		n.Curves = append(n.Curves, *curveMap[id])
	}
	flushRule()
	n.Rules = ruleBlocks
	// [DEMANDS] replaces the [JUNCTIONS] demand: first entry is primary,
	// remaining entries are additional categories.
	for id, ds := range demandEntries {
		i, ok := nodeByID[id]
		if !ok || len(ds) == 0 {
			continue
		}
		n.Nodes[i].Demand = ds[0].Base
		n.Nodes[i].DemandPat = ds[0].Pattern
		if len(ds) > 1 {
			n.Nodes[i].Demands = ds[1:]
		}
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
	} else if v, ok := take("RULE TIMESTEP"); ok {
		t.RuleStep = parseTime(v)
	} else if v, ok := take("START CLOCKTIME"); ok {
		t.StartClock = parseTime(v)
	} else if v, ok := take("STATISTIC"); ok {
		t.Statistic = strings.ToUpper(strings.TrimSpace(v))
	}
}

func parseOptionLine(f []string, o *Options, q *Quality, dm *DemandModel) {
	line := strings.Join(f, " ")
	upper := strings.ToUpper(line)
	rest := func(prefix string) (string, bool) {
		if strings.HasPrefix(upper, prefix) {
			return strings.TrimSpace(line[len(prefix):]), true
		}
		return "", false
	}
	if v, ok := rest("UNITS"); ok {
		o.FlowUnits = strings.ToUpper(v)
	} else if v, ok := rest("PRESSURE EXPONENT"); ok {
		dm.Pexp = pf(v)
	} else if v, ok := rest("PRESSURE"); ok {
		o.PressureUnits = strings.ToUpper(v)
	} else if v, ok := rest("HEADLOSS"); ok {
		o.HeadLoss = strings.ToUpper(v)
	} else if v, ok := rest("DEMAND MULTIPLIER"); ok {
		o.DemandMult = pf(v)
	} else if v, ok := rest("DEMAND MODEL"); ok {
		dm.Type = strings.ToUpper(strings.TrimSpace(v))
	} else if v, ok := rest("MINIMUM PRESSURE"); ok {
		dm.Pmin = pf(v)
	} else if v, ok := rest("REQUIRED PRESSURE"); ok {
		dm.Preq = pf(v)
	} else if v, ok := rest("TRIALS"); ok {
		o.Trials = int(pf(v))
	} else if v, ok := rest("ACCURACY"); ok {
		o.Accuracy = pf(v)
	} else if v, ok := rest("TOLERANCE"); ok {
		o.Tolerance = pf(v)
	} else if v, ok := rest("SPECIFIC GRAVITY"); ok {
		o.SpecificGravity = pf(v)
	} else if v, ok := rest("VISCOSITY"); ok {
		o.Viscosity = pf(v)
	} else if v, ok := rest("DIFFUSIVITY"); ok {
		o.Diffusivity = pf(v)
	} else if v, ok := rest("EMITTER EXPONENT"); ok {
		o.EmitterExponent = pf(v)
	} else if v, ok := rest("BACKFLOW ALLOWED"); ok {
		o.EmitterBackflow = strings.EqualFold(strings.TrimSpace(v), "YES")
	} else if v, ok := rest("PATTERN"); ok {
		o.DefaultPattern = strings.TrimSpace(v)
	} else if v, ok := rest("CHECKFREQ"); ok {
		o.CheckFreq = int(pf(v))
	} else if v, ok := rest("MAXCHECK"); ok {
		o.MaxCheck = int(pf(v))
	} else if v, ok := rest("DAMPLIMIT"); ok {
		o.DampLimit = pf(v)
	} else if v, ok := rest("HEADERROR"); ok {
		o.HeadError = pf(v)
	} else if v, ok := rest("FLOWCHANGE"); ok {
		o.FlowChange = pf(v)
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
		switch strings.ToUpper(ff[0]) {
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

// normalizeCurveType maps INP curve-type tokens to the model's canonical names.
func normalizeCurveType(t string) string {
	switch strings.ToUpper(strings.TrimSpace(t)) {
	case "PUMP":
		return "PUMP"
	case "EFFIC", "EFFICIENCY":
		return "EFFICIENCY"
	case "VOLUME":
		return "VOLUME"
	case "HEADLOSS", "HLOSS":
		return "HEADLOSS"
	case "VALVE":
		return "VALVE"
	case "GENERIC":
		return "GENERIC"
	default:
		return ""
	}
}

// normalizeMixModel maps INP mixing tokens to canonical model names.
func normalizeMixModel(m string) string {
	switch strings.ToUpper(strings.TrimSpace(m)) {
	case "MIXED", "MIX1":
		return "MIX1"
	case "2COMP", "MIX2":
		return "MIX2"
	case "FIFO":
		return "FIFO"
	case "LIFO":
		return "LIFO"
	default:
		return strings.ToUpper(strings.TrimSpace(m))
	}
}

// parseReactionLine handles one [REACTIONS] line.
func parseReactionLine(f []string, n *Network, linkByID, nodeByID map[string]int) {
	if len(f) == 0 {
		return
	}
	kw := strings.ToUpper(f[0])
	switch kw {
	case "ORDER":
		if len(f) >= 3 {
			v := int(pf(f[2]))
			switch strings.ToUpper(f[1]) {
			case "BULK":
				n.Reactions.BulkOrder = v
			case "WALL":
				n.Reactions.WallOrder = v
			case "TANK":
				n.Reactions.TankOrder = v
			}
		}
	case "GLOBAL":
		if len(f) >= 3 {
			switch strings.ToUpper(f[1]) {
			case "BULK":
				n.Reactions.GlobalBulk = pf(f[2])
			case "WALL":
				n.Reactions.GlobalWall = pf(f[2])
			}
		}
	case "LIMITING":
		if len(f) >= 3 {
			n.Reactions.LimitingPot = pf(f[2])
		}
	case "ROUGHNESS":
		if len(f) >= 3 {
			n.Reactions.RoughCorrel = pf(f[2])
		}
	case "BULK", "WALL":
		if len(f) >= 3 {
			if i, ok := linkByID[f[1]]; ok {
				if kw == "BULK" {
					n.Links[i].KBulk = pf(f[2])
				} else {
					n.Links[i].KWall = pf(f[2])
				}
			}
		}
	case "TANK":
		if len(f) >= 3 {
			if i, ok := nodeByID[f[1]]; ok {
				n.Nodes[i].TankKBulk = pf(f[2])
			}
		}
	}
}

// parseEnergyLine handles one [ENERGY] line.
func parseEnergyLine(f []string, n *Network, linkByID map[string]int) {
	if len(f) == 0 {
		return
	}
	switch strings.ToUpper(f[0]) {
	case "GLOBAL":
		if len(f) >= 3 {
			switch strings.ToUpper(f[1]) {
			case "EFFIC", "EFFICIENCY":
				n.Energy.GlobalEfficiency = pf(f[2])
			case "PRICE":
				n.Energy.GlobalPrice = pf(f[2])
			case "PATTERN":
				n.Energy.PricePattern = f[2]
			}
		}
	case "DEMAND":
		if len(f) >= 3 {
			n.Energy.DemandCharge = pf(f[2])
		}
	case "PUMP":
		if len(f) >= 4 {
			i, ok := linkByID[f[1]]
			if !ok {
				return
			}
			switch strings.ToUpper(f[2]) {
			case "EFFIC", "EFFICIENCY":
				n.Links[i].EffCurve = f[3]
			case "PRICE":
				n.Links[i].Price = pf(f[3])
			case "PATTERN":
				n.Links[i].PricePat = f[3]
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