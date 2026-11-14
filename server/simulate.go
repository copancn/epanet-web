package server

import (
	"os"
	"path/filepath"

	"epanet-web/epanet"
	"epanet-web/model"
	"epanet-web/msx"
)

// RunSimulation executes a hydraulic (and optional water-quality) analysis for
// the given network and returns a per-period time series. The entire EPANET
// session is serialized under the global lock.
func RunSimulation(net *model.Network) *model.SimResult {
	return runSim(net, net.WithReport)
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
		res.Error = model.NewMsg(model.ErrEngineNotLoaded)
		return res
	}

	dir, err := os.MkdirTemp("", "epanetsim")
	if err != nil {
		res.Error = model.ErrMsg(model.ErrTempDir, err)
		return res
	}
	defer os.RemoveAll(dir)

	inpPath := filepath.Join(dir, "net.inp")
	rptPath := filepath.Join(dir, "net.rpt")
	if err := os.WriteFile(inpPath, []byte(net.ToINP()), 0o644); err != nil {
		res.Error = model.ErrMsg(model.ErrWriteInp, err)
		return res
	}

	// Multi-species (MSX) chemistry is opt-in. Validate and stage the .msx file
	// now; the .hyd is captured after SolveH and the analysis runs at the end.
	msxOn := net.MSX != nil && net.MSX.Enabled
	msxPath := filepath.Join(dir, "net.msx")
	hydPath := filepath.Join(dir, "net.hyd")
	if msxOn {
		if vmsg := net.MSX.Validate(); vmsg != nil {
			res.Warnings = append(res.Warnings, vmsg)
			msxOn = false
		} else if err := os.WriteFile(msxPath, []byte(net.ToMSX()), 0o644); err != nil {
			res.Warnings = append(res.Warnings, model.ErrMsg(model.WarnMSXWrite, err))
			msxOn = false
		}
	}

	if err := epanet.Open(inpPath, rptPath, ""); err != nil {
		res.Error = model.ErrMsg(model.ErrOpenNet, err)
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
		res.Error = model.ErrMsg(model.ErrInventory, err)
		return res
	}

	warn, err := epanet.SolveH()
	if err != nil {
		res.Error = model.ErrMsg(model.ErrSolveH, err)
		return res
	}
	if warn != "" {
		res.Warnings = append(res.Warnings, model.NewMsg(model.WarnHydraulic).WithDetail(warn))
	}

	// File-couple the solved hydraulics to MSX via an explicit .hyd file.
	if msxOn {
		if err := epanet.SaveHydFile(hydPath); err != nil {
			res.Warnings = append(res.Warnings, model.ErrMsg(model.WarnMSXSaveHyd, err))
			msxOn = false
		}
	}

	// Populate the binary output file, which sets the engine's SaveQflag
	// required by ENreport. For a water-quality report run the quality solver
	// (it saves output too); otherwise transfer the hydraulic results.
	if withReport && qualityOn {
		if _, qerr := epanet.SolveQ(); qerr != nil {
			res.Warnings = append(res.Warnings, model.ErrMsg(model.WarnQuality, qerr))
		}
	} else if err := epanet.SaveH(); err != nil {
		res.Error = model.ErrMsg(model.ErrSaveH, err)
		return res
	}

	// Generate the report now, before readSeries re-initializes the solvers
	// and clears SaveQflag.
	if withReport {
		if err := epanet.Report(); err != nil {
			res.Warnings = append(res.Warnings, model.ErrMsg(model.WarnReport, err))
		} else if data, rerr := os.ReadFile(rptPath); rerr == nil {
			res.Report = string(data)
		}
	}

	qwarn, err := readSeries(nodes, links, &res.Times, qualityOn)
	if err != nil {
		res.Error = model.ErrMsg(model.ErrReadSeries, err)
		return res
	}
	if qwarn != nil {
		res.Warnings = append(res.Warnings, qwarn)
	}

	res.Statistics = readStatistics()

	// Multi-species analysis runs last, file-coupled to the saved hydraulics.
	// Best-effort: any failure degrades to a warning, never aborting hydraulics.
	if msxOn {
		if mres, mwarn := runMSX(msxPath, hydPath, nodes, links); mwarn != nil {
			res.Warnings = append(res.Warnings, mwarn)
		} else {
			res.MSX = mres
		}
	}

	res.Nodes = nodes
	res.Links = links
	res.OK = true
	return res
}

// runMSX executes the multi-species analysis by file-coupling the saved EPANET
// hydraulics (.hyd) with the generated .msx chemistry. EPANET must still be open
// and the caller must hold epanet.Lock() (MSX shares EPANET's global state).
// Returns a warning Msg on any failure; the result is nil in that case.
func runMSX(msxPath, hydPath string, nodes []model.NodeSeries, links []model.LinkSeries) (*model.MSXResult, *model.Msg) {
	if !msx.Ready() {
		return nil, model.NewMsg(model.WarnMSXNotLoaded)
	}
	if err := msx.Open(msxPath); err != nil {
		return nil, model.ErrMsg(model.WarnMSXOpen, err)
	}
	defer msx.Close()
	if err := msx.UseHydFile(hydPath); err != nil {
		return nil, model.ErrMsg(model.WarnMSXUseHyd, err)
	}
	return readMSXSeries(nodes, links)
}

// readMSXSeries steps the MSX quality solver over the whole period, sampling
// every species at every node/link. MSXinit sets t=0 to the initial [QUALITY]
// values; each MSXstep advances and returns the new time, so the initial state
// is sampled before the first step and the loop ends when no time remains.
func readMSXSeries(nodes []model.NodeSeries, links []model.LinkSeries) (*model.MSXResult, *model.Msg) {
	nspec, err := msx.SpeciesCount()
	if err != nil {
		return nil, model.ErrMsg(model.WarnMSXSpeciesCnt, err)
	}
	if nspec == 0 {
		return nil, model.NewMsg(model.WarnMSXNoSpecies)
	}
	meta := make([]model.MSXSpeciesMeta, nspec)
	for s := 1; s <= nspec; s++ {
		id, _ := msx.ID(msx.Species, s)
		info, err := msx.SpeciesAt(s)
		if err != nil {
			return nil, model.ErrMsg(model.WarnMSXSpeciesAttr, err)
		}
		typ := "BULK"
		if info.Type == msx.Wall {
			typ = "WALL"
		}
		meta[s-1] = model.MSXSpeciesMeta{ID: id, Type: typ, Units: info.Units}
	}

	mn := make([]model.MSXNodeSeries, len(nodes))
	for i, nd := range nodes {
		mn[i] = model.MSXNodeSeries{ID: nd.ID, Index: nd.Index, Conc: make([][]float64, nspec)}
	}
	ml := make([]model.MSXLinkSeries, len(links))
	for i, lk := range links {
		ml[i] = model.MSXLinkSeries{ID: lk.ID, Index: lk.Index, Conc: make([][]float64, nspec)}
	}
	out := &model.MSXResult{Species: meta, Nodes: mn, Links: ml}

	if err := msx.InitQual(0); err != nil {
		return nil, model.ErrMsg(model.WarnMSXInit, err)
	}
	sample := func(t int64) {
		out.Times = append(out.Times, t)
		for s := 1; s <= nspec; s++ {
			for i := range mn {
				v, _ := msx.Qual(msx.Node, mn[i].Index, s)
				mn[i].Conc[s-1] = append(mn[i].Conc[s-1], sanitize(v))
			}
			for i := range ml {
				v, _ := msx.Qual(msx.Link, ml[i].Index, s)
				ml[i].Conc[s-1] = append(ml[i].Conc[s-1], sanitize(v))
			}
		}
	}
	sample(0)
	for {
		t, tleft, err := msx.Step()
		if err != nil {
			return nil, model.ErrMsg(model.WarnMSXStep, err)
		}
		sample(t)
		if tleft <= 0 {
			break
		}
	}
	return out, nil
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
func readSeries(nodes []model.NodeSeries, links []model.LinkSeries, times *[]int64, qualityOn bool) (*model.Msg, error) {
	if err := epanet.OpenH(); err != nil {
		return nil, err
	}
	defer epanet.CloseH()
	if err := epanet.InitH(epanet.NoSave); err != nil {
		return nil, err
	}

	qActive := false
	var qWarn *model.Msg
	qwarn := func(step string, err error) *model.Msg {
		return model.NewMsg(model.WarnQuality).WithDetail(step + ": " + err.Error())
	}
	if qualityOn {
		if err := epanet.OpenQ(); err != nil {
			qWarn = qwarn("openQ", err)
		} else if err := epanet.InitQ(epanet.NoSave); err != nil {
			qWarn = qwarn("initQ", err)
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
				ef, _ := epanet.NodeValue(nd.Index, epanet.NEmitterFlow)
				nd.EmitterFlow = append(nd.EmitterFlow, sanitize(ef))
				lf, _ := epanet.NodeValue(nd.Index, epanet.NLeakageFlow)
				nd.LeakageFlow = append(nd.LeakageFlow, sanitize(lf))
				df, _ := epanet.NodeValue(nd.Index, epanet.NDemandFlow)
				nd.DemandFlow = append(nd.DemandFlow, sanitize(df))
				fd, _ := epanet.NodeValue(nd.Index, epanet.NFullDemand)
				nd.FullDemand = append(nd.FullDemand, sanitize(fd))
			}
			if qualityOn {
				sm, _ := epanet.NodeValue(nd.Index, epanet.NSourceMass)
				nd.SourceMass = append(nd.SourceMass, sanitize(sm))
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
			case lk.Type == "PIPE":
				lg, _ := epanet.LinkValue(lk.Index, epanet.LLinkLeakage)
				lk.Leakage = append(lk.Leakage, sanitize(lg))
			}
		}
		if qActive {
			if _, err := epanet.RunQ(); err != nil {
				qWarn = qwarn("runQ", err)
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
					qWarn = qwarn("nextQ", err)
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