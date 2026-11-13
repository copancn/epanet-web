package model

// Example returns a small looped network with a reservoir, a controlled pump,
// a storage tank and diurnal demands — a good starting point for the editor.
func Example() *Network {
	n := &Network{
		Title:   "示例管网 · 水库+水泵+水池+环状需水",
		Options: DefaultOptions(),
		Times:   DefaultTimes(),
		Quality: Quality{Type: "NONE"},
	}
	n.Nodes = []Node{
		{ID: "R1", Type: "RESERVOIR", X: 80, Y: 460, Head: 15},
		{ID: "J1", Type: "JUNCTION", X: 260, Y: 460, Elevation: 20, Demand: 0, DemandPat: "DEMAND"},
		{ID: "J2", Type: "JUNCTION", X: 460, Y: 460, Elevation: 20, Demand: 15, DemandPat: "DEMAND"},
		{ID: "J3", Type: "JUNCTION", X: 660, Y: 460, Elevation: 18, Demand: 20, DemandPat: "DEMAND"},
		{ID: "T1", Type: "TANK", X: 880, Y: 460, Elevation: 20, InitLevel: 8, MinLevel: 2, MaxLevel: 16, Diameter: 25, MinVol: 0},
		{ID: "J4", Type: "JUNCTION", X: 460, Y: 250, Elevation: 12, Demand: 25, DemandPat: "DEMAND"},
		{ID: "J5", Type: "JUNCTION", X: 660, Y: 250, Elevation: 14, Demand: 18, DemandPat: "DEMAND"},
	}
	n.Links = []Link{
		{ID: "PUMP1", Type: "PUMP", From: "R1", To: "J1", HeadCurve: "PCurve", Speed: 1},
		{ID: "P1", Type: "PIPE", From: "J1", To: "J2", Length: 400, Diameter: 300, Roughness: 100, Status: "OPEN"},
		{ID: "P2", Type: "PIPE", From: "J2", To: "J3", Length: 400, Diameter: 250, Roughness: 100, Status: "OPEN"},
		{ID: "P3", Type: "PIPE", From: "J3", To: "T1", Length: 400, Diameter: 250, Roughness: 100, Status: "OPEN"},
		{ID: "P4", Type: "PIPE", From: "J2", To: "J4", Length: 300, Diameter: 200, Roughness: 100, Status: "OPEN"},
		{ID: "P5", Type: "PIPE", From: "J4", To: "J5", Length: 400, Diameter: 200, Roughness: 100, Status: "OPEN"},
		{ID: "P6", Type: "PIPE", From: "J5", To: "J3", Length: 300, Diameter: 200, Roughness: 100, Status: "OPEN"},
	}
	n.Patterns = []Pattern{
		{ID: "DEMAND", Values: []float64{
			0.6, 0.5, 0.4, 0.4, 0.5, 0.7, 1.0, 1.3, 1.4, 1.3, 1.2, 1.1,
			1.0, 1.0, 1.1, 1.2, 1.3, 1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.6,
		}},
	}
	n.Curves = []Curve{
		{ID: "PCurve", Type: "PUMP", Points: []Point{{X: 0, Y: 55}, {X: 40, Y: 45}, {X: 80, Y: 25}}},
	}
	n.Controls = []string{
		"LINK PUMP1 OPEN IF NODE T1 BELOW 6",
		"LINK PUMP1 CLOSED IF NODE T1 ABOVE 14",
	}
	return n
}