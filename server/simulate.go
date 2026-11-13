package server

import (
	"os"
	"path/filepath"

	"epanet-web/epanet"
	"epanet-web/model"
)

// RunSimulation executes a hydraulic (and optional water-quality) analysis for
// the given network and returns a per-period time series. The entire EPANET
// session is serialized under the global lock.
func RunSimulation(net *model.Network) *model.SimResult {
	return runSim(net, false)
}

// RunSimulationReport is like RunSimulation but also generates the EPANET
// text report (summary + energy usage).
func RunSimulationReport(net *model.Network) *model.SimResult {
	return runSim(net, true)
}

func runSim(net *model.Network, withReport bool) *model.SimResult {
	epanet.Lock()
	defer epanet.Unlock()

	res := &model.SimResult{}
	if !epanet.Ready() {
		res.Error = "EPANET 动态库未加载"
		return res
	}

	dir, err := os.MkdirTemp("", "epanetsim")
	if err != nil {
		res.Error = "创建临时目录失败: " + err.Error()
		return res
	}
	defer os.RemoveAll(dir)

	inpPath := filepath.Join(dir, "net.inp")
	rptPath := filepath.Join(dir, "net.rpt")
	if err := os.WriteFile(inpPath, []byte(net.ToINP()), 0o644); err != nil {
		res.Error = "写入 INP 失败: " + err.Error()
		return res
	}

	if err := epanet.Open(inpPath, rptPath, ""); err != nil {
		res.Error = "打开管网失败: " + err.Error()
		return res
	}
	defer epanet.Close()

	res.Version, _ = epanet.Version()
	fu, _ := epanet.FlowUnits()
	qt, _, _ := epanet.QualType()
	res.Units = model.UnitsFor(fu, qt, net.Quality.ChemUnits)
	qualityOn := qt != 0

	nodes, links, err := inventory()
	if err != nil {
		res.Error = "读取管网结构失败: " + err.Error()
		return res
	}

	warn, err := epanet.SolveH()
	if err != nil {
		res.Error = "水力求解失败: " + err.Error()
		return res
	}
	if warn != "" {
		res.Warnings = append(res.Warnings, "水力: "+warn)
	}

	// Populate the binary output file, which sets the engine's SaveQflag
	// required by ENreport. For a water-quality report run the quality solver
	// (it saves output too); otherwise transfer the hydraulic results.
	if withReport && qualityOn {
		if _, qerr := epanet.SolveQ(); qerr != nil {
			res.Warnings = append(res.Warnings, "水质: "+qerr.Error())
		}
	} else if err := epanet.SaveH(); err != nil {
		res.Error = "保存水力结果失败: " + err.Error()
		return res
	}

	// Generate the report now, before readSeries re-initializes the solvers
	// and clears SaveQflag.
	if withReport {
		if err := epanet.Report(); err != nil {
			res.Warnings = append(res.Warnings, "报告: "+err.Error())
		} else if data, rerr := os.ReadFile(rptPath); rerr == nil {
			res.Report = string(data)
		}
	}

	qwarn, err := readSeries(nodes, links, &res.Times, qualityOn)
	if err != nil {
		res.Error = "读取时序失败: " + err.Error()
		return res
	}
	if qwarn != "" {
		res.Warnings = append(res.Warnings, "水质: "+qwarn)
	}

	res.Statistics = readStatistics()

	res.Nodes = nodes
	res.Links = links
	res.OK = true
	return res
}

// readStatistics collects engine analysis statistics; nil if unavailable.
func readStatistics() *model.Statistics {
	it, err := epanet.Statistic(epanet.StatIterations)
	if err != nil {
		return nil
	}
	s := &model.Statistics{Iterations: int(it)}
	if v, e := epanet.Statistic(epanet.StatRelativeError); e == nil {
		s.RelativeError = v
	}
	if v, e := epanet.Statistic(epanet.StatMaxHeadError); e == nil {
		s.MaxHeadError = v
	}
	if v, e := epanet.Statistic(epanet.StatMaxFlowChange); e == nil {
		s.MaxFlowChange = v
	}
	if v, e := epanet.Statistic(epanet.StatMassBalance); e == nil {
		s.MassBalance = v
	}
	if v, e := epanet.Statistic(epanet.StatDeficientNodes); e == nil {
		s.DeficientNodes = int(v)
	}
	if v, e := epanet.Statistic(epanet.StatDemandReduction); e == nil {
		s.DemandReduction = v
	}
	if v, e := epanet.Statistic(epanet.StatLeakageLoss); e == nil {
		s.LeakageLoss = v
	}
	return s
}

// sanitize maps the EPANET MISSING sentinel (-1e10) to zero.
func sanitize(v float64) float64 {
	if v < -1e9 || v > 1e9 {
		return 0
	}
	return v
}

func isValveType(t string) bool {
	switch t {
	case "PRV", "PSV", "PBV", "FCV", "TCV", "GPV", "PCV":
		return true
	}
	return false
}

func inventory() ([]model.NodeSeries, []model.LinkSeries, error) {
	nc, err := epanet.Count(epanet.NodeCount)
	if err != nil {
		return nil, nil, err
	}
	lc, err := epanet.Count(epanet.LinkCount)
	if err != nil {
		return nil, nil, err
	}
	nodes := make([]model.NodeSeries, nc)
	for i := 1; i <= nc; i++ {
		id, _ := epanet.NodeID(i)
		nt, _ := epanet.NodeType(i)
		x, y, _ := epanet.Coord(i)
		nodes[i-1] = model.NodeSeries{ID: id, Type: nodeTypeName(nt), Index: i, X: x, Y: y}
	}
	links := make([]model.LinkSeries, lc)
	for i := 1; i <= lc; i++ {
		id, _ := epanet.LinkID(i)
		lt, _ := epanet.LinkType(i)
		n1, n2, _ := epanet.LinkNodes(i)
		from, _ := epanet.NodeID(n1)
		to, _ := epanet.NodeID(n2)
		links[i-1] = model.LinkSeries{ID: id, Type: linkTypeName(lt), Index: i, From: from, To: to}
	}
	return nodes, links, nil
}

// readSeries drives the hydraulic step-through loop and, when requested, the
// water-quality loop in lockstep. ENnextH and ENnextQ both advance to the next
// hydraulic event, so the two solvers share the same timeline. Quality is
// best-effort: a failure degrades to a warning without aborting hydraulics.
func readSeries(nodes []model.NodeSeries, links []model.LinkSeries, times *[]int64, qualityOn bool) (string, error) {
	if err := epanet.OpenH(); err != nil {
		return "", err
	}
	defer epanet.CloseH()
	if err := epanet.InitH(epanet.NoSave); err != nil {
		return "", err
	}

	qActive := false
	qWarn := ""
	if qualityOn {
		if err := epanet.OpenQ(); err != nil {
			qWarn = "openQ: " + err.Error()
		} else if err := epanet.InitQ(epanet.NoSave); err != nil {
			qWarn = "initQ: " + err.Error()
			epanet.CloseQ()
		} else {
			qActive = true
			defer epanet.CloseQ()
		}
	}

	for {
		t, err := epanet.RunH()
		if err != nil {
			return qWarn, err
		}
		*times = append(*times, t)
		prevT := int64(0)
		if len(*times) >= 2 {
			prevT = (*times)[len(*times)-2]
		}
		dtHours := float64(t-prevT) / 3600.0
		for i := range nodes {
			nd := &nodes[i]
			p, _ := epanet.NodeValue(nd.Index, epanet.NPressure)
			h, _ := epanet.NodeValue(nd.Index, epanet.NHead)
			d, _ := epanet.NodeValue(nd.Index, epanet.NDemand)
			nd.Pressure = append(nd.Pressure, p)
			nd.Head = append(nd.Head, h)
			nd.Demand = append(nd.Demand, d)
			switch nd.Type {
			case "TANK":
				lv, _ := epanet.NodeValue(nd.Index, epanet.NTankLevel)
				vol, _ := epanet.NodeValue(nd.Index, epanet.NTankVolume)
				nd.Level = append(nd.Level, lv)
				nd.Volume = append(nd.Volume, vol)
			case "JUNCTION":
				dd, _ := epanet.NodeValue(nd.Index, epanet.NDemandDeficit)
				nd.DemandDeficit = append(nd.DemandDeficit, sanitize(dd))
			}
		}
		for i := range links {
			lk := &links[i]
			f, _ := epanet.LinkValue(lk.Index, epanet.LFlow)
			v, _ := epanet.LinkValue(lk.Index, epanet.LVelocity)
			hl, _ := epanet.LinkValue(lk.Index, epanet.LHeadLoss)
			st, _ := epanet.LinkValue(lk.Index, epanet.LStatus)
			lk.Flow = append(lk.Flow, f)
			lk.Velocity = append(lk.Velocity, v)
			lk.HeadLoss = append(lk.HeadLoss, hl)
			lk.Status = append(lk.Status, st)
			switch {
			case lk.Type == "PUMP":
				ps, _ := epanet.LinkValue(lk.Index, epanet.LPumpState)
				// EN_ENERGY returns instantaneous operating power (kW), not
				// cumulative kWh; EN_PUMP_EFFIC returns a 0..1 fraction.
				kw, _ := epanet.LinkValue(lk.Index, epanet.LEnergy)
				ef, _ := epanet.LinkValue(lk.Index, epanet.LPumpEffic)
				sp, _ := epanet.LinkValue(lk.Index, epanet.LSetting)
				lk.PumpState = append(lk.PumpState, ps)
				lk.Power = append(lk.Power, kw)
				lk.Efficiency = append(lk.Efficiency, ef*100)
				lk.Setting = append(lk.Setting, sp)
				prevKWh := 0.0
				if n := len(lk.Energy); n > 0 {
					prevKWh = lk.Energy[n-1]
				}
				lk.Energy = append(lk.Energy, prevKWh+kw*dtHours)
			case isValveType(lk.Type):
				se, _ := epanet.LinkValue(lk.Index, epanet.LSetting)
				lk.Setting = append(lk.Setting, se)
			}
		}
		if qActive {
			if _, err := epanet.RunQ(); err != nil {
				qWarn = "runQ: " + err.Error()
				qActive = false
			} else {
				for i := range nodes {
					q, _ := epanet.NodeValue(nodes[i].Index, epanet.NQuality)
					nodes[i].Quality = append(nodes[i].Quality, q)
				}
				for i := range links {
					q, _ := epanet.LinkValue(links[i].Index, epanet.LQuality)
					links[i].Quality = append(links[i].Quality, q)
				}
				if _, err := epanet.NextQ(); err != nil {
					qWarn = "nextQ: " + err.Error()
					qActive = false
				}
			}
		}
		dt, err := epanet.NextH()
		if err != nil {
			return qWarn, err
		}
		if dt == 0 {
			break
		}
	}
	return qWarn, nil
}

func nodeTypeName(t int) string {
	switch t {
	case epanet.Reservoir:
		return "RESERVOIR"
	case epanet.Tank:
		return "TANK"
	default:
		return "JUNCTION"
	}
}

func linkTypeName(t int) string {
	switch t {
	case epanet.CVPipe:
		return "PIPE"
	case epanet.Pipe:
		return "PIPE"
	case epanet.Pump:
		return "PUMP"
	case epanet.PRV:
		return "PRV"
	case epanet.PSV:
		return "PSV"
	case epanet.PBV:
		return "PBV"
	case epanet.FCV:
		return "FCV"
	case epanet.TCV:
		return "TCV"
	case epanet.GPV:
		return "GPV"
	case epanet.PCV:
		return "PCV"
	default:
		return "PIPE"
	}
}