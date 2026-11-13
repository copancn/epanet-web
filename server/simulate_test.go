package server

import (
	"os"
	"path/filepath"
	"testing"

	"epanet-web/epanet"
	"epanet-web/model"
)

func TestMain(m *testing.M) {
	// DLL lives at the project root, one level above this package dir.
	path, _ := filepath.Abs("../epanet2.dll")
	if err := epanet.Init(path); err != nil {
		panic(err)
	}
	os.Exit(m.Run())
}

func TestExampleHydraulics(t *testing.T) {
	net := model.Example()
	res := RunSimulation(net)
	if !res.OK {
		t.Fatalf("simulation failed: %s", res.Error)
	}
	if len(res.Times) < 2 {
		t.Fatalf("expected multiple periods, got %d", len(res.Times))
	}
	if len(res.Nodes) != len(net.Nodes) {
		t.Fatalf("node count mismatch: %d vs %d", len(res.Nodes), len(net.Nodes))
	}
	if len(res.Links) != len(net.Links) {
		t.Fatalf("link count mismatch: %d vs %d", len(res.Links), len(net.Links))
	}
	// every series must be aligned with the timeline
	for _, n := range res.Nodes {
		if len(n.Pressure) != len(res.Times) {
			t.Fatalf("node %s pressure series length %d != %d", n.ID, len(n.Pressure), len(res.Times))
		}
	}
	for _, l := range res.Links {
		if len(l.Flow) != len(res.Times) {
			t.Fatalf("link %s flow series length %d != %d", l.ID, len(l.Flow), len(res.Times))
		}
	}
	// reservoir head should be positive; tank level should vary over time
	var tank *model.NodeSeries
	for i := range res.Nodes {
		if res.Nodes[i].Type == "TANK" {
			tank = &res.Nodes[i]
		}
	}
	if tank == nil {
		t.Fatal("no tank in results")
	}
	minH, maxH := tank.Head[0], tank.Head[0]
	for _, h := range tank.Head {
		if h < minH {
			minH = h
		}
		if h > maxH {
			maxH = h
		}
	}
	if maxH-minH < 0.01 {
		t.Logf("warning: tank head barely varies (%.3f..%.3f) — controls may not be active", minH, maxH)
	}
	t.Logf("periods=%d nodes=%d links=%d tankHead=%.2f..%.2f warnings=%v",
		len(res.Times), len(res.Nodes), len(res.Links), minH, maxH, res.Warnings)
}

func TestWaterQualityAge(t *testing.T) {
	net := model.Example()
	net.Quality = model.Quality{Type: "AGE"}
	res := RunSimulation(net)
	if !res.OK {
		t.Fatalf("age simulation failed: %s", res.Error)
	}
	if res.Units.Quality != "h" {
		t.Fatalf("expected quality unit h, got %q", res.Units.Quality)
	}
	// quality arrays must be present and aligned
	for _, n := range res.Nodes {
		if len(n.Quality) != len(res.Times) {
			t.Fatalf("node %s quality series not aligned", n.ID)
		}
	}
	// at the final period some node should have accumulated age > 0
	last := len(res.Times) - 1
	anyAge := false
	for _, n := range res.Nodes {
		if n.Quality[last] > 0 {
			anyAge = true
		}
	}
	if !anyAge {
		t.Fatal("expected non-zero water age at final period")
	}
	t.Logf("age analysis OK, final-period sample: %s age=%.2f h", res.Nodes[len(res.Nodes)-1].ID, res.Nodes[len(res.Nodes)-1].Quality[last])
}

func TestINPRoundTrip(t *testing.T) {
	net := model.Example()
	inp := net.ToINP()
	parsed := model.ParseINP(inp)
	if len(parsed.Nodes) != len(net.Nodes) {
		t.Fatalf("round-trip node count: %d vs %d", len(parsed.Nodes), len(net.Nodes))
	}
	if len(parsed.Links) != len(net.Links) {
		t.Fatalf("round-trip link count: %d vs %d", len(parsed.Links), len(net.Links))
	}
	if len(parsed.Patterns) != len(net.Patterns) {
		t.Fatalf("round-trip pattern count: %d vs %d", len(parsed.Patterns), len(net.Patterns))
	}
	if len(parsed.Curves) != len(net.Curves) {
		t.Fatalf("round-trip curve count: %d vs %d", len(parsed.Curves), len(net.Curves))
	}
	if parsed.Times.Duration != net.Times.Duration {
		t.Fatalf("round-trip duration: %d vs %d", parsed.Times.Duration, net.Times.Duration)
	}
	// re-simulate the parsed network to ensure it is valid
	res := RunSimulation(parsed)
	if !res.OK {
		t.Fatalf("re-simulation of parsed INP failed: %s", res.Error)
	}
}