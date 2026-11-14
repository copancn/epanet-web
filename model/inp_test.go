package model

import "testing"

// TestAdvancedRoundTrip checks that the extended INP sections survive a
// ToINP -> ParseINP cycle.
func TestAdvancedRoundTrip(t *testing.T) {
	n := &Network{
		Title: "round trip",
		Nodes: []Node{
			{ID: "J1", Type: "JUNCTION", Elevation: 10, Demand: 5, DemandPat: "P1",
				Demands:  []Demand{{Base: 2, Pattern: "P1", Name: "industrial"}},
				Emitter:  0.5, SourceType: "MASS", SourceQual: 1.2, SourcePat: "P1",
				InitQual: 0.3, Tag: "zone-a"},
			{ID: "R1", Type: "RESERVOIR", Head: 50},
			{ID: "T1", Type: "TANK", Elevation: 20, InitLevel: 5, MinLevel: 1, MaxLevel: 10,
				Diameter: 10, MixModel: "FIFO", MixFraction: 0.5, TankKBulk: -0.3, CanOverflow: true},
		},
		Links: []Link{
			{ID: "P1", Type: "PIPE", From: "R1", To: "J1", Length: 100, Diameter: 200,
				Roughness: 100, KBulk: -0.5, KWall: -0.1, LeakArea: 0.2, LeakExpan: 1.5},
			{ID: "PU1", Type: "PUMP", From: "J1", To: "T1", HeadCurve: "C1",
				EffCurve: "E1", Price: 0.12, PricePat: "P1"},
			{ID: "V1", Type: "PCV", From: "T1", To: "J1", Diameter: 200,
				Setting: 50, MinorLoss: 0.1, HeadCurve: "VC1"},
		},
		Patterns: []Pattern{{ID: "P1", Values: []float64{1, 1.2, 0.8}}},
		Curves: []Curve{
			{ID: "C1", Type: "PUMP", Points: []Point{{X: 0, Y: 50}, {X: 100, Y: 30}}},
			{ID: "E1", Type: "EFFICIENCY", Points: []Point{{X: 0, Y: 50}, {X: 100, Y: 70}}},
			{ID: "VC1", Type: "VALVE", Points: []Point{{X: 0, Y: 0}, {X: 100, Y: 10}}},
		},
		Rules: []string{"RULE 1\nIF NODE J1 PRESSURE > 10\nTHEN PUMP PU1 STATUS = OPEN"},
		Options: Options{
			FlowUnits: "LPS", HeadLoss: "H-W", DemandMult: 1, Trials: 40,
			Accuracy: 0.001, Tolerance: 0.01, Unbalanced: 10,
			PressureUnits: "METERS", SpecificGravity: 1.0, Viscosity: 1.0,
			Diffusivity: 1.0, EmitterExponent: 0.5, EmitterBackflow: true,
			DefaultPattern: "P1", CheckFreq: 2, MaxCheck: 10, DampLimit: 0.001,
			HeadError: 0.1, FlowChange: 0.05,
		},
		Times:       Times{Duration: 86400, HydStep: 3600, RuleStep: 300, Statistic: "NONE"},
		Quality:     Quality{Type: "CHEM", ChemName: "Chlorine", ChemUnits: "mg/L"},
		Reactions:   Reactions{BulkOrder: 1, WallOrder: 0, GlobalBulk: -0.5, GlobalWall: -0.1, LimitingPot: 0, RoughCorrel: 0.2},
		Energy:      Energy{GlobalEfficiency: 75, GlobalPrice: 0.1, PricePattern: "P1", DemandCharge: 0.05},
		DemandModel: DemandModel{Type: "PDA", Pmin: 0, Preq: 20, Pexp: 0.5},
	}

	got := ParseINP(n.ToINP())

	findNode := func(id string) *Node {
		for i := range got.Nodes {
			if got.Nodes[i].ID == id {
				return &got.Nodes[i]
			}
		}
		return nil
	}
	findLink := func(id string) *Link {
		for i := range got.Links {
			if got.Links[i].ID == id {
				return &got.Links[i]
			}
		}
		return nil
	}

	j1 := findNode("J1")
	if j1 == nil {
		t.Fatal("J1 missing")
	}
	if j1.Demand != 5 || j1.DemandPat != "P1" {
		t.Errorf("primary demand lost: %+v", j1)
	}
	if len(j1.Demands) != 1 || j1.Demands[0].Base != 2 || j1.Demands[0].Name != "industrial" {
		t.Errorf("extra demand lost: %+v", j1.Demands)
	}
	if j1.Emitter != 0.5 || j1.SourceType != "MASS" || j1.SourceQual != 1.2 || j1.SourcePat != "P1" {
		t.Errorf("emitter/source lost: %+v", j1)
	}
	if j1.InitQual != 0.3 || j1.Tag != "zone-a" {
		t.Errorf("initqual/tag lost: %+v", j1)
	}

	t1 := findNode("T1")
	if t1 == nil || t1.MixModel != "FIFO" || t1.MixFraction != 0.5 || t1.TankKBulk != -0.3 || !t1.CanOverflow {
		t.Errorf("tank mixing/overflow lost: %+v", t1)
	}

	p1 := findLink("P1")
	if p1 == nil || p1.KBulk != -0.5 || p1.KWall != -0.1 || p1.LeakArea != 0.2 || p1.LeakExpan != 1.5 {
		t.Errorf("pipe reactions/leakage lost: %+v", p1)
	}

	pu1 := findLink("PU1")
	if pu1 == nil || pu1.EffCurve != "E1" || pu1.Price != 0.12 || pu1.PricePat != "P1" {
		t.Errorf("pump energy lost: %+v", pu1)
	}

	if len(got.Rules) != 1 {
		t.Errorf("rules lost: %+v", got.Rules)
	}
	if got.Reactions.BulkOrder != 1 || got.Reactions.GlobalBulk != -0.5 || got.Reactions.RoughCorrel != 0.2 {
		t.Errorf("reactions lost: %+v", got.Reactions)
	}
	if got.Energy.GlobalEfficiency != 75 || got.Energy.GlobalPrice != 0.1 || got.Energy.DemandCharge != 0.05 {
		t.Errorf("energy lost: %+v", got.Energy)
	}
	if got.DemandModel.Type != "PDA" || got.DemandModel.Preq != 20 || got.DemandModel.Pexp != 0.5 {
		t.Errorf("demand model lost: %+v", got.DemandModel)
	}
	if got.Options.PressureUnits != "METERS" || !got.Options.EmitterBackflow || got.Options.CheckFreq != 2 {
		t.Errorf("advanced options lost: %+v", got.Options)
	}
	if got.Times.RuleStep != 300 {
		t.Errorf("rule step lost: %d", got.Times.RuleStep)
	}
	if len(got.Curves) != 3 || got.Curves[1].Type != "EFFICIENCY" || got.Curves[2].Type != "VALVE" {
		t.Errorf("curve types lost: %+v", got.Curves)
	}
	v1 := findLink("V1")
	if v1 == nil || v1.Type != "PCV" || v1.Setting != 50 || v1.HeadCurve != "VC1" || v1.MinorLoss != 0.1 {
		t.Errorf("PCV setting/curve lost: %+v", v1)
	}

	// Verify UNBALANCED STOP round-trip.
	n.Options.UnbalancedStop = true
	gotStop := ParseINP(n.ToINP())
	if !gotStop.Options.UnbalancedStop {
		t.Errorf("UNBALANCED STOP lost: %+v", gotStop.Options)
	}
}